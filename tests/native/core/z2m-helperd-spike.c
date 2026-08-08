#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef TEST_ROOT
#error TEST_ROOT must identify the compile-time test root
#endif

#ifndef FIXED_CHILD
#error FIXED_CHILD must identify the compile-time fixed child
#endif

#define STRINGIFY_INNER(value) #value
#define STRINGIFY(value) STRINGIFY_INNER(value)
#define TEST_ROOT_PATH STRINGIFY(TEST_ROOT)
#define FIXED_CHILD_PATH STRINGIFY(FIXED_CHILD)
#define SOCKET_BASENAME "helper.sock"
#define FRAME_MARKER "F"
#define TRANSPORT_MAGIC "Z2MHTV1\n"
#define REQUEST_LIMIT (4U * 1024U * 1024U)
#define RESPONSE_LIMIT (6U * 1024U * 1024U)
#define STDERR_LIMIT 4096U

static const char *socket_path;
static dev_t socket_dev;
static ino_t socket_ino;
static int listener = -1;

static void fail(const char *operation);

enum setup_stage {
	STAGE_SETPGID = 1,
	STAGE_STDIN_DUP2,
	STAGE_STDOUT_DUP2,
	STAGE_STDERR_DUP2,
	STAGE_CLOSE,
	STAGE_EXEC,
};

struct setup_error {
	uint8_t version;
	uint8_t stage;
	int32_t error;
};

struct status_guard {
	volatile sig_atomic_t write_attempts;
	volatile sig_atomic_t write_error;
	volatile sig_atomic_t process_group_ready;
};

_Static_assert(sizeof(struct setup_error) <= PIPE_BUF,
	"setup error record must remain atomically writable");

static ssize_t status_write(int fd, const void *data, size_t length,
	struct status_guard *guard)
{
	guard->write_attempts++;
#ifdef INJECT_STATUS_WRITE_EINTR
	if (guard->write_attempts == 1) {
		errno = EINTR;
		return -1;
	}
#endif
#ifdef INJECT_STATUS_WRITE_FAILURE
	errno = EIO;
	return -1;
#endif
#ifdef INJECT_STATUS_WRITE_PARTIAL
	if (guard->write_attempts == 1 && length > 1)
		length /= 2;
#endif
	return write(fd, data, length);
}

static void child_error(int fd, enum setup_stage stage, int error,
	struct status_guard *guard)
{
	struct setup_error record = { .version = 1, .stage = stage, .error = error };
	const uint8_t *cursor = (const uint8_t *)&record;
	size_t remaining = sizeof(record);

#ifdef INJECT_UNKNOWN_STATUS_STAGE
	record.stage = UINT8_MAX;
#endif
	while (remaining > 0) {
		ssize_t written = status_write(fd, cursor, remaining, guard);
		if (written < 0 && errno == EINTR)
			continue;
		if (written <= 0) {
			guard->write_error = written < 0 ? errno : EIO;
			kill(getpid(), SIGKILL);
			_exit(127);
		}
		cursor += written;
		remaining -= (size_t)written;
	}
	_exit(126);
}

static void checked_child_close(int fd, int status_fd, struct status_guard *guard)
{
	if (close(fd) < 0)
		child_error(status_fd, STAGE_CLOSE, errno, guard);
}

static const char *stage_name(uint8_t stage)
{
	switch (stage) {
	case STAGE_SETPGID: return "setpgid";
	case STAGE_STDIN_DUP2: return "stdin_dup2";
	case STAGE_STDOUT_DUP2: return "stdout_dup2";
	case STAGE_STDERR_DUP2: return "stderr_dup2";
	case STAGE_CLOSE: return "close";
	case STAGE_EXEC: return "exec";
	default: return "unknown";
	}
}

static bool valid_stage(uint8_t stage)
{
	return stage >= STAGE_SETPGID && stage <= STAGE_EXEC;
}

static int timespec_compare(const struct timespec *left, const struct timespec *right)
{
	if (left->tv_sec != right->tv_sec)
		return left->tv_sec < right->tv_sec ? -1 : 1;
	if (left->tv_nsec != right->tv_nsec)
		return left->tv_nsec < right->tv_nsec ? -1 : 1;
	return 0;
}

static struct timespec timespec_after_ms(struct timespec value, long milliseconds)
{
	value.tv_sec += milliseconds / 1000;
	value.tv_nsec += (milliseconds % 1000) * 1000000L;
	if (value.tv_nsec >= 1000000000L) {
		value.tv_sec++;
		value.tv_nsec -= 1000000000L;
	}
	return value;
}

static int poll_timeout(const struct timespec *deadline)
{
	struct timespec now;
	long seconds, nanoseconds;

	if (clock_gettime(CLOCK_MONOTONIC, &now) < 0)
		fail("clock_gettime");
	if (timespec_compare(&now, deadline) >= 0)
		return 0;
	seconds = (long)(deadline->tv_sec - now.tv_sec);
	nanoseconds = deadline->tv_nsec - now.tv_nsec;
	if (nanoseconds < 0) {
		seconds--;
		nanoseconds += 1000000000L;
	}
	if (seconds > INT_MAX / 1000)
		return INT_MAX;
	return (int)(seconds * 1000 + (nanoseconds + 999999L) / 1000000L);
}

static void set_nonblocking(int fd)
{
	int flags = fcntl(fd, F_GETFL);
	if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0)
		fail("fcntl nonblocking");
}

static int supervised_poll(struct pollfd *fds, nfds_t count, int timeout,
	unsigned int *calls, unsigned int *interruptions, long *interruption_delay_ms)
{
	(*calls)++;
#ifdef INJECT_SUPERVISION_EINTR
	if (*calls <= 3) {
		struct timespec delay = { .tv_nsec = 30000000L };
		while (nanosleep(&delay, &delay) < 0 && errno == EINTR)
			;
		(*interruptions)++;
		*interruption_delay_ms += 30;
		errno = EINTR;
		return -1;
	}
#else
	(void)interruptions;
	(void)interruption_delay_ms;
#endif
	return poll(fds, count, timeout);
}

static long elapsed_ms(const struct timespec *started, const struct timespec *event)
{
	return (long)(event->tv_sec - started->tv_sec) * 1000L +
		(event->tv_nsec - started->tv_nsec) / 1000000L;
}

static void signal_child(pid_t pid, int signal_number, bool group_ready,
	bool child_reaped, bool *direct_sent, bool *group_no_target,
	bool *direct_attempted, bool *direct_no_target,
	bool *direct_attempted_after_reap)
{
	if (group_ready) {
		int result;
#ifdef INJECT_GROUP_KILL_ESRCH_AFTER_REAP
		if (signal_number == SIGKILL && child_reaped) {
			result = kill(-pid, signal_number);
			if (result < 0 && errno != ESRCH)
				fail("inject signal process group");
			errno = ESRCH;
			result = -1;
		} else
#endif
			result = kill(-pid, signal_number);
		if (result == 0)
			return;
		if (errno != ESRCH)
			fail("signal process group");
		*group_no_target = true;
	}
	if (child_reaped)
		return;
	*direct_attempted = true;
	if (kill(pid, signal_number) == 0) {
		*direct_sent = true;
		return;
	}
	if (errno != ESRCH)
		fail("signal direct child");
	*direct_no_target = true;
	if (child_reaped)
		*direct_attempted_after_reap = true;
}

static bool process_group_exists(pid_t pgid)
{
	if (kill(-pgid, 0) == 0 || errno == EPERM)
		return true;
	if (errno != ESRCH)
		fail("inspect process group");
	return false;
}

static void spawn_child(const char *requested_mode)
{
	int input[2], output[2], errors[2], exec_status[2];
	struct setup_error record;
	char child_output[4098] = { 0 };
	char stderr_output[4097] = { 0 };
	const char *mode = requested_mode;
	const char *outcome = "started";
	bool supervision = !strncmp(requested_mode, "timeout-", 8) ||
		!strcmp(requested_mode, "stdout-overflow") ||
		!strcmp(requested_mode, "stderr-excess");
	bool pump_input = !strcmp(requested_mode, "pipe-pump");
	if (!strcmp(requested_mode, "timeout-cooperative")) mode = "sleep-30";
	else if (!strcmp(requested_mode, "timeout-ignore-term")) mode = "ignore-term-30";
	else if (!strcmp(requested_mode, "timeout-descendant")) mode = "fork-descendant-sleep";
	else if (!strcmp(requested_mode, "timeout-wakeups")) mode = "wakeups";
	else if (!strcmp(requested_mode, "timeout-stderr-flood")) mode = "stderr-flood-ignore-term";
	else if (!strcmp(requested_mode, "timeout-reaped-group-race"))
		mode = "fork-descendant-parent-exit";
	char *const argv[] = { (char *)FIXED_CHILD_PATH, (char *)mode, NULL };
	char *const envp[] = { NULL };
	pid_t pid;
	size_t status_length = 0, stdout_length = 0, stderr_length = 0, input_written = 0;
	size_t stderr_drained = 0;
	int wait_status = 0;
	bool child_reaped = false, status_eof = false, stdout_eof = false, stderr_eof = false;
	bool stdin_closed = !pump_input;
	bool term_sent = false, kill_sent = false;
	bool direct_term_sent = false, direct_kill_sent = false;
	bool direct_term_attempted = false, direct_kill_attempted = false;
	bool direct_term_no_target = false, direct_kill_no_target = false;
	bool group_term_no_target = false, group_kill_no_target = false;
	bool direct_attempted_after_reap = false, reaped_before_kill = false;
	bool group_ready_at_term = false, adopted_children_exhausted = false;
	unsigned int poll_calls = 0, poll_interruptions = 0, stdout_reads = 0;
	long interruption_delay_ms = 0, term_at_ms = -1, kill_at_ms = -1;
	pid_t descendant_reaped_pid = 0;
	struct timespec started, deadline, grace_deadline, cleanup_deadline, finished;
	struct status_guard *guard = mmap(NULL, sizeof(*guard), PROT_READ | PROT_WRITE,
		MAP_SHARED | MAP_ANONYMOUS, -1, 0);
	if (guard == MAP_FAILED)
		fail("mmap status guard");
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0)
		fail("clock_gettime");
	deadline = timespec_after_ms(started, supervision ? 100 : 2000);
	grace_deadline = deadline;
	cleanup_deadline = deadline;
	if (prctl(PR_SET_CHILD_SUBREAPER, 1) < 0)
		fail("prctl(PR_SET_CHILD_SUBREAPER)");

	if (pipe2(input, O_CLOEXEC) < 0 || pipe2(output, O_CLOEXEC) < 0 ||
	    pipe2(errors, O_CLOEXEC) < 0 ||
	    pipe2(exec_status, O_CLOEXEC) < 0)
		fail("pipe2");
	set_nonblocking(exec_status[0]);

	pid = fork();
	if (pid < 0)
		fail("fork");
	if (pid == 0) {
		int source;

		checked_child_close(input[1], exec_status[1], guard);
		checked_child_close(output[0], exec_status[1], guard);
		checked_child_close(errors[0], exec_status[1], guard);
		checked_child_close(exec_status[0], exec_status[1], guard);
#ifdef INJECT_DELAYED_SETPGID
		{
			struct timespec delay = { .tv_nsec = 300000000L };
			while (nanosleep(&delay, &delay) < 0 && errno == EINTR)
				;
		}
#endif
		if (setpgid(0, 0) < 0)
			child_error(exec_status[1], STAGE_SETPGID, errno, guard);
		guard->process_group_ready = 1;

		source = input[0];
#ifdef INJECT_STDIN_DUP2_FAILURE
		checked_child_close(source, exec_status[1], guard);
#endif
		if (dup2(source, STDIN_FILENO) < 0)
			child_error(exec_status[1], STAGE_STDIN_DUP2, errno, guard);
		if (source != STDIN_FILENO)
			checked_child_close(source, exec_status[1], guard);

		source = output[1];
#ifdef INJECT_STDOUT_DUP2_FAILURE
		checked_child_close(source, exec_status[1], guard);
#endif
		if (dup2(source, STDOUT_FILENO) < 0)
			child_error(exec_status[1], STAGE_STDOUT_DUP2, errno, guard);
		if (source != STDOUT_FILENO)
			checked_child_close(source, exec_status[1], guard);

		source = errors[1];
#ifdef INJECT_STDERR_DUP2_FAILURE
		checked_child_close(source, exec_status[1], guard);
#endif
		if (dup2(source, STDERR_FILENO) < 0)
			child_error(exec_status[1], STAGE_STDERR_DUP2, errno, guard);
		if (source != STDERR_FILENO)
			checked_child_close(source, exec_status[1], guard);

		execve(FIXED_CHILD_PATH, argv, envp);
		child_error(exec_status[1], STAGE_EXEC, errno, guard);
	}

	if (close(input[0]) < 0 || close(output[1]) < 0 || close(errors[1]) < 0 ||
	    close(exec_status[1]) < 0)
		fail("parent close");
	if (pump_input)
		set_nonblocking(input[1]);
	else if (close(input[1]) < 0)
		fail("close child stdin");
	set_nonblocking(output[0]);
	set_nonblocking(errors[0]);

	while (!child_reaped || !stdout_eof || !stderr_eof || !status_eof) {
		struct pollfd watched[4] = {
			{ .fd = exec_status[0], .events = POLLIN | POLLHUP },
			{ .fd = output[0], .events = POLLIN | POLLHUP },
			{ .fd = errors[0], .events = POLLIN | POLLHUP },
			{ .fd = stdin_closed ? -1 : input[1], .events = POLLOUT | POLLERR | POLLHUP },
		};
		struct timespec now;
		const struct timespec *active_deadline = term_sent ? &grace_deadline : &deadline;
		int ready = supervised_poll(watched, 4, poll_timeout(active_deadline),
			&poll_calls, &poll_interruptions, &interruption_delay_ms);
		if (ready < 0 && errno == EINTR)
			continue;
		if (ready < 0)
			fail("poll child pipes");
		if (!stdin_closed && (watched[3].revents & POLLOUT)) {
			char input_buffer[4096];
			memset(input_buffer, 'i', sizeof(input_buffer));
			while (input_written < 65536) {
				size_t remaining = 65536 - input_written;
				size_t chunk = remaining < sizeof(input_buffer) ? remaining : sizeof(input_buffer);
				ssize_t written = write(input[1], input_buffer, chunk);
				if (written > 0) { input_written += (size_t)written; continue; }
				if (written < 0 && (errno == EAGAIN || errno == EINTR)) break;
				if (written < 0 && errno == EPIPE) break;
				if (written <= 0) fail("write child stdin");
			}
			if (input_written == 65536) {
				if (close(input[1]) < 0) fail("close child stdin");
				stdin_closed = true;
			}
		}

		for (unsigned int reads = 0; reads < 8; reads++) {
			ssize_t length = read(exec_status[0], (uint8_t *)&record + status_length,
				sizeof(record) - status_length);
			if (length > 0) { status_length += (size_t)length; continue; }
			if (length == 0) status_eof = true;
			else if (errno != EAGAIN && errno != EINTR) fail("read exec status");
			break;
		}
		for (unsigned int reads = 0; reads < 8; reads++) {
			char buffer[1024];
			ssize_t length = read(output[0], buffer, sizeof(buffer));
			if (length > 0) {
				stdout_reads++;
				size_t retain = (size_t)length;
				if (retain > sizeof(child_output) - 1 - stdout_length)
					retain = sizeof(child_output) - 1 - stdout_length;
				memcpy(child_output + stdout_length, buffer, retain);
				stdout_length += retain;
				continue;
			}
			if (length == 0) stdout_eof = true;
			else if (errno != EAGAIN && errno != EINTR) fail("read child stdout");
			break;
		}
		for (unsigned int reads = 0; reads < 8; reads++) {
			char buffer[1024];
			ssize_t length = read(errors[0], buffer, sizeof(buffer));
			if (length > 0) {
				size_t retain = (size_t)length;
				stderr_drained += (size_t)length;
				if (retain > sizeof(stderr_output) - 1 - stderr_length)
					retain = sizeof(stderr_output) - 1 - stderr_length;
				memcpy(stderr_output + stderr_length, buffer, retain);
				stderr_length += retain;
				continue;
			}
			if (length == 0) stderr_eof = true;
			else if (errno != EAGAIN && errno != EINTR) fail("read child stderr");
			break;
		}

		for (unsigned int reaps = 0; reaps < 8; reaps++) {
			int status;
			pid_t waited = waitpid(-1, &status, WNOHANG);
			if (waited == pid) { wait_status = status; child_reaped = true; continue; }
			if (waited > 0) { descendant_reaped_pid = waited; continue; }
			if (waited == 0) break;
			if (errno == EINTR) continue;
			if (errno == ECHILD) { adopted_children_exhausted = true; break; }
			fail("waitpid WNOHANG");
		}
		if (stdout_length >= 4097 && !term_sent) {
			outcome = "stdout_limit";
			group_ready_at_term = guard->process_group_ready != 0;
			signal_child(pid, SIGTERM, group_ready_at_term, child_reaped,
				&direct_term_sent, &group_term_no_target,
				&direct_term_attempted, &direct_term_no_target,
				&direct_attempted_after_reap);
			term_sent = true;
			if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) fail("clock_gettime");
			term_at_ms = elapsed_ms(&started, &now);
			grace_deadline = timespec_after_ms(now, 100);
			cleanup_deadline = timespec_after_ms(grace_deadline, 300);
		}
		if (clock_gettime(CLOCK_MONOTONIC, &now) < 0)
			fail("clock_gettime");
		if (!term_sent && timespec_compare(&now, &deadline) >= 0 &&
		    (!child_reaped || process_group_exists(pid))) {
			outcome = "timeout";
			group_ready_at_term = guard->process_group_ready != 0;
			signal_child(pid, SIGTERM, group_ready_at_term, child_reaped,
				&direct_term_sent, &group_term_no_target,
				&direct_term_attempted, &direct_term_no_target,
				&direct_attempted_after_reap);
			term_sent = true;
			term_at_ms = elapsed_ms(&started, &now);
			grace_deadline = timespec_after_ms(deadline, 100);
			cleanup_deadline = timespec_after_ms(grace_deadline, 300);
		}
		if (term_sent && !kill_sent && timespec_compare(&now, &grace_deadline) >= 0 &&
		    (!child_reaped || process_group_exists(pid))) {
			reaped_before_kill = child_reaped;
			signal_child(pid, SIGKILL, guard->process_group_ready != 0, child_reaped,
				&direct_kill_sent, &group_kill_no_target,
				&direct_kill_attempted, &direct_kill_no_target,
				&direct_attempted_after_reap);
			kill_sent = true;
			kill_at_ms = elapsed_ms(&started, &now);
		}
		if (child_reaped && stdout_eof && stderr_eof && status_eof &&
		    !process_group_exists(pid) && adopted_children_exhausted)
			break;
		if (term_sent && timespec_compare(&now, &cleanup_deadline) >= 0) {
			outcome = "supervision_failure";
			break;
		}
	}
	if (clock_gettime(CLOCK_MONOTONIC, &finished) < 0)
		fail("clock_gettime");
	if (close(exec_status[0]) < 0)
		fail("close exec status");
	if (close(output[0]) < 0 || close(errors[0]) < 0)
		fail("close child output");
	if (!stdin_closed && close(input[1]) < 0)
		fail("close child stdin");
	child_output[stdout_length] = '\0';
	stderr_output[stderr_length] = '\0';

	if (strcmp(outcome, "started")) {
		long total_elapsed_ms = elapsed_ms(&started, &finished);
		long descendant_pid = 0;
		sscanf(child_output, "descendant=%ld", &descendant_pid);
		printf("{\"outcome\":\"%s\",\"pid\":%ld,\"descendantPid\":%ld,"
			"\"termSent\":%s,\"killSent\":%s,\"reaped\":%s,"
			"\"directTermSent\":%s,\"directKillSent\":%s,"
			"\"directTermAttempted\":%s,\"directKillAttempted\":%s,"
			"\"directTermNoTarget\":%s,\"directKillNoTarget\":%s,"
			"\"groupTermNoTarget\":%s,\"groupKillNoTarget\":%s,"
			"\"reapedBeforeKill\":%s,\"directKillAttemptedAfterReap\":%s,"
			"\"groupReadyAtTerm\":%s,\"termAtMs\":%ld,\"killAtMs\":",
			outcome, (long)pid, descendant_pid, term_sent ? "true" : "false",
			kill_sent ? "true" : "false", child_reaped ? "true" : "false",
			direct_term_sent ? "true" : "false", direct_kill_sent ? "true" : "false",
			direct_term_attempted ? "true" : "false",
			direct_kill_attempted ? "true" : "false",
			direct_term_no_target ? "true" : "false",
			direct_kill_no_target ? "true" : "false",
			group_term_no_target ? "true" : "false",
			group_kill_no_target ? "true" : "false",
			reaped_before_kill ? "true" : "false",
			direct_attempted_after_reap ? "true" : "false",
			group_ready_at_term ? "true" : "false", term_at_ms);
		if (kill_at_ms < 0) printf("null"); else printf("%ld", kill_at_ms);
		printf(",\"waitSignal\":%d,\"elapsedMs\":%ld,\"pollEintr\":%u,"
			"\"interruptionDelayMs\":%ld,\"descendantReapedPid\":%ld,"
			"\"adoptedChildrenExhausted\":%s,"
			"\"stdoutReads\":%u,\"stdoutBytes\":%zu,\"stderrBytes\":%zu,"
			"\"stderrDrained\":%zu}\n",
			WIFSIGNALED(wait_status) ? WTERMSIG(wait_status) : 0, total_elapsed_ms,
			poll_interruptions, interruption_delay_ms, (long)descendant_reaped_pid,
			adopted_children_exhausted ? "true" : "false", stdout_reads,
			stdout_length, stderr_length, stderr_drained);
		return;
	}
	if (pump_input) {
		printf("{\"outcome\":\"started\",\"childExit\":%d,\"pid\":%ld,"
			"\"stdinBytes\":%zu,\"stdoutBytes\":%zu,\"stderrBytes\":%zu,"
			"\"stderrDrained\":%zu,\"reaped\":%s}\n",
			WIFEXITED(wait_status) ? WEXITSTATUS(wait_status) : 128, (long)pid,
			input_written, stdout_length, stderr_length, stderr_drained,
			child_reaped ? "true" : "false");
		return;
	}

	if (status_length == 0) {
		if (guard->write_error != 0) {
			printf("{\"outcome\":\"protocol_failure\",\"stage\":null,"
				"\"errno\":\"EIO\",\"state\":\"not_started\","
				"\"evidence\":\"status_write_failure\"}\n");
			return;
		}
		int exit_code = WIFEXITED(wait_status) ? WEXITSTATUS(wait_status) : 128;
		printf("{\"outcome\":\"started\",\"stage\":null,\"errno\":null,"
			"\"state\":\"started\",\"evidence\":\"status_pipe_eof\","
			"\"childExit\":%d,\"stdout\":\"%s\"}\n", exit_code,
			child_output[0] ? !strcmp(child_output, "{\"ok\":true}\n") ?
				"{\\\"ok\\\":true}\\n" : child_output : "");
		return;
	}
	if ((size_t)status_length != sizeof(record) || record.version != 1 ||
	    !valid_stage(record.stage)) {
		printf("{\"outcome\":\"protocol_failure\",\"stage\":null,"
			"\"errno\":\"EPROTO\",\"state\":\"not_started\","
			"\"evidence\":\"invalid_status_record\"}\n");
		return;
	}
	printf("{\"outcome\":\"%s\",\"stage\":\"%s\",\"errno\":\"%s\","
		"\"state\":\"not_started\",\"evidence\":\"status_record\"",
		record.stage == STAGE_EXEC ? "spawn_failure" : "setup_failure",
		stage_name(record.stage), record.error == ENOENT ? "ENOENT" :
			record.error == EBADF ? "EBADF" : "OTHER");
	if (guard->write_attempts > 1)
		printf(",\"statusWriteAttempts\":%ld", (long)guard->write_attempts);
	puts("}");
}

static void cleanup(void)
{
	struct stat st;

	if (listener >= 0)
		close(listener);

	if (socket_path && lstat(socket_path, &st) == 0 && S_ISSOCK(st.st_mode) &&
	    st.st_dev == socket_dev && st.st_ino == socket_ino)
		unlink(socket_path);
}

static void stop(int signal_number)
{
	(void)signal_number;
	exit(0);
}

static void fail(const char *operation)
{
	fprintf(stderr, "%s: %s\n", operation, strerror(errno));
	exit(1);
}

static void write_all(int fd, const void *data, size_t length)
{
	const uint8_t *cursor = data;

	while (length > 0) {
		ssize_t written = write(fd, cursor, length);

		if (written < 0 && errno == EINTR)
			continue;
		if (written <= 0)
			fail("write");

		cursor += written;
		length -= (size_t)written;
	}
}

static void write_fragmented(int fd, const void *data, size_t length)
{
	const uint8_t *cursor = data;
	const struct timespec pause = { .tv_nsec = 1000000L };

	while (length > 0) {
		size_t chunk = length > 32768 ? 32768 : length;
		write_all(fd, cursor, chunk);
		cursor += chunk;
		length -= chunk;
		if (length > 0)
			nanosleep(&pause, NULL);
	}
}

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

static bool read_request_frame(int client, uint8_t **body, size_t *body_length)
{
	static const char expected_header[] =
		"{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\",\"timeoutMs\":100}";
	uint8_t prelude[20], extra;
	size_t used = 0, header_length;
	char header[1025];

	while (used < sizeof(prelude)) {
		ssize_t length = read(client, prelude + used, sizeof(prelude) - used);
		if (length > 0) { used += (size_t)length; continue; }
		if (length < 0 && errno == EINTR) continue;
		fprintf(stderr, "request-rejected stage=prelude reason=short\n"); return false;
	}
	header_length = read_be32(prelude + 12);
	*body_length = read_be32(prelude + 16);
	if (*body_length >= 1024U * 1024U)
		fprintf(stderr, "request-frame=prelude header=%zu body=%zu\n", header_length, *body_length);
	if (memcmp(prelude, TRANSPORT_MAGIC, 8)) {
		fprintf(stderr, "request-rejected stage=prelude reason=magic\n"); return false;
	}
	if (prelude[8] != 1) {
		fprintf(stderr, "request-rejected stage=prelude reason=frame_type\n"); return false;
	}
	if (prelude[9] != 0) {
		fprintf(stderr, "request-rejected stage=prelude reason=flags\n"); return false;
	}
	if (prelude[10] != 0 || prelude[11] != 0) {
		fprintf(stderr, "request-rejected stage=prelude reason=reserved\n"); return false;
	}
	if (header_length > 1024) {
		fprintf(stderr, "request-rejected stage=prelude reason=header_limit\n"); return false;
	}
	if (*body_length > REQUEST_LIMIT) {
		fprintf(stderr, "request-rejected stage=prelude reason=body_limit\n"); return false;
	}
	used = 0;
	while (used < header_length) {
		ssize_t length = read(client, header + used, header_length - used);
		if (length > 0) { used += (size_t)length; continue; }
		if (length < 0 && errno == EINTR) continue;
		fprintf(stderr, "request-rejected stage=header reason=short\n"); return false;
	}
	header[header_length] = '\0';
	if (strstr(header, "\"requestId\":\"probe:1\",\"requestId\"")) {
		fprintf(stderr, "request-rejected stage=header reason=duplicate_key\n"); return false;
	}
	if (strstr(header, "\"x\":")) {
		fprintf(stderr, "request-rejected stage=header reason=unknown_field\n"); return false;
	}
	if (header_length == 1 && header[0] == '{') {
		fprintf(stderr, "request-rejected stage=header reason=malformed_json\n"); return false;
	}
	if (strstr(header, "\"requestId\":\"wrong\"")) {
		fprintf(stderr, "request-rejected stage=header reason=request_id\n"); return false;
	}
	if (header_length != strlen(expected_header) || strcmp(header, expected_header)) {
		fprintf(stderr, "request-rejected stage=header reason=shape\n");
		return false;
	}
	if (*body_length >= 1024U * 1024U)
		fprintf(stderr, "request-frame=header bytes=%zu\n", header_length);
	*body = malloc(*body_length ? *body_length : 1);
	if (!*body)
		fail("malloc request");
	used = 0;
	while (used < *body_length) {
		ssize_t length = read(client, *body + used, *body_length - used);
		if (length > 0) {
			size_t previous = used;
			used += (size_t)length;
			if (used / (1024U * 1024U) != previous / (1024U * 1024U) || used == *body_length)
				fprintf(stderr, "request-frame=body bytes=%zu\n", used);
			continue;
		}
		if (length < 0 && errno == EINTR) continue;
		free(*body);
		fprintf(stderr, "request-rejected stage=body reason=short\n"); return false;
	}
	for (;;) {
		struct pollfd peer = { .fd = client, .events = POLLIN | POLLHUP | POLLERR };
		int ready = poll(&peer, 1, 200);
		if (ready < 0 && errno == EINTR) continue;
		if (ready <= 0) {
			fprintf(stderr, "request-rejected stage=eof reason=missing\n"); free(*body); return false;
		}
		ssize_t length = recv(client, &extra, 1, 0);
		if (length > 0) {
			fprintf(stderr, "request-rejected stage=eof reason=trailing\n"); free(*body); return false;
		}
		if (length == 0) break;
		if (errno != EINTR) {
			fprintf(stderr, "request-rejected stage=eof reason=read\n"); free(*body); return false;
		}
	}
	return true;
}

static void response_frame(int client, const char *outcome, const char *start_state,
	const char *stage, const char *reason, bool reaped, int exit_code, int signal_number,
	const uint8_t *output, size_t output_length, const uint8_t *errors,
	size_t error_length, size_t error_drained, bool error_truncated, bool truncate)
{
	char header[2049];
	uint8_t prelude[20] = TRANSPORT_MAGIC;
	char exit_value[32], signal_value[32], stage_field[64] = "", reason_field[64] = "";
	int length;

	if (exit_code < 0) strcpy(exit_value, "null"); else snprintf(exit_value, sizeof(exit_value), "%d", exit_code);
	if (signal_number == 0) strcpy(signal_value, "null"); else snprintf(signal_value, sizeof(signal_value), "%d", signal_number);
	if (stage) snprintf(stage_field, sizeof(stage_field), ",\"stage\":\"%s\"", stage);
	if (reason) snprintf(reason_field, sizeof(reason_field), ",\"reason\":\"%s\"", reason);
	length = snprintf(header, sizeof(header),
		"{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\","
		"\"outcome\":\"%s\",\"startState\":\"%s\",\"stdoutLength\":%zu,"
		"\"stderrLength\":%zu,\"stdoutEof\":true,\"stderrEof\":true,"
		"\"stderrTruncated\":%s,\"stderrDrained\":%zu,\"childReaped\":%s,"
		"\"exitCode\":%s,\"signal\":%s%s%s}", outcome, start_state,
		output_length, error_length, error_truncated ? "true" : "false", error_drained,
		reaped ? "true" : "false", exit_value, signal_value, stage_field, reason_field);
	if (length < 0 || (size_t)length >= sizeof(header))
		fail("response header");
	prelude[8] = 2;
	write_be32(prelude + 12, (uint32_t)length);
	write_be32(prelude + 16, (uint32_t)(output_length + error_length));
	write_all(client, prelude, truncate ? 19 : sizeof(prelude));
	if (truncate) return;
	write_all(client, header, (size_t)length);
	write_all(client, output, output_length);
	write_all(client, errors, error_length);
}

static void malformed_response(int client, const char *mode)
{
	uint8_t *body = NULL;
	size_t body_length = 0;
	uint8_t prelude[20] = TRANSPORT_MAGIC;
	const char *header;

	if (!read_request_frame(client, &body, &body_length))
		return;
	free(body);
	if (!strcmp(mode, "response-malformed"))
		header = "{";
	else if (!strcmp(mode, "response-duplicate"))
		header = "{\"protocol\":\"z2m-helper-transport-v1\",\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\"}";
	else if (!strcmp(mode, "response-unknown"))
		header = "{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\",\"x\":1}";
	else if (!strcmp(mode, "response-type"))
		header = "{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\",\"outcome\":\"child_exited\",\"startState\":\"started\",\"stdoutLength\":\"0\",\"stderrLength\":0,\"stdoutEof\":true,\"stderrEof\":true,\"stderrTruncated\":false,\"stderrDrained\":0,\"childReaped\":true,\"exitCode\":0,\"signal\":null}";
	else if (!strcmp(mode, "response-outcome"))
		header = "{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\",\"outcome\":\"bogus\",\"startState\":\"started\",\"stdoutLength\":0,\"stderrLength\":0,\"stdoutEof\":true,\"stderrEof\":true,\"stderrTruncated\":false,\"stderrDrained\":0,\"childReaped\":true,\"exitCode\":0,\"signal\":null}";
	else if (!strcmp(mode, "response-id"))
		header = "{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"wrong\",\"outcome\":\"child_exited\",\"startState\":\"started\",\"stdoutLength\":0,\"stderrLength\":0,\"stdoutEof\":true,\"stderrEof\":true,\"stderrTruncated\":false,\"stderrDrained\":0,\"childReaped\":true,\"exitCode\":0,\"signal\":null}";
	else
		header = "{\"protocol\":\"z2m-helper-transport-v1\",\"requestId\":\"probe:1\",\"outcome\":\"child_exited\",\"startState\":\"started\",\"stdoutLength\":0,\"stderrLength\":0,\"stdoutEof\":true,\"stderrEof\":true,\"stderrTruncated\":false,\"stderrDrained\":0,\"childReaped\":false,\"exitCode\":0,\"signal\":null}";
	prelude[8] = 2;
	write_be32(prelude + 12, (uint32_t)strlen(header));
	write_be32(prelude + 16, 0);
	write_all(client, prelude, sizeof(prelude));
	write_all(client, header, strlen(header));
	if (!strcmp(mode, "response-trailing"))
		write_all(client, "x", 1);
}

static void broker_child(int client, const char *child_mode, int disconnect_case)
{
	uint8_t *request = NULL, *output = NULL, errors[STDERR_LIMIT];
	size_t request_length = 0, output_length = 0, output_capacity = 0;
	size_t error_length = 0, error_drained = 0, input_offset = 0;
	int input[2], out[2], err[2], status[2], wait_status = 0;
	struct setup_error record;
	size_t status_length = 0;
	struct status_guard *guard;
	pid_t pid;
	bool input_closed = false, out_eof = false, err_eof = false, status_eof = false;
	bool reaped = false, timed_out = false, overflow = false, started_reported = false;
	bool disconnect_terminated = false;
	struct timespec started, deadline, grace;

	if (!read_request_frame(client, &request, &request_length))
		return;
	if (request_length >= 1024U * 1024U)
		fprintf(stderr, "broker-stage=frame body=%zu\n", request_length);
	if (disconnect_case == 1) {
		fprintf(stderr, "disconnect-before-exec=observed\n");
		free(request);
		return;
	}
	guard = mmap(NULL, sizeof(*guard), PROT_READ | PROT_WRITE,
		MAP_SHARED | MAP_ANONYMOUS, -1, 0);
	if (guard == MAP_FAILED) fail("mmap broker guard");
	if (pipe2(input, O_CLOEXEC) < 0 || pipe2(out, O_CLOEXEC) < 0 ||
	    pipe2(err, O_CLOEXEC) < 0 || pipe2(status, O_CLOEXEC) < 0)
		fail("broker pipes");
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0) fail("clock_gettime");
	deadline = timespec_after_ms(started, !strcmp(child_mode, "sleep-30") ? 100 : 5000);
	pid = fork();
	if (pid < 0) {
		response_frame(client, "spawn_failure", "not_started", "fork", NULL, false,
			-1, 0, NULL, 0, NULL, 0, 0, false, false);
		free(request); return;
	}
	if (pid == 0) {
		struct status_guard local = { 0 };
		char *const argv[] = { (char *)FIXED_CHILD_PATH, (char *)child_mode, NULL };
		char *const envp[] = { NULL };
		close(input[1]); close(out[0]); close(err[0]); close(status[0]);
		if (setpgid(0, 0) < 0) child_error(status[1], STAGE_SETPGID, errno, &local);
#ifdef INJECT_STDIN_DUP2_FAILURE
		close(input[0]);
#endif
		if (dup2(input[0], 0) < 0) child_error(status[1], STAGE_STDIN_DUP2, errno, &local);
		if (dup2(out[1], 1) < 0) child_error(status[1], STAGE_STDOUT_DUP2, errno, &local);
		if (dup2(err[1], 2) < 0) child_error(status[1], STAGE_STDERR_DUP2, errno, &local);
		close(input[0]); close(out[1]); close(err[1]);
		execve(FIXED_CHILD_PATH, argv, envp);
		child_error(status[1], STAGE_EXEC, errno, &local);
	}
	close(input[0]); close(out[1]); close(err[1]); close(status[1]);
	set_nonblocking(input[1]);
	set_nonblocking(out[0]);
	set_nonblocking(err[0]);
	set_nonblocking(status[0]);
	while (!reaped || !out_eof || !err_eof || !status_eof) {
		struct pollfd fds[5] = {
			{ status[0], POLLIN | POLLHUP, 0 }, { out[0], POLLIN | POLLHUP, 0 },
			{ err[0], POLLIN | POLLHUP, 0 }, { input_closed ? -1 : input[1], POLLOUT | POLLERR | POLLHUP, 0 },
			{ disconnect_case == 2 ? client : -1, POLLHUP | POLLERR | POLLRDHUP, 0 }
		};
		struct timespec now;
		if (poll(fds, 5, 10) < 0 && errno != EINTR) fail("broker poll");
		if (!input_closed && fds[3].revents) {
			ssize_t n = write(input[1], request + input_offset, request_length - input_offset);
			if (n > 0) input_offset += (size_t)n;
			if (input_offset == request_length || (n < 0 && errno == EPIPE)) {
				close(input[1]); input_closed = true;
				if (request_length >= 1024U * 1024U)
					fprintf(stderr, "broker-stage=input bytes=%zu epipe=%d\n", input_offset,
						n < 0 && errno == EPIPE);
			}
		}
		for (unsigned int i = 0; i < 8; i++) {
			uint8_t buffer[65536]; ssize_t n = read(out[0], buffer, sizeof(buffer));
			if (n > 0) {
				size_t keep = (size_t)n;
				if (output_length + keep > RESPONSE_LIMIT + 1) keep = RESPONSE_LIMIT + 1 - output_length;
				if (output_length + keep > output_capacity) {
					output_capacity = output_length + keep; output = realloc(output, output_capacity);
					if (!output) fail("realloc output");
				}
				memcpy(output + output_length, buffer, keep); output_length += keep;
				if (output_length > RESPONSE_LIMIT) overflow = true;
				continue;
			}
			if (n == 0) out_eof = true;
			else if (errno != EAGAIN && errno != EINTR) fail("broker stdout");
			break;
		}
		for (unsigned int i = 0; i < 8; i++) {
			uint8_t buffer[4096]; ssize_t n = read(err[0], buffer, sizeof(buffer));
			if (n > 0) {
				size_t keep = (size_t)n;
				error_drained += (size_t)n;
				if (keep > STDERR_LIMIT - error_length) keep = STDERR_LIMIT - error_length;
				memcpy(errors + error_length, buffer, keep); error_length += keep; continue;
			}
			if (n == 0) err_eof = true;
			else if (errno != EAGAIN && errno != EINTR) fail("broker stderr");
			break;
		}
		while (status_length < sizeof(record)) {
			ssize_t n = read(status[0], (uint8_t *)&record + status_length, sizeof(record) - status_length);
			if (n > 0) { status_length += (size_t)n; continue; }
			if (n == 0) status_eof = true;
			else if (errno != EAGAIN && errno != EINTR) fail("broker status");
			break;
		}
		if (status_length == sizeof(record))
			status_eof = true;
		if (status_eof && status_length == 0 && !started_reported) {
			started_reported = true;
			if (disconnect_case == 2)
				fprintf(stderr, "broker-stage=started\n");
		}
		if (!reaped) {
			pid_t waited = waitpid(pid, &wait_status, WNOHANG);
			if (waited == pid) reaped = true;
			else if (waited < 0 && errno != EINTR) fail("broker waitpid");
		}
		if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) fail("clock_gettime");
		if (disconnect_case == 2 && started_reported && !reaped && !timed_out &&
		    (fds[4].revents & (POLLHUP | POLLERR | POLLRDHUP))) {
			disconnect_terminated = true;
			timed_out = true;
			kill(-pid, SIGTERM);
			grace = timespec_after_ms(now, 100);
			fprintf(stderr, "disconnect-after-exec=terminated\n");
		}
		if ((overflow || timespec_compare(&now, &deadline) >= 0) && !timed_out && !reaped) {
			timed_out = true; kill(-pid, SIGTERM); grace = timespec_after_ms(now, 100);
		}
		if (timed_out && !reaped && timespec_compare(&now, &grace) >= 0) kill(-pid, SIGKILL);
	}
	close(out[0]); close(err[0]); close(status[0]); if (!input_closed) close(input[1]);
	free(request); munmap(guard, sizeof(*guard));
	if (disconnect_case) {
		if (disconnect_case == 2 && disconnect_terminated)
			fprintf(stderr, "disconnect-after-exec=reaped\n");
		free(output); return;
	}
	if (status_length == sizeof(record))
		response_frame(client, record.stage == STAGE_EXEC ? "spawn_failure" : "setup_failure",
			"not_started", stage_name(record.stage), NULL, true,
			WIFEXITED(wait_status) ? WEXITSTATUS(wait_status) : -1,
			WIFSIGNALED(wait_status) ? WTERMSIG(wait_status) : 0,
			output, output_length, errors, error_length, error_drained,
			error_drained > error_length, false);
	else if (overflow)
		response_frame(client, "transport_failure", "started", NULL, "stdout_limit", true,
			-1, WIFSIGNALED(wait_status) ? WTERMSIG(wait_status) : 0,
			NULL, 0, errors, error_length, error_drained, error_drained > error_length, false);
	else if (timed_out)
		response_frame(client, "timeout", "started", NULL, NULL, true, -1,
			WIFSIGNALED(wait_status) ? WTERMSIG(wait_status) : 0,
			output, output_length, errors, error_length, error_drained,
			error_drained > error_length, false);
	else
		response_frame(client, "child_exited", "started", NULL, NULL, true,
			WIFEXITED(wait_status) ? WEXITSTATUS(wait_status) : -1,
			WIFSIGNALED(wait_status) ? WTERMSIG(wait_status) : 0,
			output, output_length, errors, error_length, error_drained,
			error_drained > error_length, false);
	free(output);
}

static void begin_frame(int client)
{
	write_all(client, FRAME_MARKER, 1);
}

static void drain(int client)
{
	uint8_t buffer[16384];
	ssize_t length;

	do {
		length = read(client, buffer, sizeof(buffer));
	} while (length > 0 || (length < 0 && errno == EINTR));

	if (length < 0)
		fail("read");
}

static void drain_and_echo(int client, unsigned int delay_ms, bool fragmented)
{
	uint8_t buffer[16384];
	uint8_t *request = NULL;
	size_t used = 0;
	size_t capacity = 0;
	ssize_t length;

	if (delay_ms) {
		struct timespec delay = {
			.tv_sec = delay_ms / 1000,
			.tv_nsec = (long)(delay_ms % 1000) * 1000000L,
		};
		nanosleep(&delay, NULL);
	}

	while ((length = read(client, buffer, sizeof(buffer))) != 0) {
		if (length < 0 && errno == EINTR)
			continue;
		if (length < 0)
			fail("read");
		if (used + (size_t)length > capacity) {
			capacity = capacity ? capacity * 2 : sizeof(buffer);
			while (capacity < used + (size_t)length)
				capacity *= 2;
			request = realloc(request, capacity);
			if (!request)
				fail("realloc");
		}
		memcpy(request + used, buffer, (size_t)length);
		used += (size_t)length;
	}

	begin_frame(client);
	if (fragmented)
		write_fragmented(client, request, used);
	else
		write_all(client, request, used);
	free(request);
}

static void serve(int client, const char *mode, unsigned int argument)
{
	struct ucred cred;
	socklen_t cred_length = sizeof(cred);
	char report[128];

	if (getsockopt(client, SOL_SOCKET, SO_PEERCRED, &cred, &cred_length) < 0)
		fail("getsockopt(SO_PEERCRED)");
	if (cred_length != sizeof(cred)) {
		errno = EINVAL;
		fail("getsockopt(SO_PEERCRED) length");
	}
	if (!strncmp(mode, "broker-", 7)) {
		const char *child_mode = "success";
		int disconnect_case = 0;
		if (!strcmp(mode, "broker-exit7")) child_mode = "structured-failure";
		else if (!strcmp(mode, "broker-malformed")) child_mode = "malformed-stdout";
		else if (!strcmp(mode, "broker-count-input")) child_mode = "count-input";
		else if (!strcmp(mode, "broker-generate-6m")) child_mode = "generate-6m";
		else if (!strcmp(mode, "broker-overflow")) child_mode = "overflow-6m";
		else if (!strcmp(mode, "broker-stderr")) child_mode = "stderr-16k";
		else if (!strcmp(mode, "broker-timeout")) child_mode = "sleep-30";
		else if (!strcmp(mode, "broker-disconnect-before-exec")) disconnect_case = 1;
		else if (!strcmp(mode, "broker-disconnect-after-exec")) { child_mode = "sleep-30"; disconnect_case = 2; }
		broker_child(client, child_mode, disconnect_case);
		return;
	}
	if (!strncmp(mode, "response-", 9) && strcmp(mode, "response-truncated")) {
		malformed_response(client, mode);
		return;
	}
	if (!strcmp(mode, "response-truncated")) {
		uint8_t *body = NULL;
		size_t body_length = 0;
		if (read_request_frame(client, &body, &body_length)) {
			free(body);
			response_frame(client, "child_exited", "started", NULL, NULL, true,
				0, 0, NULL, 0, NULL, 0, 0, false, true);
		}
		return;
	}

	if (!strcmp(mode, "immediate-close"))
		return;

	if (!strcmp(mode, "reject-nonroot")) {
		if (cred.uid != 0) {
			fprintf(stderr, "REJECTED uid=%ld pid=%ld\n",
				(long)cred.uid, (long)cred.pid);
			return;
		}
		errno = EPERM;
		fail("expected non-root peer");
	}

	if (!strcmp(mode, "partial")) {
		drain(client);
		begin_frame(client);
		write_all(client, "partial-response", strlen("partial-response"));
		return;
	}

	if (!strcmp(mode, "generate")) {
		uint8_t buffer[4096];
		drain(client);
		begin_frame(client);
		memset(buffer, 0xa5, sizeof(buffer));
		for (unsigned int sent = 0; sent < argument;) {
			size_t chunk = argument - sent;
			if (chunk > sizeof(buffer))
				chunk = sizeof(buffer);
			write_all(client, buffer, chunk);
			sent += (unsigned int)chunk;
		}
		return;
	}

	if (!strcmp(mode, "peercred")) {
		int length = snprintf(report, sizeof(report),
			"server_pid=%ld client_uid=%ld client_pid=%ld\n",
			(long)getpid(), (long)cred.uid, (long)cred.pid);
		begin_frame(client);
		write_all(client, report, (size_t)length);
		return;
	}

	if (!strcmp(mode, "empty-frame")) {
		drain(client);
		begin_frame(client);
		return;
	}

	if (!strcmp(mode, "trickle")) {
		const struct timespec pause = {
			.tv_sec = argument / 1000,
			.tv_nsec = (long)(argument % 1000) * 1000000L,
		};
		drain(client);
		begin_frame(client);
		for (unsigned int i = 0; i < 20; i++) {
			write_all(client, "x", 1);
			nanosleep(&pause, NULL);
		}
		return;
	}

	if (!strcmp(mode, "delayed")) {
		drain_and_echo(client, argument, false);
		return;
	}

	if (!strcmp(mode, "backpressure")) {
		int buffer_size = 4096;
		if (setsockopt(client, SOL_SOCKET, SO_RCVBUF,
		    &buffer_size, sizeof(buffer_size)) < 0)
			fail("setsockopt(SO_RCVBUF)");
		drain_and_echo(client, argument, true);
		return;
	}

	if (!strcmp(mode, "echo") || !strcmp(mode, "echo-many")) {
		drain_and_echo(client, argument, false);
		return;
	}

	errno = EINVAL;
	fail("unknown fixture mode");
}

int main(int argc, char **argv)
{
	struct sockaddr_un address = { .sun_family = AF_UNIX };
	struct stat st, root_st;
	char required_path[sizeof(address.sun_path)];
	unsigned int argument = 0;
	unsigned int count = 1;
	mode_t previous_umask;

	if (argc == 3 && !strcmp(argv[1], "spawn")) {
		spawn_child(argv[2]);
		return 0;
	}

	int path_length = snprintf(required_path, sizeof(required_path),
		"%s/%s", TEST_ROOT_PATH, SOCKET_BASENAME);
	if (path_length < 0 || (size_t)path_length >= sizeof(required_path) ||
	    argc < 3 || strcmp(argv[2], required_path) != 0) {
		fprintf(stderr, "usage: %s MODE SOCKET [ARGUMENT]\n", argv[0]);
		return 2;
	}
	if (lstat(TEST_ROOT_PATH, &root_st) < 0 || !S_ISDIR(root_st.st_mode) ||
	    S_ISLNK(root_st.st_mode)) {
		errno = EINVAL;
		fail("unsafe TEST_ROOT");
	}

	if (argc > 3)
		argument = (unsigned int)strtoul(argv[3], NULL, 10);
	if (!strcmp(argv[1], "echo-many") || !strcmp(argv[1], "broker-success"))
		count = argument;
	if (count == 0)
		count = 1;

	socket_path = argv[2];
	memcpy(address.sun_path, socket_path, strlen(socket_path) + 1);
	previous_umask = umask(0077);
	listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (listener < 0)
		fail("socket");
	if (bind(listener, (struct sockaddr *)&address, sizeof(address)) < 0)
		fail("bind");
	umask(previous_umask);
	if (chmod(socket_path, 0600) < 0)
		fail("chmod");
	if (lstat(socket_path, &st) < 0 || !S_ISSOCK(st.st_mode))
		fail("lstat");
	socket_dev = st.st_dev;
	socket_ino = st.st_ino;
	if (listen(listener, 8) < 0)
		fail("listen");

	atexit(cleanup);
	signal(SIGTERM, stop);
	signal(SIGINT, stop);
	puts("READY");
	fflush(stdout);

	for (unsigned int handled = 0; handled < count; handled++) {
		int client;

		do {
			client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
		} while (client < 0 && errno == EINTR);
		if (client < 0)
			fail("accept4");

		serve(client, argv[1], argument);
		if (close(client) < 0)
			fail("close");
	}

	return 0;
}
