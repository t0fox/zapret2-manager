#include "helper.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef Z2M_NCAT_PATH
#define Z2M_NCAT_PATH "/usr/bin/ncat"
#endif

#define ADAPTER_DIGEST "7cd367ef2aed1be2567505bf978b2d2b73f97ff149cc48d64826ed4f2b8c885e"
#define BODY_OUTPUT_LIMIT 131072U
#define TLS_OUTPUT_LIMIT 2048U
#define STUN_OUTPUT_LIMIT 1024U
#define MAX_TIMEOUT_MS 120000U

static bool string_value(json_object *object, const char *name, const char **out)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value) || !json_object_is_type(value, json_type_string)) return false;
	*out = json_object_get_string(value);
	return strlen(*out) == (size_t)json_object_get_string_len(value);
}

static bool int_value(json_object *object, const char *name, int64_t minimum, int64_t maximum, int64_t *out)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value) || !json_object_is_type(value, json_type_int)) return false;
	*out = json_object_get_int64(value);
	return *out >= minimum && *out <= maximum;
}

static bool digest_value(const char *value)
{
	if (strlen(value) != 64) return false;
	for (size_t i = 0; i < 64; i++)
		if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
	return true;
}

static bool host_value(const char *value)
{
	if (strlen(value) < 1 || strlen(value) > 253 || strstr(value, "..") != NULL) return false;
	for (size_t i = 0; value[i]; i++)
		if (!((value[i] >= 'a' && value[i] <= 'z') || (value[i] >= '0' && value[i] <= '9') || value[i] == '.' || value[i] == '-')) return false;
	return value[0] != '-' && value[strlen(value) - 1] != '-';
}

static bool profile_digest_matches(json_object *profile, const char *expected)
{
	const char *serialized = json_object_to_json_string_ext(profile, JSON_C_TO_STRING_PLAIN | JSON_C_TO_STRING_NOSLASHESCAPE);
	char digest[65];
	return serialized != NULL && z2m_sha256_bytes_hex((const unsigned char *)serialized, strlen(serialized), digest) == 0 && !strcmp(digest, expected);
}

static bool profile_host(json_object *profile, const char *host)
{
	json_object *primary, *tests;
	if (!json_object_object_get_ex(profile, "primaryHost", &primary) || !json_object_object_get_ex(profile, "testHosts", &tests) ||
		!json_object_is_type(primary, json_type_string) || !json_object_is_type(tests, json_type_array) || !host_value(json_object_get_string(primary))) return false;
	if (!strcmp(host, json_object_get_string(primary))) return true;
	for (size_t i = 0; i < json_object_array_length(tests); i++) {
		json_object *item = json_object_array_get_idx(tests, i);
		if (!json_object_is_type(item, json_type_string) || !host_value(json_object_get_string(item))) return false;
		if (!strcmp(host, json_object_get_string(item))) return true;
	}
	return false;
}

static bool path_value(const char *url, const char *host, const char **path)
{
	const char *start;
	if (strncmp(url, "https://", 8) || strncmp(url + 8, host, strlen(host)) || url[8 + strlen(host)] != '/') return false;
	if (strchr(url, '@') || strchr(url, '#') || strchr(url, '\'' ) || strchr(url, '"') || strchr(url, ';') || strchr(url, '|') || strchr(url, '&') || strchr(url, '$') || strchr(url, '`') || strchr(url, '\n') || strchr(url, '\r')) return false;
	start = url + 8 + strlen(host);
	for (const char *cursor = start; *cursor; cursor++)
		if (!((*cursor >= 'A' && *cursor <= 'Z') || (*cursor >= 'a' && *cursor <= 'z') || (*cursor >= '0' && *cursor <= '9') || strchr("/._~?=&%+-", *cursor))) return false;
	*path = start;
	return true;
}

static int64_t now_ms(void)
{
	struct timespec now;
	if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
	return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int run_fixed(char *const argv[], const unsigned char *input, size_t input_length,
		unsigned int timeout_ms, unsigned int output_limit, unsigned char **output, size_t *output_length,
		int *exit_code, int *signal_number, bool *overflow)
{
	int in[2], out[2], status = 0; pid_t child, waited; size_t used = 0, sent = 0; unsigned char *data = NULL; bool input_closed = false, child_reaped = false;
	if (pipe(in) < 0 || pipe(out) < 0) return -1;
	child = fork();
	if (child < 0) { close(in[0]); close(in[1]); close(out[0]); close(out[1]); return -1; }
	if (child == 0) {
		int nullfd = open("/dev/null", O_WRONLY | O_CLOEXEC);
		setpgid(0, 0);
		dup2(in[0], STDIN_FILENO); dup2(out[1], STDOUT_FILENO); if (nullfd >= 0) dup2(nullfd, STDERR_FILENO);
		close(in[0]); close(in[1]); close(out[0]); close(out[1]); if (nullfd >= 0) close(nullfd);
		execve(Z2M_NCAT_PATH, argv, (char *const[]){ "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", NULL });
		_exit(127);
	}
	close(in[0]); close(out[1]);
	fcntl(in[1], F_SETFL, fcntl(in[1], F_GETFL) | O_NONBLOCK);
	fcntl(out[0], F_SETFL, fcntl(out[0], F_GETFL) | O_NONBLOCK);
	int64_t deadline = now_ms() + timeout_ms;
	for (;;) {
		struct pollfd watched[2] = { { out[0], POLLIN | POLLHUP | POLLERR, 0 }, { input_closed ? -1 : in[1], POLLOUT | POLLHUP | POLLERR, 0 } };
		int64_t remaining = deadline - now_ms();
		int wait_ms = remaining > 0 ? (remaining > 50 ? 50 : (int)remaining) : 0;
		int ready = poll(watched, 2, wait_ms);
		if (ready < 0 && errno == EINTR) continue;
		if (!input_closed && watched[1].revents) {
			ssize_t written = write(in[1], input + sent, input_length - sent);
			if (written > 0) sent += (size_t)written;
			else if (written < 0 && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) { close(in[1]); input_closed = true; }
			if (sent == input_length) { close(in[1]); input_closed = true; }
		}
		if (ready > 0 && watched[0].revents) {
			unsigned char buffer[4096]; ssize_t got;
			do got = read(out[0], buffer, sizeof(buffer)); while (got < 0 && errno == EINTR);
			if (got > 0) {
				size_t keep = (size_t)got > output_limit - (used < output_limit ? used : output_limit) ? 0 : (size_t)got;
				if (used + (size_t)got > output_limit) { keep = used < output_limit ? output_limit - used : 0; *overflow = true; }
				if (keep) { unsigned char *grown = realloc(data, used + keep); if (!grown) { kill(child, SIGKILL); close(out[0]); waitpid(child, NULL, 0); free(data); return -1; } data = grown; memcpy(data + used, buffer, keep); used += keep; }
				continue;
			}
			if (got == 0) { close(out[0]); out[0] = -1; }
		}
		waited = waitpid(child, &status, WNOHANG);
		if (waited == child) child_reaped = true;
		if (remaining <= 0 && !child_reaped) { kill(-child, SIGKILL); kill(child, SIGKILL); do waited = waitpid(child, &status, 0); while (waited < 0 && errno == EINTR); child_reaped = true; }
		if (child_reaped && (out[0] < 0 || (ready <= 0 && input_closed))) break;
	}
	if (in[1] >= 0) close(in[1]);
	if (out[0] >= 0) close(out[0]);
	if (!child_reaped) do waited = waitpid(child, &status, 0); while (waited < 0 && errno == EINTR);
	*output = data; *output_length = used; *exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1; *signal_number = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
	return 0;
}

int z2m_scanner_probe(const struct z2m_request *request)
{
	json_object *args = request->arguments, *profile, *probe, *body = NULL;
	const char *authority, *adapter_digest, *profile_digest_value, *transport, *host, *family = NULL, *url = NULL, *path = NULL;
	int64_t timeout, port = 0, configured_limit = 0; unsigned int output_limit; unsigned char *input = NULL, *output = NULL; size_t input_length = 0, output_length = 0;
	int exit_code, signal_number; bool overflow = false; char *encoded;
	if (!string_value(args, "authority", &authority) || strcmp(authority, "scanner-probe-adapter.v1") ||
		!string_value(args, "adapterDigest", &adapter_digest) || strcmp(adapter_digest, ADAPTER_DIGEST) ||
		!string_value(args, "targetProfileDigest", &profile_digest_value) || !digest_value(profile_digest_value) ||
		!json_object_object_get_ex(args, "targetProfile", &profile) || !json_object_is_type(profile, json_type_object) || !profile_digest_matches(profile, profile_digest_value) ||
		!json_object_object_get_ex(args, "request", &probe) || !json_object_is_type(probe, json_type_object) ||
		!string_value(probe, "transport", &transport) || !string_value(probe, "host", &host) || !host_value(host) || !profile_host(profile, host) ||
		!int_value(probe, "timeoutMs", 1, MAX_TIMEOUT_MS, &timeout)) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	if (!strcmp(transport, "tls") || !strcmp(transport, "tls+body")) {
		if (!string_value(probe, "addressFamily", &family) || (strcmp(family, "ipv4") && strcmp(family, "ipv6")) || !int_value(probe, "port", 1, 65535, &port) || port != 443) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
		if (!strcmp(transport, "tls+body")) {
			if (!string_value(probe, "url", &url) || !path_value(url, host, &path) || !json_object_object_get_ex(probe, "body", &body) || !json_object_is_type(body, json_type_object) ||
				!int_value(body, "readLimitBytes", 1, 69633, &configured_limit) || configured_limit != 69633) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
			const char *range; if (!string_value(body, "range", &range) || strcmp(range, "bytes=0-69632")) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
			input = (unsigned char *)malloc(strlen(path) + strlen(host) + 128); if (!input) return z2m_fail(request->request_id, "EINTERNAL", "internal");
			input_length = (size_t)snprintf((char *)input, strlen(path) + strlen(host) + 128, "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\nRange: bytes=0-69632\r\n\r\n", path, host);
			output_limit = BODY_OUTPUT_LIMIT;
		} else {
			input = (unsigned char *)malloc(strlen(host) + 96); if (!input) return z2m_fail(request->request_id, "EINTERNAL", "internal");
			input_length = (size_t)snprintf((char *)input, strlen(host) + 96, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", host);
			output_limit = TLS_OUTPUT_LIMIT;
		}
	} else if (!strcmp(transport, "stun")) {
		if (!string_value(probe, "addressFamily", &family) || strcmp(family, "ipv4") || !int_value(probe, "port", 1, 65535, &port)) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
		input = malloc(20); if (!input) return z2m_fail(request->request_id, "EINTERNAL", "internal");
		input[0]=0; input[1]=1; input[2]=0; input[3]=0; input[4]=0x21; input[5]=0x12; input[6]=0xa4; input[7]=0x42; for (size_t i=0;i<12;i++) input[8+i]=(unsigned char)(i+1); input_length=20; output_limit=STUN_OUTPUT_LIMIT;
	} else return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	char port_text[24], timeout_text[24]; snprintf(port_text,sizeof(port_text),"%lld",(long long)port); snprintf(timeout_text,sizeof(timeout_text),"%lld",(long long)((timeout+999)/1000));
	char *argv[10]; size_t argc=0; argv[argc++]=(char *)Z2M_NCAT_PATH;
	if (!strcmp(transport,"tls") || !strcmp(transport,"tls+body")) { argv[argc++]="--ssl"; argv[argc++]=(char *)(!strcmp(family,"ipv6") ? "-6" : "-4"); }
	else { argv[argc++]="-u"; argv[argc++]="-4"; }
	argv[argc++]="-w"; argv[argc++]=timeout_text; argv[argc++]=(char *)host; argv[argc++]=port_text; argv[argc]=NULL;
	int result = run_fixed(argv,input,input_length,(unsigned int)timeout,output_limit,&output,&output_length,&exit_code,&signal_number,&overflow); free(input);
	if (result < 0) return z2m_fail(request->request_id, "EINTERNAL", "internal");
	encoded=z2m_base64(output,output_length); free(output); if (!encoded) return z2m_fail(request->request_id,"EINTERNAL","response_encode");
	json_object *data=z2m_json_object(); bool ok=data && z2m_json_add(data,"content",z2m_json_string(encoded)) && z2m_json_add(data,"byteLength",z2m_json_int((int64_t)output_length)) && z2m_json_add(data,"exitCode",z2m_json_int(exit_code)) && z2m_json_add(data,"signal",z2m_json_int(signal_number)) && z2m_json_add(data,"complete",z2m_json_bool(!overflow)); free(encoded);
	if (!ok) { json_object_put(data); return z2m_fail(request->request_id,"EINTERNAL","response_encode"); }
	return z2m_success(request->request_id,data);
}
