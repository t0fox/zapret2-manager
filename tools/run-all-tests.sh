#!/bin/sh
# tools/run-all-tests.sh — run EVERY self-test suite under tests/ and print an
# honest total. One command, one deterministic pass.

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TEST_ROOT:-$HERE/tests}"
NODE="${NODE:-node}"
EXPECTED_CATEGORIES="backend ui strategy shell"
FAIL_LOG_LINES="${FAIL_LOG_LINES:-120}"

[ -d "$TEST_ROOT" ] || { echo "ERROR: TEST_ROOT not found: $TEST_ROOT" >&2; exit 2; }

LIST_TMP="$(mktemp)" || { echo "ERROR: mktemp failed" >&2; exit 2; }
trap 'rm -f "$LIST_TMP"' EXIT HUP INT TERM

find "$TEST_ROOT" -type f \( -name '*.test.mjs' -o -name '*.test.sh' \) | LC_ALL=C sort > "$LIST_TMP"

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

backend_p=0 backend_f=0 ui_p=0 ui_f=0 strategy_p=0 strategy_f=0 shell_p=0 shell_f=0
files_backend=0 files_ui=0 files_strategy=0 files_shell=0
run_rc=0

add_counts() {
	case "$1" in
		backend)  backend_p=$((backend_p+$2));  backend_f=$((backend_f+$3));  files_backend=$((files_backend+1)) ;;
		ui)       ui_p=$((ui_p+$2));            ui_f=$((ui_f+$3));            files_ui=$((files_ui+1)) ;;
		strategy) strategy_p=$((strategy_p+$2)); strategy_f=$((strategy_f+$3)); files_strategy=$((files_strategy+1)) ;;
		shell)    shell_p=$((shell_p+$2));      shell_f=$((shell_f+$3));      files_shell=$((files_shell+1)) ;;
	esac
}

print_failure_output() {
	_label="$1"
	_text="$2"
	printf '  ---- FAILURE OUTPUT: %s (last %s lines) ----\n' "$_label" "$FAIL_LOG_LINES"
	printf '%s\n' "$_text" | tail -n "$FAIL_LOG_LINES" | sed 's/^/    /'
	printf '  ---- END FAILURE OUTPUT: %s ----\n' "$_label"
}

while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#$TEST_ROOT/}"
	cat="$(category_of "$f")"
	case "$f" in
		*.test.mjs)
			out="$("$NODE" --test "$f" 2>&1)"
			rc=$?
			p="$(printf '%s\n' "$out" | sed -n \
				-e 's/.*ℹ pass \([0-9][0-9]*\).*/\1/p' \
				-e 's/^[[:space:]]*# pass \([0-9][0-9]*\).*/\1/p' | tail -1)"
			fa="$(printf '%s\n' "$out" | sed -n \
				-e 's/.*ℹ fail \([0-9][0-9]*\).*/\1/p' \
				-e 's/^[[:space:]]*# fail \([0-9][0-9]*\).*/\1/p' | tail -1)"
			note=""
			if [ "$rc" -ne 0 ]; then
				if [ -z "$fa" ] || [ "$fa" -eq 0 ]; then fa=1; note=" CRASH(rc=$rc)"; else note=" rc=$rc"; fi
				run_rc=1
			else
				if [ -z "$p" ] || [ -z "$fa" ]; then
					p=0; fa=1; note=" NO-TAP-SUMMARY"
					run_rc=1
				elif [ "$fa" -gt 0 ]; then
					note=" CONTRADICTION(rc=0,fail=$fa)"
					run_rc=1
				fi
			fi
			[ -z "$p" ] && p=0
			[ -z "$fa" ] && fa=0
			add_counts "$cat" "$p" "$fa"
			[ "$fa" -gt 0 ] && run_rc=1
			printf '  FILE %-52s cat=%-8s pass=%s fail=%s%s\n' "$rel" "$cat" "$p" "$fa" "$note"
			if [ "$fa" -gt 0 ] || [ "$rc" -ne 0 ]; then print_failure_output "$rel" "$out"; fi
			;;
		*.test.sh)
			out="$(sh "$f" </dev/null 2>&1)"
			rc=$?
			if [ "$rc" -eq 0 ]; then
				add_counts "$cat" 1 0
				printf '  FILE %-52s cat=%-8s PASS\n' "$rel" "$cat"
			else
				add_counts "$cat" 0 1
				run_rc=1
				printf '  FILE %-52s cat=%-8s FAIL rc=%s\n' "$rel" "$cat" "$rc"
				print_failure_output "$rel" "$out"
			fi
			;;
	esac
done < "$LIST_TMP"

runner_error=0
for cat in $EXPECTED_CATEGORIES; do
	eval "n=\$files_$cat"
	if [ "${n:-0}" -eq 0 ]; then
		echo "ERROR: expected suite category '$cat' discovered ZERO test files under $TEST_ROOT" >&2
		runner_error=1
	fi
done
[ "$runner_error" -ne 0 ] && exit 2

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
