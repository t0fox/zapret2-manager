#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
HELPER="$ROOT/src/z2m-scanner-firewall-helper.c"
ADAPTER="$ROOT/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh"

fail() { printf '%s\n' "FAIL: $1" >&2; exit 1; }

grep -Fq '"protocolVersion", "requestId", "operation", "arguments"' "$HELPER" || fail 'helper does not parse protocol-v2 request envelope'
grep -Fq '"ownership_create"' "$HELPER" || fail 'helper does not implement ownership_create'
grep -Fq '"ownership_ready"' "$HELPER" || fail 'helper does not implement ownership_ready'
grep -Fq '"ownership_delete"' "$HELPER" || fail 'helper does not implement ownership_delete'
grep -Fq '"ownership_status"' "$HELPER" || fail 'helper does not implement ownership_status'
grep -Fq '"protocolVersion"' "$HELPER" || fail 'helper responses omit protocolVersion'
grep -Fq '"error"' "$HELPER" || fail 'helper responses omit structured errors'
grep -Fq 'table_name' "$HELPER" || fail 'canonical helper does not define tableName state'
grep -Fq 'operation_id' "$HELPER" || fail 'canonical helper does not define operationId state'
grep -Fq 'nonce' "$HELPER" || fail 'canonical helper does not define nonce state'
grep -Fq 'queue' "$HELPER" || fail 'canonical helper does not define bounded queue state'
grep -Fq 'NFT_MSG_NEWCHAIN' "$HELPER" || fail 'canonical helper does not create the fixed chain'
grep -Fq 'NFT_MSG_NEWRULE' "$HELPER" || fail 'canonical helper does not create the fixed NFQUEUE rule'
grep -Fq 'ownership_nfqueue_prepare' "$HELPER" || fail 'canonical helper does not implement prepare'
grep -Fq 'ownership_nfqueue_bind' "$HELPER" || fail 'canonical helper does not implement bind'
grep -Fq 'ownership_nfqueue_activate' "$HELPER" || fail 'canonical helper does not implement activate'
cleanup_source=$(sed -n '/^firewall_delete_owned()/,/^}/p' "$ADAPTER")
if printf '%s\n' "$cleanup_source" | grep -Fq 'compare_delete'; then
	 fail 'runtime adapter still invokes retired compare_delete'
fi
if printf '%s\n' "$cleanup_source" | grep -Fq 'zapret2'; then
	 fail 'runtime adapter still declares shared TABLE=zapret2 for A1 cleanup'
fi
grep -Fq 'ownership_create' "$ADAPTER" || fail 'runtime adapter does not invoke ownership_create'
grep -Fq 'ownership_ready' "$ADAPTER" || fail 'runtime adapter does not invoke ownership_ready'
grep -Fq 'ownership_delete' "$ADAPTER" || fail 'runtime adapter does not invoke ownership_delete'
grep -Fq 'helper.pid' "$ADAPTER" || fail 'runtime adapter has no retained helper identity'
grep -Fq 'helper.transport' "$ADAPTER" || fail 'runtime adapter has no private helper transport metadata'

printf '%s\n' 'PASS: A1 helper protocol and runtime integration contract'
