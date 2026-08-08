#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/socket.h>

int shutdown(int fd, int how)
{
	static int (*real_shutdown)(int, int);
	if (getenv("Z2M_TEST_SHUTDOWN_FAIL") != NULL) {
		errno = EIO;
		return -1;
	}
	if (real_shutdown == NULL)
		real_shutdown = dlsym(RTLD_NEXT, "shutdown");
	return real_shutdown(fd, how);
}
