#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
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
	z2m_statx st;if(syscall(SYS_statx,fd,"",AT_EMPTY_PATH|AT_STATX_SYNC_AS_STAT,STATX_MNT_ID,&st)<0||!(st.stx_mask&STATX_MNT_ID)){errno=ENOTSUP;return -1;}*id=st.stx_mnt_id;return 0;
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
{char copy[4097],*part,*save=NULL;int parent=dup(root),child;if(path[0]=='\0')return parent;if(parent<0||strlen(path)>=sizeof(copy)){if(parent>=0)close(parent);*code="EIO";return -1;}strcpy(copy,path);for(part=strtok_r(copy,"/",&save);part;part=strtok_r(NULL,"/",&save)){child=openat(parent,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0){*code=entry_code(parent,part,errno);close(parent);return -1;}if(verified_dir(child,root_mount,code)<0){close(child);close(parent);return -1;}close(parent);parent=child;}return parent;}

static bool regular_policy(const struct stat *st)
{return S_ISREG(st->st_mode)&&st->st_uid==0&&st->st_gid==0&&(st->st_mode&07777)==0600;}

static const char *target_code(const struct stat *st);

static int verified_regular(int fd,uint64_t root_mount,struct stat *st,const char **code,bool final)
{uint64_t id;if(fstat(fd,st)<0){*code="EIO";return -1;}
#ifdef Z2M_TESTING
	if(final&&getenv("Z2M_TEST_ATOMIC_FINAL_TYPE_ERROR")!=NULL)st->st_mode=(st->st_mode&~S_IFMT)|S_IFDIR;
#endif
	if(!regular_policy(st)){*code=target_code(st);return -1;}if(mount_id(fd,&id)<0){*code="ECAPABILITY";return -1;}
#ifdef Z2M_TESTING
	if(final&&getenv("Z2M_TEST_ATOMIC_FINAL_MNT_ID_CHANGE")!=NULL)id=root_mount+1;
#else
	(void)final;
#endif
	if(id!=root_mount){*code="EXDEV";return -1;}return 0;}

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

static void trace(const char *phase)
{
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_TRACE")!=NULL)fprintf(stderr,"z2m-core-helper: atomic-phase=%s\n",phase);
#else
	(void)phase;
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

static bool prepare_success(const struct z2m_request *r,size_t length,const char *durability,struct z2m_prepared_wire *wire)
{json_object *data=z2m_json_object();if(!z2m_json_add(data,"byteLength",z2m_json_int((int64_t)length))||!z2m_json_add(data,"committed",z2m_json_bool(true))||!z2m_json_add(data,"durability",z2m_json_string(durability))){json_object_put(data);return false;}return z2m_prepare_success_wire(r->request_id,data,wire);}

static bool rename_publish(int parent,const char *candidate,int check,const char *name,bool had_target)
{
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_RENAME_STALE_ERRNO")!=NULL)errno=EEXIST;
	if(getenv("Z2M_TEST_ATOMIC_RENAME_ERROR")!=NULL){errno=EIO;return false;}
#endif
	return syscall(SYS_renameat2,parent,candidate,check,name,had_target?0:RENAME_NOREPLACE)==0;
}

static int atomic_write_bytes_state(const struct z2m_request *r,const struct z2m_root *root,int root_fd,const char *path,const unsigned char *content,size_t length,bool allow_create,const char *expected,bool prelocked,uint64_t verified_mount)
{
	struct z2m_prepared_wire success_wire={0},unknown_wire={0};const char *code=NULL,*pending_code=NULL,*pending_stage=NULL;bool had_target=false,published=false;char *copy,*name,*slash,parent_path[4097],candidate[44]={0};size_t written=0;uint64_t root_mount=verified_mount;int parent=-1,check=-1,target=-1,fd=-1,final=-1,result;struct stat parent_st,check_st,target_st,current_st,created,fd_st,final_st;
	if(!prelocked){if(z2m_root_mount_id(root_fd,&root_mount,&code)<0)return fail(r,code,"path_resolve");if(z2m_root_lock(root_fd,false,&code)<0)return fail(r,code,"lock_acquire");}
	copy=strdup(path);if(copy==NULL)return fail(r,"EIO","object_open");
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_RESPONSE_PREPARE_ERROR")!=NULL){free(copy);return fail(r,"EINTERNAL","response_encode");}
#endif
	if(!prepare_success(r,length,root->directory_fsync?"durable":"tmpfs_visible",&success_wire)||!z2m_prepare_failure_wire(r->request_id,"ECOMMITUNKNOWN","directory_fsync",&unknown_wire)){z2m_discard_wire(&success_wire);free(copy);return fail(r,"EINTERNAL","response_encode");}slash=strrchr(copy,'/');if(slash==NULL){parent_path[0]='\0';name=copy;}else{*slash='\0';strcpy(parent_path,copy);name=slash+1;}
	parent=open_parent(root_fd,parent_path,root_mount,&code);if(parent<0){result=fail(r,code,strcmp(code,"EDENIED")==0?"policy":(strcmp(code,"ENOTREG")==0?"object_verify":"path_resolve"));goto done;}if(fstat(parent,&parent_st)<0){result=fail(r,"EIO","object_open");goto done;}
	target=openat(parent,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(target>=0){char actual[65];had_target=true;if(verified_regular(target,root_mount,&target_st,&code,false)<0){result=fail(r,code,strcmp(code,"EDENIED")==0?"policy":(strcmp(code,"EXDEV")==0||strcmp(code,"ECAPABILITY")==0?"path_resolve":"object_verify"));goto done;}if(expected!=NULL&&(z2m_sha256_fd_hex(target,root->max_read,actual)<0||strcmp(actual,expected)!=0)){result=fail(r,"ECONFLICT","precondition");goto done;}close(target);target=-1;}else if(errno==ELOOP){result=fail(r,"ESYMLINK","object_open");goto done;}else if(errno!=ENOENT){struct stat st;if(fstatat(parent,name,&st,AT_SYMLINK_NOFOLLOW)==0){code=target_code(&st);result=fail(r,code,strcmp(code,"EDENIED")==0?"policy":"object_verify");}else result=fail(r,entry_code(parent,name,errno),"object_open");goto done;}else if(!allow_create||expected!=NULL){result=fail(r,expected!=NULL?"ECONFLICT":"ENOENT",expected!=NULL?"precondition":"object_open");goto done;}
	gate("Z2M_TEST_ATOMIC_STOP_BEFORE_CREATE",NULL);if(fault("before_create")){result=fail(r,"EIO","object_open");goto done;}check=open_parent(root_fd,parent_path,root_mount,&code);if(check<0||fstat(check,&check_st)<0||!same_inode(&parent_st,&check_st)){if(check>=0)close(check);check=-1;result=fail(r,"EIO","object_open");goto done;}close(check);check=-1;
	for(unsigned int attempt=0;;attempt++){if(attempt==8||candidate_name(candidate)<0){result=fail(r,"EIO","object_open");goto done;}fd=openat(parent,candidate,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(fd>=0)break;if(errno!=EEXIST){result=fail(r,open_code(errno),"object_open");goto done;}if(fstatat(parent,candidate,&current_st,AT_SYMLINK_NOFOLLOW)<0||!S_ISREG(current_st.st_mode)){result=fail(r,"EIO","object_open");goto done;}}
	if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_ATOMIC_CANDIDATE_STAT_ERROR")!=NULL||
#endif
	   fstat(fd,&created)<0||!S_ISREG(created.st_mode)){result=fail(r,"ECLEANUPUNKNOWN","candidate_cleanup");candidate[0]='\0';goto done;}gate("Z2M_TEST_ATOMIC_STOP_AFTER_CREATE",candidate);if(fault("after_create")||fault("before_write")){pending_code="EIO";pending_stage="write";goto clean;}
	trace("write");while(written<length){ssize_t n=write_data(fd,content+written,length-written);if(n<0&&errno==EINTR)continue;if(n<=0){pending_code="EIO";pending_stage="write";goto clean;}written+=(size_t)n;}if(fault("after_write")||fault("before_chown")){pending_code="EIO";pending_stage="write";goto clean;}trace("fchown");if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_ATOMIC_CHOWN_ERROR")!=NULL||
#endif
	   fchown(fd,0,0)<0){pending_code="EIO";pending_stage="write";goto clean;}if(fault("after_chown")||fault("before_chmod")){pending_code="EIO";pending_stage="write";goto clean;}trace("fchmod");if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_ATOMIC_CHMOD_ERROR")!=NULL||
#endif
	   fchmod(fd,0600)<0){pending_code="EIO";pending_stage="write";goto clean;}if(fault("after_chmod")||fault("before_file_fsync")){pending_code="EIO";pending_stage="file_fsync";goto clean;}trace("file_fsync");if(fsync(fd)<0){pending_code="EIO";pending_stage="file_fsync";goto clean;}if(fault("after_file_fsync")||fault("before_candidate_verify")){pending_code="EIO";pending_stage="file_fsync";goto clean;}trace("candidate_stat");if(fstat(fd,&fd_st)<0||!same_inode(&created,&fd_st)||!regular_policy(&fd_st)||fd_st.st_size!=(off_t)length){pending_code="EIO";pending_stage="object_open";goto clean;}trace("candidate_name");if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_ATOMIC_CANDIDATE_NAME_ERROR")!=NULL||
#endif
	   !named_candidate(parent,candidate,&created)){pending_code="EIO";pending_stage="object_open";goto clean;}if(fault("after_candidate_verify")||fault("before_cas")){pending_code="EIO";pending_stage="object_open";goto clean;}
	gate("Z2M_TEST_ATOMIC_STOP_BEFORE_CAS",candidate);check=open_parent(root_fd,parent_path,root_mount,&code);if(check<0||fstat(check,&check_st)<0||!same_inode(&parent_st,&check_st)){if(check>=0)close(check);check=-1;pending_code="EIO";pending_stage="object_open";goto clean;}trace("cas");if(fstatat(check,name,&current_st,AT_SYMLINK_NOFOLLOW)==0){if(!had_target||!same_inode(&target_st,&current_st)||!regular_policy(&current_st)){pending_code="ECONFLICT";pending_stage="precondition";goto clean;}}else if(errno!=ENOENT||had_target){pending_code="ECONFLICT";pending_stage="precondition";goto clean;}if(!named_candidate(parent,candidate,&created)){pending_code="EIO";pending_stage="object_open";goto clean;}if(fault("after_cas")||fault("before_rename")){pending_code="EIO";pending_stage="rename";goto clean;}gate("Z2M_TEST_ATOMIC_STOP_BEFORE_RENAME",candidate);trace("rename");if(!rename_publish(parent,candidate,check,name,had_target)){if(!had_target&&errno==EEXIST){pending_code="ECONFLICT";pending_stage="precondition";}else{pending_code="EIO";pending_stage="rename";}goto clean;}published=true;z2m_response_publication_started();
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_DIRECT_POST_PUBLICATION_PROBE")!=NULL)z2m_test_direct_post_publication_probe();
#endif
	candidate[0]='\0';close(check);check=-1;if(fault("after_rename")||fault("before_parent_fsync")){result=z2m_emit_wire(&unknown_wire,6);goto done;}if(root->directory_fsync){trace("parent_fsync");if(directory_fsync_error()||fsync(parent)<0){result=z2m_emit_wire(&unknown_wire,6);goto done;}}if(fault("after_parent_fsync")||fault("before_final_verify")){result=z2m_emit_wire(&unknown_wire,6);goto done;}
	gate("Z2M_TEST_ATOMIC_STOP_BEFORE_FINAL_VERIFY",NULL);trace("final_verify");
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_FINAL_PARENT_ERROR")!=NULL){errno=EIO;final=-1;}
	else final=open_parent(root_fd,parent_path,root_mount,&code);
#else
	final=open_parent(root_fd,parent_path,root_mount,&code);
#endif
	if(final<0){result=z2m_emit_wire(&unknown_wire,6);goto done;}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_FINAL_OPEN_MISSING")!=NULL){errno=ENOENT;target=-1;}
	else target=openat(final,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
#else
	target=openat(final,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);
#endif
	if(target<0){result=z2m_emit_wire(&unknown_wire,6);goto done;}if(verified_regular(target,root_mount,&final_st,&code,true)<0){result=z2m_emit_wire(&unknown_wire,6);goto done;}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ATOMIC_FINAL_INODE_MISMATCH")!=NULL)final_st.st_ino++;
	if(getenv("Z2M_TEST_ATOMIC_FINAL_SIZE_MISMATCH")!=NULL)final_st.st_size++;
#endif
	if(!regular_policy(&final_st)||!same_inode(&created,&final_st)||final_st.st_size!=(off_t)length){result=z2m_emit_wire(&unknown_wire,6);goto done;}if(fault("after_final_verify")){result=z2m_emit_wire(&unknown_wire,6);goto done;}trace("response");result=z2m_emit_wire(&success_wire,0);goto done;
clean:
	if(candidate[0]&&cleanup(root,parent,candidate,&created)<0)result=fail(r,"ECLEANUPUNKNOWN","candidate_cleanup");
	else result=fail(r,pending_code,pending_stage);
	candidate[0]='\0';
done:
	if(!published&&candidate[0]&&fd>=0&&named_candidate(parent,candidate,&created))cleanup(root,parent,candidate,&created);
	if(final>=0)close(final);
	if(check>=0)close(check);
	if(target>=0)close(target);
	if(fd>=0)close(fd);
	if(parent>=0)close(parent);
	z2m_discard_wire(&success_wire);z2m_discard_wire(&unknown_wire);
	free(copy);return result;
}

int z2m_atomic_write_bytes(const struct z2m_request *r,const struct z2m_root *root,int root_fd,const char *path,const unsigned char *content,size_t length,bool allow_create)
{
	return atomic_write_bytes_state(r,root,root_fd,path,content,length,allow_create,NULL,false,0);
}

int z2m_atomic_write(const struct z2m_request *r,const struct z2m_root *root,int root_fd,uint64_t root_mount)
{
	json_object *path_value,*content_value,*create_value;const char *path,*wire;bool allow_create;unsigned char *content;size_t length=0;int result;
	json_object_object_get_ex(r->arguments,"path",&path_value);json_object_object_get_ex(r->arguments,"content",&content_value);json_object_object_get_ex(r->arguments,"allowCreate",&create_value);path=json_object_get_string(path_value);wire=json_object_get_string(content_value);allow_create=json_object_get_boolean(create_value);if(!z2m_path_valid(path,root->max_depth))return fail(r,"EPATH","path_validate");content=decode(wire,&length);if(content==NULL)return fail(r,"EIO","write");
	result=atomic_write_bytes_state(r,root,root_fd,path,content,length,allow_create,NULL,true,root_mount);
	free(content);return result;
}

int z2m_atomic_write_json(const struct z2m_request *r,const struct z2m_root *root,int root_fd,const unsigned char *content,size_t length)
{
	json_object *path_value,*create_value,*expected_value;const char *path,*expected=NULL;bool allow_create;uint64_t root_mount=0;
	json_object_object_get_ex(r->arguments,"path",&path_value);json_object_object_get_ex(r->arguments,"allowCreate",&create_value);path=json_object_get_string(path_value);allow_create=json_object_get_boolean(create_value);if(!z2m_path_valid(path,root->max_depth))return fail(r,"EPATH","path_validate");
	if(json_object_object_get_ex(r->arguments,"expectedSha256",&expected_value))expected=json_object_get_string(expected_value);
	if(expected!=NULL){const char *code;if(z2m_root_mount_id(root_fd,&root_mount,&code)<0)return fail(r,code,"path_resolve");if(z2m_root_lock(root_fd,false,&code)<0)return fail(r,code,"lock_acquire");return atomic_write_bytes_state(r,root,root_fd,path,content,length,allow_create,expected,true,root_mount);}
	return z2m_atomic_write_bytes(r,root,root_fd,path,content,length,allow_create);
}

int z2m_atomic_write_json_revision(const struct z2m_request *r,const struct z2m_root *root,int root_fd,const unsigned char *content,size_t length)
{
	json_object *path_value,*expected_value,*create_value,*current,*revision_value;const char *path,*code;int64_t expected;bool allow_create;struct stat st;int fd;uint64_t mount;
	json_object_object_get_ex(r->arguments,"path",&path_value);json_object_object_get_ex(r->arguments,"expectedRevision",&expected_value);json_object_object_get_ex(r->arguments,"allowCreate",&create_value);path=json_object_get_string(path_value);expected=json_object_get_int64(expected_value);allow_create=json_object_get_boolean(create_value);
	if(z2m_root_mount_id(root_fd,&mount,&code)<0)return fail(r,code,"path_resolve");
	if(z2m_root_lock(root_fd,false,&code)<0)return fail(r,code,"lock_acquire");
	fd=z2m_open_regular(root_fd,path,&st,&code);
	if(fd<0){if(strcmp(code,"ENOENT")!=0||expected!=-1||!allow_create)return fail(r,"ECONFLICT","precondition");}
	else {unsigned char *bytes=malloc((size_t)st.st_size+1);if(bytes==NULL){close(fd);return fail(r,"EINTERNAL","internal");}if(read(fd,bytes,(size_t)st.st_size)!=(ssize_t)st.st_size){free(bytes);close(fd);return fail(r,"EIO","read");}bytes[st.st_size]='\0';json_tokener *tokener=json_tokener_new();current=json_tokener_parse_ex(tokener,(char*)bytes,(int)st.st_size);json_tokener_free(tokener);free(bytes);close(fd);if(current==NULL||!json_object_object_get_ex(current,"revision",&revision_value)||!json_object_is_type(revision_value,json_type_int)||json_object_get_int64(revision_value)!=expected){json_object_put(current);return fail(r,"ECONFLICT","precondition");}json_object_put(current);}
	return atomic_write_bytes_state(r,root,root_fd,path,content,length,allow_create,NULL,true,mount);
}
