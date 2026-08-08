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

static void read_output(int fd, char *output, size_t capacity)
{
	size_t used = 0;

	while (used + 1 < capacity) {
		ssize_t length = read(fd, output + used, capacity - used - 1);
		if (length < 0 && errno == EINTR)
			continue;
		if (length < 0)
			fail("read child stdout");
		if (length == 0)
			break;
		used += (size_t)length;
	}
	output[used] = '\0';
}

static void spawn_child(const char *mode)
{
	int input[2], output[2], errors[2], exec_status[2];
	struct setup_error record;
	char child_output[128];
	char *const argv[] = { (char *)FIXED_CHILD_PATH, (char *)mode, NULL };
	char *const envp[] = { NULL };
	pid_t pid;
	ssize_t status_length = 0;
	int wait_status;
	struct status_guard *guard = mmap(NULL, sizeof(*guard), PROT_READ | PROT_WRITE,
		MAP_SHARED | MAP_ANONYMOUS, -1, 0);
	if (guard == MAP_FAILED)
		fail("mmap status guard");

	if (pipe2(input, O_CLOEXEC) < 0 || pipe2(output, O_CLOEXEC) < 0 ||
	    pipe2(errors, O_CLOEXEC) < 0 ||
	    pipe2(exec_status, O_CLOEXEC) < 0)
		fail("pipe2");
	if (fcntl(exec_status[0], F_SETFL, O_NONBLOCK) < 0)
		fail("fcntl exec status");

	pid = fork();
	if (pid < 0)
		fail("fork");
	if (pid == 0) {
		int source;

		checked_child_close(input[1], exec_status[1], guard);
		checked_child_close(output[0], exec_status[1], guard);
		checked_child_close(errors[0], exec_status[1], guard);
		checked_child_close(exec_status[0], exec_status[1], guard);
		if (setpgid(0, 0) < 0)
			child_error(exec_status[1], STAGE_SETPGID, errno, guard);

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
	if (close(input[1]) < 0)
		fail("close child stdin");

	for (;;) {
		struct pollfd watched = { .fd = exec_status[0], .events = POLLIN | POLLHUP };
		int ready = poll(&watched, 1, -1);
		if (ready < 0 && errno == EINTR)
			continue;
		if (ready < 0)
			fail("poll exec status");
		ssize_t length = read(exec_status[0], (uint8_t *)&record + status_length,
			sizeof(record) - (size_t)status_length);
		if (length < 0 && (errno == EINTR || errno == EAGAIN))
			continue;
		if (length < 0)
			fail("read exec status");
		if (length == 0)
			break;
		status_length += length;
		if ((size_t)status_length == sizeof(record))
			break;
	}
	if (close(exec_status[0]) < 0)
		fail("close exec status");
	if (waitpid(pid, &wait_status, 0) < 0)
		fail("waitpid");
	read_output(output[0], child_output, sizeof(child_output));
	if (close(output[0]) < 0 || close(errors[0]) < 0)
		fail("close child output");

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
