#include "ownership.h"
#include <stdio.h>
#include <string.h>

/* Minimal skeleton: netlink open/close only, no nft operations yet */

int ownership_create_table(const char *table_name, const char *owner_token) {
    (void)table_name; (void)owner_token;
    return -1; /* fail-closed until full implementation */
}

int ownership_delete_table(const char *table_name, const char *owner_token) {
    (void)table_name; (void)owner_token;
    return -1;
}

int ownership_report_ready(const char *table_name, const char *owner_token) {
    (void)table_name; (void)owner_token;
    return -1;
}
