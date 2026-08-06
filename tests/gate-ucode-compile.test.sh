#!/bin/sh
# Exercise the real compile gate against disposable shipped-file roots.

set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$HERE/tools/gate-ucode-compile.sh"
UCODE=${UCODE:-ucode}
TMP_ROOT=${TMPDIR:-/tmp}/gate-ucode-compile-test.$$

cleanup() {
	rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$TMP_ROOT"
fail=0

new_case() {
	CASE_ROOT="$TMP_ROOT/$1"
	SRC_ROOT="$CASE_ROOT/src"
	RPCD_ROOT="$CASE_ROOT/rpcd"
	mkdir -p "$SRC_ROOT" "$RPCD_ROOT"
}

run_gate() {
	SRC_ROOT="$SRC_ROOT" RPCD_ROOT="$RPCD_ROOT" UCODE="$UCODE" \
		"$GATE" >"$CASE_ROOT/output" 2>&1
}

report_ok() {
	printf '[gate-ucode-compile selftest] ok: %s\n' "$1"
}

report_fail() {
	printf '[gate-ucode-compile selftest] FAIL: %s\n' "$1"
	cat "$CASE_ROOT/output"
	fail=1
}

new_case nested-valid-module
mkdir -p "$SRC_ROOT/core"
cat >"$SRC_ROOT/core/valid.uc" <<'EOF'
export const answer = 42;
EOF
if run_gate && grep -F 'core/valid.uc' "$CASE_ROOT/output" >/dev/null; then
	report_ok 'nested valid export module is green'
else
	report_fail 'nested valid export module was not compiled successfully'
fi

new_case nested-broken-module
mkdir -p "$SRC_ROOT/core"
cat >"$SRC_ROOT/core/broken.uc" <<'EOF'
export const broken = {
EOF
if run_gate; then
	report_fail 'nested broken module did not red the gate'
elif grep -F 'core/broken.uc' "$CASE_ROOT/output" >/dev/null; then
	report_ok 'nested broken module reds the gate'
else
	report_fail 'nested broken module failed without identifying the file'
fi

new_case valid-rpcd-script
cat >"$RPCD_ROOT/valid.uc" <<'EOF'
return { valid: { ping: { call: function() { return 'pong'; } } } };
EOF
if run_gate && grep -F 'valid.uc' "$CASE_ROOT/output" >/dev/null; then
	report_ok 'valid standalone rpcd return signature is green'
else
	report_fail 'valid standalone rpcd return signature was not compiled successfully'
fi

new_case broken-standalone-script
cat >"$SRC_ROOT/broken.uc" <<'EOF'
return { broken: ; };
EOF
if run_gate; then
	report_fail 'broken standalone script did not red the gate'
elif grep -F 'broken.uc' "$CASE_ROOT/output" >/dev/null &&
	grep -F 'Syntax error' "$CASE_ROOT/output" >/dev/null; then
	report_ok 'broken standalone script reds with compiler stderr'
else
	report_fail 'broken standalone script failure omitted compiler stderr'
fi

exit "$fail"
