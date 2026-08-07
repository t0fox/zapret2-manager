#include "helper.h"

#include <string.h>
#include <unistd.h>

int main(void)
{
	struct z2m_request request={0};json_object *root_value;const char *root_name,*code;const struct z2m_root *root;uint64_t root_mount;int fd,result=z2m_read_request(&request);
	if(result!=-1){z2m_request_free(&request);return result;}
	if(strcmp(request.operation,"stat_regular")!=0&&strcmp(request.operation,"read_regular")!=0&&strcmp(request.operation,"mkdir_private")!=0&&strcmp(request.operation,"sha256_regular")!=0){
		result=z2m_reserved_schema_valid(&request)?z2m_fail(request.request_id,"EUNSUPPORTED","operation_dispatch"):z2m_fail(request.request_id,"ESCHEMA","schema");
		z2m_request_free(&request);return result;
	}
	if((strcmp(request.operation,"mkdir_private")==0||strcmp(request.operation,"sha256_regular")==0)&&!z2m_reserved_schema_valid(&request)){result=z2m_fail(request.request_id,"ESCHEMA","schema");z2m_request_free(&request);return result;}
	if(!json_object_object_get_ex(request.arguments,"root",&root_value)||!json_object_is_type(root_value,json_type_string)||strlen(json_object_get_string(root_value))!=(size_t)json_object_get_string_len(root_value)){result=z2m_fail(request.request_id,"ESCHEMA","schema");z2m_request_free(&request);return result;}
	root_name=json_object_get_string(root_value);root=z2m_root_find(root_name);
	if(root==NULL){result=z2m_fail(request.request_id,"EROOT","root_select");z2m_request_free(&request);return result;}
	if((strcmp(request.operation,"stat_regular")==0&&!root->stat_allowed)||((strcmp(request.operation,"read_regular")==0||strcmp(request.operation,"sha256_regular")==0)&&!root->read_allowed)||(strcmp(request.operation,"mkdir_private")==0&&!root->mkdir_allowed)){result=z2m_fail(request.request_id,"EDENIED","policy");z2m_request_free(&request);return result;}
	fd=z2m_root_open(root);if(fd<0){result=z2m_fail(request.request_id,"EROOT","root_open");z2m_request_free(&request);return result;}
	if(strcmp(request.operation,"mkdir_private")==0){if(z2m_root_mount_id(fd,&root_mount,&code)<0)result=z2m_fail(request.request_id,code,"path_resolve");else if(z2m_root_lock(fd,false,&code)<0)result=z2m_fail(request.request_id,code,"lock_acquire");else result=z2m_mkdir_private(&request,root,fd,root_mount);}
	else if(strcmp(request.operation,"sha256_regular")==0){if(z2m_root_mount_id(fd,&root_mount,&code)<0)result=z2m_fail(request.request_id,code,"path_resolve");else if(z2m_root_lock(fd,true,&code)<0)result=z2m_fail(request.request_id,code,"lock_acquire");else result=z2m_sha256_regular(&request,root,fd);}
	else if(strcmp(request.operation,"stat_regular")==0)result=z2m_stat_regular(&request,root,fd);else result=z2m_read_regular(&request,root,fd);
	close(fd);z2m_request_free(&request);return result;
}
