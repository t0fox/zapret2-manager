#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/src/z2m-scanner-firewall-helper.c"
ADAPTER="$ROOT/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh"
TMP=${TMPDIR:-/tmp}/z2m-a1-helper-test.$$
BIN="$TMP/z2m-scanner-firewall-helper"
PROD_BIN="$TMP/z2m-scanner-firewall-helper-production"

fail() { printf '%s\n' "FAIL: $1" >&2; rm -rf "$TMP"; exit 1; }
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

[ -f "$SRC" ] || fail 'canonical helper source is missing'

grep -Fq 'NETLINK_NETFILTER' "$SRC" || fail 'canonical helper does not retain a netfilter socket'
grep -Fq 'NFT_TABLE_F_OWNER' "$SRC" || fail 'canonical helper does not request OWNER'
grep -Fq 'NFNL_MSG_BATCH_BEGIN' "$SRC" || fail 'canonical helper does not begin nftables netlink batches'
grep -Fq 'NFNL_MSG_BATCH_END' "$SRC" || fail 'canonical helper does not end nftables netlink batches'
grep -Fq 'NFTA_TABLE_USERDATA' "$SRC" || fail 'canonical helper has no bounded userdata'
grep -Fq 'kernel_read_back' "$SRC" || fail 'canonical helper does not retain kernel read-back state'
grep -Fq 'NFT_MSG_GETTABLE' "$SRC" || fail 'canonical helper does not verify table state through netlink'
grep -Fq 'kernel_read_back(state, table_name, "", false)' "$SRC" || fail 'delete does not verify kernel table absence'
grep -Fq 'NFT_MSG_NEWTABLE' "$SRC" || fail 'canonical helper does not create tables through netlink'
grep -Fq 'NFT_MSG_DELTABLE' "$SRC" || fail 'canonical helper does not delete through netlink'
grep -Fq '"ownership_create"' "$SRC" || fail 'ownership_create protocol operation is missing'
grep -Fq '"ownership_ready"' "$SRC" || fail 'ownership_ready protocol operation is missing'
grep -Fq '"ownership_delete"' "$SRC" || fail 'ownership_delete protocol operation is missing'
grep -Fq '"ownership_status"' "$SRC" || fail 'ownership_status protocol operation is missing'
grep -Fq '"queue"' "$SRC" || fail 'NFQUEUE queue argument is missing'
grep -Fq 'NFT_MSG_NEWCHAIN' "$SRC" || fail 'NFQUEUE prepare does not create a bounded chain through netlink'
grep -Fq 'NFT_MSG_NEWRULE' "$SRC" || fail 'NFQUEUE prepare does not create a bounded rule through netlink'
grep -Fq 'NFTA_RULE_EXPRESSIONS' "$SRC" || fail 'NFQUEUE rule expression encoding is missing'
grep -Fq 'NFTA_QUEUE_NUM' "$SRC" || fail 'NFQUEUE number encoding is missing'
grep -Fq '"queue"' "$SRC" || fail 'NFQUEUE expression encoding is missing'
grep -Fq 'nfnetlink_queue' "$SRC" || fail 'NFQUEUE bind evidence does not inspect the kernel queue registry'
grep -Fq 'peer_portid' "$SRC" || fail 'NFQUEUE bind evidence does not bind to the exact process peer'
grep -Fq 'RULES_READY' "$ADAPTER" || fail 'adapter does not journal prepared rules'
grep -Fq 'PROCESS_BOUND' "$ADAPTER" || fail 'adapter does not journal bound process'
grep -Fq 'ACTIVE' "$ADAPTER" || fail 'adapter does not journal activation'
if grep -Fq 'EUNSUPPORTED' "$ADAPTER"; then
    fail 'runtime adapter still reports EUNSUPPORTED'
fi
grep -Fq '"protocolVersion"' "$SRC" || fail 'protocol-v2 envelope is missing'
grep -Fq '"arguments"' "$SRC" || fail 'protocol-v2 arguments object is missing'
grep -Fq 'poll(' "$SRC" || fail 'canonical helper is not long-lived'
grep -Fq 'table_created' "$SRC" || fail 'canonical helper lacks one-table process state'
grep -Fq 'NLM_F_EXCL' "$SRC" || fail 'table creation is not exclusive'
grep -Fq 'strcmp(state->operation_id, operation_id)' "$SRC" || fail 'delete does not verify exact operation identity'
grep -Fq 'strlen(value) == 62U' "$SRC" || fail 'dedicated table name is not bounded to the approved format'
if grep -Fq 'execv(' "$SRC" || grep -Fq 'fork(' "$SRC"; then
	 fail 'canonical helper executes arbitrary nft commands'
fi
if grep -Fq 'NFT_TABLE_F_PERSIST' "$SRC"; then
	 fail 'canonical helper requests persistent tables'
fi

mkdir -p "$TMP"
if command -v cc >/dev/null 2>&1; then
	JSON_C_FLAGS=$(pkg-config --cflags json-c 2>/dev/null || true)
	JSON_C_LIBS=$(pkg-config --libs json-c 2>/dev/null || printf '%s' '-ljson-c')
	cc $JSON_C_FLAGS -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE -DZ2M_SCANNER_HELPER_TEST "$SRC" $JSON_C_LIBS -o "$BIN" || fail 'canonical helper does not build with json-c'
	cc $JSON_C_FLAGS -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE "$SRC" $JSON_C_LIBS -o "$PROD_BIN" || fail 'production helper does not build with json-c'
	printf '%s\n' '{"protocolVersion":2,"requestId":"bad","operation":"unknown","arguments":{}}' | "$BIN" >"$TMP/response" 2>/dev/null || true
	grep -Fq '"ok":false' "$TMP/response" || fail 'malformed protocol was not rejected'
else
	printf '%s\n' 'SKIP: compiler unavailable for native build/protocol execution'
fi

printf '%s\n' 'PASS: canonical A1 source/protocol contract'
