#define _GNU_SOURCE

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

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
	if (!strcmp(mode, "ignore-term")) {
		signal(SIGTERM, SIG_IGN);
		for (;;)
			pause();
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
	if (!strcmp(mode, "identity")) {
		printf("pid=%ld ppid=%ld pgrp=%ld\n", (long)getpid(),
			(long)getppid(), (long)getpgrp());
		return 0;
	}

	return 2;
}
