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
#define STUN_TRANSACTION_ID "0102030405060708090a0b0c"

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

static bool path_value(const char *url, const char *host, const char **path);

static bool profile_digest_matches(json_object *profile, const char *expected)
{
	const char *serialized = json_object_to_json_string_ext(profile, JSON_C_TO_STRING_PLAIN | JSON_C_TO_STRING_NOSLASHESCAPE);
	char digest[65];
	return serialized != NULL && z2m_sha256_bytes_hex((const unsigned char *)serialized, strlen(serialized), digest) == 0 && !strcmp(digest, expected);
}

static bool allowed_keys(json_object *object, const char *const *allowed, size_t count)
{
	json_object_object_foreach(object, key, value) {
		bool found = false; (void)value;
		for (size_t i = 0; i < count; i++) if (!strcmp(key, allowed[i])) { found = true; break; }
		if (!found) return false;
	}
	return true;
}

static bool required_keys(json_object *object, const char *const *required, size_t count)
{
	json_object *value;
	for (size_t i = 0; i < count; i++) if (!json_object_object_get_ex(object, required[i], &value)) return false;
	return true;
}

static bool string_array(json_object *value)
{
	if (!json_object_is_type(value, json_type_array)) return false;
	for (size_t i = 0; i < json_object_array_length(value); i++) {
		json_object *item = json_object_array_get_idx(value, i);
		if (!json_object_is_type(item, json_type_string) || strlen(json_object_get_string(item)) != (size_t)json_object_get_string_len(item)) return false;
	}
	return true;
}

static bool host_array(json_object *value)
{
	if (!string_array(value)) return false;
	for (size_t i = 0; i < json_object_array_length(value); i++)
		if (!host_value(json_object_get_string(json_object_array_get_idx(value, i)))) return false;
	return true;
}

static bool profile_shape(json_object *profile)
{
	static const char *const profile_keys[] = {"profileKey", "primaryHost", "testHosts", "hostlistDomains", "expectedHostlists", "tcp", "udp", "probeUrl", "protocol"};
	static const char *const profile_required[] = {"profileKey", "primaryHost", "testHosts", "hostlistDomains", "expectedHostlists", "tcp", "udp", "probeUrl"};
	static const char *const transport_keys[] = {"ports", "l7", "payload"};
	json_object *value, *primary, *tests, *tcp, *udp, *ports, *l7, *payload;
	if (!allowed_keys(profile, profile_keys, sizeof(profile_keys) / sizeof(profile_keys[0])) ||
		!required_keys(profile, profile_required, sizeof(profile_required) / sizeof(profile_required[0])) ||
		!json_object_object_get_ex(profile, "primaryHost", &primary) || !json_object_is_type(primary, json_type_string) || !host_value(json_object_get_string(primary)) ||
		!json_object_object_get_ex(profile, "testHosts", &tests) || !host_array(tests) ||
		!json_object_object_get_ex(profile, "tcp", &tcp) || !json_object_is_type(tcp, json_type_object) ||
		!json_object_object_get_ex(profile, "udp", &udp) || !json_object_is_type(udp, json_type_object) ||
		!allowed_keys(tcp, transport_keys, 3) || !allowed_keys(udp, transport_keys, 3)) return false;
	for (size_t i = 0; i < 2; i++) {
		json_object *transport = i == 0 ? tcp : udp;
		if (!json_object_object_get_ex(transport, "ports", &ports) || !json_object_is_type(ports, json_type_string) ||
			!json_object_object_get_ex(transport, "l7", &l7) || !json_object_is_type(l7, json_type_string) ||
			!json_object_object_get_ex(transport, "payload", &payload) || !json_object_is_type(payload, json_type_string)) return false;
	}
	if (json_object_object_get_ex(profile, "profileKey", &value) && (!json_object_is_type(value, json_type_string) || strlen(json_object_get_string(value)) > 64)) return false;
	if (json_object_object_get_ex(profile, "probeUrl", &value) && !json_object_is_type(value, json_type_string)) return false;
	if (json_object_object_get_ex(profile, "protocol", &value) && (!json_object_is_type(value, json_type_string) || (strcmp(json_object_get_string(value), "tcp") && strcmp(json_object_get_string(value), "udp")))) return false;
	if (json_object_object_get_ex(profile, "hostlistDomains", &value) && !string_array(value)) return false;
	if (json_object_object_get_ex(profile, "expectedHostlists", &value) && !string_array(value)) return false;
	return true;
}

static bool nested_settings_shape(json_object *probe, const char *transport)
{
	json_object *value;
	static const char *const tls_keys[] = {"timeoutMs", "readLimitBytes"};
	static const char *const body_keys[] = {"timeoutMs", "minimumBytes", "readChunkBytes", "markerScanBytes", "readLimitBytes", "range", "markers"};
	static const char *const marker_keys[] = {"name", "needles"};
	if (strcmp(transport, "tls") && strcmp(transport, "tls+body")) return true;
	if (!json_object_object_get_ex(probe, "tls", &value) || !json_object_is_type(value, json_type_object) ||
		!allowed_keys(value, tls_keys, 2)) return false;
	if (!strcmp(transport, "tls")) return true;
	if (!json_object_object_get_ex(probe, "body", &value) || !json_object_is_type(value, json_type_object) ||
		!allowed_keys(value, body_keys, sizeof(body_keys) / sizeof(body_keys[0]))) return false;
	json_object *markers;
	if (!json_object_object_get_ex(value, "markers", &markers) || !json_object_is_type(markers, json_type_array) || json_object_array_length(markers) != 1) return false;
	json_object *marker = json_object_array_get_idx(markers, 0), *needles;
	return json_object_is_type(marker, json_type_object) && allowed_keys(marker, marker_keys, 2) &&
		json_object_object_get_ex(marker, "needles", &needles) && string_array(needles);
}

static bool probe_shape(json_object *probe, const char *transport)
{
	static const char *const tls[] = {"transport", "mode", "retries", "host", "addressFamily", "port", "portRange", "tls", "timeoutMs", "deadlineMs", "cancelToken"};
	static const char *const body[] = {"transport", "mode", "retries", "host", "addressFamily", "port", "portRange", "url", "tls", "body", "timeoutMs", "deadlineMs", "cancelToken"};
	static const char *const stun[] = {"transport", "mode", "retries", "host", "addressFamily", "port", "portRange", "transactionId", "receiveLimitBytes", "timeoutMs", "deadlineMs", "cancelToken"};
	const char *const *keys = !strcmp(transport, "tls") ? tls : (!strcmp(transport, "tls+body") ? body : stun);
	size_t count = !strcmp(transport, "tls") ? sizeof(tls) / sizeof(tls[0]) : (!strcmp(transport, "tls+body") ? sizeof(body) / sizeof(body[0]) : sizeof(stun) / sizeof(stun[0]));
	return allowed_keys(probe, keys, count);
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

static bool profile_string(json_object *profile, const char *name, const char *expected)
{
	json_object *value;
	return json_object_object_get_ex(profile, name, &value) && json_object_is_type(value, json_type_string) &&
		!strcmp(json_object_get_string(value), expected);
}

static bool profile_transport(json_object *profile, const char *name, const char *port_range,
	int64_t port, const char *l7, const char *payload)
{
	json_object *transport, *ports;
	return json_object_object_get_ex(profile, name, &transport) && json_object_is_type(transport, json_type_object) &&
		json_object_object_get_ex(transport, "ports", &ports) && json_object_is_type(ports, json_type_string) &&
		!strcmp(json_object_get_string(ports), port_range) && profile_string(transport, "l7", l7) &&
		profile_string(transport, "payload", payload) && port >= 1 && port <= 65535;
}

static bool candidate_shape(json_object *candidate)
{
	static const char *const keys[] = {"scannerId", "protocol", "compiledDigest", "dependencyDigest"};
	const char *scanner_id, *protocol, *compiled, *dependency;
	return json_object_is_type(candidate, json_type_object) &&
		allowed_keys(candidate, keys, sizeof(keys) / sizeof(keys[0])) &&
		required_keys(candidate, keys, sizeof(keys) / sizeof(keys[0])) &&
		string_value(candidate, "scannerId", &scanner_id) && strlen(scanner_id) <= 160 &&
		string_value(candidate, "protocol", &protocol) && (!strcmp(protocol, "tcp") || !strcmp(protocol, "udp")) &&
		string_value(candidate, "compiledDigest", &compiled) && digest_value(compiled) &&
		string_value(candidate, "dependencyDigest", &dependency) && digest_value(dependency);
}

static bool profile_url_matches(json_object *profile, const char *host, const char *url)
{
	json_object *primary, *probe;
	const char *primary_host, *probe_url, *path;
	if (!json_object_object_get_ex(profile, "primaryHost", &primary) || !json_object_object_get_ex(profile, "probeUrl", &probe) ||
		!json_object_is_type(primary, json_type_string) || !json_object_is_type(probe, json_type_string)) return false;
	primary_host = json_object_get_string(primary); probe_url = json_object_get_string(probe);
	if (!strcmp(host, primary_host)) return !strcmp(url, probe_url);
	return path_value(url, host, &path) && !strcmp(path, "/");
}

static bool port_range_value(const char *value, int64_t port)
{
	char *end;
	long first, last;
	if (!value || !*value) return false;
	errno = 0; first = strtol(value, &end, 10);
	if (errno || end == value || first < 1 || first > 65535) return false;
	if (*end == '\0') return port == first;
	if (*end != '-') return false;
	errno = 0; last = strtol(end + 1, &end, 10);
	return !errno && *end == '\0' && last >= first && last <= 65535 && port >= first && port <= last;
}

static bool exact_transaction_id(json_object *probe)
{
	const char *value;
	return string_value(probe, "transactionId", &value) && !strcmp(value, STUN_TRANSACTION_ID);
}

static bool exact_string(json_object *object, const char *name, const char *expected)
{
	const char *value;
	return string_value(object, name, &value) && !strcmp(value, expected);
}

static bool exact_mode(json_object *probe)
{
	const char *mode;
	return string_value(probe, "mode", &mode) && (!strcmp(mode, "quick") || !strcmp(mode, "standard") || !strcmp(mode, "full"));
}

static bool cancel_token_value(const char *value)
{
	if (!value || strlen(value) < 1 || strlen(value) > 128) return false;
	for (size_t i = 0; value[i]; i++)
		if (!((value[i] >= 'A' && value[i] <= 'Z') || (value[i] >= 'a' && value[i] <= 'z') ||
			(value[i] >= '0' && value[i] <= '9') || strchr("._:-", value[i]))) return false;
	return true;
}

static bool cancel_requested(const char *token)
{
	if (!token) return false;
	char path[256]; int written = snprintf(path, sizeof(path), "/tmp/zapret2-manager/runtime/scanner/%s.cancel", token);
	if (written < 0 || (size_t)written >= sizeof(path)) return false;
	int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
	if (fd < 0) return false;
	close(fd);
	return true;
}

static bool exact_tls_settings(json_object *probe)
{
	json_object *tls;
	int64_t timeout, limit;
	return json_object_object_get_ex(probe, "tls", &tls) && json_object_is_type(tls, json_type_object) &&
		int_value(tls, "timeoutMs", 1, MAX_TIMEOUT_MS, &timeout) && timeout == 6000 &&
		int_value(tls, "readLimitBytes", 1, TLS_OUTPUT_LIMIT, &limit) && limit == 2048;
}

static bool exact_body_settings(json_object *probe)
{
	json_object *body, *markers, *marker, *needles;
	int64_t timeout, minimum, chunk, scan, limit;
	const char *needle;
	if (!json_object_object_get_ex(probe, "body", &body) || !json_object_is_type(body, json_type_object) ||
		!int_value(body, "timeoutMs", 1, MAX_TIMEOUT_MS, &timeout) || timeout != 8000 ||
		!int_value(body, "minimumBytes", 1, BODY_OUTPUT_LIMIT, &minimum) || minimum != 65536 ||
		!int_value(body, "readChunkBytes", 1, BODY_OUTPUT_LIMIT, &chunk) || chunk != 4096 ||
		!int_value(body, "markerScanBytes", 1, BODY_OUTPUT_LIMIT, &scan) || scan != 8192 ||
		!int_value(body, "readLimitBytes", 1, BODY_OUTPUT_LIMIT, &limit) || limit != 69633 ||
		!exact_string(body, "range", "bytes=0-69632") || !json_object_object_get_ex(body, "markers", &markers) ||
		!json_object_is_type(markers, json_type_array) || json_object_array_length(markers) != 1) return false;
	marker = json_object_array_get_idx(markers, 0);
	if (!json_object_is_type(marker, json_type_object) || !exact_string(marker, "name", "isp_page") ||
		!json_object_object_get_ex(marker, "needles", &needles) || !json_object_is_type(needles, json_type_array) ||
		json_object_array_length(needles) != 3) return false;
	for (size_t i = 0; i < 3; i++) {
		json_object *value = json_object_array_get_idx(needles, i);
		if (!json_object_is_type(value, json_type_string)) return false;
		needle = json_object_get_string(value);
		if (strcmp(needle, i == 0 ? "blocked" : (i == 1 ? "access denied" : "captcha"))) return false;
	}
	return true;
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

static int64_t wall_ms(void)
{
	struct timespec now;
	if (clock_gettime(CLOCK_REALTIME, &now) < 0) return -1;
	return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int run_fixed(char *const argv[], const unsigned char *input, size_t input_length,
		unsigned int timeout_ms, int64_t absolute_deadline_ms, unsigned int output_limit, unsigned char **output, size_t *output_length,
		int *exit_code, int *signal_number, bool *overflow, int64_t *started_at, int64_t *finished_at,
		const char *cancel_token, bool *cancelled)
{
	int in[2] = {-1, -1}, out[2] = {-1, -1}, status = 0; pid_t child, waited; size_t used = 0, sent = 0; unsigned char *data = NULL; bool input_closed = false, child_reaped = false, failed = false;
	int flags; struct sigaction old_pipe, ignore_pipe = { .sa_handler = SIG_IGN };
	sigemptyset(&ignore_pipe.sa_mask);
	if (sigaction(SIGPIPE, &ignore_pipe, &old_pipe) < 0) return -1;
	if (pipe(in) < 0) { if (sigaction(SIGPIPE, &old_pipe, NULL) < 0) return -1; return -1; }
	if (pipe(out) < 0) { close(in[0]); close(in[1]); if (sigaction(SIGPIPE, &old_pipe, NULL) < 0) return -1; return -1; }
	child = fork();
	if (child < 0) { close(in[0]); close(in[1]); close(out[0]); close(out[1]); if (sigaction(SIGPIPE, &old_pipe, NULL) < 0) return -1; return -1; }
	if (child == 0) {
		int nullfd = open("/dev/null", O_WRONLY | O_CLOEXEC);
		if (sigaction(SIGPIPE, &old_pipe, NULL) < 0) _exit(126);
		if (setpgid(0, 0) < 0) _exit(126);
		dup2(in[0], STDIN_FILENO); dup2(out[1], STDOUT_FILENO); if (nullfd >= 0) dup2(nullfd, STDERR_FILENO);
		close(in[0]); close(in[1]); close(out[0]); close(out[1]); if (nullfd >= 0) close(nullfd);
		execve(Z2M_NCAT_PATH, argv, (char *const[]){ "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", NULL });
		_exit(127);
	}
	close(in[0]); close(out[1]);
	if (setpgid(child, child) < 0 && errno != EACCES && errno != ESRCH) { failed = true; goto cleanup; }
	flags = fcntl(in[1], F_GETFL); if (flags < 0 || fcntl(in[1], F_SETFL, flags | O_NONBLOCK) < 0) { failed = true; goto cleanup; }
	flags = fcntl(out[0], F_GETFL); if (flags < 0 || fcntl(out[0], F_SETFL, flags | O_NONBLOCK) < 0) { failed = true; goto cleanup; }
	*started_at = now_ms(); if (*started_at < 0) { failed = true; goto cleanup; }
	int64_t wall_start = wall_ms(), wall_remaining = wall_start < 0 ? 0 : timeout_ms;
	if (wall_start >= 0 && absolute_deadline_ms > wall_start && absolute_deadline_ms - wall_start < wall_remaining) wall_remaining = absolute_deadline_ms - wall_start;
	int64_t deadline = *started_at + wall_remaining;
	for (;;) {
		struct pollfd watched[2] = { { out[0], POLLIN | POLLHUP | POLLERR, 0 }, { input_closed ? -1 : in[1], POLLOUT | POLLHUP | POLLERR, 0 } };
		if (cancel_requested(cancel_token)) { *cancelled = true; if (kill(-child, SIGTERM) < 0 && errno != ESRCH) failed = true; if (kill(child, SIGTERM) < 0 && errno != ESRCH) failed = true; }
		int64_t remaining = deadline - now_ms();
		int wait_ms = remaining > 0 ? (remaining > 50 ? 50 : (int)remaining) : 0;
		int ready = poll(watched, 2, wait_ms);
		if (ready < 0 && errno == EINTR) continue;
		if (ready < 0) { failed = true; break; }
		if (!input_closed && watched[1].revents) {
			ssize_t written = write(in[1], input + sent, input_length - sent);
			if (written > 0) sent += (size_t)written;
			else if (written < 0 && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) { close(in[1]); in[1] = -1; input_closed = true; if (errno != EPIPE) failed = true; }
			if (sent == input_length) { close(in[1]); input_closed = true; }
		}
		if (ready > 0 && watched[0].revents) {
			unsigned char buffer[4096]; ssize_t got;
			do got = read(out[0], buffer, sizeof(buffer)); while (got < 0 && errno == EINTR);
			if (got > 0) {
				size_t keep = (size_t)got > output_limit - (used < output_limit ? used : output_limit) ? 0 : (size_t)got;
				if (used + (size_t)got > output_limit) { keep = used < output_limit ? output_limit - used : 0; *overflow = true; }
				if (keep) { unsigned char *grown = realloc(data, used + keep); if (!grown) { failed = true; break; } data = grown; memcpy(data + used, buffer, keep); used += keep; }
				continue;
			}
			if (got == 0) { close(out[0]); out[0] = -1; }
		}
		waited = waitpid(child, &status, WNOHANG);
		if (waited == child) child_reaped = true;
		if (remaining <= 0 && !child_reaped) { if (kill(-child, SIGKILL) < 0 && errno != ESRCH) failed = true; if (kill(child, SIGKILL) < 0 && errno != ESRCH) failed = true; do waited = waitpid(child, &status, 0); while (waited < 0 && errno == EINTR); if (waited != child) failed = true; child_reaped = true; }
		if (failed) break;
		if (child_reaped && (out[0] < 0 || (ready <= 0 && input_closed))) break;
	}

cleanup:
	if (!child_reaped) {
		if (kill(-child, SIGKILL) < 0 && errno != ESRCH) failed = true;
		if (kill(child, SIGKILL) < 0 && errno != ESRCH) failed = true;
		do waited = waitpid(child, &status, 0); while (waited < 0 && errno == EINTR);
		if (waited != child) failed = true; else child_reaped = true;
	}
	if (in[1] >= 0) close(in[1]);
	if (out[0] >= 0) close(out[0]);
	if (!child_reaped) do waited = waitpid(child, &status, 0); while (waited < 0 && errno == EINTR);
	*finished_at = now_ms();
	if (sigaction(SIGPIPE, &old_pipe, NULL) < 0) failed = true;
	if (*finished_at < 0 || failed) { free(data); return -1; }
	*output = data; *output_length = used; *exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1; *signal_number = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
	return 0;
}

int z2m_scanner_probe(const struct z2m_request *request)
{
	json_object *args = request->arguments, *profile, *probe, *body = NULL, *value = NULL;
	const char *authority, *adapter_digest, *profile_digest_value, *transport, *host, *family = NULL, *url = NULL, *path = NULL;
	int64_t timeout, deadline_ms, port = 0, configured_limit = 0; unsigned int output_limit; unsigned char *input = NULL, *output = NULL; size_t input_length = 0, output_length = 0;
	int exit_code, signal_number; bool overflow = false; char *encoded; int64_t started_at, finished_at;
	if (!string_value(args, "authority", &authority) || strcmp(authority, "scanner-probe-adapter.v1") ||
		!string_value(args, "adapterDigest", &adapter_digest) || strcmp(adapter_digest, ADAPTER_DIGEST) ||
		!string_value(args, "targetProfileDigest", &profile_digest_value) || !digest_value(profile_digest_value) ||
		!json_object_object_get_ex(args, "targetProfile", &profile) || !json_object_is_type(profile, json_type_object) || !profile_digest_matches(profile, profile_digest_value) ||
		!json_object_object_get_ex(args, "request", &probe) || !json_object_is_type(probe, json_type_object) ||
		!profile_shape(profile) ||
		(json_object_object_get_ex(args, "candidate", &value) && !candidate_shape(value)) ||
		!string_value(probe, "transport", &transport) || !string_value(probe, "host", &host) || !host_value(host) || !profile_host(profile, host) ||
		!int_value(probe, "timeoutMs", 1, MAX_TIMEOUT_MS, &timeout) || !int_value(probe, "deadlineMs", 1, INT64_MAX, &deadline_ms)) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	if (!probe_shape(probe, transport) || !nested_settings_shape(probe, transport) ||
		strlen(json_object_to_json_string_ext(args, JSON_C_TO_STRING_PLAIN)) > 4096) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	int64_t wall = wall_ms(), remaining = wall < 0 ? 0 : deadline_ms - wall;
	if (remaining <= 0) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	if (remaining < timeout) timeout = remaining;
	if (!strcmp(transport, "tls") || !strcmp(transport, "tls+body")) {
		json_object *tcp, *tcp_ports;
		const char *probe_range;
		if (!exact_mode(probe) || !string_value(probe, "portRange", &probe_range) || strlen(probe_range) > 64 || !int_value(probe, "retries", 1, 2, &configured_limit) || configured_limit != 1 ||
			!string_value(probe, "addressFamily", &family) || (strcmp(family, "ipv4") && strcmp(family, "ipv6")) || !int_value(probe, "port", 1, 65535, &port) ||
			!exact_tls_settings(probe) ||
			!json_object_object_get_ex(profile, "tcp", &tcp) || !json_object_object_get_ex(tcp, "ports", &tcp_ports) || !json_object_is_type(tcp_ports, json_type_string) ||
			strcmp(probe_range, json_object_get_string(tcp_ports)) || !port_range_value(json_object_get_string(tcp_ports), port) || !profile_transport(profile, "tcp", json_object_get_string(tcp_ports), port, "tls", "tls_client_hello")) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
		if (!strcmp(transport, "tls+body")) {
			if (!string_value(probe, "url", &url) || !path_value(url, host, &path) || !json_object_object_get_ex(probe, "body", &body) || !json_object_is_type(body, json_type_object) ||
				!int_value(body, "readLimitBytes", 1, 69633, &configured_limit) || configured_limit != 69633) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
			const char *range; json_object *tcp, *tcp_ports;
			if (!exact_body_settings(probe) || !string_value(body, "range", &range) || strcmp(range, "bytes=0-69632") || !json_object_object_get_ex(profile, "tcp", &tcp) ||
				!json_object_object_get_ex(tcp, "ports", &tcp_ports) || !json_object_is_type(tcp_ports, json_type_string) ||
				!profile_transport(profile, "tcp", json_object_get_string(tcp_ports), port, "tls", "tls_client_hello") ||
				!profile_url_matches(profile, host, url)) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
			input = (unsigned char *)malloc(strlen(path) + strlen(host) + 128); if (!input) return z2m_fail(request->request_id, "EINTERNAL", "internal");
			input_length = (size_t)snprintf((char *)input, strlen(path) + strlen(host) + 128, "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\nRange: bytes=0-69632\r\n\r\n", path, host);
			output_limit = BODY_OUTPUT_LIMIT;
		} else {
			input = (unsigned char *)malloc(strlen(host) + 96); if (!input) return z2m_fail(request->request_id, "EINTERNAL", "internal");
			input_length = (size_t)snprintf((char *)input, strlen(host) + 96, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", host);
			output_limit = TLS_OUTPUT_LIMIT;
		}
	} else if (!strcmp(transport, "stun")) {
		json_object *udp, *ports;
		const char *probe_range;
		if (!exact_mode(probe) || !string_value(probe, "portRange", &probe_range) || strlen(probe_range) > 64 || !int_value(probe, "retries", 1, 2, &configured_limit) || configured_limit != 2 || !int_value(probe, "receiveLimitBytes", 1, STUN_OUTPUT_LIMIT, &configured_limit) || configured_limit != 1024 ||
			!string_value(probe, "addressFamily", &family) || strcmp(family, "ipv4") || !int_value(probe, "port", 1, 65535, &port) || !exact_transaction_id(probe) ||
			!json_object_object_get_ex(profile, "udp", &udp) || !json_object_object_get_ex(udp, "ports", &ports) || !json_object_is_type(ports, json_type_string) ||
			strcmp(probe_range, json_object_get_string(ports)) || !port_range_value(json_object_get_string(ports), port) || !profile_transport(profile, "udp", json_object_get_string(ports), port, "stun", "binding")) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
		input = malloc(20); if (!input) return z2m_fail(request->request_id, "EINTERNAL", "internal");
		input[0]=0; input[1]=1; input[2]=0; input[3]=0; input[4]=0x21; input[5]=0x12; input[6]=0xa4; input[7]=0x42; for (size_t i=0;i<12;i++) input[8+i]=(unsigned char)(i+1); input_length=20; output_limit=STUN_OUTPUT_LIMIT;
	} else return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	char port_text[24], timeout_text[24]; snprintf(port_text,sizeof(port_text),"%lld",(long long)port); snprintf(timeout_text,sizeof(timeout_text),"%lld",(long long)((timeout+999)/1000));
	char *argv[10]; size_t argc=0; argv[argc++]=(char *)Z2M_NCAT_PATH;
	if (!strcmp(transport,"tls") || !strcmp(transport,"tls+body")) { argv[argc++]="--ssl"; argv[argc++]=(char *)(!strcmp(family,"ipv6") ? "-6" : "-4"); }
	else { argv[argc++]="-u"; argv[argc++]="-4"; }
	argv[argc++]="-w"; argv[argc++]=timeout_text; argv[argc++]=(char *)host; argv[argc++]=port_text; argv[argc]=NULL;
	const char *cancel_token = NULL; json_object *cancel_value = NULL;
	if (json_object_object_get_ex(probe, "cancelToken", &cancel_value)) {
		if (!json_object_is_type(cancel_value, json_type_string) || !cancel_token_value(json_object_get_string(cancel_value))) return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
		cancel_token = json_object_get_string(cancel_value);
	}
	bool cancelled = false;
	int result = run_fixed(argv,input,input_length,(unsigned int)timeout,deadline_ms,output_limit,&output,&output_length,&exit_code,&signal_number,&overflow,&started_at,&finished_at,cancel_token,&cancelled); free(input);
	if (result < 0) return z2m_fail(request->request_id, "EINTERNAL", "internal");
	encoded=z2m_base64(output,output_length); free(output); if (!encoded) return z2m_fail(request->request_id,"EINTERNAL","response_encode");
	json_object *data=z2m_json_object(); bool ok=data && z2m_json_add(data,"content",z2m_json_string(encoded)) && z2m_json_add(data,"byteLength",z2m_json_int((int64_t)output_length)) && z2m_json_add(data,"exitCode",z2m_json_int(exit_code)) && z2m_json_add(data,"signal",z2m_json_int(signal_number)) && z2m_json_add(data,"startedAt",z2m_json_int(started_at)) && z2m_json_add(data,"finishedAt",z2m_json_int(finished_at)) && z2m_json_add(data,"complete",z2m_json_bool(!overflow)) && z2m_json_add(data,"cancelled",z2m_json_bool(cancelled)); free(encoded);
	if (!ok) { json_object_put(data); return z2m_fail(request->request_id,"EINTERNAL","response_encode"); }
	return z2m_success(request->request_id,data);
}
