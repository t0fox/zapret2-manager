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
#include <sys/syscall.h>
#include <sys/un.h>
#include <unistd.h>

#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1U << 0)
#endif

static volatile sig_atomic_t stopping;
static int listener = -1;
static int lock_fd = -1;
static int runtime_fd = -1;
static dev_t socket_dev;
static ino_t socket_ino;

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
	    (descriptor.st_mode & 0777) != 0600 || descriptor.st_uid != Z2M_RUNTIME_UID ||
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
	    (descriptor.st_mode & 0777) != 0600 || descriptor.st_uid != Z2M_RUNTIME_UID ||
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

static int rename_noreplace(const char *old_name, const char *new_name)
{
	return (int)syscall(SYS_renameat2, runtime_fd, old_name, runtime_fd, new_name,
		RENAME_NOREPLACE);
}

static int remove_safe_stale_socket(void)
{
	struct stat before, current, after;
	char reservation[64], quarantine[64];
	int reservation_fd = -1;
	int saved_errno;
	bool moved = false;
	/*
	 * The verified runtime is root:root 0700 and the singleton lock is held, so
	 * only another privileged actor can race these names. O_EXCL reserves a
	 * unique attempt and RENAME_NOREPLACE prevents overwriting any quarantine;
	 * an identity mismatch is restored only into an absent original pathname.
	 */
	if (fstatat(runtime_fd, "z2m-helperd.sock", &before, AT_SYMLINK_NOFOLLOW) < 0)
		return errno == ENOENT ? 0 : -1;
	if (!S_ISSOCK(before.st_mode) || before.st_uid != Z2M_RUNTIME_UID ||
	    before.st_gid != Z2M_RUNTIME_GID || (before.st_mode & 0777) != 0600) {
		errno = EPERM;
		return -1;
	}
#ifdef Z2M_TEST_STOP_BEFORE_STALE_REMOVE
	raise(SIGSTOP);
#endif
	if (fstatat(runtime_fd, "z2m-helperd.sock", &current, AT_SYMLINK_NOFOLLOW) < 0 ||
	    current.st_dev != before.st_dev || current.st_ino != before.st_ino ||
	    !S_ISSOCK(current.st_mode) || current.st_uid != Z2M_RUNTIME_UID ||
	    current.st_gid != Z2M_RUNTIME_GID || (current.st_mode & 0777) != 0600) {
		errno = EPERM;
		return -1;
	}
#ifdef Z2M_TEST_STOP_BEFORE_QUARANTINE_RESERVE
	raise(SIGSTOP);
#endif
	for (unsigned int attempt = 0; attempt < 32; attempt++) {
		if (snprintf(reservation, sizeof(reservation), ".z2m-helperd.reserve.%ld.%u",
		    (long)getpid(), attempt) < 0 ||
		    snprintf(quarantine, sizeof(quarantine), ".z2m-helperd.stale.%ld.%u",
		    (long)getpid(), attempt) < 0) return -1;
		reservation_fd = openat(runtime_fd, reservation,
			O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
		if (reservation_fd < 0) {
			if (errno == EEXIST) continue;
			return -1;
		}
		if (close(reservation_fd) < 0) goto reserve_failure;
		reservation_fd = -1;
		if (rename_noreplace("z2m-helperd.sock", quarantine) == 0) {
			moved = true;
			break;
		}
		saved_errno = errno;
		(void)unlinkat(runtime_fd, reservation, 0);
		if (saved_errno != EEXIST) { errno = saved_errno; return -1; }
	}
	if (!moved) { errno = EEXIST; return -1; }
	if (fstatat(runtime_fd, quarantine, &after, AT_SYMLINK_NOFOLLOW) < 0 ||
	    after.st_dev != before.st_dev || after.st_ino != before.st_ino ||
	    !S_ISSOCK(after.st_mode) || after.st_uid != Z2M_RUNTIME_UID ||
	    after.st_gid != Z2M_RUNTIME_GID || (after.st_mode & 0777) != 0600) {
		(void)unlinkat(runtime_fd, reservation, 0);
		errno = EPERM;
		return -1;
	}
	if (unlinkat(runtime_fd, quarantine, 0) < 0) goto reserve_failure;
	if (unlinkat(runtime_fd, reservation, 0) < 0) return -1;
	return 0;

reserve_failure:
	saved_errno = errno;
	if (reservation_fd >= 0) (void)close(reservation_fd);
	(void)unlinkat(runtime_fd, reservation, 0);
	errno = saved_errno;
	return -1;
}

static void cleanup(void)
{
	struct stat st;
	if (listener >= 0) close(listener);
	if (runtime_fd >= 0 && fstatat(runtime_fd, "z2m-helperd.sock", &st, AT_SYMLINK_NOFOLLOW) == 0 &&
	    S_ISSOCK(st.st_mode) && st.st_uid == Z2M_RUNTIME_UID &&
	    st.st_gid == Z2M_RUNTIME_GID && st.st_dev == socket_dev && st.st_ino == socket_ino)
		(void)unlinkat(runtime_fd, "z2m-helperd.sock", 0);
	if (lock_fd >= 0) close(lock_fd);
	if (runtime_fd >= 0) close(runtime_fd);
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
	if (acquire_lock() < 0 || remove_safe_stale_socket() < 0) goto failure;
	memcpy(address.sun_path, Z2M_SOCKET_PATH, strlen(Z2M_SOCKET_PATH) + 1);
	old_umask = umask(0077);
	listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (listener < 0 || bind(listener, (struct sockaddr *)&address, sizeof(address)) < 0) {
		umask(old_umask); goto failure;
	}
	umask(old_umask);
	if (fchmodat(runtime_fd, "z2m-helperd.sock", 0600, 0) < 0 ||
	    fstatat(runtime_fd, "z2m-helperd.sock", &st, AT_SYMLINK_NOFOLLOW) < 0 ||
	    !S_ISSOCK(st.st_mode) || st.st_uid != Z2M_RUNTIME_UID ||
	    st.st_gid != Z2M_RUNTIME_GID ||
	    (st.st_mode & 0777) != 0600) goto failure;
	socket_dev = st.st_dev; socket_ino = st.st_ino;
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
