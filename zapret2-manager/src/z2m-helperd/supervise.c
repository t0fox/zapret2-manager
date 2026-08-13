#include "helperd.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

enum setup_stage { STAGE_SETPGID = 1, STAGE_STDIN, STAGE_STDOUT, STAGE_STDERR, STAGE_CLOSE, STAGE_EXEC };
struct setup_error { uint8_t version; uint8_t stage; int32_t error; };
struct child_identity { pid_t pid; unsigned long long starttime; bool reaped; };
#define MAX_TRACKED_CHILDREN 2048U
#define MAX_CHILDREN_BYTES 65536U
_Static_assert(sizeof(struct setup_error) <= PIPE_BUF, "status record must be atomic");

static const char *stage_name(uint8_t stage)
{
	switch (stage) {
	case STAGE_SETPGID: return "setpgid";
	case STAGE_STDIN: return "stdin_dup2";
	case STAGE_STDOUT: return "stdout_dup2";
	case STAGE_STDERR: return "stderr_dup2";
	case STAGE_CLOSE: return "close";
	case STAGE_EXEC: return "exec";
	default: return NULL;
	}
}

static void child_error(int fd, uint8_t stage, int error)
{
	struct setup_error record = { 1, stage, error };
	const uint8_t *cursor = (const uint8_t *)&record;
	size_t remaining = sizeof(record);
	while (remaining) {
		ssize_t count = write(fd, cursor, remaining);
		if (count < 0 && errno == EINTR) continue;
		if (count <= 0) { kill(getpid(), SIGKILL); _exit(127); }
		cursor += count;
		remaining -= (size_t)count;
	}
	_exit(126);
}

static void child_close(int fd, int status)
{
	if (close(fd) < 0) child_error(status, STAGE_CLOSE, errno);
}

static int nonblocking(int fd)
{
	int flags = fcntl(fd, F_GETFL);
	if (flags < 0) return -1;
	return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int supervised_poll(struct pollfd *fds, nfds_t count, int timeout,
	unsigned int *poll_count)
{
	(*poll_count)++;
#ifdef Z2M_TEST_POLL_HARD_FAILURE
	if (*poll_count == 1) {
		errno = EIO;
		return -1;
	}
#endif
	return poll(fds, count, timeout);
}

static int compare_time(const struct timespec *a, const struct timespec *b)
{
	if (a->tv_sec != b->tv_sec) return a->tv_sec < b->tv_sec ? -1 : 1;
	if (a->tv_nsec != b->tv_nsec) return a->tv_nsec < b->tv_nsec ? -1 : 1;
	return 0;
}

static struct timespec after_ms(struct timespec value, unsigned int ms)
{
	value.tv_sec += ms / 1000;
	value.tv_nsec += (long)(ms % 1000) * 1000000L;
	if (value.tv_nsec >= 1000000000L) { value.tv_sec++; value.tv_nsec -= 1000000000L; }
	return value;
}

static int remaining_ms(const struct timespec *deadline)
{
	struct timespec now;
	long sec, nsec;
	if (clock_gettime(CLOCK_MONOTONIC, &now) < 0 || compare_time(&now, deadline) >= 0) return 0;
	sec = deadline->tv_sec - now.tv_sec;
	nsec = deadline->tv_nsec - now.tv_nsec;
	if (nsec < 0) { sec--; nsec += 1000000000L; }
	if (sec > INT_MAX / 1000) return INT_MAX;
	return (int)(sec * 1000 + (nsec + 999999L) / 1000000L);
}

static unsigned long long process_starttime(pid_t pid)
{
	char path[64], buffer[1024], *cursor, *end;
	int fd;
	ssize_t length;
	unsigned int field = 3;

	if (snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid) < 0) return 0;
	fd = open(path, O_RDONLY | O_CLOEXEC);
	if (fd < 0) return 0;
	do { length = read(fd, buffer, sizeof(buffer) - 1); } while (length < 0 && errno == EINTR);
	(void)close(fd);
	if (length <= 0) return 0;
	buffer[length] = '\0';
	cursor = strrchr(buffer, ')');
	if (!cursor || cursor[1] != ' ') return 0;
	cursor += 2;
	while (field <= 22) {
		while (*cursor == ' ') cursor++;
		if (!*cursor) return 0;
		end = cursor;
		while (*end && *end != ' ') end++;
		if (field == 22) {
			char saved = *end;
			unsigned long long value;
			*end = '\0';
			errno = 0;
			value = strtoull(cursor, NULL, 10);
			*end = saved;
			return errno == 0 ? value : 0;
		}
		cursor = end;
		field++;
	}
	return 0;
}

static bool identity_live(const struct child_identity *identity)
{
	return !identity->reaped && identity->starttime != 0 &&
		process_starttime(identity->pid) == identity->starttime;
}

static int track_identity_value(struct child_identity *tracked, size_t *count,
	pid_t pid, unsigned long long starttime)
{
	for (size_t i = 0; i < *count; i++) {
		if (tracked[i].pid != pid) continue;
		if (tracked[i].starttime == starttime) return 0;
		if (!tracked[i].reaped) { errno = EEXIST; return -1; }
	}
	if (*count >= MAX_TRACKED_CHILDREN) { errno = EOVERFLOW; return -1; }
	if (starttime == 0) return 0;
	tracked[*count] = (struct child_identity){ .pid = pid, .starttime = starttime };
	(*count)++;
	return 0;
}

static int track_identity(struct child_identity *tracked, size_t *count, pid_t pid)
{
	return track_identity_value(tracked, count, pid, process_starttime(pid));
}

static int discover_children(struct child_identity *tracked, size_t *count,
	size_t *enumeration_bytes)
{
	char path[64], buffer[4096], token[32];
	int fd;
	ssize_t length;
	size_t token_length = 0, total = 0;
#ifdef Z2M_TEST_CHILDREN_PATH
	const char *children_path = Z2M_TEST_CHILDREN_PATH;
#else
	const char *children_path = path;
#endif

	if (snprintf(path, sizeof(path), "/proc/self/task/%ld/children", (long)getpid()) < 0)
		return -1;
	fd = open(children_path, O_RDONLY | O_CLOEXEC);
	if (fd < 0) {
#ifdef Z2M_TEST_CHILDREN_PATH
		if (errno == ENOENT) return 0;
#endif
		return -1;
	}
	for (;;) {
		do { length = read(fd, buffer, sizeof(buffer)); } while (length < 0 && errno == EINTR);
		if (length < 0) { (void)close(fd); return -1; }
		if (length == 0) break;
		total += (size_t)length;
		if (total > MAX_CHILDREN_BYTES) { (void)close(fd); errno = EOVERFLOW; return -1; }
		for (ssize_t i = 0; i < length; i++) {
			if (buffer[i] >= '0' && buffer[i] <= '9') {
				if (token_length + 1 >= sizeof(token)) { (void)close(fd); errno = EOVERFLOW; return -1; }
				token[token_length++] = buffer[i];
			} else if (token_length) {
				long value;
				token[token_length] = '\0';
				value = strtol(token, NULL, 10);
				if (value > 0 && track_identity(tracked, count, (pid_t)value) < 0) {
					(void)close(fd); return -1;
				}
				token_length = 0;
			}
		}
	}
	(void)close(fd);
	if (token_length) {
		long value;
		token[token_length] = '\0';
		value = strtol(token, NULL, 10);
		if (value > 0 && track_identity(tracked, count, (pid_t)value) < 0) return -1;
	}
	*enumeration_bytes += total;
	return 0;
}

static int signal_tracked(struct child_identity *tracked, size_t count,
	int signal_number)
{
#ifndef Z2M_TEST_SKIP_TERMINATION_SIGNALS
	for (size_t i = 0; i < count; i++) {
		if (!identity_live(&tracked[i])) continue;
		if (kill(tracked[i].pid, signal_number) < 0 && errno != ESRCH) return -1;
	}
#else
	(void)tracked; (void)count; (void)signal_number;
#endif
	return 0;
}

#ifdef Z2M_TESTING
unsigned long long z2m_test_process_starttime(int pid)
{
	return process_starttime((pid_t)pid);
}

bool z2m_test_identity_live(int pid, unsigned long long starttime)
{
	struct child_identity identity = { .pid = (pid_t)pid, .starttime = starttime };
	return identity_live(&identity);
}

int z2m_test_track_conflict(int pid, unsigned long long first_starttime,
	unsigned long long second_starttime)
{
	struct child_identity tracked[2] = { 0 };
	size_t count = 0;
	if (track_identity_value(tracked, &count, (pid_t)pid, first_starttime) < 0)
		return -1;
	return track_identity_value(tracked, &count, (pid_t)pid, second_starttime);
}

void z2m_test_signal_tracked(int pid, unsigned long long starttime, int signal_number)
{
	struct child_identity tracked = { .pid = (pid_t)pid, .starttime = starttime };
	signal_tracked(&tracked, 1, signal_number);
}

int z2m_test_registry_reuse_transition(int pid, unsigned long long old_starttime,
	unsigned long long new_starttime)
{
	struct child_identity tracked[2] = { 0 };
	size_t count = 0;
	if (track_identity_value(tracked, &count, (pid_t)pid, old_starttime) < 0)
		return -1;
	errno = 0;
	if (track_identity_value(tracked, &count, (pid_t)pid, new_starttime) != -1 ||
	    errno != EEXIST)
		return -1;
	tracked[0].reaped = true;
	if (track_identity_value(tracked, &count, (pid_t)pid, new_starttime) < 0)
		return -1;
	return count == 2 && tracked[1].pid == pid &&
		tracked[1].starttime == new_starttime && !tracked[1].reaped ? 0 : -1;
}
#endif

static int signal_leader_group(pid_t leader, int signal_number, bool leader_reaped,
	unsigned int *post_reap_group_signals)
{
	if (leader_reaped) return 0;
#ifndef Z2M_TEST_SKIP_TERMINATION_SIGNALS
	int group_result = kill(-leader, signal_number);
	if (group_result < 0 && errno == ESRCH) {
		if (kill(leader, signal_number) < 0 && errno != ESRCH) { *post_reap_group_signals = 1; return -1; }
	} else if (group_result < 0) {
		*post_reap_group_signals = 1; return -1;
	}
#else
	(void)leader; (void)signal_number;
#endif
	(void)post_reap_group_signals;
	return 0;
}

void z2m_supervise(int client, const struct z2m_request *request, struct z2m_result *result)
{
	int input[2] = {-1,-1}, output[2] = {-1,-1}, errors[2] = {-1,-1}, status[2] = {-1,-1};
	struct setup_error record;
	size_t input_at = 0, status_length = 0, capacity = 0;
	bool input_closed = false, output_eof = false, errors_eof = false, status_eof = false;
	bool reaped = false, descendants_exhausted = false, terminating = false;
	bool kill_sent = false, disconnected = false, shutdown = false;
	bool timed_out = false, overflow = false, supervision_failed = false;
	bool cleanup_expired = false;
	unsigned int poll_count = 0;
	unsigned int post_reap_group_signals = 0;
	size_t tracked_count = 0, enumeration_bytes = 0;
	struct child_identity tracked[MAX_TRACKED_CHILDREN];
	int wait_status = 0;
	pid_t pid;
	struct timespec started, deadline, grace, cleanup_deadline;

	memset(result, 0, sizeof(*result));
	result->outcome = "transport_failure";
	result->start_state = "not_started";
	result->reason = "supervision_failure";
	result->exit_code = -1;
	if (pipe2(input, O_CLOEXEC) < 0) goto finish;
	if (pipe2(output, O_CLOEXEC) < 0) goto finish;
	if (pipe2(errors, O_CLOEXEC) < 0) goto finish;
	if (pipe2(status, O_CLOEXEC) < 0) goto finish;
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0) goto finish;
	deadline = after_ms(started, request->timeout_ms);
	pid = fork();
	if (pid < 0) { result->outcome = "spawn_failure"; result->stage = "fork"; result->error_number = errno; goto finish; }
	if (pid == 0) {
		char *const argv[] = { (char *)Z2M_HELPER_PATH, NULL };
		char *const envp[] = { (char *)"PATH=/usr/sbin:/usr/bin:/sbin:/bin", (char *)"LANG=C", NULL };
		child_close(input[1], status[1]); child_close(output[0], status[1]);
		child_close(errors[0], status[1]); child_close(status[0], status[1]);
		if (setpgid(0, 0) < 0) child_error(status[1], STAGE_SETPGID, errno);
#ifdef Z2M_TEST_FAIL_STDIN_DUP2
		child_close(input[0], status[1]);
#endif
		if (dup2(input[0], STDIN_FILENO) < 0) child_error(status[1], STAGE_STDIN, errno);
		if (dup2(output[1], STDOUT_FILENO) < 0) child_error(status[1], STAGE_STDOUT, errno);
		if (dup2(errors[1], STDERR_FILENO) < 0) child_error(status[1], STAGE_STDERR, errno);
		if (input[0] != STDIN_FILENO) child_close(input[0], status[1]);
		if (output[1] != STDOUT_FILENO) child_close(output[1], status[1]);
		if (errors[1] != STDERR_FILENO) child_close(errors[1], status[1]);
		execve(Z2M_HELPER_PATH, argv, envp);
		child_error(status[1], STAGE_EXEC, errno);
	}
	memset(tracked, 0, sizeof(tracked));
	if (track_identity(tracked, &tracked_count, pid) < 0) supervision_failed = true;
	close(input[0]); input[0] = -1; close(output[1]); output[1] = -1;
	close(errors[1]); errors[1] = -1; close(status[1]); status[1] = -1;
	if (nonblocking(input[1]) < 0 || nonblocking(output[0]) < 0 || nonblocking(errors[0]) < 0 || nonblocking(status[0]) < 0) {
		supervision_failed = true;
	}
	while (!reaped || !descendants_exhausted || !output_eof || !errors_eof || !status_eof) {
		struct pollfd fds[5] = {
			{ status[0], POLLIN | POLLHUP, 0 }, { output[0], POLLIN | POLLHUP, 0 },
			{ errors[0], POLLIN | POLLHUP, 0 }, { input_closed ? -1 : input[1], POLLOUT | POLLERR | POLLHUP, 0 },
			{ client, POLLHUP | POLLERR, 0 }
		};
		struct timespec now;
		int timeout = terminating ? remaining_ms(&grace) : remaining_ms(&deadline);
		if (timeout > 10) timeout = 10;
		int ready = supervised_poll(fds, 5, timeout, &poll_count);
		if (ready < 0 && errno == EINTR) continue;
		if (ready < 0) supervision_failed = true;
		if (!input_closed && fds[3].revents) {
			ssize_t count = write(input[1], request->body + input_at, request->body_length - input_at);
			if (count > 0) input_at += (size_t)count;
			if (count < 0 && errno != EPIPE && errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) supervision_failed = true;
			if (input_at == request->body_length || (count < 0 && errno == EPIPE)) {
				close(input[1]); input[1] = -1; input_closed = true;
			}
		}
		for (unsigned int i = 0; output[0] >= 0 && i < 8; i++) {
			uint8_t buffer[65536]; ssize_t count = read(output[0], buffer, sizeof(buffer));
			if (count > 0) {
				size_t keep = (size_t)count;
				if (result->output_length + keep > Z2M_RESPONSE_LIMIT + 1)
					keep = Z2M_RESPONSE_LIMIT + 1 - result->output_length;
				if (result->output_length + keep > capacity) {
					capacity = result->output_length + keep;
					uint8_t *grown = realloc(result->output, capacity);
					if (!grown) { supervision_failed = true; break; }
					result->output = grown;
				}
				memcpy(result->output + result->output_length, buffer, keep);
				result->output_length += keep; continue;
			}
			if (count == 0) {
				output_eof = true;
				close(output[0]); output[0] = -1;
			}
			else if (errno != EAGAIN && errno != EINTR) supervision_failed = true;
			break;
		}
		for (unsigned int i = 0; errors[0] >= 0 && i < 8; i++) {
			uint8_t buffer[4096]; ssize_t count = read(errors[0], buffer, sizeof(buffer));
			if (count > 0) {
				size_t keep = (size_t)count;
				result->error_drained += (size_t)count;
				if (keep > Z2M_STDERR_LIMIT - result->error_length) keep = Z2M_STDERR_LIMIT - result->error_length;
				memcpy(result->errors + result->error_length, buffer, keep); result->error_length += keep; continue;
			}
			if (count == 0) {
				errors_eof = true;
				close(errors[0]); errors[0] = -1;
			}
			else if (errno != EAGAIN && errno != EINTR) supervision_failed = true;
			break;
		}
		while (status[0] >= 0 && status_length < sizeof(record)) {
			ssize_t count = read(status[0], (uint8_t *)&record + status_length, sizeof(record) - status_length);
			if (count > 0) { status_length += (size_t)count; continue; }
			if (count == 0) {
				status_eof = true;
				close(status[0]); status[0] = -1;
			}
			else if (errno != EAGAIN && errno != EINTR) supervision_failed = true;
			break;
		}
		if (status_length == sizeof(record)) {
			status_eof = true;
			if (status[0] >= 0) { close(status[0]); status[0] = -1; }
		}
		if (status_eof && status_length == 0) result->start_state = "started";
		for (unsigned int i = 0; i < 8; i++) {
			int collected_status;
			pid_t waited = waitpid(-1, &collected_status, WNOHANG);
			if (waited == pid) { wait_status = collected_status; reaped = true; }
			if (waited > 0) {
				for (size_t j = 0; j < tracked_count; j++)
					if (tracked[j].pid == waited) tracked[j].reaped = true;
				continue;
			}
			if (waited == 0) break;
			if (errno == EINTR) continue;
			if (errno == ECHILD) { descendants_exhausted = true; break; }
			supervision_failed = true; break;
		}
		if (!descendants_exhausted && discover_children(tracked, &tracked_count,
		    &enumeration_bytes) < 0) supervision_failed = true;
		if (terminating && !descendants_exhausted && signal_tracked(tracked, tracked_count, kill_sent ? SIGKILL : SIGTERM) < 0)
			supervision_failed = true;
		if (fds[4].revents & (POLLHUP | POLLERR)) disconnected = true;
		if (z2m_stopping()) shutdown = true;
		if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) {
			supervision_failed = true;
			memset(&now, 0, sizeof(now));
		}
		overflow = result->output_length > Z2M_RESPONSE_LIMIT;
		if (!descendants_exhausted && compare_time(&now, &deadline) >= 0) timed_out = true;
		if (!terminating && (disconnected || shutdown || overflow || timed_out || supervision_failed)) {
			terminating = true;
			if (signal_leader_group(pid, SIGTERM, reaped, &post_reap_group_signals) < 0) supervision_failed = true;
			if (signal_tracked(tracked, tracked_count, SIGTERM) < 0) supervision_failed = true;
			grace = after_ms(now, 100);
			cleanup_deadline = after_ms(grace, 300);
		}
		if (terminating && !kill_sent && compare_time(&now, &grace) >= 0 &&
		    !descendants_exhausted) {
			if (signal_leader_group(pid, SIGKILL, reaped, &post_reap_group_signals) < 0) supervision_failed = true;
			if (signal_tracked(tracked, tracked_count, SIGKILL) < 0) supervision_failed = true;
			kill_sent = true;
		}
		if (terminating && compare_time(&now, &cleanup_deadline) >= 0 &&
		    (!reaped || !descendants_exhausted || !output_eof || !errors_eof || !status_eof)) {
			cleanup_expired = true;
			break;
		}
	}
#ifdef Z2M_TEST_FORCE_CLEANUP_EXPIRED
	cleanup_expired = true;
#endif
	result->child_reaped = reaped;
	result->stdout_eof = output_eof;
	result->stderr_eof = errors_eof;
	if (supervision_failed || cleanup_expired || !reaped || !descendants_exhausted || !output_eof ||
	    !errors_eof || !status_eof) {
		result->outcome = "transport_failure"; result->reason = "supervision_failure";
	} else if (status_length == sizeof(record) && record.version == 1 && stage_name(record.stage)) {
		result->outcome = record.stage == STAGE_EXEC ? "spawn_failure" : "setup_failure";
		result->start_state = "not_started"; result->stage = stage_name(record.stage);
		result->error_number = record.error;
	} else if (status_length != 0) {
		result->outcome = "transport_failure"; result->start_state = "not_started";
		result->reason = "status_protocol";
	} else if (disconnected) {
		result->outcome = "transport_failure"; result->reason = "client_disconnect";
	} else if (shutdown) {
		result->outcome = "transport_failure"; result->reason = "daemon_shutdown";
	} else if (overflow) {
		free(result->output); result->output = NULL; result->output_length = 0;
		result->outcome = "transport_failure"; result->reason = "stdout_limit";
	} else if (timed_out) {
		result->outcome = "timeout";
	} else {
		result->outcome = "child_exited";
	}
	result->exit_code = WIFEXITED(wait_status) ? WEXITSTATUS(wait_status) : -1;
	result->signal_number = WIFSIGNALED(wait_status) ? WTERMSIG(wait_status) : 0;

#ifdef Z2M_TEST_POLL_COUNT_PATH
	{
		int report = open(Z2M_TEST_POLL_COUNT_PATH, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
		if (report >= 0) {
			char value[32];
			int length = snprintf(value, sizeof(value), "%u\n", poll_count);
			if (length > 0) (void)write(report, value, (size_t)length);
			(void)close(report);
		}
	}
#endif

#ifdef Z2M_TEST_ENUMERATION_BYTES_PATH
	{
		int report = open(Z2M_TEST_ENUMERATION_BYTES_PATH, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
		if (report >= 0) {
			char value[32]; int length = snprintf(value, sizeof(value), "%zu\n", enumeration_bytes);
			if (length > 0) (void)write(report, value, (size_t)length);
			(void)close(report);
		}
	}
#endif
#ifdef Z2M_TEST_POST_REAP_GROUP_SIGNAL_PATH
	{
		int report = open(Z2M_TEST_POST_REAP_GROUP_SIGNAL_PATH, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
		if (report >= 0) {
			char value[32]; int length = snprintf(value, sizeof(value), "%u\n", post_reap_group_signals);
			if (length > 0) (void)write(report, value, (size_t)length);
			(void)close(report);
		}
	}
#endif

finish:
	for (size_t i = 0; i < 2; i++) {
		if (input[i] >= 0) close(input[i]);
		if (output[i] >= 0) close(output[i]);
		if (errors[i] >= 0) close(errors[i]);
		if (status[i] >= 0) close(status[i]);
	}
}

void z2m_free_result(struct z2m_result *result)
{
	free(result->output);
	memset(result, 0, sizeof(*result));
}
