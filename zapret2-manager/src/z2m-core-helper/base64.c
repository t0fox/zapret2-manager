#include "helper.h"

#include <stdlib.h>

char *z2m_base64(const unsigned char *input, size_t length)
{
	static const char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	size_t output_length=4*((length+2)/3), i=0, o=0; char *output=malloc(output_length+1);
	if(output==NULL) return NULL;
	while(i<length){unsigned int a=input[i++],b=i<length?input[i++]:0,c=i<length?input[i++]:0,v=(a<<16)|(b<<8)|c;
		output[o++]=alphabet[(v>>18)&63];output[o++]=alphabet[(v>>12)&63];output[o++]=alphabet[(v>>6)&63];output[o++]=alphabet[v&63];}
	if(length%3==1){output[output_length-2]='=';output[output_length-1]='=';}else if(length%3==2)output[output_length-1]='=';
	output[output_length]='\0';return output;
}
