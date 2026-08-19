#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/src/z2m-scanner-firewall-helper.c"
ADAPTER="$ROOT/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh"
TMP=${TMPDIR:-/tmp}/z2m-a1-load-bearing.$$
BIN="$TMP/z2m-scanner-firewall-helper"

fail() { printf '%s\n' "FAIL: $1" >&2; exit 1; }
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

mkdir -p "$TMP"
JSON_C_FLAGS=$(pkg-config --cflags json-c 2>/dev/null || true)
JSON_C_LIBS=$(pkg-config --libs json-c 2>/dev/null || printf '%s' '-ljson-c')
cc $JSON_C_FLAGS -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE -DZ2M_SCANNER_HELPER_TEST "$SRC" $JSON_C_LIBS -o "$BIN" ||
    fail 'canonical helper does not compile'

table=z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef
nonce=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
operation_id=session:candidate:1

request() {
    printf '%s\n' "{\"protocolVersion\":2,\"requestId\":\"$1\",\"operation\":\"$2\",\"arguments\":{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\",\"queue\":300,\"peerPid\":0}}"
}

request malformed-id unknown | "$BIN" >"$TMP/malformed-id.out" 2>/dev/null || true
grep -Fq '"requestId":"malformed-id"' "$TMP/malformed-id.out" ||
    fail 'valid requestId was not echoed on operation/schema failure'

printf '%s\n' "{\"protocolVersion\":2,\"requestId\":\"duplicate\",\"requestId\":\"duplicate\",\"operation\":\"ownership_status\",\"arguments\":{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\"}}" |
    "$BIN" >"$TMP/duplicate.out" 2>/dev/null || true
grep -Fq '"code":"ESCHEMA"' "$TMP/duplicate.out" || fail 'duplicate key was accepted'

printf '%s\n' "{\"protocolVersion\":2,\"requestId\":\"trailing\",\"operation\":\"ownership_status\",\"arguments\":{\"tableName\":\"$table\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\"}} trailing" |
    "$BIN" >"$TMP/trailing.out" 2>/dev/null || true
grep -Fq '"code":"ESCHEMA"' "$TMP/trailing.out" || fail 'trailing data was accepted'

printf '%s\n' "{\"protocolVersion\":2,\"requestId\":\"bad-table\",\"operation\":\"ownership_status\",\"arguments\":{\"tableName\":\"z2m_sc_invalid\",\"operationId\":\"$operation_id\",\"nonce\":\"$nonce\"}}" |
    "$BIN" >"$TMP/bad-table.out" 2>/dev/null || true
grep -Fq '"code":"ESCHEMA"' "$TMP/bad-table.out" || fail 'invalid table name was accepted'

python3 - "$TMP/oversize.in" <<'PY'
from pathlib import Path
Path(__import__('sys').argv[1]).write_bytes(b'{' + b'a' * 4095 + b'}\n')
PY
"$BIN" <"$TMP/oversize.in" >"$TMP/oversize.out" 2>/dev/null || true
grep -Fq '"code":"EREQUESTTOOBIG"' "$TMP/oversize.out" || fail 'oversized request did not return EREQUESTTOOBIG'

{
    request first ownership_status
    request second ownership_status
} | "$BIN" >"$TMP/stream.out" 2>/dev/null || true
[ "$(grep -c '"requestId":"first"' "$TMP/stream.out")" = 1 ] || { cat "$TMP/stream.out" >&2; fail 'first streamed request did not receive one response'; }
[ "$(grep -c '"requestId":"second"' "$TMP/stream.out")" = 1 ] || { cat "$TMP/stream.out" >&2; fail 'second streamed request did not receive one response'; }

grep -Fq '[ "$generation" -le 65535 ]' "$ADAPTER" || fail 'adapter does not reject generation above 65535'
grep -Fq 'wc -c' "$ADAPTER" || fail 'adapter does not assert generated table name length'
if grep -Fq 'journal_required' "$ADAPTER" && grep -Fq 'SESSION_JOURNAL' "$ADAPTER"; then
    fail 'adapter retains canonical journal writes'
fi
if grep -Fq 'case "$response"' "$ADAPTER"; then
    fail 'adapter still validates helper responses by prefix match'
fi

printf '%s\n' 'PASS: canonical load-bearing protocol and adapter contract'
