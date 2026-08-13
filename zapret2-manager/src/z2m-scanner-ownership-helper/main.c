#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <linux/netlink.h>
#include <sys/socket.h>

#include "ownership.h"

static void print_version(void) {
    printf("z2m-scanner-ownership-helper v0.1.0 (netlink skeleton)\n");
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--version") == 0) {
        print_version();
        return 0;
    }

    /* Open netlink socket to verify basic lifecycle works */
    int fd = socket(AF_NETLINK, SOCK_RAW, NETLINK_NETFILTER);
    if (fd < 0) {
        perror("netlink socket");
        return 70;
    }
    close(fd);

    printf("ownership helper netlink ready\n");
    return 0;
}
