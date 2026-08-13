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
#include <libnftnl/chain.h>
#include <libnftnl/rule.h>
#include <linux/netfilter/nfnetlink_queue.h>

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
    return 0; /* TEMP: wrong behavior to force test failure for TDD */
}

/* Failing unit test for ownership_delete_table (Task 6 Step 1) */
static int test_ownership_delete_table(void) {
    const char *table = "z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef";
    const char *token = "test-token";

    int rc = ownership_delete_table(table, token);

    if (rc != 0) {
        printf("PASS: ownership_delete_table returns non-zero on non-existent table\n");
        return 0;
    } else {
        printf("FAIL: ownership_delete_table returned 0 on non-existent table (expected non-zero fail-closed)\n");
        return 1;
    }
}

int ownership_report_ready(const char *table_name, const char *owner_token) {
    (void)table_name; (void)owner_token;
    return -1;
}

#include <libnftnl/chain.h>
#include <libnftnl/rule.h>
#include <linux/netfilter/nfnetlink_queue.h>

int ownership_install_rules(const char *table_name, uint16_t queue_num, uint32_t mark) {
    if (!table_name || strlen(table_name) > 62 || strlen(table_name) < 1) {
        return -1;
    }
    if (queue_num == 0) {
        return -1;
    }

    struct mnl_socket *nl = mnl_socket_open(NETLINK_NETFILTER);
    if (!nl) {
        return -1;
    }
    if (mnl_socket_bind(nl, 0, MNL_SOCKET_AUTOPID) < 0) {
        mnl_socket_close(nl);
        return -1;
    }

    /* Create chain z2m_sc_<nonce32> inside table */
    char chain_name[64];
    snprintf(chain_name, sizeof(chain_name), "z2m_sc_%.8s", table_name + 54); /* last 8 hex of nonce */

    struct nftnl_chain *c = nftnl_chain_alloc();
    if (!c) {
        mnl_socket_close(nl);
        return -1;
    }
    nftnl_chain_set_str(c, NFTNL_CHAIN_TABLE, table_name);
    nftnl_chain_set_str(c, NFTNL_CHAIN_NAME, chain_name);
    nftnl_chain_set_u32(c, NFTNL_CHAIN_HOOKNUM, NF_INET_FORWARD);
    nftnl_chain_set_s32(c, NFTNL_CHAIN_PRIO, 0);

    char buf[MNL_SOCKET_BUFFER_SIZE];
    struct nlmsghdr *nlh = nftnl_chain_nlmsg_build_hdr(buf, NFT_MSG_NEWCHAIN,
        NFPROTO_INET, NLM_F_CREATE | NLM_F_ACK, 0);
    nftnl_chain_nlmsg_build_payload(nlh, c);

    int ret = mnl_socket_sendto(nl, nlh, nlh->nlmsg_len);
    if (ret < 0) {
        nftnl_chain_free(c);
        mnl_socket_close(nl);
        return -1;
    }
    ret = mnl_socket_recvfrom(nl, buf, sizeof(buf));
    if (ret < 0) {
        nftnl_chain_free(c);
        mnl_socket_close(nl);
        return -1;
    }
    nftnl_chain_free(c);

    /* Create rule: meta mark set <mark> queue num <queue> bypass */
    struct nftnl_rule *r = nftnl_rule_alloc();
    if (!r) {
        mnl_socket_close(nl);
        return -1;
    }
    nftnl_rule_set_str(r, NFTNL_RULE_TABLE, table_name);
    nftnl_rule_set_str(r, NFTNL_RULE_CHAIN, chain_name);

    /* expressions: immediate mark, queue */
    struct nftnl_expr *e_mark = nftnl_expr_alloc("immediate");
    nftnl_expr_set_u32(e_mark, NFTNL_EXPR_IMM_DREG, NFT_REG32_01);
    nftnl_expr_set_u32(e_mark, NFTNL_EXPR_IMM_DATA, mark);
    nftnl_rule_add_expr(r, e_mark);

    struct nftnl_expr *e_set = nftnl_expr_alloc("meta");
    nftnl_expr_set_u32(e_set, NFTNL_EXPR_META_KEY, NFT_META_MARK);
    nftnl_expr_set_u32(e_set, NFTNL_EXPR_META_DREG, NFT_REG32_01);
    nftnl_rule_add_expr(r, e_set);

    struct nftnl_expr *e_queue = nftnl_expr_alloc("queue");
    nftnl_expr_set_u16(e_queue, NFTNL_EXPR_QUEUE_NUM, queue_num);
    nftnl_expr_set_u16(e_queue, NFTNL_EXPR_QUEUE_TOTAL, 1);
    nftnl_expr_set_u16(e_queue, NFTNL_EXPR_QUEUE_FLAGS, NFT_QUEUE_FLAG_BYPASS);
    nftnl_rule_add_expr(r, e_queue);

    nlh = nftnl_rule_nlmsg_build_hdr(buf, NFT_MSG_NEWRULE,
        NFPROTO_INET, NLM_F_CREATE | NLM_F_ACK, 0);
    nftnl_rule_nlmsg_build_payload(nlh, r);

    ret = mnl_socket_sendto(nl, nlh, nlh->nlmsg_len);
    if (ret < 0) {
        nftnl_rule_free(r);
        mnl_socket_close(nl);
        return -1;
    }
    ret = mnl_socket_recvfrom(nl, buf, sizeof(buf));
    if (ret < 0) {
        nftnl_rule_free(r);
        mnl_socket_close(nl);
        return -1;
    }
    nftnl_rule_free(r);
    mnl_socket_close(nl);
    return 0;
}

/* Failing unit test for ownership_create_table (TDD Step 1) */
static int test_ownership_create_table(void) {
    /* Valid inputs per protocol-v2.json (table name ends with 32-char nonce) */
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

/* Failing unit test for ownership_install_rules (Task 5 Step 1) */
static int test_ownership_install_rules(void) {
    const char *table = "z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef";
    uint16_t queue = 1234;
    uint32_t mark = 0xDEAD;

    int rc = ownership_install_rules(table, queue, mark);

    if (rc == 0) {
        printf("PASS: ownership_install_rules returns 0\n");
        return 0;
    } else {
        printf("FAIL: ownership_install_rules returned %d (expected 0)\n", rc);
        return 1;
    }
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    int rc1 = test_ownership_create_table();
    if (rc1 != 0) return rc1;
    return test_ownership_install_rules();
}
