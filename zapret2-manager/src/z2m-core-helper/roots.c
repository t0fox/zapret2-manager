#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/stat.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/syscall.h>
#include <unistd.h>

static const struct z2m_root roots[] = {
	{"persistent_state","/etc/zapret2-manager/state",4194304,16,true,true,true,true},
	{"snapshots","/etc/zapret2-manager/snapshots",4194304,16,true,true,true,true},
	{"registry","/etc/zapret2-manager/registry",4194304,16,true,true,true,true},
	{"secrets","/etc/zapret2-manager/secrets",0,8,true,false,true,true},
	{"runtime","/tmp/zapret2-manager/runtime",1048576,12,true,true,true,false},
	{"jobs","/tmp/zapret2-manager/jobs",4194304,16,true,true,true,false},
	{"locks","/tmp/zapret2-manager/locks",0,1,false,false,false,false},
	{"staging","/tmp/zapret2-manager/staging",4194304,12,true,true,true,false}
};

const struct z2m_root *z2m_root_find(const char *name)
{
	for (size_t i=0;i<sizeof(roots)/sizeof(roots[0]);i++) if(strcmp(name,roots[i].name)==0) return &roots[i];
	return NULL;
}

static bool secure_dir(int fd, bool tmp)
{
	struct stat st;
	if (fstat(fd,&st)<0 || !S_ISDIR(st.st_mode) || st.st_uid!=0 || st.st_gid!=0) return false;
	if (tmp) return (st.st_mode & 07777) == 01777;
	return (st.st_mode & 0022) == 0;
}

int z2m_root_open(const struct z2m_root *root)
{
	char full[PATH_MAX]; const char *prefix = ""; char *copy, *part, *save = NULL; int fd, next; bool first = true;
#ifdef Z2M_TESTING
	prefix = getenv("Z2M_TEST_ROOT_PREFIX"); if (prefix == NULL || prefix[0] != '/') return -1;
#else
	if (getenv("Z2M_TEST_ROOT_PREFIX") != NULL) return -1;
#endif
	if (snprintf(full,sizeof(full),"%s%s",prefix,root->base) >= (int)sizeof(full)) return -1;
	copy=strdup(full); if(copy==NULL) return -1;
	fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC); if(fd<0){free(copy);return -1;}
	part=strtok_r(copy,"/",&save);
	while(part!=NULL){
		next=openat(fd,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
		if(next<0 || !secure_dir(next, first && strcmp(part,"tmp")==0)){if(next>=0)close(next);close(fd);free(copy);return -1;}
		if(strcmp(part,"zapret2-manager")==0 && (strstr(full,"/tmp/zapret2-manager/")!=NULL)){
			struct stat parent_st;
			if(fstat(next,&parent_st)<0 || (parent_st.st_mode&07777)!=0700){close(next);close(fd);free(copy);return -1;}
		}
		close(fd);fd=next;first=false;part=strtok_r(NULL,"/",&save);
	}
	free(copy);
	struct stat st; if(fstat(fd,&st)<0 || !S_ISDIR(st.st_mode) || st.st_uid!=0 || st.st_gid!=0 || (st.st_mode&07777)!=0700){close(fd);return -1;}
	return fd;
}

int z2m_root_mount_id(int root_fd, uint64_t *id, const char **code)
{
#if defined(SYS_statx) && defined(STATX_MNT_ID) && !defined(Z2M_NO_STATX)
	struct statx value;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_ROOT_MOUNT_ERROR")!=NULL){*code="ECAPABILITY";return -1;}
#endif
	if(syscall(SYS_statx,root_fd,"",AT_EMPTY_PATH|AT_STATX_SYNC_AS_STAT,STATX_MNT_ID,&value)<0||!(value.stx_mask&STATX_MNT_ID)){*code="ECAPABILITY";return -1;}
	*id=value.stx_mnt_id;return 0;
#else
	(void)root_fd;(void)id;*code="ECAPABILITY";return -1;
#endif
}

int z2m_root_lock(int root_fd, const char **code)
{
#ifdef Z2M_TESTING
	const char *error=getenv("Z2M_TEST_FLOCK_ERROR");
	if(getenv("Z2M_TEST_LOCK_ORDER_TRACE")!=NULL)fprintf(stderr,"z2m-core-helper: lock-attempt\n");
	if(error!=NULL){errno=strcmp(error,"EIO")==0?EIO:EBADF;goto fail;}
#endif
	if(flock(root_fd,LOCK_EX|LOCK_NB)<0) goto fail;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_STOP_AFTER_LOCK")!=NULL){fprintf(stderr,"z2m-core-helper: lock-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#endif
	return 0;
fail:
	*code=(errno==EWOULDBLOCK||errno==EAGAIN)?"ELOCKED":"EIO";
	return -1;
}
