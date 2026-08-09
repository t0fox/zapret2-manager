#include "helperd.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

static volatile sig_atomic_t stopping;
static int listener = -1;
static int lock_fd = -1;
static int runtime_fd = -1;
static dev_t socket_dev;
static ino_t socket_ino;
static bool socket_owned;

static void stop(int signal_number)
{
	(void)signal_number;
	stopping = 1;
	if (listener >= 0) close(listener);
	listener = -1;
}

bool z2m_stopping(void)
{
	return stopping != 0;
}

static int exact_object(const char *path, mode_t type, mode_t mode)
{
	struct stat pathname, descriptor;
	int flags = O_RDONLY | O_CLOEXEC | O_NOFOLLOW;
	int fd;
	if (type == S_IFDIR) flags |= O_DIRECTORY;
	fd = open(path, flags);
	if (fd < 0 || fstat(fd, &descriptor) < 0 || lstat(path, &pathname) < 0 ||
	    (descriptor.st_mode & S_IFMT) != type || (pathname.st_mode & S_IFMT) != type ||
	    (descriptor.st_mode & 07777) != mode || descriptor.st_uid != Z2M_RUNTIME_UID ||
	    descriptor.st_gid != Z2M_RUNTIME_GID ||
	    descriptor.st_dev != pathname.st_dev || descriptor.st_ino != pathname.st_ino) {
		if (fd >= 0) close(fd);
		errno = EPERM;
		return -1;
	}
	return fd;
}

static int verify_runtime(void)
{
#ifndef Z2M_TESTING
	struct stat descriptor, pathname;
	int tmp = exact_object("/tmp", S_IFDIR, 01777);
	int root = -1, runtime = -1;
	if (tmp < 0) return -1;
	root = openat(tmp, "zapret2-manager", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
	if (root < 0 || fstat(root, &descriptor) < 0 ||
	    fstatat(tmp, "zapret2-manager", &pathname, AT_SYMLINK_NOFOLLOW) < 0 ||
	    !S_ISDIR(descriptor.st_mode) || !S_ISDIR(pathname.st_mode) ||
	    (descriptor.st_mode & 07777) != 0700 || descriptor.st_uid != 0 || descriptor.st_gid != 0 ||
	    descriptor.st_dev != pathname.st_dev || descriptor.st_ino != pathname.st_ino) goto unsafe;
	runtime = openat(root, "runtime", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
	if (runtime < 0 || fstat(runtime, &descriptor) < 0 ||
	    fstatat(root, "runtime", &pathname, AT_SYMLINK_NOFOLLOW) < 0 ||
	    !S_ISDIR(descriptor.st_mode) || !S_ISDIR(pathname.st_mode) ||
	    (descriptor.st_mode & 07777) != 0700 || descriptor.st_uid != 0 || descriptor.st_gid != 0 ||
	    descriptor.st_dev != pathname.st_dev || descriptor.st_ino != pathname.st_ino) goto unsafe;
	close(root); close(tmp);
	return runtime;
unsafe:
	if (runtime >= 0) close(runtime);
	if (root >= 0) close(root);
	close(tmp);
	errno = EPERM;
	return -1;
#else
	return exact_object(Z2M_RUNTIME_PATH, S_IFDIR, 0700);
#endif
}

static int acquire_lock(void)
{
	struct stat descriptor, pathname;
	lock_fd = openat(runtime_fd, "z2m-helperd.lock",
		O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
#ifdef Z2M_TEST_STOP_AFTER_LOCK_OPEN
	raise(SIGSTOP);
#endif
	if (lock_fd < 0 || fstat(lock_fd, &descriptor) < 0 ||
	    fstatat(runtime_fd, "z2m-helperd.lock", &pathname, AT_SYMLINK_NOFOLLOW) < 0 ||
	    !S_ISREG(descriptor.st_mode) || !S_ISREG(pathname.st_mode) ||
	    (descriptor.st_mode & 07777) != 0600 || descriptor.st_uid != Z2M_RUNTIME_UID ||
	    descriptor.st_gid != Z2M_RUNTIME_GID || descriptor.st_dev != pathname.st_dev ||
	    descriptor.st_ino != pathname.st_ino) goto failure;
#ifdef Z2M_TEST_STOP_BEFORE_LOCK_FLOCK
	raise(SIGSTOP);
#endif
	if (flock(lock_fd, LOCK_EX | LOCK_NB) < 0) goto failure;
#ifdef Z2M_TEST_STOP_AFTER_LOCK_FLOCK
	raise(SIGSTOP);
#endif
	if (fstat(lock_fd, &descriptor) < 0 ||
	    fstatat(runtime_fd, "z2m-helperd.lock", &pathname, AT_SYMLINK_NOFOLLOW) < 0 ||
	    !S_ISREG(descriptor.st_mode) || !S_ISREG(pathname.st_mode) ||
	    (descriptor.st_mode & 07777) != 0600 || descriptor.st_uid != Z2M_RUNTIME_UID ||
	    descriptor.st_gid != Z2M_RUNTIME_GID || descriptor.st_dev != pathname.st_dev ||
	    descriptor.st_ino != pathname.st_ino) goto failure_locked;
	return 0;

failure_locked:
	(void)flock(lock_fd, LOCK_UN);
failure:
	if (lock_fd >= 0) close(lock_fd);
	lock_fd = -1;
	errno = EPERM;
	return -1;
}

static int remove_verified_stale_socket(void)
{
	struct stat existing;

	/* The verified 0700 runtime root and held singleton lock exclude unprivileged races.
	 * Local UID 0 is trusted; malicious-root pathname replacement is out of scope. */
	if (fstatat(runtime_fd, "z2m-helperd.sock", &existing, AT_SYMLINK_NOFOLLOW) < 0)
		return errno == ENOENT ? 0 : -1;
	if (!S_ISSOCK(existing.st_mode) || existing.st_uid != Z2M_RUNTIME_UID ||
	    existing.st_gid != Z2M_RUNTIME_GID || (existing.st_mode & 07777) != 0600) {
		fprintf(stderr, "z2m-helperd: unsafe pre-existing socket path left untouched\n");
		errno = EPERM;
		return -1;
	}
	return unlinkat(runtime_fd, "z2m-helperd.sock", 0);
}

static void remove_owned_socket(void)
{
	struct stat current;

	/* Preserve any replacement unless the fixed name still has our recorded identity. */
	if (!socket_owned || runtime_fd < 0 || lock_fd < 0) return;
	if (fstatat(runtime_fd, "z2m-helperd.sock", &current, AT_SYMLINK_NOFOLLOW) == 0 &&
	    S_ISSOCK(current.st_mode) && current.st_uid == Z2M_RUNTIME_UID &&
	    current.st_gid == Z2M_RUNTIME_GID && (current.st_mode & 07777) == 0600 &&
	    current.st_dev == socket_dev && current.st_ino == socket_ino)
		(void)unlinkat(runtime_fd, "z2m-helperd.sock", 0);
	socket_owned = false;
}

static void cleanup(void)
{
	if (listener >= 0) close(listener);
	listener = -1;
	remove_owned_socket();
	if (lock_fd >= 0) close(lock_fd);
	lock_fd = -1;
	if (runtime_fd >= 0) close(runtime_fd);
	runtime_fd = -1;
}

int main(void)
{
	struct sockaddr_un address = { .sun_family = AF_UNIX };
	struct sigaction action = { .sa_handler = stop };
	struct stat st;
	mode_t old_umask;
	if (strlen(Z2M_SOCKET_PATH) >= sizeof(address.sun_path)) { errno = ENAMETOOLONG; goto failure; }
	runtime_fd = verify_runtime();
	if (runtime_fd < 0) goto failure;
	if (prctl(PR_SET_CHILD_SUBREAPER, 1) < 0) goto failure;
	if (acquire_lock() < 0) {
		fprintf(stderr, "z2m-helperd: singleton lock unavailable\n");
		goto failure;
	}
	if (remove_verified_stale_socket() < 0) goto failure;
	memcpy(address.sun_path, Z2M_SOCKET_PATH, strlen(Z2M_SOCKET_PATH) + 1);
	old_umask = umask(0177);
	listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (listener < 0 || bind(listener, (struct sockaddr *)&address, sizeof(address)) < 0) {
		umask(old_umask); goto failure;
	}
	umask(old_umask);
#ifdef Z2M_TEST_STOP_AFTER_BIND
	raise(SIGSTOP);
#endif
	if (fstatat(runtime_fd, "z2m-helperd.sock", &st, AT_SYMLINK_NOFOLLOW) < 0 ||
	    !S_ISSOCK(st.st_mode) || st.st_uid != Z2M_RUNTIME_UID ||
	    st.st_gid != Z2M_RUNTIME_GID ||
	    (st.st_mode & 07777) != 0600) goto failure;
	socket_dev = st.st_dev;
	socket_ino = st.st_ino;
	socket_owned = true;
	if (listen(listener, 8) < 0) goto failure;
	atexit(cleanup);
	sigemptyset(&action.sa_mask);
	action.sa_flags = 0;
	if (sigaction(SIGTERM, &action, NULL) < 0 || sigaction(SIGINT, &action, NULL) < 0 ||
	    signal(SIGPIPE, SIG_IGN) == SIG_ERR) goto failure;
	while (!stopping) {
		struct ucred credential;
		socklen_t length = sizeof(credential);
		struct z2m_request request;
		struct z2m_result result;
		int client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
		if (client < 0 && errno == EINTR) continue;
		if (client < 0) { if (stopping) break; goto failure; }
		if (getsockopt(client, SOL_SOCKET, SO_PEERCRED, &credential, &length) < 0 ||
		    length != sizeof(credential) || credential.uid != Z2M_PEER_UID) { close(client); continue; }
		if (z2m_read_request(client, &request) == 0) {
			z2m_supervise(client, &request, &result);
			if (strcmp(result.reason ? result.reason : "", "client_disconnect"))
				(void)z2m_write_response(client, &request, &result);
			z2m_free_result(&result);
			z2m_free_request(&request);
		}
		close(client);
	}
	return 0;

failure:
	fprintf(stderr, "z2m-helperd: %s\n", strerror(errno));
	cleanup();
	return 1;
}
