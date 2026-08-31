#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

enum selection { SELECT_PERSISTENT, SELECT_RUNTIME, SELECT_ALL };

struct managed_root {
    const char *path;
    enum selection group;
};

static const struct managed_root managed_roots[] = {
    { "/etc/zapret2-manager/state", SELECT_PERSISTENT },
    { "/etc/zapret2-manager/snapshots", SELECT_PERSISTENT },
    { "/etc/zapret2-manager/registry", SELECT_PERSISTENT },
    { "/etc/zapret2-manager/secrets", SELECT_PERSISTENT },
    { "/tmp/zapret2-manager/runtime", SELECT_RUNTIME },
    { "/tmp/zapret2-manager/jobs", SELECT_RUNTIME },
    { "/tmp/zapret2-manager/locks", SELECT_RUNTIME },
    { "/tmp/zapret2-manager/staging", SELECT_RUNTIME },
};

static int report_error(const char *operation, const char *path)
{
    fprintf(stderr, "z2m-root-bootstrap: %s failed for %s: %s\n",
            operation, path, strerror(errno));
    return -1;
}

static gid_t daemon_gid(void)
{
    struct group *daemon_group = getgrnam("daemon");
    return daemon_group != NULL ? daemon_group->gr_gid : 1;
}

static int migrate_legacy_state_root(int fd, const char *path)
{
    struct stat st;

    if (fstat(fd, &st) < 0)
        return report_error("fstat", path);
    if (!S_ISDIR(st.st_mode) || st.st_uid != 0 || st.st_gid != 0 ||
        (st.st_mode & 07777) != 0700)
        return 0;
    if (fchown(fd, 0, daemon_gid()) < 0 || fchmod(fd, 0710) < 0)
        return report_error("legacy state migration", path);
    return 0;
}

static int verify_directory(int fd, const char *path, mode_t required_mode,
                            int exact_mode, int allow_daemon_group)
{
    struct stat st;
    struct group *daemon_group;
    gid_t expected_gid = 0;
    mode_t mode;

    if (fstat(fd, &st) < 0)
        return report_error("fstat", path);
    if (allow_daemon_group) {
        daemon_group = getgrnam("daemon");
        expected_gid = daemon_group != NULL ? daemon_group->gr_gid : daemon_gid();
    }
    mode = st.st_mode & 07777;
    if (!S_ISDIR(st.st_mode) || st.st_uid != 0 ||
        (allow_daemon_group ? st.st_gid != expected_gid : st.st_gid != 0) ||
        (exact_mode ? mode != required_mode : (mode & 0022) != 0)) {
        errno = EPERM;
        return report_error("policy verification", path);
    }
    return 0;
}

static int verify_path_identity(int parent_fd, const char *name, int fd,
                                const char *path)
{
    struct stat descriptor_stat;
    struct stat path_stat;

    if (fstat(fd, &descriptor_stat) < 0 ||
        fstatat(parent_fd, name, &path_stat, AT_SYMLINK_NOFOLLOW) < 0)
        return report_error("identity verification", path);
    if (!S_ISDIR(path_stat.st_mode) ||
        descriptor_stat.st_dev != path_stat.st_dev ||
        descriptor_stat.st_ino != path_stat.st_ino) {
        errno = ESTALE;
        return report_error("identity verification", path);
    }
    return 0;
}

static int may_create(const char *logical_path, int final_component)
{
    return final_component || strcmp(logical_path, "/tmp/zapret2-manager") == 0;
}

static const char *logical_position(const char *traversed, const char *test_root)
{
    size_t length = strlen(test_root);

    if (strncmp(traversed, test_root, length) != 0)
        return NULL;
    if (traversed[length] != '\0' && traversed[length] != '/')
        return NULL;
    return traversed + length;
}

static int open_verified_root(const char *logical_root)
{
    char full_path[PATH_MAX];
    char traversed[PATH_MAX] = "";
    char *component;
    char *saveptr = NULL;
    int current_fd;
#ifdef Z2M_TESTING
    const char *test_root = getenv("Z2M_TEST_ROOT");
#else
    const char *test_root = "";
#endif

#ifdef Z2M_TESTING
    if (test_root == NULL || test_root[0] != '/' ||
        snprintf(full_path, sizeof(full_path), "%s%s", test_root, logical_root) >=
            (int)sizeof(full_path)) {
        errno = EINVAL;
        return report_error("test root selection", logical_root);
    }
#else
    if (snprintf(full_path, sizeof(full_path), "%s", logical_root) >=
        (int)sizeof(full_path)) {
        errno = ENAMETOOLONG;
        return report_error("root selection", logical_root);
    }
#endif

    current_fd = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (current_fd < 0)
        return report_error("open", "/");
    if (verify_directory(current_fd, "/", 0, 0, 0) < 0) {
        close(current_fd);
        return -1;
    }

    component = strtok_r(full_path + 1, "/", &saveptr);
    while (component != NULL) {
        char *next = strtok_r(NULL, "/", &saveptr);
        int final_component = next == NULL;
        int next_fd;
        int state_root;
        const char *logical_position_value;
        size_t used = strlen(traversed);

        if (snprintf(traversed + used, sizeof(traversed) - used, "/%s", component) >=
            (int)(sizeof(traversed) - used)) {
            errno = ENAMETOOLONG;
            report_error("path traversal", logical_root);
            close(current_fd);
            return -1;
        }
        logical_position_value = logical_position(traversed, test_root);
        state_root = strcmp(traversed, "/etc/zapret2-manager/state") == 0 ||
                     (logical_position_value != NULL &&
                      strcmp(logical_position_value,
                             "/etc/zapret2-manager/state") == 0);

        next_fd = openat(current_fd, component,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (next_fd < 0 && errno == ENOENT && logical_position_value != NULL &&
            may_create(logical_position_value, final_component)) {
            if (mkdirat(current_fd, component, state_root ? 0710 : 0700) < 0) {
                report_error("mkdirat", logical_root);
                close(current_fd);
                return -1;
            }
            if (state_root &&
                (fchownat(current_fd, component, 0, daemon_gid(), 0) < 0 ||
                 fchmodat(current_fd, component, 0710, 0) < 0)) {
                report_error("state ownership", logical_root);
                close(current_fd);
                return -1;
            }
            next_fd = openat(current_fd, component,
                             O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        }
        if (next_fd < 0) {
            report_error("openat", logical_root);
            close(current_fd);
            return -1;
        }

        if (verify_path_identity(current_fd, component, next_fd, logical_root) < 0 ||
            (state_root && migrate_legacy_state_root(next_fd, logical_root) < 0) ||
            verify_directory(next_fd, logical_root,
                             strcmp(traversed, "/tmp") == 0 ||
                                     (logical_position_value != NULL &&
                                      strcmp(logical_position_value, "/tmp") == 0)
                                 ? 01777
                                 : state_root ? 0710
                                 : 0700,
                             final_component || strcmp(traversed, "/tmp") == 0 ||
                                 (logical_position_value != NULL &&
                                  (strcmp(logical_position_value, "/tmp") == 0 ||
                                   strcmp(logical_position_value,
                                          "/tmp/zapret2-manager") == 0)),
                             state_root) < 0) {
            close(next_fd);
            close(current_fd);
            return -1;
        }
        close(current_fd);
        current_fd = next_fd;
        component = next;
    }

    close(current_fd);
    return 0;
}

static int selected(enum selection requested, enum selection group)
{
    return requested == SELECT_ALL || requested == group;
}

int main(int argc, char **argv)
{
    enum selection requested;
    mode_t old_umask;
    size_t i;

    if (argc != 2) {
        fprintf(stderr, "usage: z2m-root-bootstrap persistent|runtime|all\n");
        return 2;
    }
    if (strcmp(argv[1], "persistent") == 0)
        requested = SELECT_PERSISTENT;
    else if (strcmp(argv[1], "runtime") == 0)
        requested = SELECT_RUNTIME;
    else if (strcmp(argv[1], "all") == 0)
        requested = SELECT_ALL;
    else {
        fprintf(stderr, "usage: z2m-root-bootstrap persistent|runtime|all\n");
        return 2;
    }
    if (geteuid() != 0) {
        fprintf(stderr, "z2m-root-bootstrap: root privileges required\n");
        return 1;
    }

    old_umask = umask(0);
    for (i = 0; i < sizeof(managed_roots) / sizeof(managed_roots[0]); i++) {
        if (selected(requested, managed_roots[i].group) &&
            open_verified_root(managed_roots[i].path) < 0) {
            umask(old_umask);
            return 1;
        }
    }
    umask(old_umask);
    return 0;
}
