#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/stat.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/syscall.h>
#include <unistd.h>

static bool same_inode(const struct stat *a,const struct stat *b)
{return a->st_dev==b->st_dev&&a->st_ino==b->st_ino;}

static int mount_id(int fd,uint64_t *id)
{
#if defined(SYS_statx) && defined(STATX_MNT_ID) && !defined(Z2M_NO_STATX)
	struct statx st;if(syscall(SYS_statx,fd,"",AT_EMPTY_PATH|AT_STATX_SYNC_AS_STAT,STATX_MNT_ID,&st)<0||!(st.stx_mask&STATX_MNT_ID)){errno=ENOTSUP;return -1;}*id=st.stx_mnt_id;return 0;
#else
	(void)fd;(void)id;errno=ENOTSUP;return -1;
#endif
}

static const char *open_code(int e)
{if(e==ENOENT)return "ENOENT";if(e==ELOOP)return "ESYMLINK";if(e==EXDEV)return "EXDEV";if(e==ENOTDIR)return "ENOTREG";if(e==EACCES)return "EDENIED";return "EIO";}

static const char *entry_code(int parent,const char *name,int e)
{struct stat st;if((e==ENOTDIR||e==ELOOP)&&fstatat(parent,name,&st,AT_SYMLINK_NOFOLLOW)==0&&S_ISLNK(st.st_mode))return "ESYMLINK";return open_code(e);}

static int fail(const struct z2m_request *r,const char *code,const char *stage)
{return z2m_fail(r->request_id,code,stage);}

static int verified_dir(int fd,uint64_t root_mount,const char **code)
{struct stat st;uint64_t id;if(fstat(fd,&st)<0){*code="EIO";return -1;}if(!S_ISDIR(st.st_mode)){*code="ENOTREG";return -1;}if(mount_id(fd,&id)<0){*code="ECAPABILITY";return -1;}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_MNT_ID_CHANGE")!=NULL)id=root_mount+1;
#endif
	if(id!=root_mount){*code="EXDEV";return -1;}if(st.st_uid!=0||st.st_gid!=0||(st.st_mode&07777)!=0700){*code="EDENIED";return -1;}return 0;}

static int open_parent(int root,const char *path,uint64_t root_mount,const char **code)
{char *copy,*part,*save=NULL;int parent=dup(root),child;if(path[0]=='\0')return parent;copy=strdup(path);if(copy==NULL||parent<0){free(copy);if(parent>=0)close(parent);*code="EIO";return -1;}for(part=strtok_r(copy,"/",&save);part;part=strtok_r(NULL,"/",&save)){child=openat(parent,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0){*code=entry_code(parent,part,errno);close(parent);free(copy);return -1;}if(verified_dir(child,root_mount,code)<0){close(child);close(parent);free(copy);return -1;}close(parent);parent=child;}free(copy);return parent;}

static bool regular_policy(const struct stat *st)
{return S_ISREG(st->st_mode)&&st->st_uid==0&&st->st_gid==0&&(st->st_mode&07777)==0600;}

static const char *target_code(const struct stat *st)
{if(S_ISLNK(st->st_mode))return "ESYMLINK";if(S_ISCHR(st->st_mode)||S_ISBLK(st->st_mode))return "EDENIED";if(!S_ISREG(st->st_mode))return "ENOTREG";return "EDENIED";}

static int candidate_name(char out[44])
{unsigned char random[16];static const char hex[]="0123456789abcdef";ssize_t got;
#ifdef Z2M_TESTING
	static unsigned int sequence;if(getenv("Z2M_TEST_ATOMIC_COLLISION")!=NULL){memset(random,0,sizeof(random));random[15]=(unsigned char)sequence++;goto format;}
#endif
	do got=getrandom(random,sizeof(random),0);while(got<0&&errno==EINTR);if(got!=(ssize_t)sizeof(random))return -1;
#ifdef Z2M_TESTING
format:
#endif
	memcpy(out,".z2m-write-",11);for(size_t i=0;i<16;i++){out[11+i*2]=hex[random[i]>>4];out[12+i*2]=hex[random[i]&15];}out[43]='\0';return 0;}

static bool named_candidate(int parent,const char *name,const struct stat *created)
{struct stat st;return fstatat(parent,name,&st,AT_SYMLINK_NOFOLLOW)==0&&S_ISREG(st.st_mode)&&same_inode(&st,created);}

static void gate(const char *env,const char *candidate);

static int cleanup(const struct z2m_root *root,int parent,const char *name,const struct stat *created)
{if(!named_candidate(parent,name,created))return -1;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_CLEANUP_AMBIGUOUS")!=NULL)return -1;
#endif
	if(unlinkat(parent,name,0)<0)return -1;
	if(root->directory_fsync&&fsync(parent)<0)return -1;
	gate("Z2M_TEST_ATOMIC_STOP_AFTER_CLEANUP",NULL);return 0;}

static bool fault(const char *phase)
{
#ifdef Z2M_TESTING
	const char *value=getenv("Z2M_TEST_ATOMIC_FAULT");return value!=NULL&&strcmp(value,phase)==0;
#else
	(void)phase;return false;
#endif
}

static bool directory_fsync_error(void)
{
#ifdef Z2M_TESTING
	return getenv("Z2M_TEST_DIRECTORY_FSYNC_ERROR")!=NULL;
#else
	return false;
#endif
}

static void gate(const char *env,const char *candidate)
{
#ifdef Z2M_TESTING
	if(getenv(env)!=NULL){if(candidate)fprintf(stderr,"z2m-core-helper: candidate=%s lock-gate-pid=%ld\n",candidate,(long)getpid());else fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#else
	(void)env;(void)candidate;
#endif
}

static ssize_t write_data(int fd,const void *data,size_t length)
{
#ifdef Z2M_TESTING
	static bool interrupted;if(getenv("Z2M_TEST_ATOMIC_WRITE_ERROR")!=NULL){errno=EIO;return -1;}if(getenv("Z2M_TEST_ATOMIC_WRITE_ZERO")!=NULL)return 0;if(getenv("Z2M_TEST_ATOMIC_WRITE_SHIM")!=NULL){if(!interrupted){interrupted=true;errno=EINTR;return -1;}if(length>3)length=3;}
#endif
	return write(fd,data,length);
}

static unsigned char decode_char(unsigned char c)
{if(c>='A'&&c<='Z')return c-'A';if(c>='a'&&c<='z')return c-'a'+26;if(c>='0'&&c<='9')return c-'0'+52;return c=='+'?62:63;}

static unsigned char *decode(const char *wire,size_t *length)
{size_t n=strlen(wire),padding=n?(wire[n-1]=='=')+(n>1&&wire[n-2]=='='):0,o=0;*length=n/4*3-padding;unsigned char *out=malloc(*length?*length:1);if(out==NULL)return NULL;for(size_t i=0;i<n;i+=4){unsigned int v=(decode_char(wire[i])<<18)|(decode_char(wire[i+1])<<12)|((wire[i+2]=='='?0:decode_char(wire[i+2]))<<6)|(wire[i+3]=='='?0:decode_char(wire[i+3]));if(o<*length)out[o++]=(unsigned char)(v>>16);if(o<*length)out[o++]=(unsigned char)(v>>8);if(o<*length)out[o++]=(unsigned char)v;}return out;}

static int success(const struct z2m_request *r,size_t length,const char *durability)
{json_object *data=z2m_json_object();if(!z2m_json_add(data,"byteLength",z2m_json_int((int64_t)length))||!z2m_json_add(data,"committed",z2m_json_bool(true))||!z2m_json_add(data,"durability",z2m_json_string(durability))){json_object_put(data);return fail(r,"EINTERNAL","response_encode");}return z2m_success(r->request_id,data);}

int z2m_atomic_write(const struct z2m_request *r,const struct z2m_root *root,int root_fd,uint64_t root_mount)
{
	json_object *path_value,*content_value,*create_value;const char *path,*wire,*code=NULL,*pending_code=NULL,*pending_stage=NULL;bool allow_create,had_target=false,published=false;char *copy,*name,*slash,parent_path[4097],candidate[44]={0};unsigned char *content=NULL;size_t length=0,written=0;int parent=-1,check=-1,target=-1,fd=-1,final=-1,result;struct stat parent_st,check_st,target_st,current_st,created,fd_st,final_st;
	json_object_object_get_ex(r->arguments,"path",&path_value);json_object_object_get_ex(r->arguments,"content",&content_value);json_object_object_get_ex(r->arguments,"allowCreate",&create_value);path=json_object_get_string(path_value);wire=json_object_get_string(content_value);allow_create=json_object_get_boolean(create_value);if(!z2m_path_valid(path,root->max_depth))return fail(r,"EPATH","path_validate");content=decode(wire,&length);if(content==NULL)return fail(r,"EIO","write");
	copy=strdup(path);if(copy==NULL){free(content);return fail(r,"EIO","object_open");}slash=strrchr(copy,'/');if(slash==NULL){parent_path[0]='\0';name=copy;}else{*slash='\0';strcpy(parent_path,copy);name=slash+1;}
	parent=open_parent(root_fd,parent_path,root_mount,&code);if(parent<0){free(copy);free(content);return fail(r,code,strcmp(code,"EDENIED")==0?"policy":(strcmp(code,"ENOTREG")==0?"object_verify":"path_resolve"));}if(fstat(parent,&parent_st)<0){result=fail(r,"EIO","object_open");goto done;}
	target=openat(parent,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(target>=0){had_target=true;if(fstat(target,&target_st)<0){result=fail(r,"EIO","stat");goto done;}if(!regular_policy(&target_st)){code=target_code(&target_st);result=fail(r,code,strcmp(code,"EDENIED")==0?"policy":"object_verify");goto done;}close(target);target=-1;}else if(errno==ELOOP){result=fail(r,"ESYMLINK","object_open");goto done;}else if(errno!=ENOENT){struct stat st;if(fstatat(parent,name,&st,AT_SYMLINK_NOFOLLOW)==0){code=target_code(&st);result=fail(r,code,strcmp(code,"EDENIED")==0?"policy":"object_verify");}else result=fail(r,entry_code(parent,name,errno),"object_open");goto done;}else if(!allow_create){result=fail(r,"ENOENT","object_open");goto done;}
	gate("Z2M_TEST_ATOMIC_STOP_BEFORE_CREATE",NULL);if(fault("before_create")){result=fail(r,"EIO","object_open");goto done;}check=open_parent(root_fd,parent_path,root_mount,&code);if(check<0||fstat(check,&check_st)<0||!same_inode(&parent_st,&check_st)){if(check>=0)close(check);check=-1;result=fail(r,"EIO","object_open");goto done;}close(check);check=-1;
	for(unsigned int attempt=0;;attempt++){if(attempt==8||candidate_name(candidate)<0){result=fail(r,"EIO","object_open");goto done;}fd=openat(parent,candidate,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd>=0)break;if(errno!=EEXIST){result=fail(r,open_code(errno),"object_open");goto done;}if(fstatat(parent,candidate,&current_st,AT_SYMLINK_NOFOLLOW)<0||!S_ISREG(current_st.st_mode)){result=fail(r,"EIO","object_open");goto done;}}
	if(fstat(fd,&created)<0||!S_ISREG(created.st_mode)){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}gate("Z2M_TEST_ATOMIC_STOP_AFTER_CREATE",candidate);if(fault("after_create")||fault("before_write")){pending_code="EIO";pending_stage="write";goto clean;}
	while(written<length){ssize_t n=write_data(fd,content+written,length-written);if(n<0&&errno==EINTR)continue;if(n<=0){pending_code="EIO";pending_stage="write";goto clean;}written+=(size_t)n;}if(fault("after_write")||fault("before_chown")){pending_code="EIO";pending_stage="write";goto clean;}if(fchown(fd,0,0)<0){pending_code="EIO";pending_stage="write";goto clean;}if(fault("after_chown")||fault("before_chmod")){pending_code="EIO";pending_stage="write";goto clean;}if(fchmod(fd,0600)<0){pending_code="EIO";pending_stage="write";goto clean;}if(fault("after_chmod")||fault("before_file_fsync")){pending_code="EIO";pending_stage="file_fsync";goto clean;}if(fsync(fd)<0){pending_code="EIO";pending_stage="file_fsync";goto clean;}if(fault("after_file_fsync")||fault("before_candidate_verify")){pending_code="EIO";pending_stage="file_fsync";goto clean;}if(fstat(fd,&fd_st)<0||!same_inode(&created,&fd_st)||!regular_policy(&fd_st)||fd_st.st_size!=(off_t)length||!named_candidate(parent,candidate,&created)){pending_code="EIO";pending_stage="object_open";goto clean;}if(fault("after_candidate_verify")||fault("before_cas")){pending_code="EIO";pending_stage="object_open";goto clean;}
	gate("Z2M_TEST_ATOMIC_STOP_BEFORE_CAS",candidate);check=open_parent(root_fd,parent_path,root_mount,&code);if(check<0||fstat(check,&check_st)<0||!same_inode(&parent_st,&check_st)){if(check>=0)close(check);check=-1;pending_code="EIO";pending_stage="object_open";goto clean;}if(fstatat(check,name,&current_st,AT_SYMLINK_NOFOLLOW)==0){if(!had_target||!same_inode(&target_st,&current_st)||!regular_policy(&current_st)){pending_code="EIO";pending_stage="object_open";goto clean;}}else if(errno!=ENOENT||had_target){pending_code="EIO";pending_stage="object_open";goto clean;}if(!named_candidate(parent,candidate,&created)){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}if(fault("after_cas")||fault("before_rename")){pending_code="EIO";pending_stage="rename";goto clean;}if(renameat(parent,candidate,check,name)<0){pending_code="EIO";pending_stage="rename";goto clean;}published=true;candidate[0]='\0';close(check);check=-1;if(fault("after_rename")||fault("before_parent_fsync")){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}if(root->directory_fsync){if(directory_fsync_error()||fsync(parent)<0){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}}if(fault("after_parent_fsync")||fault("before_final_verify")){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}
	gate("Z2M_TEST_ATOMIC_STOP_BEFORE_FINAL_VERIFY",NULL);final=open_parent(root_fd,parent_path,root_mount,&code);if(final<0){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}target=openat(final,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(target<0||fstat(target,&final_st)<0||!same_inode(&created,&final_st)||!regular_policy(&final_st)||final_st.st_size!=(off_t)length){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}if(fault("after_final_verify")){result=fail(r,"ECOMMITUNKNOWN","directory_fsync");goto done;}result=success(r,length,root->directory_fsync?"durable":"tmpfs_visible");goto done;
clean:
	if(candidate[0]&&cleanup(root,parent,candidate,&created)<0)result=fail(r,"ECOMMITUNKNOWN","directory_fsync");
	else result=fail(r,pending_code,pending_stage);
	candidate[0]='\0';
done:
	if(!published&&candidate[0]&&fd>=0&&named_candidate(parent,candidate,&created))cleanup(root,parent,candidate,&created);
	if(final>=0)close(final);
	if(check>=0)close(check);
	if(target>=0)close(target);
	if(fd>=0)close(fd);
	if(parent>=0)close(parent);
	free(copy);free(content);return result;
}
