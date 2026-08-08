#ifndef Z2M_HELPERD_H
#define Z2M_HELPERD_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define Z2M_PROTOCOL "z2m-helper-transport-v1"
#define Z2M_REQUEST_LIMIT (4U * 1024U * 1024U)
#define Z2M_RESPONSE_LIMIT (6U * 1024U * 1024U)
#define Z2M_STDERR_LIMIT 4096U
#define Z2M_REQUEST_HEADER_LIMIT 1024U

#ifdef Z2M_TEST_IO_TIMEOUT_MS
#define Z2M_IO_TIMEOUT_MS Z2M_TEST_IO_TIMEOUT_MS
#else
#define Z2M_IO_TIMEOUT_MS 1000U
#endif

#ifdef Z2M_TESTING
#ifndef Z2M_RUNTIME_PATH
#error Z2M_RUNTIME_PATH is required for test builds
#endif
#ifndef Z2M_HELPER_PATH
#error Z2M_HELPER_PATH is required for test builds
#endif
#ifndef Z2M_TEST_RUNTIME_UID
#define Z2M_TEST_RUNTIME_UID 0
#endif
#ifndef Z2M_TEST_PEER_UID
#define Z2M_TEST_PEER_UID 0
#endif
#ifndef Z2M_TEST_RUNTIME_GID
#define Z2M_TEST_RUNTIME_GID 0
#endif
#define Z2M_RUNTIME_UID Z2M_TEST_RUNTIME_UID
#define Z2M_RUNTIME_GID Z2M_TEST_RUNTIME_GID
#define Z2M_PEER_UID Z2M_TEST_PEER_UID
#else
#define Z2M_RUNTIME_PATH "/tmp/zapret2-manager/runtime"
#define Z2M_HELPER_PATH "/usr/libexec/zapret2-manager/z2m-core-helper"
#define Z2M_SOCKET_PATH "/tmp/zapret2-manager/runtime/z2m-helperd.sock"
#define Z2M_LOCK_PATH "/tmp/zapret2-manager/runtime/z2m-helperd.lock"
#define Z2M_RUNTIME_UID 0
#define Z2M_RUNTIME_GID 0
#define Z2M_PEER_UID 0
#endif

#ifdef Z2M_TESTING
#define Z2M_SOCKET_PATH Z2M_RUNTIME_PATH "/z2m-helperd.sock"
#define Z2M_LOCK_PATH Z2M_RUNTIME_PATH "/z2m-helperd.lock"
#endif

struct z2m_request {
	char request_id[129];
	unsigned int timeout_ms;
	uint8_t *body;
	size_t body_length;
};

struct z2m_result {
	const char *outcome;
	const char *start_state;
	const char *stage;
	const char *reason;
	int error_number;
	int exit_code;
	int signal_number;
	bool child_reaped;
	bool stdout_eof;
	bool stderr_eof;
	uint8_t *output;
	size_t output_length;
	uint8_t errors[Z2M_STDERR_LIMIT];
	size_t error_length;
	size_t error_drained;
};

int z2m_read_request(int client, struct z2m_request *request);
int z2m_write_response(int client, const struct z2m_request *request,
	const struct z2m_result *result);
void z2m_free_request(struct z2m_request *request);
void z2m_supervise(int client, const struct z2m_request *request,
	struct z2m_result *result);
void z2m_free_result(struct z2m_result *result);
bool z2m_stopping(void);

#endif
