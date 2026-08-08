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

static void nonblocking(int fd)
{
	int flags = fcntl(fd, F_GETFL);
	if (flags >= 0) (void)fcntl(fd, F_SETFL, flags | O_NONBLOCK);
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

static void signal_child(pid_t pid, int signal_number, bool reaped)
{
	if (kill(-pid, signal_number) == 0) return;
	if (errno != ESRCH || reaped) return;
	(void)kill(pid, signal_number);
}

static void signal_adopted_children(pid_t leader, int signal_number)
{
	char path[64], buffer[4096];
	int fd;
	ssize_t length;
	char *cursor, *end;

	if (snprintf(path, sizeof(path), "/proc/self/task/%ld/children", (long)getpid()) < 0)
		return;
	fd = open(path, O_RDONLY | O_CLOEXEC);
	if (fd < 0) return;
	do { length = read(fd, buffer, sizeof(buffer) - 1); } while (length < 0 && errno == EINTR);
	(void)close(fd);
	if (length <= 0) return;
	buffer[length] = '\0';
	cursor = buffer;
	while (*cursor) {
		long child = strtol(cursor, &end, 10);
		if (end == cursor) break;
		if (child > 0 && child != leader)
			(void)kill((pid_t)child, signal_number);
		cursor = end;
	}
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
	int wait_status = 0;
	pid_t pid;
	struct timespec started, deadline, grace, cleanup_deadline;

	memset(result, 0, sizeof(*result));
	result->outcome = "transport_failure";
	result->start_state = "not_started";
	result->reason = "supervision_failure";
	result->exit_code = -1;
	if (pipe2(input, O_CLOEXEC) < 0 || pipe2(output, O_CLOEXEC) < 0 ||
	    pipe2(errors, O_CLOEXEC) < 0 || pipe2(status, O_CLOEXEC) < 0) goto finish;
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
	close(input[0]); input[0] = -1; close(output[1]); output[1] = -1;
	close(errors[1]); errors[1] = -1; close(status[1]); status[1] = -1;
	nonblocking(input[1]); nonblocking(output[0]); nonblocking(errors[0]); nonblocking(status[0]);
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
			if (waited == pid) { wait_status = collected_status; reaped = true; continue; }
			if (waited > 0) continue;
			if (waited == 0) break;
			if (errno == EINTR) continue;
			if (errno == ECHILD) { descendants_exhausted = true; break; }
			supervision_failed = true; break;
		}
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
			signal_child(pid, SIGTERM, reaped);
			signal_adopted_children(pid, SIGTERM);
			grace = after_ms(now, 100);
			cleanup_deadline = after_ms(grace, 300);
		}
		if (terminating && !kill_sent && compare_time(&now, &grace) >= 0 &&
		    !descendants_exhausted) {
			signal_child(pid, SIGKILL, reaped); kill_sent = true;
			signal_adopted_children(pid, SIGKILL);
		}
		if (terminating && compare_time(&now, &cleanup_deadline) >= 0 &&
		    (!reaped || !descendants_exhausted || !output_eof || !errors_eof || !status_eof)) {
			cleanup_expired = true;
			break;
		}
	}
	result->child_reaped = reaped;
	result->stdout_eof = output_eof;
	result->stderr_eof = errors_eof;
	if (status_length == sizeof(record) && record.version == 1 && stage_name(record.stage)) {
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
	} else if (supervision_failed || cleanup_expired || !reaped || !descendants_exhausted) {
		result->outcome = "transport_failure"; result->reason = "supervision_failure";
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
