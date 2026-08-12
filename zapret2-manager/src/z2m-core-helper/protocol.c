#include "helper.h"

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
	size_t candidate_start;
	size_t candidate_end;
	bool candidate_seen;
	bool duplicate_other;
	bool nul_key_other;
	bool atomic_write_json;
	bool atomic_write_json_revision;
	bool capture_candidate;
};

enum scan_scope {
	SCAN_OTHER,
	SCAN_ENVELOPE,
	SCAN_ARGUMENTS
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

static bool json_whitespace(unsigned char byte)
{
	return byte == ' ' || byte == '\t' || byte == '\r' || byte == '\n';
}

static void ws(struct scan *s)
{
	while (s->offset < s->length && json_whitespace(s->data[s->offset]))
		s->offset++;
}

static int hex_digit(unsigned char byte)
{
	if (byte >= '0' && byte <= '9') return byte - '0';
	if (byte >= 'a' && byte <= 'f') return byte - 'a' + 10;
	if (byte >= 'A' && byte <= 'F') return byte - 'A' + 10;
	return -1;
}

static bool scan_quad(struct scan *s, uint32_t *value)
{
	uint32_t result = 0;
	if (s->length - s->offset < 4) return false;
	for (size_t i = 0; i < 4; i++) {
		int digit = hex_digit(s->data[s->offset++]);
		if (digit < 0) return false;
		result = (result << 4) | (uint32_t)digit;
	}
	*value = result;
	return true;
}

static bool append_decoded(char **decoded, size_t *length, size_t *capacity,
	const unsigned char *bytes, size_t count)
{
	char *grown;
	size_t required;
	size_t next;
	if (decoded == NULL) return true;
	if (count > SIZE_MAX - *length) return false;
	required = *length + count;
	if (required + 1U < required) return false;
	if (required + 1U > *capacity) {
		next = *capacity == 0 ? 16U : *capacity;
		while (next < required + 1U) {
			if (next > SIZE_MAX / 2U) return false;
			next *= 2U;
		}
		grown = realloc(*decoded, next);
		if (grown == NULL) return false;
		*decoded = grown;
		*capacity = next;
	}
	if (count != 0) memcpy(*decoded + *length, bytes, count);
	*length = required;
	(*decoded)[required] = '\0';
	return true;
}

static bool append_codepoint(char **decoded, size_t *length, size_t *capacity,
	uint32_t codepoint)
{
	unsigned char bytes[4];
	size_t count;
	if (codepoint <= 0x7fU) {
		bytes[0] = (unsigned char)codepoint; count = 1;
	} else if (codepoint <= 0x7ffU) {
		bytes[0] = (unsigned char)(0xc0U | (codepoint >> 6));
		bytes[1] = (unsigned char)(0x80U | (codepoint & 0x3fU)); count = 2;
	} else if (codepoint <= 0xffffU) {
		bytes[0] = (unsigned char)(0xe0U | (codepoint >> 12));
		bytes[1] = (unsigned char)(0x80U | ((codepoint >> 6) & 0x3fU));
		bytes[2] = (unsigned char)(0x80U | (codepoint & 0x3fU)); count = 3;
	} else {
		bytes[0] = (unsigned char)(0xf0U | (codepoint >> 18));
		bytes[1] = (unsigned char)(0x80U | ((codepoint >> 12) & 0x3fU));
		bytes[2] = (unsigned char)(0x80U | ((codepoint >> 6) & 0x3fU));
		bytes[3] = (unsigned char)(0x80U | (codepoint & 0x3fU)); count = 4;
	}
	return append_decoded(decoded, length, capacity, bytes, count);
}

static bool scan_raw_string(struct scan *s)
{
	bool escaped = false;
	if (s->offset >= s->length || s->data[s->offset++] != '"') return false;
	while (s->offset < s->length) {
		unsigned char byte = s->data[s->offset++];
		if (!escaped && byte == '"') return true;
		if (!escaped && byte < 0x20U) return false;
		if (!escaped && byte == '\\') escaped = true; else escaped = false;
	}
	return false;
}

static bool scan_candidate_span(struct scan *s)
{
	unsigned char first;
	size_t nesting = 0;

	if (s->offset >= s->length) return false;
	first = s->data[s->offset];
	if (first == '"') return scan_raw_string(s);
	if (first != '{' && first != '[') {
		size_t start = s->offset;
		while (s->offset < s->length &&
			!strchr(" \t\r\n,]}", s->data[s->offset]))
			s->offset++;
		return s->offset > start;
	}
	while (s->offset < s->length) {
		unsigned char byte = s->data[s->offset];
		if (byte == '"') {
			if (!scan_raw_string(s)) return false;
			continue;
		}
		s->offset++;
		if (byte == '{' || byte == '[') {
			if (nesting == SIZE_MAX) return false;
			nesting++;
		} else if (byte == '}' || byte == ']') {
			if (nesting == 0) return false;
			nesting--;
			if (nesting == 0) return true;
		}
	}
	return false;
}

static bool scan_string(struct scan *s, char **decoded, size_t *decoded_length)
{
	size_t capacity = 0;
	if (decoded != NULL) { *decoded = NULL; *decoded_length = 0; }
	if (s->offset >= s->length || s->data[s->offset++] != '"') return false;
	while (s->offset < s->length) {
		unsigned char byte = s->data[s->offset++];
		uint32_t codepoint;
		if (byte == '"') {
			if (decoded != NULL && *decoded == NULL) {
				*decoded = malloc(1);
				if (*decoded == NULL) return false;
				(*decoded)[0] = '\0';
			}
			return true;
		}
		if (byte < 0x20U) goto fail;
		if (byte != '\\') {
			if (!append_decoded(decoded, decoded_length, &capacity, &byte, 1)) goto fail;
			continue;
		}
		if (s->offset >= s->length) goto fail;
		byte = s->data[s->offset++];
		switch (byte) {
		case '"': codepoint = '"'; break;
		case '\\': codepoint = '\\'; break;
		case '/': codepoint = '/'; break;
		case 'b': codepoint = '\b'; break;
		case 'f': codepoint = '\f'; break;
		case 'n': codepoint = '\n'; break;
		case 'r': codepoint = '\r'; break;
		case 't': codepoint = '\t'; break;
		case 'u': {
			uint32_t low;
			if (!scan_quad(s, &codepoint)) goto fail;
			if (codepoint >= 0xd800U && codepoint <= 0xdbffU) {
				if (s->length - s->offset < 2 || s->data[s->offset] != '\\' ||
					s->data[s->offset + 1] != 'u') goto fail;
				s->offset += 2;
				if (!scan_quad(s, &low) || low < 0xdc00U || low > 0xdfffU) goto fail;
				codepoint = 0x10000U + ((codepoint - 0xd800U) << 10) +
					(low - 0xdc00U);
			} else if (codepoint >= 0xdc00U && codepoint <= 0xdfffU) goto fail;
			break;
		}
		default: goto fail;
		}
		if (!append_codepoint(decoded, decoded_length, &capacity, codepoint)) goto fail;
	}
fail:
	if (decoded != NULL) { free(*decoded); *decoded = NULL; *decoded_length = 0; }
	return false;
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
	if (s->containers >= Z2M_JSON_MAX_CONTAINERS) { s->limited = true; return false; }
	s->containers++;
	if (++s->depth > Z2M_JSON_MAX_DEPTH) { s->limited = true; return false; }
	if (s->data[s->offset++] != '{') return false;
	ws(s);
	if (s->offset < s->length && s->data[s->offset] == '}') {
		s->offset++;
		s->depth--;
		return true;
	}
	for (;;) {
		char *key = NULL;
		size_t key_length = 0;
		enum scan_scope child_scope = SCAN_OTHER;
		bool operation_field = false;
		bool candidate_field = false;
		if (!scan_string(s, &key, &key_length)) goto fail;
		operation_field = scope == SCAN_ENVELOPE && key_is(key, key_length, "operation");
		if (scope == SCAN_ENVELOPE && key_is(key, key_length, "arguments"))
			child_scope = SCAN_ARGUMENTS;
		else if (scope == SCAN_ARGUMENTS && s->capture_candidate &&
			key_is(key, key_length, "value"))
			candidate_field = true;
		if (memchr(key, 0, key_length) != NULL)
			s->nul_key_other = true;
		if (++s->keys > Z2M_JSON_MAX_KEYS) { s->limited = true; free(key); goto fail; }
		if (keys == NULL) {
			keys = calloc(KEY_BUCKETS, sizeof(*keys));
			if (keys == NULL) { free(key); goto fail; }
			s->bucket_allocs++;
		}
		if (!add_key(s, keys, key, key_length, &s->duplicate_other)) goto fail;
		ws(s); if (s->offset >= s->length || s->data[s->offset++] != ':') goto fail;
		ws(s);
		if (candidate_field) {
			size_t start = s->offset;
			if (!scan_candidate_span(s)) goto fail;
			if (!s->candidate_seen) {
				s->candidate_start = start;
				s->candidate_end = s->offset;
				s->candidate_seen = true;
			}
		} else if (operation_field && s->offset < s->length && s->data[s->offset] == '"') {
			char *operation = NULL;
			size_t operation_length = 0;
			if (!scan_string(s, &operation, &operation_length)) goto fail;
			if (key_is(operation, operation_length, "atomic_write_json"))
				s->atomic_write_json = true;
			if (key_is(operation, operation_length, "atomic_write_json_revision"))
				s->atomic_write_json_revision = true;
			free(operation);
		} else {
			if (!scan_value(s, child_scope)) goto fail;
		}
		ws(s); if (s->offset >= s->length) goto fail;
		if (s->data[s->offset++] == '}') break;
		if (s->data[s->offset - 1] != ',') goto fail;
		ws(s);
	}
	free_keys(keys);
	s->depth--;
	return true;
fail:
	free_keys(keys);
	s->depth--;
	return false;
}

static bool scan_array(struct scan *s)
{
	if (s->containers >= Z2M_JSON_MAX_CONTAINERS) { s->limited = true; return false; }
	s->containers++;
	if (++s->depth > Z2M_JSON_MAX_DEPTH) { s->limited = true; return false; }
	s->offset++; ws(s);
	if (s->offset < s->length && s->data[s->offset] == ']') {
		s->offset++;
		s->depth--;
		return true;
	}
	for (;;) {
		if (!scan_value(s, SCAN_OTHER)) {
			s->depth--;
			return false;
		}
		ws(s); if (s->offset >= s->length) {
			s->depth--;
			return false;
		}
		if (s->data[s->offset++] == ']') {
			s->depth--;
			return true;
		}
		if (s->data[s->offset - 1] != ',') {
			s->depth--;
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
	if (s->data[s->offset] == '[') return scan_array(s);
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
	static const char *const names[] = {"stat_regular","read_regular","atomic_write","atomic_write_json","atomic_write_json_revision","mkdir_private","sha256_regular","rename_owned","unlink_owned","lock_acquire","lock_release","lock_status"};
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
	struct scan legacy_scan;
	struct scan *checked;
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
	scan = (struct scan){.data=buffer,.length=used,.capture_candidate=true};
	if (!scan_value(&scan, SCAN_ENVELOPE)) {
#ifdef Z2M_TESTING
		if (getenv("Z2M_TEST_SCAN_STATS") != NULL) fprintf(stderr,"z2m-core-helper: scan-containers=%zu scan-bucket-allocs=%zu scan-probes=%zu\n",scan.containers,scan.bucket_allocs,scan.probes);
#endif
		free(buffer);
		return z2m_fail(NULL, scan.limited ? "ESCHEMA" : "EMALFORMED", scan.limited ? "schema" : "json_decode");
	}
	ws(&scan);
#ifdef Z2M_TESTING
	if (getenv("Z2M_TEST_SCAN_STATS") != NULL) fprintf(stderr,"z2m-core-helper: scan-containers=%zu scan-bucket-allocs=%zu scan-probes=%zu\n",scan.containers,scan.bucket_allocs,scan.probes);
#endif
	if (scan.offset != used) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "trailing_data"); }
	checked = &scan;
	if (!(scan.atomic_write_json || scan.atomic_write_json_revision) && scan.candidate_seen) {
		legacy_scan = (struct scan){.data=buffer,.length=used};
		if (!scan_value(&legacy_scan, SCAN_ENVELOPE)) {
			free(buffer);
			return z2m_fail(NULL, legacy_scan.limited ? "ESCHEMA" : "EMALFORMED",
				legacy_scan.limited ? "schema" : "json_decode");
		}
		ws(&legacy_scan);
		if (legacy_scan.offset != used) {
			free(buffer);
			return z2m_fail(NULL, "EMALFORMED", "trailing_data");
		}
		checked = &legacy_scan;
	}
	if (checked->nul_key_other) { free(buffer); return z2m_fail(NULL, "ESCHEMA", "schema"); }
	if (checked->duplicate_other) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "json_decode"); }
	if ((scan.atomic_write_json || scan.atomic_write_json_revision) && scan.candidate_seen &&
		!z2m_canonical_construct(buffer + scan.candidate_start,
			scan.candidate_end - scan.candidate_start,
			&request->canonical_value, &canonical_error)) {
		free(buffer);
		return z2m_fail(NULL, canonical_error.code, canonical_error.stage);
	}
	if (scan.atomic_write_json || scan.atomic_write_json_revision) {
		if (!z2m_json_c_parse_validated(buffer, used,
			Z2M_CANONICAL_MAX_DEPTH + 3U, &request->document)) {
			free(buffer);
			return z2m_fail(NULL, "EMALFORMED", "json_decode");
		}
	} else {
		tokener = json_tokener_new();
		if (tokener == NULL) { free(buffer); return z2m_fail(NULL,"EINTERNAL","internal"); }
		json_tokener_set_flags(tokener, JSON_TOKENER_STRICT);
		request->document = json_tokener_parse_ex(tokener, (const char *)buffer, (int)used); error = json_tokener_get_error(tokener);
		json_tokener_free(tokener);
		if (error != json_tokener_success) { free(buffer); return z2m_fail(NULL, "EMALFORMED", "json_decode"); }
	}
	free(buffer);
	if (request->document == NULL || !json_object_is_type(request->document, json_type_object)) return z2m_fail(NULL, "EMALFORMED", "json_decode");
	if (!json_object_object_get_ex(request->document,"requestId",&id) || !valid_id(id)) return z2m_fail(NULL,"ESCHEMA","request_id");
	request->request_id = strdup(json_object_get_string(id));
	if (request->request_id == NULL) return z2m_fail(NULL,"EINTERNAL","internal");
	if (!exact_fields(request->document, envelope, 4) || !json_object_object_get_ex(request->document,"protocolVersion",&version) || !json_object_is_type(version,json_type_int) || json_object_get_int(version)!=1) return z2m_fail(request->request_id,"ESCHEMA","schema");
	if (!json_object_object_get_ex(request->document,"operation",&op) || !exact_json_string(op,&request->operation) || !known_operation(request->operation) || !json_object_object_get_ex(request->document,"arguments",&args) || !json_object_is_type(args,json_type_object)) return z2m_fail(request->request_id,"ESCHEMA","schema");
	request->arguments = args;
	return -1;
}

void z2m_request_free(struct z2m_request *request) { free(request->request_id); json_object_put(request->canonical_value); json_object_put(request->document); }

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
	static const char *const write_json_cas_fields[]={"root","path","value","mode","uid","gid","allowCreate","expectedSha256"};
	static const char *const write_json_revision_fields[]={"root","path","value","mode","uid","gid","allowCreate","expectedRevision"};
	static const char *const mkdir_fields[]={"root","path","mode","uid","gid","existOk"};
	static const char *const hash_fields[]={"root","path","maxBytes"};
	static const char *const rename_fields[]={"root","fromPath","toPath","ownershipToken","replace"};
	static const char *const unlink_fields[]={"root","path","ownershipToken","missingOk"};
	static const char *const acquire_fields[]={"name","owner","timeoutMs"};
	static const char *const release_fields[]={"name","owner","token"};
	static const char *const status_fields[]={"name"};
	if(strcmp(request->operation,"atomic_write")==0)
		return exact_fields(args,write_fields,7)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&string_value(args,"content",0,694704,&s)&&z2m_base64_canonical(s,strlen(s),521028)&&string_value(args,"mode",4,4,&s)&&strcmp(s,"0600")==0&&integer_value(args,"uid",0,0,&number)&&integer_value(args,"gid",0,0,&number)&&boolean_value(args,"allowCreate");
	if(strcmp(request->operation,"atomic_write_json")==0){
		bool fields_ok=exact_fields(args,write_json_fields,7)||(exact_fields(args,write_json_cas_fields,8)&&string_value(args,"expectedSha256",64,64,&token)&&hex64(token));
		return fields_ok&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&json_object_object_get_ex(args,"value",&value)&&string_value(args,"mode",4,4,&s)&&strcmp(s,"0600")==0&&integer_value(args,"uid",0,0,&number)&&integer_value(args,"gid",0,0,&number)&&boolean_value(args,"allowCreate");
	}
	if(strcmp(request->operation,"atomic_write_json_revision")==0)
		return exact_fields(args,write_json_revision_fields,8)&&string_value(args,"root",0,SIZE_MAX,&s)&&string_value(args,"path",0,SIZE_MAX,&s)&&z2m_path_valid(s,32)&&json_object_object_get_ex(args,"value",&value)&&string_value(args,"mode",4,4,&s)&&strcmp(s,"0600")==0&&integer_value(args,"uid",0,0,&number)&&integer_value(args,"gid",0,0,&number)&&boolean_value(args,"allowCreate")&&integer_value(args,"expectedRevision",-1,2147483647,&number);
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
