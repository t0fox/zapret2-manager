#define _GNU_SOURCE

#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static void sleep_30_seconds(void)
{
	struct timespec delay = { .tv_sec = 30 };

	while (nanosleep(&delay, &delay) < 0)
		;
}

static int write_repeated(int fd, char value, size_t length)
{
	char buffer[4096];
	memset(buffer, value, sizeof(buffer));
	while (length > 0) {
		size_t chunk = length < sizeof(buffer) ? length : sizeof(buffer);
		ssize_t written = write(fd, buffer, chunk);
		if (written < 0 && errno == EINTR)
			continue;
		if (written <= 0)
			return -1;
		length -= (size_t)written;
	}
	return 0;
}

int main(int argc, char **argv)
{
	const char *mode = argc > 1 ? argv[1] : "success";

	if (!strcmp(mode, "success")) {
		puts("{\"ok\":true}");
		return 0;
	}
	if (!strcmp(mode, "no-stdout"))
		return 0;
	if (!strncmp(mode, "exit-", 5))
		return atoi(mode + 5);
	if (!strcmp(mode, "malformed-stdout")) {
		fputs("{not-json\n", stdout);
		return 0;
	}
	if (!strcmp(mode, "sleep")) {
		for (;;)
			pause();
	}
	if (!strcmp(mode, "sleep-30")) {
		sleep_30_seconds();
		return 0;
	}
	if (!strcmp(mode, "ignore-term")) {
		signal(SIGTERM, SIG_IGN);
		for (;;)
			pause();
	}
	if (!strcmp(mode, "ignore-term-30")) {
		signal(SIGTERM, SIG_IGN);
		sleep_30_seconds();
		return 0;
	}
	if (!strcmp(mode, "wakeups")) {
		struct timespec delay = { .tv_nsec = 10000000L };
		for (;;) {
			fputc('w', stdout);
			fflush(stdout);
			nanosleep(&delay, NULL);
		}
	}
	if (!strcmp(mode, "stdout-overflow")) {
		if (write_repeated(STDOUT_FILENO, 'o', 8192) < 0)
			return 1;
		sleep_30_seconds();
		return 0;
	}
	if (!strcmp(mode, "stderr-excess")) {
		if (write_repeated(STDERR_FILENO, 'e', 16384) < 0)
			return 1;
		sleep_30_seconds();
		return 0;
	}
	if (!strcmp(mode, "pipe-pump")) {
		char buffer[4096];
		size_t received = 0;
		if (write_repeated(STDOUT_FILENO, 'o', 4096) < 0 ||
		    write_repeated(STDERR_FILENO, 'e', 8192) < 0)
			return 1;
		for (;;) {
			ssize_t length = read(STDIN_FILENO, buffer, sizeof(buffer));
			if (length > 0) { received += (size_t)length; continue; }
			if (length == 0) break;
			if (errno != EINTR) return 1;
		}
		return received == 65536 ? 0 : 1;
	}
	if (!strcmp(mode, "fork-descendant")) {
		pid_t descendant = fork();
		if (descendant < 0)
			return 1;
		if (descendant == 0) {
			for (;;)
				pause();
		}
		printf("descendant=%ld\n", (long)descendant);
		return 0;
	}
	if (!strcmp(mode, "fork-descendant-sleep")) {
		pid_t descendant = fork();
		if (descendant < 0)
			return 1;
		if (descendant == 0) {
			signal(SIGTERM, SIG_IGN);
			sleep_30_seconds();
			return 0;
		}
		printf("descendant=%ld\n", (long)descendant);
		fflush(stdout);
		sleep_30_seconds();
		return 0;
	}
	if (!strcmp(mode, "identity")) {
		printf("pid=%ld ppid=%ld pgrp=%ld\n", (long)getpid(),
			(long)getppid(), (long)getpgrp());
		return 0;
	}

	return 2;
}
