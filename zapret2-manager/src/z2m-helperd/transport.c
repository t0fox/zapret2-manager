#include "helperd.h"

#include <errno.h>
#include <fcntl.h>
#include <json-c/json.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include <limits.h>
#include <time.h>

#define PRELUDE_SIZE 20U
#define RESPONSE_HEADER_LIMIT 2048U

static const uint8_t magic[8] = { 'Z', '2', 'M', 'H', 'T', 'V', '1', '\n' };

static uint32_t read_be32(const uint8_t *value)
{
	return ((uint32_t)value[0] << 24) | ((uint32_t)value[1] << 16) |
		((uint32_t)value[2] << 8) | value[3];
}

static void write_be32(uint8_t *value, uint32_t number)
{
	value[0] = (uint8_t)(number >> 24);
	value[1] = (uint8_t)(number >> 16);
	value[2] = (uint8_t)(number >> 8);
	value[3] = (uint8_t)number;
}

static int compare_time(const struct timespec *left, const struct timespec *right)
{
	if (left->tv_sec != right->tv_sec) return left->tv_sec < right->tv_sec ? -1 : 1;
	if (left->tv_nsec != right->tv_nsec) return left->tv_nsec < right->tv_nsec ? -1 : 1;
	return 0;
}

static struct timespec deadline_after(unsigned int milliseconds)
{
	struct timespec value;
	if (clock_gettime(CLOCK_MONOTONIC, &value) < 0) return (struct timespec){ 0, 0 };
	value.tv_sec += milliseconds / 1000;
	value.tv_nsec += (long)(milliseconds % 1000) * 1000000L;
	if (value.tv_nsec >= 1000000000L) { value.tv_sec++; value.tv_nsec -= 1000000000L; }
	return value;
}

static int deadline_timeout(const struct timespec *deadline)
{
	struct timespec now;
	long seconds, nanoseconds;
	if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
	if (compare_time(&now, deadline) >= 0) return 0;
	seconds = deadline->tv_sec - now.tv_sec;
	nanoseconds = deadline->tv_nsec - now.tv_nsec;
	if (nanoseconds < 0) { seconds--; nanoseconds += 1000000000L; }
	if (seconds > INT_MAX / 1000) return INT_MAX;
	return (int)(seconds * 1000 + (nanoseconds + 999999L) / 1000000L);
}

static int wait_ready(int fd, short events, const struct timespec *deadline)
{
	for (;;) {
		struct pollfd watched = { .fd = fd, .events = events };
		int timeout = deadline_timeout(deadline);
		int ready;
		if (timeout <= 0) { errno = timeout < 0 ? errno : ETIMEDOUT; return -1; }
		ready = poll(&watched, 1, timeout);
		if (ready < 0 && errno == EINTR) continue;
		if (ready <= 0) { if (ready == 0) errno = ETIMEDOUT; return -1; }
		return 0;
	}
}

static int read_all(int fd, void *data, size_t length, const struct timespec *deadline)
{
	uint8_t *cursor = data;
	while (length) {
		ssize_t count = read(fd, cursor, length);
		if (count < 0 && errno == EINTR) continue;
		if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
			if (wait_ready(fd, POLLIN | POLLHUP | POLLERR, deadline) < 0) return -1;
			continue;
		}
		if (count <= 0) return -1;
		cursor += count;
		length -= (size_t)count;
	}
	return 0;
}

static int write_all(int fd, const void *data, size_t length, const struct timespec *deadline)
{
	const uint8_t *cursor = data;
	while (length) {
		ssize_t count = send(fd, cursor, length, MSG_NOSIGNAL);
		if (count < 0 && errno == EINTR) continue;
		if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
			if (wait_ready(fd, POLLOUT | POLLHUP | POLLERR, deadline) < 0) return -1;
			continue;
		}
		if (count <= 0) return -1;
		cursor += count;
		length -= (size_t)count;
	}
	return 0;
}

static bool valid_request_id(const char *value)
{
	size_t length = strlen(value);
	if (length < 1 || length > 128) return false;
	for (size_t i = 0; i < length; i++) {
		unsigned char c = (unsigned char)value[i];
		if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
		    (c >= '0' && c <= '9') || c == '.' || c == '_' || c == ':' || c == '-'))
			return false;
	}
	return true;
}

/* Reject repeated top-level keys before json-c can collapse them. */
static bool unique_request_keys(const char *header)
{
	const char *keys[] = { "protocol", "requestId", "timeoutMs" };
	if (strchr(header, '\\')) return false;
	for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
		char token[32];
		const char *first;
		snprintf(token, sizeof(token), "\"%s\"", keys[i]);
		first = strstr(header, token);
		if (first && strstr(first + strlen(token), token)) return false;
	}
	return true;
}

int z2m_read_request(int client, struct z2m_request *request)
{
	uint8_t prelude[PRELUDE_SIZE], extra;
	uint32_t header_length, body_length;
	char header[Z2M_REQUEST_HEADER_LIMIT + 1];
	struct json_tokener *tokener = NULL;
	struct json_object *object = NULL, *protocol, *request_id, *timeout;
	int fields = 0;
	struct timespec deadline = deadline_after(Z2M_IO_TIMEOUT_MS);
	int flags;

	memset(request, 0, sizeof(*request));
	flags = fcntl(client, F_GETFL);
	if (flags < 0 || fcntl(client, F_SETFL, flags | O_NONBLOCK) < 0) goto reject;
	if (read_all(client, prelude, sizeof(prelude), &deadline) < 0) goto reject;
	header_length = read_be32(prelude + 12);
	body_length = read_be32(prelude + 16);
	if (memcmp(prelude, magic, sizeof(magic)) || prelude[8] != 1 || prelude[9] != 0 ||
	    prelude[10] != 0 || prelude[11] != 0 || header_length > Z2M_REQUEST_HEADER_LIMIT ||
	    body_length > Z2M_REQUEST_LIMIT) goto reject;
	if (read_all(client, header, header_length, &deadline) < 0) goto reject;
	header[header_length] = '\0';
	if (!unique_request_keys(header)) goto reject;
	tokener = json_tokener_new();
	if (!tokener) goto reject;
	object = json_tokener_parse_ex(tokener, header, (int)header_length);
	if (!object || json_tokener_get_error(tokener) != json_tokener_success ||
	    json_tokener_get_parse_end(tokener) != header_length ||
	    !json_object_is_type(object, json_type_object)) goto reject;
	json_object_object_foreach(object, key, value) {
		(void)value;
		if (strcmp(key, "protocol") && strcmp(key, "requestId") && strcmp(key, "timeoutMs"))
			goto reject;
		fields++;
	}
	if (fields != 3 || !json_object_object_get_ex(object, "protocol", &protocol) ||
	    !json_object_object_get_ex(object, "requestId", &request_id) ||
	    !json_object_object_get_ex(object, "timeoutMs", &timeout) ||
	    !json_object_is_type(protocol, json_type_string) ||
	    !json_object_is_type(request_id, json_type_string) ||
	    !json_object_is_type(timeout, json_type_int) ||
	    strcmp(json_object_get_string(protocol), Z2M_PROTOCOL) ||
	    !valid_request_id(json_object_get_string(request_id)) ||
	    json_object_get_int64(timeout) < 1 || json_object_get_int64(timeout) > 30000)
		goto reject;
	strcpy(request->request_id, json_object_get_string(request_id));
	request->timeout_ms = (unsigned int)json_object_get_int(timeout);
	request->body = malloc(body_length ? body_length : 1);
	if (!request->body || read_all(client, request->body, body_length, &deadline) < 0) goto reject;
	request->body_length = body_length;
	for (;;) {
		struct pollfd peer = { .fd = client, .events = POLLIN | POLLHUP | POLLERR };
		int timeout = deadline_timeout(&deadline);
		int ready;
		if (timeout <= 0) goto reject;
		ready = poll(&peer, 1, timeout);
		if (ready < 0 && errno == EINTR) continue;
		if (ready <= 0 || recv(client, &extra, 1, 0) != 0) goto reject;
		break;
	}
	json_object_put(object);
	json_tokener_free(tokener);
	return 0;

reject:
	if (object) json_object_put(object);
	if (tokener) json_tokener_free(tokener);
	z2m_free_request(request);
	return -1;
}

int z2m_write_response(int client, const struct z2m_request *request,
	const struct z2m_result *result)
{
	uint8_t prelude[PRELUDE_SIZE] = "Z2MHTV1\n";
	char header[RESPONSE_HEADER_LIMIT + 1], metadata[256] = "";
	int length;
	unsigned int timeout_ms = request->timeout_ms < Z2M_IO_TIMEOUT_MS ?
		request->timeout_ms : Z2M_IO_TIMEOUT_MS;
	struct timespec deadline = deadline_after(timeout_ms);
	if (!strcmp(result->outcome, "child_exited")) {
		char exit_value[32], signal_value[32];
		if (result->exit_code < 0) strcpy(exit_value, "null");
		else snprintf(exit_value, sizeof(exit_value), "%d", result->exit_code);
		if (result->signal_number == 0) strcpy(signal_value, "null");
		else snprintf(signal_value, sizeof(signal_value), "%d", result->signal_number);
		snprintf(metadata, sizeof(metadata), ",\"exitCode\":%s,\"signal\":%s",
			exit_value, signal_value);
	}
	else if (!strcmp(result->outcome, "timeout"))
		snprintf(metadata, sizeof(metadata), ",\"signal\":%d", result->signal_number);
	else if (result->stage)
		snprintf(metadata, sizeof(metadata), ",\"stage\":\"%s\",\"errno\":%d",
			result->stage, result->error_number);
	else if (result->reason)
		snprintf(metadata, sizeof(metadata), ",\"reason\":\"%s\"", result->reason);
	length = snprintf(header, sizeof(header),
		"{\"protocol\":\"%s\",\"requestId\":\"%s\",\"outcome\":\"%s\","
		"\"startState\":\"%s\",\"stdoutLength\":%zu,\"stderrLength\":%zu,"
		"\"stdoutEof\":%s,\"stderrEof\":%s,\"stderrTruncated\":%s,"
		"\"stderrDrained\":%zu,\"childReaped\":%s%s}", Z2M_PROTOCOL,
		request->request_id, result->outcome, result->start_state,
		result->output_length, result->error_length, result->stdout_eof ? "true" : "false",
		result->stderr_eof ? "true" : "false",
		result->error_drained > result->error_length ? "true" : "false",
		result->error_drained, result->child_reaped ? "true" : "false", metadata);
	if (length < 0 || length > (int)RESPONSE_HEADER_LIMIT) return -1;
	prelude[8] = 2;
	write_be32(prelude + 12, (uint32_t)length);
	write_be32(prelude + 16, (uint32_t)(result->output_length + result->error_length));
	if (write_all(client, prelude, sizeof(prelude), &deadline) < 0 ||
	    write_all(client, header, (size_t)length, &deadline) < 0 ||
	    write_all(client, result->output, result->output_length, &deadline) < 0 ||
	    write_all(client, result->errors, result->error_length, &deadline) < 0) return -1;
	return 0;
}

void z2m_free_request(struct z2m_request *request)
{
	free(request->body);
	memset(request, 0, sizeof(*request));
}
