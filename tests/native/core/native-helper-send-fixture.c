#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define SOCKET_PATH "/tmp/zapret2-manager/runtime/z2m-helperd.sock"

static void fail(const char *message)
{
	perror(message);
	exit(1);
}

static uint32_t be32(const unsigned char *value)
{
	return ((uint32_t)value[0] << 24) | ((uint32_t)value[1] << 16) |
		((uint32_t)value[2] << 8) | value[3];
}

static void reset_close(int fd)
{
	struct linger linger = { .l_onoff = 1, .l_linger = 0 };
	if (setsockopt(fd, SOL_SOCKET, SO_LINGER, &linger, sizeof(linger)) < 0)
		fail("setsockopt linger");
	if (close(fd) < 0)
		fail("close client");
}

int main(int argc, char **argv)
{
	struct sockaddr_un address = { .sun_family = AF_UNIX };
	int listener, client, receive_buffer = 4096;
	unsigned char prelude[20], buffer[4096];
	size_t received = 0, expected = 0;
	struct timespec delay = { .tv_nsec = 150000000L };

	if (argc != 2 || (strcmp(argv[1], "backpressure-hup") &&
	    strcmp(argv[1], "shutdown-reset"))) return 2;
	listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (listener < 0) fail("socket");
	strcpy(address.sun_path, SOCKET_PATH);
	(void)unlink(SOCKET_PATH);
	if (bind(listener, (struct sockaddr *)&address, sizeof(address)) < 0 ||
	    listen(listener, 1) < 0) fail("bind/listen");
	if (chmod(SOCKET_PATH, 0600) < 0) fail("chmod");
	puts("READY");
	fflush(stdout);
	client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
	if (client < 0) fail("accept4");
	if (setsockopt(client, SOL_SOCKET, SO_RCVBUF, &receive_buffer,
	    sizeof(receive_buffer)) < 0) fail("setsockopt receive buffer");

	if (!strcmp(argv[1], "backpressure-hup")) {
		(void)nanosleep(&delay, NULL);
		ssize_t count = recv(client, buffer, sizeof(buffer), 0);
		if (count < 0) fail("recv partial");
		received = (size_t)count;
		printf("MODE=backpressure-hup RECEIVED=%zu RCVBUF=%d NO_READ_MS=150\n",
			received, receive_buffer);
		fflush(stdout);
		reset_close(client);
	} else {
		while (received < sizeof(prelude)) {
			ssize_t count = recv(client, prelude + received, sizeof(prelude) - received, 0);
			if (count <= 0) fail("recv prelude");
			received += (size_t)count;
		}
		expected = sizeof(prelude) + be32(prelude + 12) + be32(prelude + 16);
		while (received < expected) {
			ssize_t count = recv(client, buffer,
				expected - received < sizeof(buffer) ? expected - received : sizeof(buffer), 0);
			if (count <= 0) fail("recv request");
			received += (size_t)count;
		}
		printf("MODE=shutdown-reset RECEIVED=%zu EXPECTED=%zu\n", received, expected);
		fflush(stdout);
		reset_close(client);
	}
	(void)close(listener);
	(void)unlink(SOCKET_PATH);
	return 0;
}
