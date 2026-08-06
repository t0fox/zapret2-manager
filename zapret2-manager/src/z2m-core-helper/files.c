#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifdef Z2M_TESTING
static ssize_t test_read(int fd, void *buffer, size_t length)
{
	static bool interrupted;
	if(getenv("Z2M_TEST_READ_SHIM")!=NULL){
		if(!interrupted){interrupted=true;errno=EINTR;return -1;}
		if(length>3)length=3;
	}
	return read(fd,buffer,length);
}
#define Z2M_READ test_read
#else
#define Z2M_READ read
#endif

static const char *open_error(int error)
{
	if(error==ENOENT) return "ENOENT";
	if(error==ELOOP) return "ESYMLINK";
	if(error==EXDEV) return "EXDEV";
	if(error==ENXIO || error==ENODEV || error==EOPNOTSUPP || error==EPERM || error==EACCES) return "ENOTREG";
	return "EIO";
}

static int fallback_open(int root_fd,const char *path)
{
	char *copy=strdup(path),*part,*save=NULL; int current=dup(root_fd),next=-1;struct stat root_stat,child_stat;
	if(copy==NULL||current<0){free(copy);return -1;}
	if(fstat(root_fd,&root_stat)<0){free(copy);close(current);return -1;}
	part=strtok_r(copy,"/",&save);
	while(part!=NULL){char *following=strtok_r(NULL,"/",&save); int flags=O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK|(following?O_DIRECTORY:0);
		next=openat(current,part,O_RDONLY|flags);close(current);if(next<0){free(copy);return -1;}
		if(fstat(next,&child_stat)<0){close(next);free(copy);return -1;}
		if(child_stat.st_dev!=root_stat.st_dev){close(next);free(copy);errno=EXDEV;return -1;}
		current=next;part=following;}
	free(copy);return current;
}

int z2m_open_regular(int root_fd,const char *path,struct stat *st,const char **code)
{
	struct open_how how={.flags=O_RDONLY|O_CLOEXEC|O_NONBLOCK,.resolve=RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV};
	int fd;int saved;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_FORCE_FALLBACK")!=NULL){fd=-1;errno=ENOSYS;}else
#endif
		fd=(int)syscall(SYS_openat2,root_fd,path,&how,sizeof(how));
	saved=errno;
	if(fd<0 && (saved==ENOSYS||saved==EINVAL)){fd=fallback_open(root_fd,path);saved=errno;}
	if(fd<0){*code=open_error(saved);return -1;}
	if(fstat(fd,st)<0){close(fd);*code="EIO";return -1;}
	if(!S_ISREG(st->st_mode)){close(fd);*code="ENOTREG";return -1;}
	return fd;
}

static bool get_string(json_object *args,const char *name,const char **value)
{
	json_object *item;
	if(!json_object_object_get_ex(args,name,&item)||!json_object_is_type(item,json_type_string)) return false;
	*value=json_object_get_string(item);
	return true;
}

static bool embedded_nul(json_object *args,const char *name,const char *value)
{
	json_object *item;
	return json_object_object_get_ex(args,name,&item) &&
		strlen(value)!=(size_t)json_object_get_string_len(item);
}

static bool fields(json_object *args,const char *const *names,size_t count)
{size_t seen=0;json_object_object_foreach(args,key,value){bool found=false;(void)value;for(size_t i=0;i<count;i++)if(strcmp(key,names[i])==0)found=true;if(!found)return false;seen++;}return seen==count;}

int z2m_stat_regular(const struct z2m_request *request,const struct z2m_root *root,int root_fd)
{
	const char *path,*code;struct stat st;int fd;static const char *const names[]={"root","path"};
	if(!fields(request->arguments,names,2)||!get_string(request->arguments,"path",&path)) return z2m_fail(request->request_id,"ESCHEMA","schema");
	if(embedded_nul(request->arguments,"path",path)) return z2m_fail(request->request_id,"EPATH","path_validate");
	if(!z2m_path_valid(path,root->max_depth)) return z2m_fail(request->request_id,"EPATH","path_validate");
	fd=z2m_open_regular(root_fd,path,&st,&code);if(fd<0)return z2m_fail(request->request_id,code,"object_open");close(fd);
	json_object *data=json_object_new_object();char mode[5];snprintf(mode,sizeof(mode),"0%03o",(unsigned)(st.st_mode&0777));
	json_object_object_add(data,"type",json_object_new_string("regular"));json_object_object_add(data,"size",json_object_new_int64(st.st_size));json_object_object_add(data,"mode",json_object_new_string(mode));json_object_object_add(data,"uid",json_object_new_int64(st.st_uid));json_object_object_add(data,"gid",json_object_new_int64(st.st_gid));json_object_object_add(data,"mtimeSec",json_object_new_int64(st.st_mtim.tv_sec));json_object_object_add(data,"mtimeNsec",json_object_new_int64(st.st_mtim.tv_nsec));return z2m_success(request->request_id,data);
}

int z2m_read_regular(const struct z2m_request *request,const struct z2m_root *root,int root_fd)
{
	const char *path,*code;struct stat st;int fd;json_object *maximum;int64_t max;unsigned char *data;size_t used=0;ssize_t got;static const char *const names[]={"root","path","maxBytes"};
	if(!fields(request->arguments,names,3)||!get_string(request->arguments,"path",&path)||!json_object_object_get_ex(request->arguments,"maxBytes",&maximum)||!json_object_is_type(maximum,json_type_int)||(max=json_object_get_int64(maximum))<0||max>4194304) return z2m_fail(request->request_id,"ESCHEMA","schema");
	if(embedded_nul(request->arguments,"path",path)) return z2m_fail(request->request_id,"EPATH","path_validate");
	if(!z2m_path_valid(path,root->max_depth))return z2m_fail(request->request_id,"EPATH","path_validate");
	fd=z2m_open_regular(root_fd,path,&st,&code);if(fd<0)return z2m_fail(request->request_id,code,"object_open");
	if(st.st_size<0||(uint64_t)st.st_size>(uint64_t)max||(uint64_t)st.st_size>root->max_read){close(fd);return z2m_fail(request->request_id,"ETOOBIG","object_verify");}
	data=malloc((size_t)st.st_size+1);if(data==NULL){close(fd);return z2m_fail(request->request_id,"EINTERNAL","internal");}
	while(used<(size_t)st.st_size){got=Z2M_READ(fd,data+used,(size_t)st.st_size-used);if(got<0&&errno==EINTR)continue;if(got<=0){free(data);close(fd);return z2m_fail(request->request_id,"EIO","read");}used+=(size_t)got;}
	do { got=Z2M_READ(fd,data+used,1); } while(got<0&&errno==EINTR);
	close(fd);
	if(got<0){free(data);return z2m_fail(request->request_id,"EIO","read");}
	if(got>0){free(data);return z2m_fail(request->request_id,"ETOOBIG","read");}
	char *encoded=z2m_base64(data,used);free(data);if(encoded==NULL)return z2m_fail(request->request_id,"EINTERNAL","internal");json_object *out=json_object_new_object();json_object_object_add(out,"content",json_object_new_string(encoded));free(encoded);json_object_object_add(out,"byteLength",json_object_new_int64((int64_t)used));return z2m_success(request->request_id,out);
}
