#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/src/z2m-scanner-firewall-helper.c"
TMP=${TMPDIR:-/tmp}/z2m-a1-rules.$$
BIN="$TMP/z2m-scanner-firewall-helper"

fail() { printf '%s\n' "FAIL: $1" >&2; exit 1; }
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

mkdir -p "$TMP"
JSON_C_FLAGS=$(pkg-config --cflags json-c 2>/dev/null || true)
JSON_C_LIBS=$(pkg-config --libs json-c 2>/dev/null || printf '%s' '-ljson-c')
cc $JSON_C_FLAGS -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE -DZ2M_SCANNER_HELPER_TEST "$SRC" $JSON_C_LIBS -o "$BIN"

table=z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef
nonce=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
operation_id=session:candidate:1

request() {
    printf '%s\n' "{\"protocolVersion\":2,\"requestId\":\"$1\",\"operation\":\"$2\",\"arguments\":$3}"
}
base_args="{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\"}"
prepare_args="{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\",\"generation\":1,\"queue\":301,\"profile\":\"tcp_https\"}"
enable_args="{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\",\"generation\":1,\"queue\":301,\"profile\":\"tcp_https\"}"

{
    request create ownership_create "$base_args"
    request prepare rules_prepare "$prepare_args"
    request enable rules_enable "$enable_args"
} |
    "$BIN" >"$TMP/lifecycle.out" 2>/dev/null || true
grep -Fq '"created":true' "$TMP/lifecycle.out" || fail 'OWNER create did not succeed'

grep -Fq '"prepared":true' "$TMP/lifecycle.out" || fail 'bounded rules_prepare did not succeed'
grep -Fq '"queue":301' "$TMP/lifecycle.out" || fail 'rules_prepare did not return the server-owned queue'
grep -Fq '"profile":"tcp_https"' "$TMP/lifecycle.out" || fail 'rules_prepare did not return the bounded profile'
grep -Fq '"chainName":"z2m_' "$TMP/lifecycle.out" || fail 'rules_prepare did not return a helper-owned chain identity'

grep -Fq '"enabled":true' "$TMP/lifecycle.out" || fail 'bounded rules_enable did not succeed'
grep -Fq '"queue":301' "$TMP/lifecycle.out" || fail 'rules_enable did not retain the exact queue'

request bad-table rules_prepare "{\"tableName\":\"zapret2\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\",\"generation\":1,\"queue\":301,\"profile\":\"tcp_https\"}" |
    "$BIN" >"$TMP/bad-table.out" 2>/dev/null || true
grep -Fq '"code":"ESCHEMA"' "$TMP/bad-table.out" || fail 'arbitrary table was accepted'

request bad-queue rules_prepare "{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\",\"generation\":1,\"queue\":1,\"profile\":\"tcp_https\"}" |
    "$BIN" >"$TMP/bad-queue.out" 2>/dev/null || true
grep -Fq '"code":"ESCHEMA"' "$TMP/bad-queue.out" || fail 'arbitrary queue was accepted'

request bad-profile rules_prepare "{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\",\"generation\":1,\"queue\":301,\"profile\":\"raw_nft\"}" |
    "$BIN" >"$TMP/bad-profile.out" 2>/dev/null || true
grep -Fq '"code":"ESCHEMA"' "$TMP/bad-profile.out" || fail 'arbitrary profile/rule selector was accepted'

printf '%s\n' 'PASS: bounded A1 rule protocol and server-owned inputs'
