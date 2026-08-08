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
	bool *direct_sent)
{
	if (group_ready && kill(-pid, signal_number) == 0)
		return;
	if (group_ready && errno != ESRCH)
		fail("signal process group");
	if (kill(pid, signal_number) < 0 && errno != ESRCH)
		fail("signal direct child");
	*direct_sent = true;
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
			signal_child(pid, SIGTERM, group_ready_at_term, &direct_term_sent);
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
			signal_child(pid, SIGTERM, group_ready_at_term, &direct_term_sent);
			term_sent = true;
			term_at_ms = elapsed_ms(&started, &now);
			grace_deadline = timespec_after_ms(deadline, 100);
			cleanup_deadline = timespec_after_ms(grace_deadline, 300);
		}
		if (term_sent && !kill_sent && timespec_compare(&now, &grace_deadline) >= 0 &&
		    (!child_reaped || process_group_exists(pid))) {
			signal_child(pid, SIGKILL, guard->process_group_ready != 0, &direct_kill_sent);
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
			"\"groupReadyAtTerm\":%s,\"termAtMs\":%ld,\"killAtMs\":",
			outcome, (long)pid, descendant_pid, term_sent ? "true" : "false",
			kill_sent ? "true" : "false", child_reaped ? "true" : "false",
			direct_term_sent ? "true" : "false", direct_kill_sent ? "true" : "false",
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
	if (!strcmp(argv[1], "echo-many"))
		count = argument;

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
