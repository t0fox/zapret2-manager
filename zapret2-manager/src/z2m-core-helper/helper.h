#ifndef Z2M_HELPER_H
#define Z2M_HELPER_H

#include <json-c/json.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>

#define Z2M_REQUEST_MAX (4U * 1024U * 1024U)
#define Z2M_RESPONSE_MAX (6U * 1024U * 1024U)
#define Z2M_JSON_MAX_DEPTH 64U
#define Z2M_JSON_MAX_KEYS 1024U
#define Z2M_JSON_MAX_CONTAINERS 1024U

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
};

int z2m_fail(const char *request_id, const char *code, const char *stage);
int z2m_success(const char *request_id, json_object *data);
int z2m_read_request(struct z2m_request *request);
void z2m_request_free(struct z2m_request *request);
bool z2m_reserved_schema_valid(const struct z2m_request *request);
const struct z2m_root *z2m_root_find(const char *name);
int z2m_root_open(const struct z2m_root *root);
int z2m_root_mount_id(int root_fd, uint64_t *id, const char **code);
int z2m_root_lock(int root_fd, const char **code);
bool z2m_path_valid(const char *path, unsigned int max_depth);
int z2m_open_regular(int root_fd, const char *path, struct stat *st, const char **code);
int z2m_stat_regular(const struct z2m_request *request, const struct z2m_root *root, int root_fd);
int z2m_read_regular(const struct z2m_request *request, const struct z2m_root *root, int root_fd);
int z2m_sha256_regular(const struct z2m_request *request, const struct z2m_root *root, int root_fd);
int z2m_mkdir_private(const struct z2m_request *request, const struct z2m_root *root, int root_fd, uint64_t root_mount);
char *z2m_base64(const unsigned char *input, size_t length);
bool z2m_base64_canonical(const char *input, size_t length, size_t max_decoded);
void *z2m_alloc(size_t size);
json_object *z2m_json_object(void);
json_object *z2m_json_string(const char *value);
json_object *z2m_json_int(int64_t value);
json_object *z2m_json_bool(bool value);
bool z2m_json_add(json_object *object, const char *name, json_object *value);

#endif
