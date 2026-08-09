#ifndef Z2M_HELPER_H
#define Z2M_HELPER_H

#include <json-c/json.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>

#ifdef __GLIBC__
typedef struct statx z2m_statx;
#else
#define statx z2m_statx
#define statx_timestamp z2m_statx_timestamp
#include <linux/stat.h>
#undef statx_timestamp
#undef statx
typedef struct z2m_statx z2m_statx;
#endif

#define Z2M_REQUEST_MAX (4U * 1024U * 1024U)
#define Z2M_RESPONSE_MAX (6U * 1024U * 1024U)
#define Z2M_JSON_MAX_DEPTH 64U
#define Z2M_JSON_MAX_KEYS 1024U
#define Z2M_JSON_MAX_CONTAINERS 1024U
#define Z2M_CANONICAL_MAX_DEPTH 64U
#define Z2M_CANONICAL_MAX_CONTAINERS 1024U
#define Z2M_CANONICAL_MAX_MEMBERS 1024U
#define Z2M_CANONICAL_MAX_NODES 65536U
#define Z2M_CANONICAL_MAX_KEY_BYTES 4096U

struct z2m_canonical_error {
	const char *code;
	const char *stage;
};

struct z2m_root {
	const char *name;
	const char *base;
	size_t max_read;
	unsigned int max_depth;
	bool stat_allowed;
	bool read_allowed;
	bool mkdir_allowed;
	bool directory_fsync;
};

struct z2m_request {
	char *request_id;
	const char *operation;
	json_object *document;
	json_object *arguments;
	json_object *canonical_value;
};

struct z2m_prepared_wire {
	char *data;
	size_t length;
};

int z2m_fail(const char *request_id, const char *code, const char *stage);
int z2m_success(const char *request_id, json_object *data);
json_object *z2m_prepare_success(const char *request_id, json_object *data);
int z2m_emit_prepared(json_object *response, int exit_code);
bool z2m_prepare_success_wire(const char *request_id, json_object *data, struct z2m_prepared_wire *wire);
bool z2m_prepare_failure_wire(const char *request_id, const char *code, const char *stage, struct z2m_prepared_wire *wire);
int z2m_emit_wire(struct z2m_prepared_wire *wire, int exit_code);
void z2m_discard_wire(struct z2m_prepared_wire *wire);
void z2m_response_publication_started(void);
#ifdef Z2M_TESTING
void z2m_test_audit_start(void);
void z2m_test_audit_finish(unsigned long allocation_count, unsigned long serialization_count);
void z2m_test_audit_report(void);
void z2m_test_direct_post_publication_probe(void);
#endif
int z2m_read_request(struct z2m_request *request);
void z2m_request_free(struct z2m_request *request);
bool z2m_reserved_schema_valid(const struct z2m_request *request);
bool z2m_canonical_validate(const unsigned char *data, size_t length,
	struct z2m_canonical_error *error);
bool z2m_canonical_semantic_valid(json_object *value);
bool z2m_canonical_construct(const unsigned char *data, size_t length,
	json_object **value, struct z2m_canonical_error *error);
bool z2m_json_c_parse_validated(const unsigned char *data, size_t length,
	unsigned int max_depth, json_object **value);
const struct z2m_root *z2m_root_find(const char *name);
int z2m_root_open(const struct z2m_root *root);
int z2m_root_mount_id(int root_fd, uint64_t *id, const char **code);
int z2m_root_lock(int root_fd, bool shared, const char **code);
bool z2m_path_valid(const char *path, unsigned int max_depth);
int z2m_open_regular(int root_fd, const char *path, struct stat *st, const char **code);
int z2m_stat_regular(const struct z2m_request *request, const struct z2m_root *root, int root_fd);
int z2m_read_regular(const struct z2m_request *request, const struct z2m_root *root, int root_fd);
int z2m_sha256_regular(const struct z2m_request *request, const struct z2m_root *root, int root_fd);
int z2m_mkdir_private(const struct z2m_request *request, const struct z2m_root *root, int root_fd, uint64_t root_mount);
int z2m_atomic_write(const struct z2m_request *request, const struct z2m_root *root, int root_fd, uint64_t root_mount);
char *z2m_base64(const unsigned char *input, size_t length);
bool z2m_base64_canonical(const char *input, size_t length, size_t max_decoded);
void *z2m_alloc(size_t size);
json_object *z2m_json_object(void);
json_object *z2m_json_string(const char *value);
json_object *z2m_json_int(int64_t value);
json_object *z2m_json_bool(bool value);
bool z2m_json_add(json_object *object, const char *name, json_object *value);

#endif
