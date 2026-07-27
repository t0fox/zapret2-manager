#!/bin/sh
# tools/run-all-tests.sh — run EVERY self-test suite (no exceptions) and print a one-line total.
#
# Node .mjs suites (via `node --test`) and shell .test.sh gates. The total is
# node-pass + node-fail + shell-pass + shell-fail; the sum of per-suite counts
# MUST equal the total.
#
# Run: tools/run-all-tests.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE=${NODE:-node}

npass=0; nfail=0; spass=0; sfail=0

# ---- node .mjs suites ----
for f in "$HERE"/tests/*.test.mjs; do
	[ -f "$f" ] || continue
	out=$("$NODE" --test "$f" 2>&1)
	p=$(printf '%s' "$out" | sed -n 's/.*ℹ pass \([0-9]*\).*/\1/p' | tr -d ' ')
	[ -z "$p" ] && p=0
	fa=$(printf '%s' "$out" | sed -n 's/.*ℹ fail \([0-9]*\).*/\1/p' | tr -d ' ')
	[ -z "$fa" ] && fa=0
	npass=$((npass + p))
	nfail=$((nfail + fa))
	printf '  %-40s pass=%s fail=%s\n' "$(basename "$f")" "$p" "$fa"
done

# ---- shell .test.sh gates ----
for f in "$HERE"/tests/*.test.sh; do
	[ -f "$f" ] || continue
	if sh "$f" >/dev/null 2>&1; then
		spass=$((spass + 1))
		printf '  %-40s PASS\n' "$(basename "$f")"
	else
		sfail=$((sfail + 1))
		printf '  %-40s FAIL\n' "$(basename "$f")"
	fi
done

echo
echo "TOTAL node: pass=$npass fail=$nfail | shell: pass=$spass fail=$sfail | ALL: pass=$((npass + spass)) fail=$((nfail + sfail))"
echo "TOTAL one-line: $((npass + spass)) green, $((nfail + sfail)) red"

exit $((nfail + sfail))
