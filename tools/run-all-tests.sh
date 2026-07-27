#!/bin/sh
# tools/run-all-tests.sh — run EVERY self-test suite under tests/ and print an
# honest total. One command, one deterministic pass:
#
#   tests/*.test.mjs            → backend (root) Node suites
#   tests/ui/*.test.mjs         → UI Node suites
#   tests/strategy/*.test.mjs   → strategy Node suites
#   tests/**/*.test.mjs         → any other real Node suite (bucket: backend)
#   tests/**/*.test.sh          → shell gates (bucket: shell)
#
# Hard rules (each was a defect class in the previous runner):
#   - discovery is RECURSIVE (nested ui/ and strategy/ suites really run) and
#     sorted (LC_ALL=C), each file exactly once, spaces in paths are safe.
#   - a Node process exit code != 0 ALWAYS reddens the file — even when the
#     TAP parser finds no "fail N" (syntax crash, loader error). A crash is
#     recorded as fail=1, never as pass=0/fail=0 "success".
#   - a file whose output carries NO TAP summary at all (and rc=0) is also
#     red: the runner does not trust silent success.
#   - a shell gate exit != 0 reddens the run.
#   - an expected suite category that discovers ZERO files is an ERROR
#     (exit 2), not a silent success.
#   - the printed grand total is exactly the sum of the per-file counts; the
#     per-category subtotals sum to the grand total. Nothing is hardcoded.
#
# Exit: 0 = every discovered suite green; 1 = any test/gate failed;
#       2 = runner error (missing TEST_ROOT, empty expected category).
#
# TEST_ROOT overrides the discovery root (used by tests/runner-selftest.test.sh
# to run the runner against a temp fixture tree). NODE overrides the binary.
#
# Run: tools/run-all-tests.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TEST_ROOT:-$HERE/tests}"
NODE="${NODE:-node}"
EXPECTED_CATEGORIES="backend ui strategy shell"

[ -d "$TEST_ROOT" ] || { echo "ERROR: TEST_ROOT not found: $TEST_ROOT" >&2; exit 2; }

LIST_TMP="$(mktemp)" || { echo "ERROR: mktemp failed" >&2; exit 2; }
trap 'rm -f "$LIST_TMP"' EXIT HUP INT TERM

# ---- discovery: recursive, deterministic, each file once ---------------------
find "$TEST_ROOT" -type f \( -name '*.test.mjs' -o -name '*.test.sh' \) | LC_ALL=C sort > "$LIST_TMP"

# category_of PATH → backend | ui | strategy | shell.
# Extension decides the TYPE first (every .test.sh is a shell gate); for Node
# files the first path component under TEST_ROOT names the bucket, anything
# else nests into backend.
category_of() {
	_rel="${1#$TEST_ROOT/}"
	case "$_rel" in
		*.test.sh) printf 'shell'; return ;;
	esac
	case "$_rel" in
		ui/*)       printf 'ui' ;;
		strategy/*) printf 'strategy' ;;
		*)          printf 'backend' ;;
	esac
}

# ---- counters ----------------------------------------------------------------
backend_p=0 backend_f=0 ui_p=0 ui_f=0 strategy_p=0 strategy_f=0 shell_p=0 shell_f=0
files_backend=0 files_ui=0 files_strategy=0 files_shell=0
run_rc=0   # 1 once any file is red

add_counts() { # $1=category $2=pass $3=fail
	case "$1" in
		backend)  backend_p=$((backend_p+$2));  backend_f=$((backend_f+$3));  files_backend=$((files_backend+1)) ;;
		ui)       ui_p=$((ui_p+$2));            ui_f=$((ui_f+$3));            files_ui=$((files_ui+1)) ;;
		strategy) strategy_p=$((strategy_p+$2)); strategy_f=$((strategy_f+$3)); files_strategy=$((files_strategy+1)) ;;
		shell)    shell_p=$((shell_p+$2));      shell_f=$((shell_f+$3));      files_shell=$((files_shell+1)) ;;
	esac
}

# ---- run every discovered file exactly once ----------------------------------
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#$TEST_ROOT/}"
	cat="$(category_of "$f")"
	case "$f" in
		*.test.mjs)
			out="$("$NODE" --test "$f" 2>&1)"
			rc=$?
			p="$(printf '%s\n' "$out" | sed -n 's/.*ℹ pass \([0-9][0-9]*\).*/\1/p' | tail -1)"
			fa="$(printf '%s\n' "$out" | sed -n 's/.*ℹ fail \([0-9][0-9]*\).*/\1/p' | tail -1)"
			note=""
			if [ "$rc" -ne 0 ]; then
				# process failure (syntax crash, loader error, failing tests):
				# ALWAYS red; without a parsed fail count record a synthetic 1
				# so the arithmetic never shows a crash as pass=0/fail=0.
				if [ -z "$fa" ] || [ "$fa" -eq 0 ]; then fa=1; note=" CRASH(rc=$rc)"; else note=" rc=$rc"; fi
				run_rc=1
			else
				if [ -z "$p" ] || [ -z "$fa" ]; then
					# rc=0 but NO TAP summary: the runner does not trust
					# silent success — output format must be parsed or the
					# file is red.
					p=0; fa=1; note=" NO-TAP-SUMMARY"
					run_rc=1
				elif [ "$fa" -gt 0 ]; then
					# rc=0 with parsed failures: contradictory, treat as red.
					note=" CONTRADICTION(rc=0,fail=$fa)"
					run_rc=1
				fi
			fi
			[ -z "$p" ] && p=0
			[ -z "$fa" ] && fa=0
			add_counts "$cat" "$p" "$fa"
			[ "$fa" -gt 0 ] && run_rc=1
			printf '  FILE %-52s cat=%-8s pass=%s fail=%s%s\n' "$rel" "$cat" "$p" "$fa" "$note"
			;;
		*.test.sh)
			if sh "$f" >/dev/null 2>&1; then
				add_counts "$cat" 1 0
				printf '  FILE %-52s cat=%-8s PASS\n' "$rel" "$cat"
			else
				add_counts "$cat" 0 1
				run_rc=1
				printf '  FILE %-52s cat=%-8s FAIL\n' "$rel" "$cat"
			fi
			;;
	esac
done < "$LIST_TMP"

# ---- expected categories must be non-empty -----------------------------------
runner_error=0
for cat in $EXPECTED_CATEGORIES; do
	eval "n=\$files_$cat"
	if [ "${n:-0}" -eq 0 ]; then
		echo "ERROR: expected suite category '$cat' discovered ZERO test files under $TEST_ROOT" >&2
		runner_error=1
	fi
done
[ "$runner_error" -ne 0 ] && exit 2

# ---- subtotals + grand total (the sum MUST match) ----------------------------
node_p=$((backend_p + ui_p + strategy_p))
node_f=$((backend_f + ui_f + strategy_f))
all_p=$((node_p + shell_p))
all_f=$((node_f + shell_f))

echo
printf 'SUBTOTAL backend(root): pass=%s fail=%s (files=%s)\n' "$backend_p" "$backend_f" "$files_backend"
printf 'SUBTOTAL ui:            pass=%s fail=%s (files=%s)\n' "$ui_p" "$ui_f" "$files_ui"
printf 'SUBTOTAL strategy:      pass=%s fail=%s (files=%s)\n' "$strategy_p" "$strategy_f" "$files_strategy"
printf 'SUBTOTAL shell gates:   pass=%s fail=%s (files=%s)\n' "$shell_p" "$shell_f" "$files_shell"
echo "TOTAL node: pass=$node_p fail=$node_f | shell: pass=$shell_p fail=$shell_f | ALL: pass=$all_p fail=$all_f"
echo "TOTAL one-line: $all_p green, $all_f red"

[ "$run_rc" -eq 0 ] && [ "$all_f" -eq 0 ]
exit $?
