#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/socket.h>

static size_t limited_length(size_t length)
{
	const char *mode = getenv("Z2M_TEST_SEND_MODE");
	if (mode != NULL && mode[0] == 's' && length > 17)
		return 17;
	return length;
}

ssize_t sendto(int fd, const void *buffer, size_t length, int flags,
	const struct sockaddr *address, socklen_t address_length)
{
	static ssize_t (*real_sendto)(int, const void *, size_t, int,
		const struct sockaddr *, socklen_t);
	const char *mode = getenv("Z2M_TEST_SEND_MODE");
	if (mode != NULL && mode[0] == 'z') return 0;
	if (real_sendto == NULL) real_sendto = dlsym(RTLD_NEXT, "sendto");
	return real_sendto(fd, buffer, limited_length(length), flags, address, address_length);
}

ssize_t sendmsg(int fd, const struct msghdr *message, int flags)
{
	static ssize_t (*real_sendmsg)(int, const struct msghdr *, int);
	struct msghdr copy = *message;
	struct iovec vectors[16];
	const char *mode = getenv("Z2M_TEST_SEND_MODE");
	if (mode != NULL && mode[0] == 'z') return 0;
	if (real_sendmsg == NULL) real_sendmsg = dlsym(RTLD_NEXT, "sendmsg");
	if (mode != NULL && mode[0] == 's' && copy.msg_iovlen > 0 && copy.msg_iovlen <= 16) {
		for (size_t i = 0; i < (size_t)copy.msg_iovlen; i++) vectors[i] = copy.msg_iov[i];
		vectors[0].iov_len = limited_length(vectors[0].iov_len);
		copy.msg_iov = vectors;
	}
	return real_sendmsg(fd, &copy, flags);
}

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
