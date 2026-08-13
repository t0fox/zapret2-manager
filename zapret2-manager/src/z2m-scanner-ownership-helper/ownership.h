#ifndef OWNERSHIP_H
#define OWNERSHIP_H

#include <stdint.h>

/* ownership_create_table: create nft table with NFT_TABLE_F_OWNER, no PERSIST */
int ownership_create_table(const char *table_name, const char *owner_token);

/* ownership_delete_table: delete table (primary ownership primitive) */
int ownership_delete_table(const char *table_name, const char *owner_token);

/* ownership_report_ready: verify ownership and report ready status */
int ownership_report_ready(const char *table_name, const char *owner_token);

#endif
