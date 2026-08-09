#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/syscall.h>
#include <unistd.h>

static int mount_id(int fd,uint64_t *id)
{
#if defined(SYS_statx) && defined(STATX_MNT_ID) && !defined(Z2M_NO_STATX)
	z2m_statx value;
	if(syscall(SYS_statx,fd,"",AT_EMPTY_PATH|AT_STATX_SYNC_AS_STAT,STATX_MNT_ID,&value)<0||!(value.stx_mask&STATX_MNT_ID)){errno=ENOTSUP;return -1;}
	*id=value.stx_mnt_id;return 0;
#else
	(void)fd;(void)id;errno=ENOTSUP;return -1;
#endif
}

static const char *open_code(int error)
{
	if(error==ENOENT)return "ENOENT";
	if(error==ELOOP)return "ESYMLINK";
	if(error==EXDEV)return "EXDEV";
	if(error==EACCES)return "EDENIED";
	if(error==ENOTDIR)return "ENOTREG";
	return "EIO";
}

static int fail(const struct z2m_request *request,const char *code)
{
	const char *stage=strcmp(code,"EDENIED")==0?"policy":
		(strcmp(code,"ENOTREG")==0?"object_verify":
		(strcmp(code,"EXDEV")==0||strcmp(code,"ECAPABILITY")==0?"path_resolve":"object_open"));
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_BEFORE_MKDIR_FAILURE")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	return z2m_fail(request->request_id,code,stage);
}

static int verified_directory(int fd,uint64_t root_mount,const char **code)
{
	struct stat st;uint64_t child_mount;
	if(fstat(fd,&st)<0){*code="EIO";return -1;}
	if(!S_ISDIR(st.st_mode)){*code="ENOTREG";return -1;}
	if(mount_id(fd,&child_mount)<0){*code="ECAPABILITY";return -1;}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_MKDIR_MNT_ID_CHANGE")!=NULL)child_mount=root_mount+1;
#endif
	if(child_mount!=root_mount){*code="EXDEV";return -1;}
	if(st.st_uid!=0||st.st_gid!=0||(st.st_mode&07777)!=0700){*code="EDENIED";return -1;}
	return 0;
}

static const char *entry_error(int parent,const char *name,int error)
{
	struct stat st;
	if((error==ENOTDIR||error==ELOOP)&&fstatat(parent,name,&st,AT_SYMLINK_NOFOLLOW)==0&&S_ISLNK(st.st_mode))return "ESYMLINK";
	return open_code(error);
}

static bool same_inode(const struct stat *left,const struct stat *right)
{
	return left->st_dev==right->st_dev&&left->st_ino==right->st_ino;
}

static bool same_object(const struct stat *left,const struct stat *right)
{
	return same_inode(left,right)&&left->st_mtim.tv_sec==right->st_mtim.tv_sec&&left->st_mtim.tv_nsec==right->st_mtim.tv_nsec;
}

static int open_parent(int root_fd,const char *parent_path,uint64_t root_mount,const char **code)
{
	char *copy,*part,*save=NULL;int parent=dup(root_fd),child;
	if(parent_path[0]=='\0')return parent;
	copy=strdup(parent_path);if(copy==NULL||parent<0){free(copy);if(parent>=0)close(parent);*code="EIO";return -1;}
	part=strtok_r(copy,"/",&save);
	while(part!=NULL){child=openat(parent,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0){*code=entry_error(parent,part,errno);close(parent);free(copy);return -1;}if(verified_directory(child,root_mount,code)<0){close(child);close(parent);free(copy);return -1;}close(parent);parent=child;part=strtok_r(NULL,"/",&save);}
	free(copy);return parent;
}

static int success(const struct z2m_request *request,bool created,const char *durability)
{
	json_object *data=z2m_json_object();
	if(!z2m_json_add(data,"created",z2m_json_bool(created))||!z2m_json_add(data,"committed",z2m_json_bool(true))||!z2m_json_add(data,"durability",z2m_json_string(durability))){json_object_put(data);return z2m_fail(request->request_id,"EINTERNAL","response_encode");}
	return z2m_success(request->request_id,data);
}

static int candidate_name(char name[44])
{
	unsigned char random[16];static const char hex[]="0123456789abcdef";ssize_t got;
	do got=getrandom(random,sizeof(random),0);while(got<0&&errno==EINTR);
	if(got!=(ssize_t)sizeof(random))return -1;
	memcpy(name,".z2m-mkdir-",11);for(size_t i=0;i<sizeof(random);i++){name[11+i*2]=hex[random[i]>>4];name[12+i*2]=hex[random[i]&15];}name[43]='\0';return 0;
}

static bool named_inode(int parent,const char *name,const struct stat *created)
{
	struct stat named;
	return fstatat(parent,name,&named,AT_SYMLINK_NOFOLLOW)==0&&S_ISDIR(named.st_mode)&&same_object(created,&named);
}

static int cleanup_candidate(const struct z2m_root *root,int parent,const char *candidate,const struct stat *created)
{
	if(!named_inode(parent,candidate,created))return -1;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_CLEANUP_AMBIGUOUS")!=NULL)return -1;
#endif
	if(unlinkat(parent,candidate,AT_REMOVEDIR)<0)return -1;
	if(root->directory_fsync&&fsync(parent)<0)return -1;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_AFTER_MKDIR_CLEANUP")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	return 0;
}

static int abandon_candidate(const struct z2m_request *request,const struct z2m_root *root,int parent,const char *candidate,const struct stat *created,bool clean_failure)
{
	if(cleanup_candidate(root,parent,candidate,created)<0)return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");
	return clean_failure?z2m_fail(request->request_id,"EIO","object_open"):z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");
}

int z2m_mkdir_private(const struct z2m_request *request,const struct z2m_root *root,int root_fd,uint64_t root_mount)
{
	json_object *exist_value,*path_value;const char *path,*code=NULL;char *copy,*name,*slash,parent_path[4097],candidate[44];int parent=-1,check=-1,child=-1,final=-1,result;bool exist_ok,final_ok=false;struct stat parent_st,check_st,created,final_st;
	if(!json_object_object_get_ex(request->arguments,"path",&path_value))return z2m_fail(request->request_id,"ESCHEMA","schema");
	path=json_object_get_string(path_value);exist_ok=json_object_object_get_ex(request->arguments,"existOk",&exist_value)&&json_object_get_boolean(exist_value);
	if(!z2m_path_valid(path,root->max_depth))return z2m_fail(request->request_id,"EPATH","path_validate");
	copy=strdup(path);if(copy==NULL)return z2m_fail(request->request_id,"EINTERNAL","internal");
	slash=strrchr(copy,'/');if(slash==NULL){parent_path[0]='\0';name=copy;}else{*slash='\0';if(strlen(copy)>=sizeof(parent_path)){free(copy);return z2m_fail(request->request_id,"EPATH","path_validate");}strcpy(parent_path,copy);name=slash+1;}
	parent=open_parent(root_fd,parent_path,root_mount,&code);if(parent<0){free(copy);return fail(request,code);}
	child=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
	if(child>=0){int valid=verified_directory(child,root_mount,&code);close(child);close(parent);free(copy);if(valid<0)return fail(request,code);if(!exist_ok)return z2m_fail(request->request_id,"EIO","object_open");return success(request,false,root->directory_fsync?"durable":"tmpfs_visible");}
	if(errno!=ENOENT){code=entry_error(parent,name,errno);close(parent);free(copy);return fail(request,code);}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_BEFORE_MKDIR")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	if(fstat(parent,&parent_st)<0){close(parent);free(copy);return z2m_fail(request->request_id,"EIO","object_open");}
	check=open_parent(root_fd,parent_path,root_mount,&code);
	if(check<0||fstat(check,&check_st)<0||!same_inode(&parent_st,&check_st)){if(check>=0)close(check);close(parent);free(copy);return fail(request,check<0?code:"EIO");}
	close(check);check=-1;
	for(unsigned int attempt=0;;attempt++){
		if(attempt==8||candidate_name(candidate)<0){close(parent);free(copy);return z2m_fail(request->request_id,"EIO","object_open");}
		if(mkdirat(parent,candidate,0700)==0)break;
		if(errno!=EEXIST){code=open_code(errno);close(parent);free(copy);return fail(request,code);}
	}
	if(fstatat(parent,candidate,&created,AT_SYMLINK_NOFOLLOW)<0||!S_ISDIR(created.st_mode)){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_AFTER_MKDIR")!=NULL){fprintf(stderr,"z2m-core-helper: candidate=%s lock-gate-pid=%ld\n",candidate,(long)getpid());raise(SIGSTOP);}
#endif
	child=openat(parent,candidate,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
	if(child<0||fstat(child,&final_st)<0||!same_object(&created,&final_st)||!named_inode(parent,candidate,&created)){if(child>=0)close(child);close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
	if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_METADATA_ERROR")!=NULL||
#endif
	   fchown(child,0,0)<0||fchmod(child,0700)<0){if(fstat(child,&created)<0){close(child);result=z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}else{close(child);result=abandon_candidate(request,root,parent,candidate,&created,true);}close(parent);free(copy);return result;}
	if(fstat(child,&created)<0){close(child);close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
	if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_CANDIDATE_VERIFY_ERROR")!=NULL||
#endif
	   verified_directory(child,root_mount,&code)<0){close(child);result=abandon_candidate(request,root,parent,candidate,&created,true);close(parent);free(copy);return result;}close(child);child=-1;
	check=open_parent(root_fd,parent_path,root_mount,&code);if(check<0||fstat(check,&check_st)<0||!same_inode(&parent_st,&check_st)){if(check>=0)close(check);result=abandon_candidate(request,root,parent,candidate,&created,false);close(parent);free(copy);return result;}
	if(!named_inode(parent,candidate,&created)){close(check);close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_BEFORE_MKDIR_PUBLISH")!=NULL){fprintf(stderr,"z2m-core-helper: candidate=%s lock-gate-pid=%ld\n",candidate,(long)getpid());raise(SIGSTOP);}
#endif
	if(syscall(SYS_renameat2,parent,candidate,check,name,RENAME_NOREPLACE)<0){
		int error=errno;close(check);
		if(error==EEXIST){
			if(cleanup_candidate(root,parent,candidate,&created)<0){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
			child=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
			if(child<0){code=entry_error(parent,name,errno);close(parent);free(copy);return fail(request,code);}
			int valid=verified_directory(child,root_mount,&code);close(child);close(parent);free(copy);
			if(valid<0)return fail(request,code);
			if(exist_ok)return success(request,false,root->directory_fsync?"durable":"tmpfs_visible");
			return z2m_fail(request->request_id,"EIO","object_open");
		}
		if(named_inode(parent,candidate,&created))result=abandon_candidate(request,root,parent,candidate,&created,true);else result=z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");close(parent);free(copy);return result;
	}
	close(check);check=-1;
	final=open_parent(root_fd,parent_path,root_mount,&code);if(final>=0){child=openat(final,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child>=0&&fstat(child,&final_st)==0&&same_object(&created,&final_st)&&verified_directory(child,root_mount,&code)==0)final_ok=true;if(child>=0)close(child);close(final);}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_FINAL_VERIFY_ERROR")!=NULL)final_ok=false;
#endif
	if(!final_ok){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
	if(root->directory_fsync){
#ifdef Z2M_TESTING
		if(getenv("Z2M_TEST_STOP_BEFORE_DIRECTORY_FSYNC")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
		if(getenv("Z2M_TEST_DIRECTORY_FSYNC_ERROR")!=NULL){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
#endif
		if(fsync(parent)<0){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
	}
	close(parent);free(copy);return success(request,true,root->directory_fsync?"durable":"tmpfs_visible");
}
