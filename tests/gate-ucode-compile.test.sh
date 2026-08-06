#!/bin/sh
# Exercise the real compile gate against disposable shipped-file roots.

set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$HERE/tools/gate-ucode-compile.sh"
UCODE=${UCODE:-ucode}
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gate-ucode-compile-test.XXXXXX") || {
	printf '[gate-ucode-compile selftest] FAIL: unable to create private temporary directory\n' >&2
	exit 1
}

cleanup() {
	rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

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

new_case export-in-comment
cat >"$SRC_ROOT/comment.uc" <<'EOF'
/*
export const not_a_module = true;
*/
return { valid: true };
EOF
if run_gate && grep -F 'comment.uc' "$CASE_ROOT/output" >/dev/null; then
	report_ok 'export text in a block comment does not misclassify a script'
else
	report_fail 'export text in a block comment misclassified a valid script'
fi

new_case quoted-module-path
mkdir -p "$SRC_ROOT/quote'path"
cat >"$SRC_ROOT/quote'path/valid.uc" <<'EOF'
export const answer = 42;
EOF
if run_gate && grep -F "quote'path/valid.uc" "$CASE_ROOT/output" >/dev/null; then
	report_ok 'module path containing a quote is encoded safely'
else
	report_fail 'module path containing a quote broke the import wrapper'
fi

new_case broken-standalone-script
cat >"$SRC_ROOT/broken.uc" <<'EOF'
return { broken: ; };
EOF
if run_gate; then
	report_fail 'broken standalone script did not red the gate'
elif grep -F 'broken.uc' "$CASE_ROOT/output" >/dev/null &&
	grep -F 'Syntax error' "$CASE_ROOT/output" >/dev/null &&
	grep -F '[gate-ucode-compile] direct compile diagnostics:' "$CASE_ROOT/output" >/dev/null &&
	grep -F '[gate-ucode-compile] import wrapper diagnostics:' "$CASE_ROOT/output" >/dev/null; then
	report_ok 'broken standalone script reds with compiler stderr'
else
	report_fail 'broken standalone script failure omitted compiler stderr'
fi

new_case missing-compiler
if UCODE="$CASE_ROOT/does-not-exist" run_gate; then
	report_fail 'missing compiler with empty roots did not red the gate'
elif [ "$(grep -c 'compiler.*not.*available' "$CASE_ROOT/output")" -eq 1 ]; then
	report_ok 'missing compiler fails once before enumeration'
else
	report_fail 'missing compiler did not produce one availability failure'
fi

new_case newline-source-path
newline_file=$(printf '%s/line\nbreak.uc' "$SRC_ROOT")
printf 'return true;\n' >"$newline_file"
if run_gate; then
	report_fail 'newline-containing source path did not red the gate'
elif [ "$(grep -c 'unsupported newline in shipped ucode path' "$CASE_ROOT/output")" -eq 1 ]; then
	report_ok 'newline-containing source path fails closed before manifest use'
else
	report_fail 'newline-containing source path lacked one clear diagnostic'
fi

new_case sorted-enumeration
printf 'return true;\n' >"$SRC_ROOT/z-last.uc"
printf 'return true;\n' >"$SRC_ROOT/a-first.uc"
if run_gate &&
	[ "$(grep '\[gate-ucode-compile\] ok' "$CASE_ROOT/output" | sed -n '1s|.*/||p')" = 'a-first.uc' ] &&
	[ "$(grep '\[gate-ucode-compile\] ok' "$CASE_ROOT/output" | sed -n '2s|.*/||p')" = 'z-last.uc' ]; then
	report_ok 'recursive enumeration is sorted in C locale'
else
	report_fail 'recursive enumeration was not sorted in C locale'
fi

exit "$fail"
