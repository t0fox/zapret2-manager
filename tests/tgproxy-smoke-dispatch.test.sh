#!/bin/sh
# tests/tgproxy-smoke-dispatch.test.sh — structural dispatch checks for
# tools/smoke.sh tgproxy gates. Uses line-number-based extraction.
#
# Run: sh tests/tgproxy-smoke-dispatch.test.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE="$HERE/tools/smoke.sh"
DRILL="$HERE/tools/tgproxy-drill.sh"
[ -f "$SMOKE" ] || { echo "FATAL: $SMOKE not found" >&2; exit 2; }
[ -f "$DRILL" ] || { echo "FATAL: $DRILL not found" >&2; exit 2; }

fails=0
ok()  { printf '[smoke-dispatch]   PASS  %s\n' "$1"; }
bad() { printf '[smoke-dispatch]   FAIL  %s\n' "$1" >&2; fails=$((fails+1)); }

# ---- helper: extract lines between two regex patterns (exclusive) -----------
extract_between() {
	local file="$1" start_pat="$2" end_pat="$3"
	local s e
	s=$(grep -n "$start_pat" "$file" | head -1 | cut -d: -f1)
	e=$(grep -n "$end_pat" "$file" | head -1 | cut -d: -f1)
	[ -z "$s" ] && { echo ""; return; }
	[ -z "$e" ] && e=$(wc -l < "$file")
	s=$((s + 1))
	[ "$e" -gt "$s" ] && sed -n "${s},$((e - 1))p" "$file" || echo ""
}

# ---- D1: gate function definitions exist ------------------------------------
echo "[smoke-dispatch] SUITE D1 — function definitions"
for fn in gate_tgproxy gate_tgproxy_reboot gate_tgproxy_uninstall; do
	grep -q "^${fn}()" "$SMOKE" && ok "$fn defined" || bad "$fn NOT defined"
done

# ---- D2: dispatch case includes all three ------------------------------------
echo "[smoke-dispatch] SUITE D2 — dispatch case entries"
if grep -q "tgproxy|tgproxy-reboot|tgproxy-uninstall)" "$SMOKE"; then
	ok "all three tgproxy gates in dispatch case"
else
	for gate in tgproxy tgproxy-reboot tgproxy-uninstall; do
		grep -qF "$gate" "$SMOKE" && ok "'$gate' mentioned" || bad "'$gate' MISSING"
	done
fi

# ---- D3: none in 'all' block ------------------------------------------------
echo "[smoke-dispatch] SUITE D3 — excluded from 'all'"
all_block=$(sed -n '/^  all)/,/^    ;;$/p' "$SMOKE")
for gate in tgproxy tgproxy-reboot tgproxy-uninstall; do
	if echo "$all_block" | grep -qF "$gate"; then
		bad "'$gate' FOUND in 'all'"
	else
		ok "'$gate' NOT in 'all'"
	fi
done

# ---- D4: gate_tgproxy isolation ---------------------------------------------
echo "[smoke-dispatch] SUITE D4 — gate_tgproxy isolation"
tgproxy_body=$(extract_between "$SMOKE" "^gate_tgproxy()" "^gate_tgproxy_reboot()")
# Check for actual "apk del" command (not in comment)
echo "$tgproxy_body" | grep -qF "apk del" && bad "gate_tgproxy has 'apk del'" || ok "gate_tgproxy no 'apk del'"
# Check for "reboot" as a word (not in comment, not tgproxy-reboot)
echo "$tgproxy_body" | grep -v "^[[:space:]]*#" | grep -qE "(^|[^a-z])reboot([^a-z]|$)" && bad "gate_tgproxy has 'reboot'" || ok "gate_tgproxy no 'reboot'"

# ---- D5: gate_tgproxy_reboot isolation --------------------------------------
echo "[smoke-dispatch] SUITE D5 — gate_tgproxy_reboot isolation"
reboot_body=$(extract_between "$SMOKE" "^gate_tgproxy_reboot()" "^gate_tgproxy_uninstall()")
echo "$reboot_body" | grep -v "^[[:space:]]*#" | grep -qF "apk del" && bad "gate_tgproxy_reboot has 'apk del'" || ok "gate_tgproxy_reboot no 'apk del'"

# ---- D6: gate_tgproxy_uninstall delegates to drill uninstall phase ----------
echo "[smoke-dispatch] SUITE D6 — gate_tgproxy_uninstall delegates uninstall"
start2=$(grep -n "^gate_tgproxy_uninstall()" "$SMOKE" | cut -d: -f1)
end2=$(grep -n "^# ---- dispatch" "$SMOKE" | cut -d: -f1)
[ -z "$end2" ] && end2=$(wc -l < "$SMOKE")
uninstall_body=$(sed -n "$((start2+1)),$((end2-1))p" "$SMOKE" 2>/dev/null | tr -d '\000-\010\016-\037')
echo "$uninstall_body" | grep -q "tgproxy-drill.sh.*uninstall" && ok "gate_tgproxy_uninstall delegates to drill uninstall" || bad "gate_tgproxy_uninstall MISSING uninstall delegation"
echo "$uninstall_body" | grep -q "approve_or_skip \"TG PROXY UNINSTALL\"" && ok "gate_tgproxy_uninstall uses approve_or_skip" || bad "gate_tgproxy_uninstall MISSING approve_or_skip"

# ---- D7: approve_or_skip calls ---------------------------------------------------
echo "[smoke-dispatch] SUITE D7 — approve_or_skip calls"
for label in "TG PROXY INSTALL" "TG PROXY REBOOT" "TG PROXY UNINSTALL"; do
	grep -qF "approve_or_skip \"$label\"" "$SMOKE" && ok "approve_or_skip '$label'" || bad "approve_or_skip '$label' MISSING"
done

# ---- D8: drill 'all' excludes uninstall/autostart ---------------------------
echo "[smoke-dispatch] SUITE D8 — drill 'all' phase boundary"
all_drill=$(sed -n '/^	all)/,/^		;;$/p' "$DRILL")
echo "$all_drill" | grep -q "phase_uninstall" && bad "drill 'all' includes uninstall" || ok "drill 'all' excludes uninstall"
echo "$all_drill" | grep -q "autostart" && bad "drill 'all' includes autostart" || ok "drill 'all' excludes autostart"

# ---- D9: drill uninstall dispatch -------------------------------------------
echo "[smoke-dispatch] SUITE D9 — uninstall dispatch"
# The drill uses a single case line: pre|apply|...|disable|uninstall|autostart_*) "phase_$PHASE" ;;
if grep -q "^	pre|apply.*uninstall|" "$DRILL"; then
	ok "uninstall is in drill dispatch"
else
	bad "uninstall MISSING from drill dispatch"
fi

# ---- D10: all block does not call tgproxy functions -------------------------
echo "[smoke-dispatch] SUITE D10 — 'all' does not call tgproxy"
for call in gate_tgproxy gate_tgproxy_reboot gate_tgproxy_uninstall tgproxy; do
	echo "$all_block" | grep -qF "$call" && bad "'all' calls '$call'" || ok "'all' does not call '$call'"
done

echo "----------------------------------------"
if [ "$fails" -eq 0 ]; then
	echo "[smoke-dispatch] ALL DISPATCH CONTROLS GREEN"
	exit 0
else
	echo "[smoke-dispatch] $fails CONTROL(S) FAILED" >&2
	exit 1
fi
