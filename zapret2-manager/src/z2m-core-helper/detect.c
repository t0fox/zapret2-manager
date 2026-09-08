#include "helper.h"

#include <json-c/json_tokener.h>
#include <errno.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAX_TIMEOUT_MS 120000U

static bool int_value(json_object *object, const char *name, int64_t minimum, int64_t maximum, int64_t *out)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value) || !json_object_is_type(value, json_type_int)) return false;
	*out = json_object_get_int64(value);
	return *out >= minimum && *out <= maximum;
}

#ifndef Z2K_DETECT_PATH
#define Z2K_DETECT_PATH "/usr/libexec/zapret2-manager/z2k-detect"
#endif
#define Z2K_DETECT_EXEC_PATH "/usr/libexec/zapret2-manager/z2k-detect"

#define Z2K_DETECT_OUTPUT_LIMIT 65536U
#define Z2K_DETECT_MAX_REPEATS 32

static bool detect_dns_value(const char *value)
{
	size_t length = strlen(value), start = 0;
	bool dotted_numeric = false, has_dot = false;
	if (length < 1 || length > 253) return false;
	for (size_t i = 0; i <= length; i++) {
		unsigned char c = (unsigned char)value[i];
		if (i == length || c == '.') {
			size_t label_length = i - start;
			if (label_length < 1 || label_length > 63 || value[start] == '-' || value[i - 1] == '-') return false;
			if (i < length) has_dot = true;
			start = i + 1;
			continue;
		}
		if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '-')) return false;
	}
	if (has_dot) {
		dotted_numeric = true;
		for (size_t i = 0; i < length; i++)
			if (value[i] != '.' && (value[i] < '0' || value[i] > '9')) { dotted_numeric = false; break; }
	}
	return !dotted_numeric;
}

static bool detect_host_value(const char *value)
{
	struct in_addr ipv4;
	struct in6_addr ipv6;
	if (value == NULL) return false;
	if (inet_pton(AF_INET, value, &ipv4) == 1) return true;
	if (strchr(value, ':') != NULL) return inet_pton(AF_INET6, value, &ipv6) == 1;
	return detect_dns_value(value);
}

static int64_t now_ms(void)
{
	struct timespec now;
	if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) return -1;
	return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static bool detect_string(json_object *args, const char *name, const char **out, size_t max)
{
	json_object *value;
	if (!json_object_object_get_ex(args, name, &value) || !json_object_is_type(value, json_type_string)) return false;
	*out = json_object_get_string(value);
	if (strlen(*out) != (size_t)json_object_get_string_len(value) || strlen(*out) < 1 || strlen(*out) > max) return false;
	return true;
}

static bool detect_int(json_object *args, const char *name, int64_t minimum, int64_t maximum, int64_t *out)
{
	return int_value(args, name, minimum, maximum, out);
}

static int detect_run(char *const argv[], unsigned int timeout_ms, unsigned char **stdout_data, size_t *stdout_length,
	unsigned char **stderr_data, size_t *stderr_length, int *exit_code, bool *timed_out, bool *output_truncated)
{
	int out[2] = {-1, -1}, err[2] = {-1, -1}; pid_t child; int status = 0; bool reaped = false;
	*stdout_data = NULL; *stderr_data = NULL; *stdout_length = 0; *stderr_length = 0; *exit_code = -1; *timed_out = false; *output_truncated = false;
	if (pipe(out) < 0 || pipe(err) < 0) { if (out[0] >= 0) { close(out[0]); close(out[1]); } return -1; }
	child = fork();
	if (child < 0) { close(out[0]); close(out[1]); close(err[0]); close(err[1]); return -1; }
	if (child == 0) {
		if (setpgid(0, 0) < 0) _exit(126);
		dup2(out[1], STDOUT_FILENO); dup2(err[1], STDERR_FILENO);
		close(out[0]); close(out[1]); close(err[0]); close(err[1]);
		execve(Z2K_DETECT_PATH, argv, (char *const[]){"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", NULL}); _exit(127);
	}
	if (setpgid(child, child) < 0 && errno != EACCES && errno != ESRCH) { kill(child, SIGKILL); waitpid(child, NULL, 0); close(out[0]); close(out[1]); close(err[0]); close(err[1]); return -1; }
	close(out[1]); close(err[1]);
	int out_flags = fcntl(out[0], F_GETFL), err_flags = fcntl(err[0], F_GETFL);
	if (out_flags < 0 || err_flags < 0 || fcntl(out[0], F_SETFL, out_flags | O_NONBLOCK) < 0 || fcntl(err[0], F_SETFL, err_flags | O_NONBLOCK) < 0) {
		kill(-child, SIGKILL); kill(child, SIGKILL); waitpid(child, NULL, 0); close(out[0]); close(err[0]); return -1;
	}
	int64_t started = now_ms();
	if (started < 0) { kill(-child, SIGKILL); kill(child, SIGKILL); waitpid(child, NULL, 0); close(out[0]); close(err[0]); return -1; }
	int64_t deadline = started + timeout_ms; unsigned char *outbuf = malloc(Z2K_DETECT_OUTPUT_LIMIT + 1), *errbuf = malloc(Z2K_DETECT_OUTPUT_LIMIT + 1);
	if (!outbuf || !errbuf) { free(outbuf); free(errbuf); kill(-child, SIGKILL); waitpid(child, NULL, 0); close(out[0]); close(err[0]); return -1; }
	bool out_open = true, err_open = true, stopping = false;
	while (out_open || err_open || !reaped) {
		struct pollfd fds[2]; nfds_t count = 0;
		if (out_open) fds[count++] = (struct pollfd){out[0], POLLIN | POLLHUP | POLLERR, 0};
		if (err_open) fds[count++] = (struct pollfd){err[0], POLLIN | POLLHUP | POLLERR, 0};
		int64_t remaining = deadline - now_ms();
		if (remaining <= 0 && !reaped && !stopping) { *timed_out = true; stopping = true; kill(-child, SIGKILL); kill(child, SIGKILL); }
		if (count) poll(fds, count, remaining > 20 ? 20 : remaining > 0 ? (int)remaining : 0);
		unsigned char buffer[4096]; ssize_t got;
		if (out_open) { while ((got = read(out[0], buffer, sizeof(buffer))) > 0) { size_t keep = (size_t)got > Z2K_DETECT_OUTPUT_LIMIT - *stdout_length ? Z2K_DETECT_OUTPUT_LIMIT - *stdout_length : (size_t)got; memcpy(outbuf + *stdout_length, buffer, keep); *stdout_length += keep; if ((size_t)got > keep) { *output_truncated = true; stopping = true; kill(-child, SIGKILL); kill(child, SIGKILL); } } if (got == 0) { out_open = false; close(out[0]); } }
		if (err_open) { while ((got = read(err[0], buffer, sizeof(buffer))) > 0) { size_t keep = (size_t)got > Z2K_DETECT_OUTPUT_LIMIT - *stderr_length ? Z2K_DETECT_OUTPUT_LIMIT - *stderr_length : (size_t)got; memcpy(errbuf + *stderr_length, buffer, keep); *stderr_length += keep; if ((size_t)got > keep) { *output_truncated = true; stopping = true; kill(-child, SIGKILL); kill(child, SIGKILL); } } if (got == 0) { err_open = false; close(err[0]); } }
		if (!reaped && waitpid(child, &status, WNOHANG) == child) reaped = true;
		if (stopping && !reaped) { kill(-child, SIGKILL); if (waitpid(child, &status, 0) == child) reaped = true; }
	}
	if (reaped && WIFEXITED(status)) *exit_code = WEXITSTATUS(status); else if (reaped && WIFSIGNALED(status)) *exit_code = 128 + WTERMSIG(status);
	outbuf[*stdout_length] = 0; errbuf[*stderr_length] = 0; *stdout_data = outbuf; *stderr_data = errbuf; return 0;
}

static bool detect_result_has(json_object *object, const char *const names[], size_t count)
{
	if (object == NULL || !json_object_is_type(object, json_type_object)) return false;
	for (size_t i = 0; i < count; i++) {
		json_object *value;
		if (!json_object_object_get_ex(object, names[i], &value)) return false;
	}
	return true;
}

static bool detect_result_type(json_object *object, const char *name, enum json_type type)
{
	json_object *value;
	return json_object_object_get_ex(object, name, &value) && json_object_is_type(value, type);
}

static bool detect_result_string(json_object *object, const char *name)
{
	return detect_result_type(object, name, json_type_string);
}

static bool detect_result_bool(json_object *object, const char *name)
{
	return detect_result_type(object, name, json_type_boolean);
}

static bool detect_result_nullable_bool(json_object *object, const char *name)
{
	json_object *value;
	return json_object_object_get_ex(object, name, &value) &&
		(json_object_is_type(value, json_type_null) || json_object_is_type(value, json_type_boolean));
}

static bool detect_result_int(json_object *object, const char *name, int64_t minimum)
{
	json_object *value;
	return json_object_object_get_ex(object, name, &value) && json_object_is_type(value, json_type_int) &&
		json_object_get_int64(value) >= minimum;
}

static bool detect_result_number(json_object *object, const char *name, double minimum)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value) ||
		(!json_object_is_type(value, json_type_int) && !json_object_is_type(value, json_type_double))) return false;
	double number = json_object_get_double(value);
	return isfinite(number) && number >= minimum;
}

static bool detect_result_object_field(json_object *object, const char *name)
{
	return detect_result_type(object, name, json_type_object);
}

static bool detect_result_string_array(json_object *object, const char *name)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value) || !json_object_is_type(value, json_type_array)) return false;
	for (size_t i = 0; i < json_object_array_length(value); i++)
		if (!json_object_is_type(json_object_array_get_idx(value, i), json_type_string)) return false;
	return true;
}

static bool detect_result_object_array(json_object *object, const char *name, bool required)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value)) return !required;
	if (!json_object_is_type(value, json_type_array)) return false;
	for (size_t i = 0; i < json_object_array_length(value); i++)
		if (!json_object_is_type(json_object_array_get_idx(value, i), json_type_object)) return false;
	return true;
}

static bool detect_probe_result_valid(json_object *value)
{
	static const char *const required[] = {
		"Domain", "DNSOK", "TCPOK", "TLSOK", "TLS12OK", "TLS13OK", "HTTPOK",
		"ResolvedIPs", "FailureCode", "FailureReason", "LatencyMS", "PathVerdict", "PathReason"
	};
	return detect_result_has(value, required, sizeof(required) / sizeof(required[0])) &&
		detect_result_string(value, "Domain") && detect_result_bool(value, "DNSOK") &&
		detect_result_bool(value, "TCPOK") && detect_result_bool(value, "TLSOK") &&
		detect_result_nullable_bool(value, "TLS12OK") && detect_result_nullable_bool(value, "TLS13OK") &&
		detect_result_nullable_bool(value, "HTTPOK") && detect_result_string_array(value, "ResolvedIPs") &&
		detect_result_string(value, "FailureCode") && detect_result_string(value, "FailureReason") &&
		detect_result_int(value, "LatencyMS", 0) && detect_result_string(value, "PathVerdict") &&
		detect_result_string(value, "PathReason");
}

static bool detect_classify_result_valid(json_object *value)
{
	static const char *const required[] = {
		"target", "verdict", "reason", "repeats", "probes", "duration", "trigger_len",
		"props", "composed", "raw_usable", "trace"
	};
	return detect_result_has(value, required, sizeof(required) / sizeof(required[0])) &&
		detect_result_string(value, "target") && detect_result_string(value, "verdict") &&
		detect_result_string(value, "reason") && detect_result_int(value, "repeats", 1) &&
		detect_result_int(value, "probes", 0) && detect_result_string(value, "duration") &&
		detect_result_int(value, "trigger_len", 0) && detect_result_object_field(value, "props") &&
		detect_result_bool(value, "composed") && detect_result_bool(value, "raw_usable") &&
		detect_result_object_array(value, "trace", true);
}

static bool detect_quic_result_valid(json_object *value)
{
	static const char *const required[] = { "target", "addr", "verdict", "reason", "repeats", "probes", "duration", "props" };
	return detect_result_has(value, required, sizeof(required) / sizeof(required[0])) &&
		detect_result_string(value, "target") && detect_result_string(value, "addr") &&
		detect_result_string(value, "verdict") && detect_result_string(value, "reason") &&
		detect_result_int(value, "repeats", 1) && detect_result_int(value, "probes", 0) &&
		detect_result_string(value, "duration") && detect_result_object_field(value, "props") &&
		detect_result_object_array(value, "trace", false);
}

static bool detect_voice_result_valid(json_object *value)
{
	static const char *const required[] = { "target", "verdict", "reason", "repeats", "probes", "duration", "marked" };
	return detect_result_has(value, required, sizeof(required) / sizeof(required[0])) &&
		detect_result_string(value, "target") && detect_result_string(value, "verdict") &&
		detect_result_string(value, "reason") && detect_result_int(value, "repeats", 1) &&
		detect_result_int(value, "probes", 0) && detect_result_string(value, "duration") &&
		detect_result_bool(value, "marked") && detect_result_object_array(value, "trace", false);
}

static bool detect_tcp16_result_valid(json_object *value)
{
	static const char *const required[] = { "Target", "SNI", "Alive", "Detected", "DiedAtKB", "Err", "RTT" };
	return detect_result_has(value, required, sizeof(required) / sizeof(required[0])) &&
		detect_result_object_field(value, "Target") && detect_result_string(value, "SNI") &&
		detect_result_bool(value, "Alive") && detect_result_bool(value, "Detected") &&
		detect_result_int(value, "DiedAtKB", 0) && detect_result_string(value, "Err") &&
		detect_result_number(value, "RTT", 0);
}

static bool detect_json_result_valid(const char *kind, const unsigned char *data, size_t length)
{
	struct json_tokener *tokener = json_tokener_new();
	if (tokener == NULL || data == NULL || length == 0 || length > Z2K_DETECT_OUTPUT_LIMIT) {
		json_tokener_free(tokener);
		return false;
	}
	for (size_t i = 0; i < length; i++)
		if (data[i] == 0) { json_tokener_free(tokener); return false; }
	json_object *value = json_tokener_parse_ex(tokener, (const char *)data, (int)length);
	size_t parsed = json_tokener_get_parse_end(tokener);
	bool valid = value != NULL && json_tokener_get_error(tokener) == json_tokener_success &&
		json_object_is_type(value, json_type_object);
	while (valid && parsed < length) {
		unsigned char c = data[parsed++];
		if (c != ' ' && c != '\t' && c != '\n' && c != '\r') valid = false;
	}
	if (valid && !strcmp(kind, "probe")) valid = detect_probe_result_valid(value);
	else if (valid && !strcmp(kind, "classify")) valid = detect_classify_result_valid(value);
	else if (valid && !strcmp(kind, "quic")) valid = detect_quic_result_valid(value);
	else if (valid && !strcmp(kind, "voice")) valid = detect_voice_result_valid(value);
	else if (valid && !strcmp(kind, "tcp16")) valid = detect_tcp16_result_valid(value);
	else valid = false;
	if (value != NULL) json_object_put(value);
	json_tokener_free(tokener);
	return valid;
}

static bool detect_upstream_result_valid(const char *kind, const unsigned char *data, size_t length)
{
	if (!strcmp(kind, "tcp16")) {
		if (data == NULL || length == 0 || length > Z2K_DETECT_OUTPUT_LIMIT) return false;
		for (size_t i = 0; i < length; i++) if (data[i] == 0) return false;
		return true;
	}
	return detect_json_result_valid(kind, data, length);
}

int z2m_detect_operation(const struct z2m_request *request)
{
	const char *host = NULL, *domain = NULL, *hello = NULL; int64_t port = 0, repeats = 0, timeout;
	char endpoint[320], port_text[24], repeats_text[24], timeout_text[24];
	char *argv[16]; size_t argc = 0; const char *kind;
	if (!z2m_reserved_schema_valid(request) || !detect_int(request->arguments, "timeoutMs", 1, MAX_TIMEOUT_MS, &timeout)) return z2m_fail(request->request_id, "ESCHEMA", "schema");
	if (!strcmp(request->operation, "z2k_detect_probe")) {
		if (!detect_string(request->arguments, "domain", &domain, 253) || !detect_host_value(domain)) return z2m_fail(request->request_id, "ESCHEMA", "schema");
		kind = "probe";
	} else if (!strcmp(request->operation, "z2k_detect_classify")) {
		if (!detect_string(request->arguments, "host", &host, 253) || !detect_host_value(host) ||
			!detect_int(request->arguments, "port", 1, 65535, &port) || !detect_string(request->arguments, "hello", &hello, 32) ||
			(strcmp(hello, "modern") && strcmp(hello, "legacy") && strcmp(hello, "both")) ||
			!detect_int(request->arguments, "repeats", 1, Z2K_DETECT_MAX_REPEATS, &repeats)) return z2m_fail(request->request_id, "ESCHEMA", "schema");
		kind = "classify";
	} else if (!strcmp(request->operation, "z2k_detect_quic")) {
		if (!detect_string(request->arguments, "domain", &domain, 253) || !detect_host_value(domain) ||
			!detect_int(request->arguments, "port", 1, 65535, &port) ||
			!detect_int(request->arguments, "repeats", 1, Z2K_DETECT_MAX_REPEATS, &repeats)) return z2m_fail(request->request_id, "ESCHEMA", "schema");
		kind = "quic";
	} else if (!strcmp(request->operation, "z2k_detect_voice")) {
		if (!detect_int(request->arguments, "repeats", 1, Z2K_DETECT_MAX_REPEATS, &repeats)) return z2m_fail(request->request_id, "ESCHEMA", "schema");
		kind = "voice";
	} else if (!strcmp(request->operation, "z2k_detect_tcp16")) kind = "tcp16";
	else return z2m_fail(request->request_id, "ESCHEMA", "schema");
	argv[argc++] = (char *)Z2K_DETECT_EXEC_PATH; argv[argc++] = (char *)kind;
	if (!strcmp(kind, "probe")) { argv[argc++] = "-json"; argv[argc++] = (char *)domain; }
	else if (!strcmp(kind, "classify")) {
		if (snprintf(endpoint, sizeof(endpoint), strchr(host, ':') != NULL ? "[%s]:%lld" : "%s:%lld", host, (long long)port) < 0 ||
			snprintf(repeats_text, sizeof(repeats_text), "%lld", (long long)repeats) < 0 ||
			snprintf(timeout_text, sizeof(timeout_text), "%llds", (long long)((timeout + 999) / 1000)) < 0) return z2m_fail(request->request_id, "EINTERNAL", "argv");
		argv[argc++] = "-hello"; argv[argc++] = (char *)hello; argv[argc++] = "-repeats"; argv[argc++] = repeats_text;
		argv[argc++] = "-timeout"; argv[argc++] = timeout_text; argv[argc++] = "-json"; argv[argc++] = endpoint;
	} else if (!strcmp(kind, "quic")) {
		if (snprintf(port_text, sizeof(port_text), "%lld", (long long)port) < 0 || snprintf(repeats_text, sizeof(repeats_text), "%lld", (long long)repeats) < 0 ||
			snprintf(timeout_text, sizeof(timeout_text), "%llds", (long long)((timeout + 999) / 1000)) < 0) return z2m_fail(request->request_id, "EINTERNAL", "argv");
		argv[argc++] = "-port"; argv[argc++] = port_text; argv[argc++] = "-repeats"; argv[argc++] = repeats_text;
		argv[argc++] = "-timeout"; argv[argc++] = timeout_text; argv[argc++] = "-json"; argv[argc++] = (char *)domain;
	} else if (!strcmp(kind, "voice")) {
		if (snprintf(repeats_text, sizeof(repeats_text), "%lld", (long long)repeats) < 0 || snprintf(timeout_text, sizeof(timeout_text), "%llds", (long long)((timeout + 999) / 1000)) < 0) return z2m_fail(request->request_id, "EINTERNAL", "argv");
		argv[argc++] = "-repeats"; argv[argc++] = repeats_text; argv[argc++] = "-timeout"; argv[argc++] = timeout_text; argv[argc++] = "-json";
	}
	argv[argc] = NULL;
	unsigned char *out, *err; size_t out_len, err_len; int exit_code; bool timed_out, output_truncated;
	if (detect_run(argv, (unsigned int)timeout, &out, &out_len, &err, &err_len, &exit_code, &timed_out, &output_truncated) < 0) return z2m_fail(request->request_id, "EINTERNAL", "supervise");
	if (exit_code == 0 && !timed_out && !output_truncated && !detect_upstream_result_valid(kind, out, out_len)) {
		free(out); free(err); return z2m_fail(request->request_id, "ESCHEMA", "canonical_validate");
	}
	json_object *data = z2m_json_object(), *argv_data = json_object_new_array();
	if (!data || !argv_data) { json_object_put(data); json_object_put(argv_data); free(out); free(err); return z2m_fail(request->request_id, "EINTERNAL", "response_encode"); }
	for (size_t i = 0; i < argc; i++) json_object_array_add(argv_data, z2m_json_string(argv[i]));
	bool ok = z2m_json_add(data, "argv", argv_data) && z2m_json_add(data, "exitCode", z2m_json_int(exit_code)) && z2m_json_add(data, "stdout", z2m_json_string((char *)out)) && z2m_json_add(data, "stderr", z2m_json_string((char *)err)) && z2m_json_add(data, "timedOut", z2m_json_bool(timed_out)) && z2m_json_add(data, "outputTruncated", z2m_json_bool(output_truncated));
	free(out); free(err); if (!ok) { json_object_put(data); return z2m_fail(request->request_id, "EINTERNAL", "response_encode"); } return z2m_success(request->request_id, data);
}
