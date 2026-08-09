#include "helper.h"

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct sha256 {
	uint32_t state[8];
	uint64_t length;
	unsigned char block[64];
	size_t used;
};

static uint32_t rotate(uint32_t value,unsigned int count)
{return (value>>count)|(value<<(32-count));}

static void transform(struct sha256 *ctx,const unsigned char block[64])
{
	static const uint32_t k[64]={
		0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
		0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
		0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
		0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
		0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
		0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
		0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
		0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
	uint32_t w[64],a,b,c,d,e,f,g,h;
	for(size_t i=0;i<16;i++)w[i]=((uint32_t)block[i*4]<<24)|((uint32_t)block[i*4+1]<<16)|((uint32_t)block[i*4+2]<<8)|block[i*4+3];
	for(size_t i=16;i<64;i++){uint32_t s0=rotate(w[i-15],7)^rotate(w[i-15],18)^(w[i-15]>>3);uint32_t s1=rotate(w[i-2],17)^rotate(w[i-2],19)^(w[i-2]>>10);w[i]=w[i-16]+s0+w[i-7]+s1;}
	a=ctx->state[0];b=ctx->state[1];c=ctx->state[2];d=ctx->state[3];e=ctx->state[4];f=ctx->state[5];g=ctx->state[6];h=ctx->state[7];
	for(size_t i=0;i<64;i++){uint32_t s1=rotate(e,6)^rotate(e,11)^rotate(e,25);uint32_t choice=(e&f)^((~e)&g);uint32_t t1=h+s1+choice+k[i]+w[i];uint32_t s0=rotate(a,2)^rotate(a,13)^rotate(a,22);uint32_t majority=(a&b)^(a&c)^(b&c);uint32_t t2=s0+majority;h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}
	ctx->state[0]+=a;ctx->state[1]+=b;ctx->state[2]+=c;ctx->state[3]+=d;ctx->state[4]+=e;ctx->state[5]+=f;ctx->state[6]+=g;ctx->state[7]+=h;
}

static void update(struct sha256 *ctx,const unsigned char *data,size_t length)
{
	ctx->length+=(uint64_t)length;
	while(length>0){size_t take=64-ctx->used;if(take>length)take=length;memcpy(ctx->block+ctx->used,data,take);ctx->used+=take;data+=take;length-=take;if(ctx->used==64){transform(ctx,ctx->block);ctx->used=0;}}
}

static void finish(struct sha256 *ctx,unsigned char digest[32])
{
	uint64_t bits=ctx->length*8;ctx->block[ctx->used++]=0x80;
	if(ctx->used>56){memset(ctx->block+ctx->used,0,64-ctx->used);transform(ctx,ctx->block);ctx->used=0;}
	memset(ctx->block+ctx->used,0,56-ctx->used);for(size_t i=0;i<8;i++)ctx->block[63-i]=(unsigned char)(bits>>(i*8));transform(ctx,ctx->block);
	for(size_t i=0;i<8;i++){digest[i*4]=(unsigned char)(ctx->state[i]>>24);digest[i*4+1]=(unsigned char)(ctx->state[i]>>16);digest[i*4+2]=(unsigned char)(ctx->state[i]>>8);digest[i*4+3]=(unsigned char)ctx->state[i];}
}

static bool unchanged(const struct stat *before,const struct stat *after)
{
	return before->st_dev==after->st_dev&&before->st_ino==after->st_ino&&before->st_mode==after->st_mode&&before->st_uid==after->st_uid&&before->st_gid==after->st_gid&&before->st_size==after->st_size&&before->st_mtim.tv_sec==after->st_mtim.tv_sec&&before->st_mtim.tv_nsec==after->st_mtim.tv_nsec;
}

static ssize_t hash_read(int fd,void *buffer,size_t length)
{
#ifdef Z2M_TESTING
	static bool interrupted;
	if(getenv("Z2M_TEST_SHA_READ_ERROR")!=NULL){errno=EIO;return -1;}
	if(getenv("Z2M_TEST_SHA_READ_SHIM")!=NULL){if(!interrupted){interrupted=true;errno=EINTR;return -1;}if(length>3)length=3;}
#endif
	return read(fd,buffer,length);
}

static void test_gate(const char *name)
{
#ifdef Z2M_TESTING
	if(getenv(name)!=NULL){fprintf(stderr,"z2m-core-helper: hash-gate-pid=%ld\n",(long)getpid());raise(SIGSTOP);}
#else
	(void)name;
#endif
}

int z2m_sha256_fd_hex(int fd,size_t max_bytes,char hex[65])
{
	struct stat before,after;unsigned char buffer[16384],digest[32];size_t total=0;ssize_t got;
	struct sha256 ctx={{0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19},0,{0},0};
	if(fstat(fd,&before)<0||before.st_size<0||(uint64_t)before.st_size>(uint64_t)max_bytes){errno=EFBIG;return -1;}
	if(lseek(fd,0,SEEK_SET)<0)return -1;
	for(;;){do got=read(fd,buffer,sizeof(buffer));while(got<0&&errno==EINTR);if(got<0)return -1;if(got==0)break;if((uint64_t)total+(uint64_t)got>(uint64_t)max_bytes){errno=EFBIG;return -1;}update(&ctx,buffer,(size_t)got);total+=(size_t)got;}
	if(fstat(fd,&after)<0)return -1;
	if(total!=(size_t)before.st_size||!unchanged(&before,&after)){errno=EAGAIN;return -1;}
	finish(&ctx,digest);for(size_t i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]='\0';return 0;
}

int z2m_sha256_regular(const struct z2m_request *request,const struct z2m_root *root,int root_fd)
{
	json_object *path_value,*maximum,*out;const char *path,*code;int64_t max;int fd;struct stat before,after;unsigned char buffer[16384],digest[32];size_t total=0;ssize_t got;char hex[65];
	if(!json_object_object_get_ex(request->arguments,"path",&path_value)||!json_object_object_get_ex(request->arguments,"maxBytes",&maximum))return z2m_fail(request->request_id,"ESCHEMA","schema");
	path=json_object_get_string(path_value);max=json_object_get_int64(maximum);
	if(!z2m_path_valid(path,root->max_depth))return z2m_fail(request->request_id,"EPATH","path_validate");
	fd=z2m_open_regular(root_fd,path,&before,&code);if(fd<0)return z2m_fail(request->request_id,code,strcmp(code,"EDENIED")==0?"policy":(strcmp(code,"ENOTREG")==0?"object_verify":(strcmp(code,"ECAPABILITY")==0||strcmp(code,"EXDEV")==0?"path_resolve":"object_open")));
	if(before.st_size<0||(uint64_t)before.st_size>(uint64_t)max||(uint64_t)before.st_size>root->max_read){close(fd);return z2m_fail(request->request_id,"ETOOBIG","object_verify");}
	test_gate("Z2M_TEST_SHA_STOP_AFTER_OPEN");
	struct sha256 ctx={{0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19},0,{0},0};
	for(;;){do got=hash_read(fd,buffer,sizeof(buffer));while(got<0&&errno==EINTR);if(got<0){close(fd);return z2m_fail(request->request_id,"EIO","read");}if(got==0)break;if((uint64_t)total+(uint64_t)got>(uint64_t)max||(uint64_t)total+(uint64_t)got>root->max_read){close(fd);return z2m_fail(request->request_id,"ETOOBIG","read");}update(&ctx,buffer,(size_t)got);total+=(size_t)got;}
	test_gate("Z2M_TEST_SHA_STOP_AFTER_READ");
	if(fstat(fd,&after)<0){close(fd);return z2m_fail(request->request_id,"EIO","stat");}close(fd);
	if(total!=(size_t)before.st_size||!unchanged(&before,&after))return z2m_fail(request->request_id,"EIO","read");
	finish(&ctx,digest);for(size_t i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]='\0';
	out=z2m_json_object();if(!z2m_json_add(out,"sha256",z2m_json_string(hex))||!z2m_json_add(out,"byteLength",z2m_json_int((int64_t)total))){json_object_put(out);return z2m_fail(request->request_id,"EINTERNAL","response_encode");}return z2m_success(request->request_id,out);
}
