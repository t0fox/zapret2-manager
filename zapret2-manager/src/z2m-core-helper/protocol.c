#include "helper.h"

#include <ctype.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct scan {
	const unsigned char *data;
	size_t length;
	size_t offset;
	unsigned int depth;
	size_t keys;
	bool limited;
	size_t probes;
	size_t containers;
	size_t bucket_allocs;
	size_t canonical_depth;
	size_t canonical_keys;
	size_t canonical_containers;
	size_t canonical_start;
	size_t canonical_end;
	bool canonical_seen;
	bool canonical_limited;
	bool duplicate_other;
	bool nul_key_other;
	bool atomic_write_json;
};

enum scan_scope {
	SCAN_OTHER,
	SCAN_ENVELOPE,
	SCAN_ARGUMENTS,
	SCAN_CANONICAL
};

#define KEY_BUCKETS 2048U
#define Z2M_JSON_MAX_PROBES 8192U

struct key_entry {
	struct key_entry *next;
	char *value;
	size_t length;
};

static uint64_t key_hash(const char *value, size_t length)
{
	uint64_t hash = UINT64_C(1469598103934665603);
	for (size_t i = 0; i < length; i++) {
		hash ^= (unsigned char)value[i];
		hash *= UINT64_C(1099511628211);
	}
	return hash;
}

static void free_keys(struct key_entry **buckets)
{
	if (buckets == NULL) return;
	for (size_t i = 0; i < KEY_BUCKETS; i++) {
		struct key_entry *entry = buckets[i];
		while (entry != NULL) {
			struct key_entry *next = entry->next;
			free(entry->value);
			free(entry);
			entry = next;
		}
	}
	free(buckets);
}

static bool add_key(struct scan *s, struct key_entry **buckets, char *key,
	size_t length, bool *duplicate)
{
	size_t bucket = (size_t)(key_hash(key, length) % KEY_BUCKETS);
	struct key_entry *entry;
	for (entry = buckets[bucket]; entry != NULL; entry = entry->next) {
		if (++s->probes > Z2M_JSON_MAX_PROBES) { s->limited = true; free(key); return false; }
		if (entry->length == length && memcmp(entry->value, key, length) == 0) {
			*duplicate = true;
			free(key);
			return true;
		}
	}
	entry = malloc(sizeof(*entry));
	if (entry == NULL) { free(key); return false; }
	entry->value = key;
	entry->length = length;
	entry->next = buckets[bucket];
	buckets[bucket] = entry;
	return true;
}

static void ws(struct scan *s) { while (s->offset < s->length && isspace(s->data[s->offset])) s->offset++; }

static bool scan_string(struct scan *s, char **decoded, size_t *decoded_length)
{
	size_t start = s->offset;
	bool escaped = false;
	json_object *value;
	if (s->offset >= s->length || s->data[s->offset++] != '"') return false;
	while (s->offset < s->length) {
		unsigned char c = s->data[s->offset++];
		if (!escaped && c == '"') break;
		if (!escaped && c < 0x20) return false;
		if (!escaped && c == '\\') escaped = true; else escaped = false;
	}
	if (s->offset > s->length || s->data[s->offset - 1] != '"') return false;
	if (decoded == NULL) return true;
	char *text = strndup((const char *)s->data + start, s->offset - start);
	if (text == NULL) return false;
	value = json_tokener_parse(text);
	free(text);
	if (value == NULL || !json_object_is_type(value, json_type_string)) { json_object_put(value); return false; }
	*decoded_length = (size_t)json_object_get_string_len(value);
	if (*decoded_length == SIZE_MAX) { json_object_put(value); return false; }
	*decoded = malloc(*decoded_length + 1U);
	if (*decoded != NULL) {
		memcpy(*decoded, json_object_get_string(value), *decoded_length);
		(*decoded)[*decoded_length] = '\0';
	}
	json_object_put(value);
	return *decoded != NULL;
}

static bool scan_value(struct scan *s, enum scan_scope scope);

static bool key_is(const char *key, size_t length, const char *expected)
{
	size_t expected_length = strlen(expected);
	return length == expected_length && memcmp(key, expected, length) == 0;
}

static bool scan_object(struct scan *s, enum scan_scope scope)
{
	struct key_entry **keys = NULL;
	bool canonical = scope == SCAN_CANONICAL;
	if (canonical) {
		if (s->canonical_containers >= Z2M_CANONICAL_MAX_CONTAINERS + 1U ||
			s->canonical_depth >= Z2M_CANONICAL_MAX_DEPTH + 1U) {
			s->canonical_limited = true;
			return false;
		}
		s->canonical_containers++;
		s->canonical_depth++;
	} else {
		if (s->containers >= Z2M_JSON_MAX_CONTAINERS) { s->limited = true; return false; }
		s->containers++;
		if (++s->depth > Z2M_JSON_MAX_DEPTH) { s->limited = true; return false; }
	}
	if (s->data[s->offset++] != '{') return false;
	ws(s);
	if (s->offset < s->length && s->data[s->offset] == '}') {
		s->offset++;
		if (canonical) s->canonical_depth--; else s->depth--;
		return true;
	}
	for (;;) {
		char *key = NULL;
		size_t key_length = 0;
		enum scan_scope child_scope = canonical ? SCAN_CANONICAL : SCAN_OTHER;
		bool operation_field = false;
		bool canonical_field = false;
		if (canonical) {
			if (!scan_string(s, NULL, NULL)) goto fail;
			if (++s->canonical_keys > Z2M_CANONICAL_MAX_MEMBERS + 1U) {
				s->canonical_limited = true;
				goto fail;
			}
		} else {
			if (!scan_string(s, &key, &key_length)) goto fail;
			operation_field = scope == SCAN_ENVELOPE && key_is(key, key_length, "operation");
			if (scope == SCAN_ENVELOPE && key_is(key, key_length, "arguments"))
				child_scope = SCAN_ARGUMENTS;
			else if (scope == SCAN_ARGUMENTS && key_is(key, key_length, "value"))
				child_scope = SCAN_CANONICAL;
			canonical_field = child_scope == SCAN_CANONICAL;
			if (memchr(key, 0, key_length) != NULL)
				s->nul_key_other = true;
			if (++s->keys > Z2M_JSON_MAX_KEYS) { s->limited = true; free(key); goto fail; }
			if (keys == NULL) {
				keys = calloc(KEY_BUCKETS, sizeof(*keys));
				if (keys == NULL) { free(key); goto fail; }
				s->bucket_allocs++;
			}
			if (!add_key(s, keys, key, key_length, &s->duplicate_other)) goto fail;
		}
		ws(s); if (s->offset >= s->length || s->data[s->offset++] != ':') goto fail;
		ws(s);
		if (operation_field && s->offset < s->length && s->data[s->offset] == '"') {
			char *operation = NULL;
			size_t operation_length = 0;
			if (!scan_string(s, &operation, &operation_length)) goto fail;
			if (key_is(operation, operation_length, "atomic_write_json"))
				s->atomic_write_json = true;
			free(operation);
		} else {
			size_t start = s->offset;
			if (!scan_value(s, child_scope)) goto fail;
			if (canonical_field && !s->canonical_seen) {
				s->canonical_start = start;
				s->canonical_end = s->offset;
				s->canonical_seen = true;
			}
		}
		ws(s); if (s->offset >= s->length) goto fail;
		if (s->data[s->offset++] == '}') break;
		if (s->data[s->offset - 1] != ',') goto fail;
		ws(s);
	}
	free_keys(keys);
	if (canonical) s->canonical_depth--; else s->depth--;
	return true;
fail:
	free_keys(keys);
	if (canonical) s->canonical_depth--; else s->depth--;
	return false;
}

static bool scan_array(struct scan *s, enum scan_scope scope)
{
	bool canonical = scope == SCAN_CANONICAL;
	if (canonical) {
		if (s->canonical_containers >= Z2M_CANONICAL_MAX_CONTAINERS + 1U ||
			s->canonical_depth >= Z2M_CANONICAL_MAX_DEPTH + 1U) {
			s->canonical_limited = true;
			return false;
		}
		s->canonical_containers++;
		s->canonical_depth++;
	} else {
		if (s->containers >= Z2M_JSON_MAX_CONTAINERS) { s->limited = true; return false; }
		s->containers++;
		if (++s->depth > Z2M_JSON_MAX_DEPTH) { s->limited = true; return false; }
	}
	s->offset++; ws(s);
	if (s->offset < s->length && s->data[s->offset] == ']') {
		s->offset++;
		if (canonical) s->canonical_depth--; else s->depth--;
		return true;
	}
	for (;;) {
		if (!scan_value(s, canonical ? SCAN_CANONICAL : SCAN_OTHER)) {
			if (canonical) s->canonical_depth--; else s->depth--;
			return false;
		}
		ws(s); if (s->offset >= s->length) {
			if (canonical) s->canonical_depth--; else s->depth--;
			return false;
		}
		if (s->data[s->offset++] == ']') {
			if (canonical) s->canonical_depth--; else s->depth--;
			return true;
		}
		if (s->data[s->offset - 1] != ',') {
			if (canonical) s->canonical_depth--; else s->depth--;
			return false;
		}
		ws(s);
	}
}

static bool scan_value(struct scan *s, enum scan_scope scope)
{
	size_t start;
	ws(s); if (s->offset >= s->length) return false;
	if (s->data[s->offset] == '{') return scan_object(s, scope);
	if (s->data[s->offset] == '[') return scan_array(s, scope);
	if (s->data[s->offset] == '"') return scan_string(s, NULL, NULL);
	start = s->offset;
	while (s->offset < s->length && !strchr(" \t\r\n,]}", s->data[s->offset])) s->offset++;
	return s->offset > start;
}

static bool valid_utf8(const unsigned char *s, size_t n)
{
	size_t i = 0;
	while (i < n) {
		uint32_t cp; size_t need;
		if (s[i] < 0x80) { if (s[i] == 0) return false; i++; continue; }
		if ((s[i] & 0xe0) == 0xc0) { cp = s[i] & 0x1f; need = 1; if (cp < 2) return false; }
		else if ((s[i] & 0xf0) == 0xe0) { cp = s[i] & 0x0f; need = 2; }
		else if ((s[i] & 0xf8) == 0xf0) { cp = s[i] & 7; need = 3; }
		else return false;
		if (i + need >= n) return false;
		for (size_t j = 1; j <= need; j++) { if ((s[i+j] & 0xc0) != 0x80) return false; cp = (cp << 6) | (s[i+j] & 0x3f); }
		if ((need == 2 && cp < 0x800) || (need == 3 && cp < 0x10000) || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return false;
		i += need + 1;
	}
	return true;
}

static bool exact_fields(json_object *object, const char *const *fields, size_t count)
{
	size_t seen = 0;
	json_object_object_foreach(object, key, value) {
		bool found = false; (void)value;
		for (size_t i = 0; i < count; i++) if (strcmp(key, fields[i]) == 0) found = true;
		if (!found)
			return false;
		seen++;
	}
	return seen == count;
}

static bool valid_id(json_object *value)
{
	const char *id = json_object_get_string(value);
	size_t n = (size_t)json_object_get_string_len(value);
	if (n < 1 || n > 128 || strlen(id) != n) return false;
	for (size_t i = 0; i < n; i++) {
		unsigned char c = (unsigned char)id[i];
		if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
			(c >= '0' && c <= '9') || strchr("._:-", c))) return false;
	}
	return true;
}

static bool known_operation(const char *op)
{
	static const char *const names[] = {"stat_regular","read_regular","atomic_write","atomic_write_json","mkdir_private","sha256_regular","rename_owned","unlink_owned","lock_acquire","lock_release","lock_status"};
	for (size_t i = 0; i < sizeof(names)/sizeof(names[0]); i++) if (strcmp(op, names[i]) == 0) return true;
	return false;
}

static bool exact_json_string(json_object *value, const char **text)
{
	if (!json_object_is_type(value, json_type_string)) return false;
	*text = json_object_get_string(value);
	return strlen(*text) == (size_t)json_object_get_string_len(value);
}

#ifdef Z2M_TESTING
static ssize_t input_read(void *buffer, size_t length)
{
	static bool interrupted;
	if (getenv("Z2M_TEST_STDIN_SHIM") != NULL && !interrupted) {
		interrupted = true; errno = EINTR; return -1;
	}
	return read(STDIN_FILENO, buffer, length);
}
#else
static ssize_t input_read(void *buffer, size_t length) { return read(STDIN_FILENO, buffer, length); }
#endif

int z2m_read_request(struct z2m_request *request)
{
	unsigned char *buffer = z2m_alloc(Z2M_REQUEST_MAX + 1); size_t used = 0; ssize_t got;
	json_tokener *tokener; enum json_tokener_error error; json_object *id, *op, *args, *version;
	static const char *const envelope[] = {"protocolVersion","requestId","operation","arguments"};
	struct scan scan;
	struct z2m_canonical_error canonical_error;
	if (buffer == NULL) return z2m_fail(NULL, "EINTERNAL", "internal");
	for (;;) {
		got = input_read(buffer + used, Z2M_REQUEST_MAX + 1 - used);
		if (got < 0 && errno == EINTR) continue;
		if (got <= 0) break;
		used += (size_t)got;
		if (used > Z2M_REQUEST_MAX) { free(buffer); return z2m_fail(NULL, "EREQUESTTOOBIG", "request_size"); }
	}
	if (got < 0) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "framing"); }
	if (used == 0 || !valid_utf8(buffer, used)) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "utf8"); }
	scan = (struct scan){.data=buffer,.length=used};
	if (!scan_value(&scan, SCAN_ENVELOPE)) {
#ifdef Z2M_TESTING
		if (getenv("Z2M_TEST_SCAN_STATS") != NULL) fprintf(stderr,"z2m-core-helper: scan-containers=%zu scan-bucket-allocs=%zu scan-probes=%zu\n",scan.containers,scan.bucket_allocs,scan.probes);
#endif
		free(buffer);
		if (scan.canonical_limited)
			return z2m_fail(NULL, "ESCHEMA", "canonical_validate");
		return z2m_fail(NULL, scan.limited ? "ESCHEMA" : "EMALFORMED", scan.limited ? "schema" : "json_decode");
	}
	ws(&scan);
#ifdef Z2M_TESTING
	if (getenv("Z2M_TEST_SCAN_STATS") != NULL) fprintf(stderr,"z2m-core-helper: scan-containers=%zu scan-bucket-allocs=%zu scan-probes=%zu\n",scan.containers,scan.bucket_allocs,scan.probes);
#endif
	if (scan.offset != used) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "trailing_data"); }
	if (scan.nul_key_other) { free(buffer); return z2m_fail(NULL, "ESCHEMA", "schema"); }
	if (scan.duplicate_other) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "json_decode"); }
	if (scan.atomic_write_json && scan.canonical_seen &&
		!z2m_canonical_validate(buffer + scan.canonical_start,
			scan.canonical_end - scan.canonical_start, &canonical_error)) {
		free(buffer);
		return z2m_fail(NULL, canonical_error.code, canonical_error.stage);
	}
	tokener = json_tokener_new();
	if (tokener == NULL) { free(buffer); return z2m_fail(NULL,"EINTERNAL","internal"); }
	json_tokener_set_flags(tokener, JSON_TOKENER_STRICT);
	request->document = json_tokener_parse_ex(tokener, (const char *)buffer, (int)used); error = json_tokener_get_error(tokener);
	json_tokener_free(tokener); free(buffer);
	if (error != json_tokener_success || request->document == NULL || !json_object_is_type(request->document, json_type_object)) return z2m_fail(NULL, "EMALFORMED", "json_decode");
	if (!json_object_object_get_ex(request->document,"requestId",&id) || !valid_id(id)) return z2m_fail(NULL,"ESCHEMA","request_id");
	request->request_id = strdup(json_object_get_string(id));
	if (request->request_id == NULL) return z2m_fail(NULL,"EINTERNAL","internal");
	if (!exact_fields(request->document, envelope, 4) || !json_object_object_get_ex(request->document,"protocolVersion",&version) || !json_object_is_type(version,json_type_int) || json_object_get_int(version)!=1) return z2m_fail(request->request_id,"ESCHEMA","schema");
	if (!json_object_object_get_ex(request->document,"operation",&op) || !exact_json_string(op,&request->operation) || !known_operation(request->operation) || !json_object_object_get_ex(request->document,"arguments",&args) || !json_object_is_type(args,json_type_object)) return z2m_fail(request->request_id,"ESCHEMA","schema");
	request->arguments = args;
	return -1;
}

void z2m_request_free(struct z2m_request *request) { free(request->request_id); json_object_put(request->document); }

static bool integer_value(json_object *args, const char *name, int64_t minimum, int64_t maximum, int64_t *out)
{
	json_object *value;
	if (!json_object_object_get_ex(args,name,&value) || !json_object_is_type(value,json_type_int)) return false;
	*out=json_object_get_int64(value);
	return *out>=minimum && *out<=maximum;
}

static bool boolean_value(json_object *args,const char *name)
{json_object *value;return json_object_object_get_ex(args,name,&value)&&json_object_is_type(value,json_type_boolean);}

static bool string_value(json_object *args,const char *name,size_t minimum,size_t maximum,const char **out)
{json_object *value;if(!json_object_object_get_ex(args,name,&value)||!json_object_is_type(value,json_type_string))return false;*out=json_object_get_string(value);return strlen(*out)==(size_t)json_object_get_string_len(value)&&strlen(*out)>=minimum&&strlen(*out)<=maximum;}

static bool hex64(const char *value)
{if(strlen(value)!=64)return false;for(size_t i=0;i<64;i++)if(!((value[i]>='0'&&value[i]<='9')||(value[i]>='a'&&value[i]<='f')))return false;return true;}

static bool lock_name(const char *value)
{for(size_t i=0;value[i];i++){unsigned char c=(unsigned char)value[i];if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||strchr("._/-",c)))return false;}return true;}

bool z2m_reserved_schema_valid(const struct z2m_request *request)
{
	json_object *args=request->arguments,*value;const char *s,*token;int64_t number;
	static const char *const write_fields[]={"root","path","content","mode","uid","gid","allowCreate"};
	static const char *const write_json_fields[]={"root","path","value","mode","uid","gid","allowCreate"};
	static const char *const mkdir_fields[]={"root","path","mode","uid","gid","existOk"};
	static const char *const hash_fields[]={"root","path","maxBytes"};
	static const char *const rename_fields[]={"root","fromPath","toPath","ownershipToken","replace"};
	static const char *const unlink_fields[]={"root","path","ownershipToken","missingOk"};
	static const char *const acquire_fields[]={"name","owner","timeoutMs"};
	static const char *const release_fields[]={"name","owner","token"};
	static const char *const status_fields[]={"name"};
	if(strcmp(request->operation,"atomic_write")==0)
		return exact_fields(args,write_fields,7)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&string_value(args,"content",0,694704,&s)&&z2m_base64_canonical(s,strlen(s),521028)&&string_value(args,"mode",4,4,&s)&&strcmp(s,"0600")==0&&integer_value(args,"uid",0,0,&number)&&integer_value(args,"gid",0,0,&number)&&boolean_value(args,"allowCreate");
	if(strcmp(request->operation,"atomic_write_json")==0)
		return exact_fields(args,write_json_fields,7)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&json_object_object_get_ex(args,"value",&value)&&string_value(args,"mode",4,4,&s)&&strcmp(s,"0600")==0&&integer_value(args,"uid",0,0,&number)&&integer_value(args,"gid",0,0,&number)&&boolean_value(args,"allowCreate");
	if(strcmp(request->operation,"mkdir_private")==0)
		return exact_fields(args,mkdir_fields,6)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&string_value(args,"mode",4,4,&s)&&strcmp(s,"0700")==0&&integer_value(args,"uid",0,0,&number)&&integer_value(args,"gid",0,0,&number)&&boolean_value(args,"existOk");
	if(strcmp(request->operation,"sha256_regular")==0)
		return exact_fields(args,hash_fields,3)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&integer_value(args,"maxBytes",0,4194304,&number);
	if(strcmp(request->operation,"rename_owned")==0)
		return exact_fields(args,rename_fields,5)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"fromPath",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&string_value(args,"toPath",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&string_value(args,"ownershipToken",64,64,&token)&&hex64(token)&&boolean_value(args,"replace");
	if(strcmp(request->operation,"unlink_owned")==0)
		return exact_fields(args,unlink_fields,4)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&string_value(args,"ownershipToken",64,64,&token)&&hex64(token)&&boolean_value(args,"missingOk");
	if(strcmp(request->operation,"lock_acquire")==0)
		return exact_fields(args,acquire_fields,3)&&string_value(args,"name",1,256,&s)&&lock_name(s)&&string_value(args,"owner",1,128,&s)&&integer_value(args,"timeoutMs",0,30000,&number);
	if(strcmp(request->operation,"lock_release")==0)
		return exact_fields(args,release_fields,3)&&string_value(args,"name",1,256,&s)&&string_value(args,"owner",1,128,&s)&&string_value(args,"token",64,64,&token)&&hex64(token);
	return strcmp(request->operation,"lock_status")==0&&exact_fields(args,status_fields,1)&&string_value(args,"name",1,256,&s);
}
