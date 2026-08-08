#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#ifndef TEST_ROOT
#error TEST_ROOT must identify the compile-time test root
#endif

#define STRINGIFY_INNER(value) #value
#define STRINGIFY(value) STRINGIFY_INNER(value)
#define TEST_ROOT_PATH STRINGIFY(TEST_ROOT)
#define SOCKET_BASENAME "helper.sock"
#define FRAME_MARKER "F"

static const char *socket_path;
static dev_t socket_dev;
static ino_t socket_ino;
static int listener = -1;

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
