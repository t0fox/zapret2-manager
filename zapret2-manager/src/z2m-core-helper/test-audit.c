#include "helper.h"

#ifdef Z2M_TESTING
#include <stdlib.h>

static bool publication_started;
static unsigned long allocations;
static unsigned long json_calls;

void z2m_test_audit_start(void) { publication_started=true; }
void z2m_test_audit_counts(unsigned long *a,unsigned long *j) { *a=allocations;*j=json_calls; }

void *__real_malloc(size_t); void *__real_calloc(size_t,size_t); void *__real_realloc(void *,size_t); char *__real_strdup(const char *);
json_object *__real_json_object_new_object(void); json_object *__real_json_object_new_string(const char *); json_object *__real_json_object_new_int64(int64_t); json_object *__real_json_object_new_boolean(json_bool);
int __real_json_object_object_add(json_object *,const char *,json_object *); const char *__real_json_object_to_json_string_ext(json_object *,int);

void *__wrap_malloc(size_t n) { if(publication_started)allocations++;return __real_malloc(n); }
void *__wrap_calloc(size_t n,size_t s) { if(publication_started)allocations++;return __real_calloc(n,s); }
void *__wrap_realloc(void *p,size_t n) { if(publication_started)allocations++;return __real_realloc(p,n); }
char *__wrap_strdup(const char *s) { if(publication_started)allocations++;return __real_strdup(s); }
json_object *__wrap_json_object_new_object(void) { if(publication_started)json_calls++;return __real_json_object_new_object(); }
json_object *__wrap_json_object_new_string(const char *s) { if(publication_started)json_calls++;return __real_json_object_new_string(s); }
json_object *__wrap_json_object_new_int64(int64_t n) { if(publication_started)json_calls++;return __real_json_object_new_int64(n); }
json_object *__wrap_json_object_new_boolean(json_bool b) { if(publication_started)json_calls++;return __real_json_object_new_boolean(b); }
int __wrap_json_object_object_add(json_object *o,const char *n,json_object *v) { if(publication_started)json_calls++;return __real_json_object_object_add(o,n,v); }
const char *__wrap_json_object_to_json_string_ext(json_object *o,int f) { if(publication_started)json_calls++;return __real_json_object_to_json_string_ext(o,f); }

void z2m_test_direct_post_publication_probe(void)
{ void *p=malloc(1);json_object *o=json_object_new_object();json_object_object_add(o,"probe",json_object_new_boolean(true));free(p);json_object_put(o); }
#endif
