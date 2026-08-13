#include "ownership.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <linux/netlink.h>
#include <linux/netfilter/nf_tables.h>
#include <libmnl/libmnl.h>
#include <libnftnl/table.h>

/* Minimal skeleton: netlink open/close only, no nft operations yet */

int ownership_create_table(const char *table_name, const char *owner_token) {
    (void)owner_token; /* owner_token is for future ownership evidence binding */

    if (!table_name || strlen(table_name) > 62 || strlen(table_name) < 1) {
        return -1; /* fail-closed on invalid input */
    }

    struct mnl_socket *nl = mnl_socket_open(NETLINK_NETFILTER);
    if (!nl) {
        return -1;
    }
    if (mnl_socket_bind(nl, 0, MNL_SOCKET_AUTOPID) < 0) {
        mnl_socket_close(nl);
        return -1;
    }

    struct nftnl_table *t = nftnl_table_alloc();
    if (!t) {
        mnl_socket_close(nl);
        return -1;
    }

    nftnl_table_set_str(t, NFTNL_TABLE_NAME, table_name);
    nftnl_table_set_str(t, NFTNL_TABLE_USERDATA, "z2m_owner");
    nftnl_table_set_u32(t, NFTNL_TABLE_FLAGS, NFT_TABLE_F_OWNER);
    /* Explicitly do NOT set NFT_TABLE_F_PERSIST */

    char buf[MNL_SOCKET_BUFFER_SIZE];
    struct nlmsghdr *nlh = nftnl_table_nlmsg_build_hdr(buf, NFT_MSG_NEWTABLE,
        NFPROTO_INET, NLM_F_CREATE | NLM_F_ACK, 0);
    nftnl_table_nlmsg_build_payload(nlh, t);

    int ret = mnl_socket_sendto(nl, nlh, nlh->nlmsg_len);
    if (ret < 0) {
        nftnl_table_free(t);
        mnl_socket_close(nl);
        return -1;
    }

    ret = mnl_socket_recvfrom(nl, buf, sizeof(buf));
    if (ret < 0) {
        nftnl_table_free(t);
        mnl_socket_close(nl);
        return -1;
    }

    nftnl_table_free(t);
    mnl_socket_close(nl);

    if (ret < 0) return -1;
    return 0; /* success */
}

int ownership_delete_table(const char *table_name, const char *owner_token) {
    (void)table_name; (void)owner_token;
    return -1;
}

int ownership_report_ready(const char *table_name, const char *owner_token) {
    (void)table_name; (void)owner_token;
    return -1;
}

/* Failing unit test for ownership_create_table (TDD Step 1) */
static int test_ownership_create_table(void) {
    /* Valid inputs per protocol-v2.json */
    const char *table = "z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef";
    const char *token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    int rc = ownership_create_table(table, token);

    /* Expect success (0) after implementation; currently stub returns -1 -> test fails */
    if (rc == 0) {
        printf("PASS: ownership_create_table returns 0\n");
        return 0;
    } else {
        printf("FAIL: ownership_create_table returned %d (expected 0)\n", rc);
        return 1;
    }
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    return test_ownership_create_table();
}
