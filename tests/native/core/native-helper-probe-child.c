#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int write_all(int fd, const void *data, size_t length)
{
	const unsigned char *cursor = data;

	while (length > 0) {
		ssize_t written = write(fd, cursor, length);
		if (written < 0) {
			if (errno == EINTR)
				continue;
			return -1;
		}
		cursor += (size_t)written;
		length -= (size_t)written;
	}
	return 0;
}

static int consume(int echo)
{
	unsigned char buffer[16384];

	for (;;) {
		ssize_t length = read(STDIN_FILENO, buffer, sizeof(buffer));
		if (length == 0)
			return 0;
		if (length < 0) {
			if (errno == EINTR)
				continue;
			return 74;
		}
		if (echo && write_all(STDOUT_FILENO, buffer, (size_t)length) < 0)
			return 74;
	}
}

static int generate(void)
{
	char input[64];
	unsigned char output[16384];
	size_t used = 0;
	char *end;
	unsigned long long remaining;

	for (;;) {
		ssize_t length = read(STDIN_FILENO, input + used, sizeof(input) - used - 1);
		if (length == 0)
			break;
		if (length < 0) {
			if (errno == EINTR)
				continue;
			return 64;
		}
		used += (size_t)length;
		if (used == sizeof(input) - 1)
			return 64;
	}
	input[used] = '\0';
	errno = 0;
	remaining = strtoull(input, &end, 10);
	if (errno != 0 || end == input || (*end != '\0' && *end != '\n'))
		return 64;

	for (unsigned long long offset = 0; remaining > 0;) {
		size_t length = remaining < sizeof(output) ? (size_t)remaining : sizeof(output);
		for (size_t i = 0; i < length; i++)
			output[i] = (unsigned char)(((offset + i) * 31U + 17U) & 0xffU);
		if (write_all(STDOUT_FILENO, output, length) < 0)
			return 74;
		offset += length;
		remaining -= length;
	}
	return 0;
}

int main(int argc, char **argv)
{
	if (argc != 2)
		return 64;
	if (strcmp(argv[1], "echo") == 0)
		return consume(1);
	if (strcmp(argv[1], "generate") == 0)
		return generate();
	if (strcmp(argv[1], "exit7") == 0) {
		int result = consume(0);
		return result == 0 ? 7 : result;
	}
	if (strcmp(argv[1], "sleep") == 0) {
		struct timespec delay = { .tv_sec = 30, .tv_nsec = 0 };
		while (nanosleep(&delay, &delay) < 0 && errno == EINTR) {}
		return 0;
	}
	if (strcmp(argv[1], "stderr") == 0) {
		static const char diagnostic[] = "probe diagnostic\n";
		static const char protocol[] = "protocol-ok\n";
		return write_all(STDERR_FILENO, diagnostic, sizeof(diagnostic) - 1) < 0 ||
		       write_all(STDOUT_FILENO, protocol, sizeof(protocol) - 1) < 0 ? 74 : 0;
	}
	return 64;
}
