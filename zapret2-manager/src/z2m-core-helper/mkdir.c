#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/stat.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int mount_id(int fd,uint64_t *id)
{
#if defined(SYS_statx) && defined(STATX_MNT_ID) && !defined(Z2M_NO_STATX)
	struct statx value;
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
		(strcmp(code,"EXDEV")==0?"path_resolve":"object_open"));
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

static int success(const struct z2m_request *request,bool created,const char *durability)
{
	json_object *data=z2m_json_object();
	if(!z2m_json_add(data,"created",z2m_json_bool(created))||
	   !z2m_json_add(data,"committed",z2m_json_bool(true))||
	   !z2m_json_add(data,"durability",z2m_json_string(durability))){json_object_put(data);return z2m_fail(request->request_id,"EINTERNAL","response_encode");}
	return z2m_success(request->request_id,data);
}

static int cleanup_created(const struct z2m_request *request,const struct z2m_root *root,int parent,int child,const char *name)
{
	struct stat opened,named;
	if(fstat(child,&opened)<0||fstatat(parent,name,&named,AT_SYMLINK_NOFOLLOW)<0||
	   !S_ISDIR(named.st_mode)||opened.st_dev!=named.st_dev||opened.st_ino!=named.st_ino){close(child);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
	close(child);
	if(unlinkat(parent,name,AT_REMOVEDIR)<0)return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");
	if(root->directory_fsync&&fsync(parent)<0)return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_AFTER_MKDIR_CLEANUP")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	return z2m_fail(request->request_id,"EIO","object_open");
}

int z2m_mkdir_private(const struct z2m_request *request,const struct z2m_root *root,int root_fd)
{
	json_object *exist_value;const char *path,*code;char *copy,*name,*slash,*part,*save=NULL;int parent,child=-1;bool exist_ok;uint64_t root_mount;
	json_object *path_value;
	if(!json_object_object_get_ex(request->arguments,"path",&path_value))return z2m_fail(request->request_id,"ESCHEMA","schema");
	path=json_object_get_string(path_value);exist_ok=json_object_object_get_ex(request->arguments,"existOk",&exist_value)&&json_object_get_boolean(exist_value);
	if(!z2m_path_valid(path,root->max_depth))return z2m_fail(request->request_id,"EPATH","path_validate");
	if(mount_id(root_fd,&root_mount)<0)return z2m_fail(request->request_id,"ECAPABILITY","path_resolve");
	copy=strdup(path);parent=dup(root_fd);if(copy==NULL||parent<0){free(copy);if(parent>=0)close(parent);return z2m_fail(request->request_id,"EINTERNAL","internal");}
	slash=strrchr(copy,'/');if(slash==NULL)name=copy;else{*slash='\0';name=slash+1;part=strtok_r(copy,"/",&save);while(part!=NULL){child=openat(parent,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0){code=entry_error(parent,part,errno);close(parent);free(copy);return fail(request,code);}if(verified_directory(child,root_mount,&code)<0){close(child);close(parent);free(copy);return fail(request,code);}close(parent);parent=child;child=-1;part=strtok_r(NULL,"/",&save);}}
	child=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
	if(child>=0){int valid=verified_directory(child,root_mount,&code);close(child);close(parent);free(copy);if(valid<0)return fail(request,code);if(!exist_ok)return z2m_fail(request->request_id,"EIO","object_open");return success(request,false,root->directory_fsync?"durable":"tmpfs_visible");}
	if(errno!=ENOENT){code=entry_error(parent,name,errno);close(parent);free(copy);return fail(request,code);}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_BEFORE_MKDIR")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	if(mkdirat(parent,name,0700)<0){code=open_code(errno);close(parent);free(copy);return fail(request,code);}
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_AFTER_MKDIR")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	child=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0){code=entry_error(parent,name,errno);close(parent);free(copy);return fail(request,code);}
	if(
#ifdef Z2M_TESTING
	   getenv("Z2M_TEST_METADATA_ERROR")!=NULL||
#endif
	   fchown(child,0,0)<0||fchmod(child,0700)<0){
		int result=cleanup_created(request,root,parent,child,name);close(parent);free(copy);return result;
	}
	if(verified_directory(child,root_mount,&code)<0){close(child);close(parent);free(copy);return fail(request,code);}close(child);
	if(root->directory_fsync){
#ifdef Z2M_TESTING
		if(getenv("Z2M_TEST_STOP_BEFORE_DIRECTORY_FSYNC")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
		if(getenv("Z2M_TEST_DIRECTORY_FSYNC_ERROR")!=NULL){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
#endif
		if(fsync(parent)<0){close(parent);free(copy);return z2m_fail(request->request_id,"ECOMMITUNKNOWN","directory_fsync");}
	}
	close(parent);free(copy);return success(request,true,root->directory_fsync?"durable":"tmpfs_visible");
}
