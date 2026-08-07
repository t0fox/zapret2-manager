#!/bin/sh
# tests/runner-selftest.test.sh — negative controls for tools/run-all-tests.sh.
#
# A runner that cannot prove it goes red is not a gate. Each control builds a
# TEMP fixture tree (never a permanent fixture in production tests) and runs
# the runner against it via TEST_ROOT:
#
#   B1  a nested tests/ui/*.test.mjs is discovered and counted
#   B2  a nested tests/strategy/*.test.mjs is discovered and counted
#   B3  an intentionally failing nested Node test makes the runner non-zero
#   B4  a Node SYNTAX CRASH (no TAP totals) makes the runner non-zero and is
#       recorded as a failure, never as pass=0/fail=0 success
#   B5  a failing shell gate makes the runner non-zero
#   B6  one test file runs exactly once
#   B7  directory/file names containing a space do not break discovery
#   B8  a missing expected suite category is an error, not silent success
#
# Run: sh tests/runner-selftest.test.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$HERE/tools/run-all-tests.sh"
NODE="${NODE:-node}"

FIX="$(mktemp -d)" || { echo "selftest: mktemp -d failed" >&2; exit 1; }
trap 'rm -rf "$FIX"' EXIT HUP INT TERM
fails=0

ok()  { printf '[runner-selftest]   PASS  %s\n' "$1"; }
bad() { printf '[runner-selftest]   FAIL  %s\n' "$1" >&2; fails=$((fails+1)); }

passing_node() { # $1 = file
	cat > "$1" <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fixture passes', () => { assert.equal(1, 1); });
EOF
}

# happy_tree DIR — a minimal complete tree: backend + ui + strategy + shell.
happy_tree() {
	mkdir -p "$1/ui" "$1/strategy"
	passing_node "$1/a.test.mjs"
	passing_node "$1/ui/u.test.mjs"
	passing_node "$1/strategy/s.test.mjs"
	printf '#!/bin/sh\nexit 0\n' > "$1/gate.test.sh"
}

run_runner() { # $1 = tree ; output in $FIX/last.out, rc in $rrc (no subshell)
	TEST_ROOT="$1" sh "$RUNNER" > "$FIX/last.out" 2>&1
	rrc=$?
	out="$(cat "$FIX/last.out")"
}

# ---- B1/B2: nested ui/ and strategy/ suites are discovered -------------------
T1="$FIX/t1"; mkdir -p "$T1"; happy_tree "$T1"
run_runner "$T1"
if [ "$rrc" -eq 0 ] \
	&& printf '%s\n' "$out" | grep -q 'FILE ui/u.test.mjs .*cat=ui .*pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'FILE strategy/s.test.mjs .*cat=strategy .*pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'SUBTOTAL ui:            pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'SUBTOTAL strategy:      pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'SUBTOTAL backend(root): pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'SUBTOTAL shell gates:   pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'TOTAL one-line: 4 green, 0 red'; then
	ok "B1+B2: nested ui/ and strategy/ suites discovered, subtotals + total = 4 green (rc=0)"
else
	bad "B1+B2: nested suites not discovered or wrong totals (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

# ---- B3: a failing nested Node test makes the runner non-zero ----------------
T2="$FIX/t2"; mkdir -p "$T2"; happy_tree "$T2"
cat > "$T2/ui/broken.test.mjs" <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fixture fails on purpose', () => { assert.equal(1, 2); });
EOF
run_runner "$T2"
if [ "$rrc" -ne 0 ] \
	&& printf '%s\n' "$out" | grep -q 'FILE ui/broken.test.mjs .*cat=ui .*fail=1' \
	&& printf '%s\n' "$out" | grep -q 'TOTAL one-line: 4 green, 1 red'; then
	ok "B3: failing nested Node test → runner non-zero, counted (rc=$rrc)"
else
	bad "B3: failing nested Node test did not redden the runner (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

# ---- B4: a Node syntax crash reddens (and a no-TAP crash is synthetic fail=1)
T3="$FIX/t3"; mkdir -p "$T3"; happy_tree "$T3"
printf 'this is not valid javascript (((\n' > "$T3/strategy/crash.test.mjs"
out=''; run_runner "$T3"
if [ "$rrc" -ne 0 ] \
	&& printf '%s\n' "$out" | grep -q 'FILE strategy/crash.test.mjs .*cat=strategy .*fail=1' \
	&& printf '%s\n' "$out" | grep -q 'TOTAL one-line: 4 green, 1 red'; then
	ok "B4a: Node syntax crash → runner non-zero, crash counted as a failure (rc=$rrc)"
else
	bad "B4a: syntax crash was not recorded as a failure (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi
# no-TAP variant: node produces garbage output and exits 1 — the runner must
# not parse pass=0/fail=0 as success; exit code alone reddens with a
# synthetic fail=1 (the exact weakness of the old command-substitution runner).
T3B="$FIX/t3b"; mkdir -p "$T3B"; happy_tree "$T3B"
printf '#!/bin/sh\necho garbage-without-any-tap-summary\nexit 1\n' > "$FIX/fake-node.sh"
chmod +x "$FIX/fake-node.sh"
out=''; TEST_ROOT="$T3B" NODE="$FIX/fake-node.sh" sh "$RUNNER" > "$FIX/last.out" 2>&1
rrc=$?
out="$(cat "$FIX/last.out")"
if [ "$rrc" -ne 0 ] \
	&& printf '%s\n' "$out" | grep -q 'FILE a.test.mjs .*fail=1.*CRASH' \
	&& printf '%s\n' "$out" | grep -q 'TOTAL one-line: 1 green, 3 red'; then
	ok "B4b: node exiting 1 with NO TAP summary → synthetic fail=1 per Node file (rc=$rrc)"
else
	bad "B4b: no-TAP crash became pass=0/fail=0 success (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

# ---- B5: a failing shell gate makes the runner non-zero ----------------------
T4="$FIX/t4"; mkdir -p "$T4"; happy_tree "$T4"
printf '#!/bin/sh\nexit 1\n' > "$T4/badgate.test.sh"
run_runner "$T4"
if [ "$rrc" -ne 0 ] \
	&& printf '%s\n' "$out" | grep -q 'FILE badgate.test.sh .*cat=shell .*FAIL' \
	&& printf '%s\n' "$out" | grep -q 'TOTAL one-line: 4 green, 1 red'; then
	ok "B5: failing shell gate → runner non-zero (rc=$rrc)"
else
	bad "B5: failing shell gate did not redden the runner (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

# ---- B6: one test file runs exactly once -------------------------------------
T5="$FIX/t5"; mkdir -p "$T5"; happy_tree "$T5"
run_runner "$T5"
n="$(printf '%s\n' "$out" | grep -c 'FILE a.test.mjs ')"
if [ "$rrc" -eq 0 ] && [ "$n" -eq 1 ]; then
	ok "B6: one test file ran exactly once (seen $n time(s))"
else
	bad "B6: a.test.mjs seen $n times (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

# ---- B7: names containing a space do not break discovery ---------------------
T6="$FIX/t6"; mkdir -p "$T6"; happy_tree "$T6"; mkdir -p "$T6/dir with space"
passing_node "$T6/dir with space/my test.test.mjs"
run_runner "$T6"
if [ "$rrc" -eq 0 ] \
	&& printf '%s\n' "$out" | grep -q 'FILE dir with space/my test.test.mjs .*pass=1 fail=0' \
	&& printf '%s\n' "$out" | grep -q 'TOTAL one-line: 5 green, 0 red'; then
	ok "B7: directory/file names with a space are discovered and counted"
else
	bad "B7: spaced names broke discovery (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

# ---- B8: a missing expected category is an error ------------------------------
T7="$FIX/t7"; mkdir -p "$T7/strategy"   # NO ui/ directory at all
passing_node "$T7/a.test.mjs"
passing_node "$T7/strategy/s.test.mjs"
printf '#!/bin/sh\nexit 0\n' > "$T7/gate.test.sh"
run_runner "$T7"
if [ "$rrc" -ne 0 ] && printf '%s\n' "$out" | grep -q "expected suite category 'ui'"; then
	ok "B8: missing ui/ category → runner error (rc=$rrc), not silent success"
else
	bad "B8: missing category was silently accepted (rc=$rrc)"; printf '%s\n' "$out" | sed 's/^/    /' >&2
fi

if [ "$fails" -eq 0 ]; then
	echo "[runner-selftest] ALL CONTROLS GREEN"
	exit 0
else
	echo "[runner-selftest] $fails CONTROL(S) FAILED" >&2
	exit 1
fi
