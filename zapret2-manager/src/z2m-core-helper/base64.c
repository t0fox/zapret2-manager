#include "helper.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

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

bool z2m_base64_canonical(const char *input, size_t length, size_t max_decoded)
{
	size_t padding = 0, decoded;
	if (length == 0)
		return true;
	if (length % 4 != 0)
		return false;
	if (input[length - 1] == '=') padding++;
	if (input[length - 2] == '=') padding++;
	for (size_t i = 0; i < length - padding; i++)
		if (!(isalnum((unsigned char)input[i]) || input[i] == '+' || input[i] == '/'))
			return false;
	for (size_t i = length - padding; i < length; i++)
		if (input[i] != '=') return false;
	decoded = length / 4 * 3 - padding;
	if (decoded > max_decoded) return false;
	if (padding == 1 && (strchr("AEIMQUYcgkosw048", input[length - 2]) == NULL)) return false;
	if (padding == 2 && (strchr("AQgw", input[length - 3]) == NULL)) return false;
	return true;
}
