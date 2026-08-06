#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const struct z2m_root roots[] = {
	{"persistent_state","/etc/zapret2-manager/state",4194304,16,true,true},
	{"snapshots","/etc/zapret2-manager/snapshots",4194304,16,true,true},
	{"registry","/etc/zapret2-manager/registry",4194304,16,true,true},
	{"secrets","/etc/zapret2-manager/secrets",0,8,true,false},
	{"runtime","/tmp/zapret2-manager/runtime",1048576,12,true,true},
	{"jobs","/tmp/zapret2-manager/jobs",4194304,16,true,true},
	{"locks","/tmp/zapret2-manager/locks",0,1,false,false},
	{"staging","/tmp/zapret2-manager/staging",4194304,12,true,true}
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
