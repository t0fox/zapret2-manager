#include "helper.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct error_info {
	const char *code;
	const char *message;
	bool retryable;
	json_object *committed;
	const char *durability;
	int exit_code;
};

static const struct error_info errors[] = {
	{"EMALFORMED", "Request is not one valid JSON object.", false, NULL, "unchanged", 2},
	{"ESCHEMA", "Request does not match protocol v1.", false, NULL, "unchanged", 2},
	{"EREQUESTTOOBIG", "Request exceeds the wire limit.", false, NULL, "unchanged", 2},
	{"EDENIED", "Operation is denied by root policy.", false, NULL, "unchanged", 3},
	{"EROOT", "Root is unknown or insecure.", false, NULL, "unchanged", 3},
	{"EPATH", "Path is not an allowed canonical relative path.", false, NULL, "unchanged", 3},
	{"EUNSUPPORTED", "Operation is reserved but not implemented in this milestone.", false, NULL, "unchanged", 3},
	{"ECAPABILITY", "Required safe filesystem capability is unavailable.", false, NULL, "unchanged", 3},
	{"ENOENT", "Managed object does not exist.", false, NULL, "unchanged", 4},
	{"ENOTREG", "Managed object is not a regular file.", false, NULL, "unchanged", 4},
	{"ESYMLINK", "Symbolic or magic link traversal was refused.", false, NULL, "unchanged", 4},
	{"EXDEV", "Mount or root boundary crossing was refused.", false, NULL, "unchanged", 4},
	{"ETOOBIG", "Managed object exceeds the operation or root limit.", false, NULL, "unchanged", 4},
	{"EIO", "Filesystem operation failed.", false, NULL, "unchanged", 4},
	{"ECONFLICT", "Managed object precondition changed.", false, NULL, "unchanged", 4},
	{"ECLEANUPUNKNOWN", "Candidate cleanup could not be proven.", false, NULL, "unchanged", 4},
	{"ELOCKED", "Lock is held by another operation.", true, NULL, "unchanged", 5},
	{"ECOMMITUNKNOWN", "Commit may be visible but durability is unknown.", false, NULL, "unknown", 6},
	{"EINTERNAL", "Helper failed internally.", false, NULL, "not_applicable", 70},
	{"EINCOMPLETE", "Helper could not emit one complete response.", false, NULL, "not_applicable", 74}
};

#ifdef Z2M_TESTING
static long allocation_count;
static long serialization_count;
static long post_publication_allocations;
static long post_publication_serializations;
static bool publication_started;
static bool allocation_should_fail(void)
{
	const char *value = getenv("Z2M_TEST_ALLOC_FAIL_AFTER");
	if(publication_started)post_publication_allocations++;
	if (value == NULL) return false;
	return ++allocation_count >= strtol(value, NULL, 10);
}
#else
static bool allocation_should_fail(void) { return false; }
#endif

void *z2m_alloc(size_t size) { return allocation_should_fail() ? NULL : malloc(size); }
json_object *z2m_json_object(void) { return allocation_should_fail() ? NULL : json_object_new_object(); }
json_object *z2m_json_string(const char *value) { return allocation_should_fail() ? NULL : json_object_new_string(value); }
json_object *z2m_json_int(int64_t value) { return allocation_should_fail() ? NULL : json_object_new_int64(value); }
json_object *z2m_json_bool(bool value) { return allocation_should_fail() ? NULL : json_object_new_boolean(value); }
bool z2m_json_add(json_object *object, const char *name, json_object *value)
{
	if (object == NULL || value == NULL) { json_object_put(value); return false; }
	if (json_object_object_add(object, name, value) != 0) { json_object_put(value); return false; }
	return true;
}

static ssize_t output_write(const void *buffer, size_t length)
{
#ifdef Z2M_TESTING
	static bool interrupted;
	static size_t written;
	const char *limit = getenv("Z2M_TEST_STDOUT_FAIL_AFTER");
	if (getenv("Z2M_TEST_STDOUT_SHIM") != NULL) {
		if (!interrupted) { interrupted = true; errno = EINTR; return -1; }
		if (length > 3) length = 3;
	}
	if (limit != NULL) {
		size_t maximum = (size_t)strtoul(limit, NULL, 10);
		if (written >= maximum) { errno = EIO; return -1; }
		if (length > maximum - written) length = maximum - written;
	}
	ssize_t result = write(STDOUT_FILENO, buffer, length);
	if (result > 0) written += (size_t)result;
	return result;
#else
	return write(STDOUT_FILENO, buffer, length);
#endif
}

static bool write_all(const char *wire, size_t length)
{
	size_t written = 0;
	while (written < length) {
		ssize_t result = output_write(wire + written, length - written);
		if (result < 0 && errno == EINTR) continue;
		if (result <= 0) return false;
		written += (size_t)result;
	}
	return true;
}

static const char *serialize(json_object *response)
{
#ifdef Z2M_TESTING
	const char *limit=getenv("Z2M_TEST_SERIALIZE_FAIL_AFTER");
	serialization_count++;
	if(publication_started){post_publication_serializations++;if(getenv("Z2M_TEST_SERIALIZE_FORBID_AFTER_PUBLICATION")!=NULL)return NULL;}
	if(limit!=NULL&&serialization_count>=strtol(limit,NULL,10))return NULL;
#endif
	return json_object_to_json_string_ext(response,JSON_C_TO_STRING_PLAIN);
}

void z2m_response_publication_started(void)
{
#ifdef Z2M_TESTING
	publication_started=true;
	z2m_test_audit_start();
#endif
}

void z2m_discard_wire(struct z2m_prepared_wire *wire)
{if(wire!=NULL){free(wire->data);wire->data=NULL;wire->length=0;}}

int z2m_emit_wire(struct z2m_prepared_wire *wire,int exit_code)
{
	if(wire==NULL||wire->data==NULL)return 74;
#ifdef Z2M_TESTING
	if(getenv("Z2M_TEST_RESPONSE_AUDIT")!=NULL){unsigned long a,j;z2m_test_audit_counts(&a,&j);fprintf(stderr,"z2m-core-helper: response-audit post-publication-allocations=%ld serializations=%ld broad-allocations=%lu broad-json-calls=%lu\n",post_publication_allocations,post_publication_serializations,a,j);}
#endif
	bool ok=write_all(wire->data,wire->length)&&write_all("\n",1);
	z2m_discard_wire(wire);return ok?exit_code:74;
}

static bool prepare_wire(json_object *response,struct z2m_prepared_wire *wire)
{
	const char *encoded;if(response==NULL||wire==NULL)return false;encoded=serialize(response);if(encoded==NULL){json_object_put(response);return false;}size_t length=strlen(encoded);if(length+1>Z2M_RESPONSE_MAX){json_object_put(response);return false;}wire->data=z2m_alloc(length);if(wire->data==NULL){json_object_put(response);return false;}memcpy(wire->data,encoded,length);wire->length=length;json_object_put(response);return true;
}

int z2m_emit_prepared(json_object *response, int exit_code)
{
	const char *wire;
	if (response == NULL) { fprintf(stderr,"z2m-core-helper: response allocation failed\n"); return 74; }
	wire = serialize(response);
	if (wire == NULL) { json_object_put(response); return 74; }
	size_t length = strlen(wire);
	if (length + 1 > Z2M_RESPONSE_MAX) {
		json_object_put(response);
		return 74;
	}
	if (!write_all(wire, length) || !write_all("\n", 1)) {
		json_object_put(response);
		return 74;
	}
	json_object_put(response);
	return exit_code;
}

bool z2m_prepare_success_wire(const char *request_id,json_object *data,struct z2m_prepared_wire *wire)
{json_object *response=z2m_prepare_success(request_id,data);return prepare_wire(response,wire);}

bool z2m_prepare_failure_wire(const char *request_id,const char *code,const char *stage,struct z2m_prepared_wire *wire)
{
	const struct error_info *info=NULL;json_object *response,*error;for(size_t i=0;i<sizeof(errors)/sizeof(errors[0]);i++)if(strcmp(errors[i].code,code)==0)info=&errors[i];if(info==NULL)return false;response=z2m_json_object();error=z2m_json_object();if(!z2m_json_add(response,"protocolVersion",z2m_json_int(1))||!z2m_json_add(response,"requestId",z2m_json_string(request_id))||!z2m_json_add(response,"ok",z2m_json_bool(false))||!z2m_json_add(error,"code",z2m_json_string(info->code))||!z2m_json_add(error,"message",z2m_json_string(info->message))||!z2m_json_add(error,"retryable",z2m_json_bool(info->retryable))||!z2m_json_add(error,"committed",z2m_json_bool(strcmp(info->code,"ECOMMITUNKNOWN")==0))||!z2m_json_add(error,"durability",z2m_json_string(info->durability))||!z2m_json_add(error,"stage",z2m_json_string(stage))){json_object_put(error);json_object_put(response);return false;}if(!z2m_json_add(response,"error",error)){json_object_put(response);return false;}return prepare_wire(response,wire);
}

int z2m_fail(const char *request_id, const char *code, const char *stage)
{
	const struct error_info *info = NULL;
	json_object *response;
	json_object *error;
	size_t i;
	for (i = 0; i < sizeof(errors) / sizeof(errors[0]); i++)
		if (strcmp(errors[i].code, code) == 0)
			info = &errors[i];
	if (info == NULL) info = &errors[18];
#ifdef Z2M_TESTING
	if (getenv("Z2M_TEST_UNKNOWN_ERROR") != NULL) { info = &errors[18]; stage = "response_encode"; }
#endif
	response=z2m_json_object(); error=z2m_json_object();
	if (!z2m_json_add(response,"protocolVersion",z2m_json_int(1)) ||
	    (request_id == NULL ? json_object_object_add(response,"requestId",NULL)!=0 : !z2m_json_add(response,"requestId",z2m_json_string(request_id))) ||
	    !z2m_json_add(response,"ok",z2m_json_bool(false)) ||
	    !z2m_json_add(error,"code",z2m_json_string(info->code)) ||
	    !z2m_json_add(error,"message",z2m_json_string(info->message)) ||
	    !z2m_json_add(error,"retryable",z2m_json_bool(info->retryable)) ||
	    (strcmp(info->code,"EINTERNAL")==0 || strcmp(info->code,"EINCOMPLETE")==0 ? json_object_object_add(error,"committed",NULL)!=0 : !z2m_json_add(error,"committed",z2m_json_bool(strcmp(info->code,"ECOMMITUNKNOWN")==0))) ||
	    !z2m_json_add(error,"durability",z2m_json_string(info->durability)) ||
	    !z2m_json_add(error,"stage",z2m_json_string(stage))) {
		json_object_put(error); json_object_put(response);
		fprintf(stderr,"z2m-core-helper: response allocation failed\n"); return 74;
	}
	if (!z2m_json_add(response,"error",error)) {
		json_object_put(response);
		fprintf(stderr,"z2m-core-helper: response allocation failed\n"); return 74;
	}
	fprintf(stderr, "z2m-core-helper: %s at %s\n", info->code, stage);
	return z2m_emit_prepared(response, info->exit_code);
}

json_object *z2m_prepare_success(const char *request_id, json_object *data)
{
	json_object *response = z2m_json_object();
	if (!z2m_json_add(response,"protocolVersion",z2m_json_int(1)) ||
	    !z2m_json_add(response,"requestId",z2m_json_string(request_id)) ||
	    !z2m_json_add(response,"ok",z2m_json_bool(true))) {
		json_object_put(data); json_object_put(response);
		return NULL;
	}
	if (!z2m_json_add(response,"data",data)) {
		json_object_put(response);
		return NULL;
	}
	return response;
}

int z2m_success(const char *request_id, json_object *data)
{
	json_object *response=z2m_prepare_success(request_id,data);
	if(response==NULL)return z2m_fail(request_id,"EINTERNAL","response_encode");
	return z2m_emit_prepared(response,0);
}
