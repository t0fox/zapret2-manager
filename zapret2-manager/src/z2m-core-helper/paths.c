#include "helper.h"

#include <string.h>

bool z2m_path_valid(const char *path, unsigned int max_depth)
{
	size_t length=strlen(path), component=0; unsigned int depth=1;
	if(length==0 || length>4096 || path[0]=='/' || path[length-1]=='/') return false;
	for(size_t i=0;i<=length;i++){
		if(i==length || path[i]=='/'){
			if(component==0 || component>255) return false;
			if((component==1 && path[i-component]=='.') || (component==2 && path[i-component]=='.' && path[i-component+1]=='.')) return false;
			component=0; if(i<length && ++depth>max_depth) return false;
		}else{
			unsigned char c=(unsigned char)path[i];
			if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='.'||c=='_'||c=='-')) return false;
			component++;
		}
	}
	return depth<=32;
}
