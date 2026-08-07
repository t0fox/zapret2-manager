#!/bin/sh
# tests/tgproxy-drill-negative-control.test.sh — structural and logic tests
# for tools/tgproxy-drill.sh. Tests the drill's dispatch, phase boundaries,
# key helper functions (jqok, lan_ip, proxy_listeners), and that each phase
# contains both ok() and bad() calls (can go green and red).
#
# Run: sh tests/tgproxy-drill-negative-control.test.sh

set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DRILL="$HERE/tools/tgproxy-drill.sh"
[ -f "$DRILL" ] || { echo "FATAL: $DRILL not found" >&2; exit 2; }

FIX="$(mktemp -d)" || { echo "FATAL: mktemp -d failed" >&2; exit 1; }
trap 'rm -rf "$FIX"' EXIT HUP INT TERM

fails=0
ok()  { printf '[tgproxy-neg]   PASS  %s\n' "$1"; }
bad() { printf '[tgproxy-neg]   FAIL  %s\n' "$1" >&2; fails=$((fails+1)); }

echo "[tgproxy-neg] SUITE A — dispatch and phase boundaries"

# A1: all phases have a phase_<name> function and are in the dispatch case
dispatch_line=$(grep -n "^	pre|" "$DRILL" | head -1)
for phase in pre apply health lifecycle independence rotate logs disable uninstall autostart_enable autostart_check autostart_disable; do
	has_func=$(grep -c "^phase_${phase}()" "$DRILL" 2>/dev/null || echo 0)
	in_dispatch=$(echo "$dispatch_line" | grep -c "${phase}" 2>/dev/null || echo 0)
	if [ "$has_func" -ge 1 ] && [ "$in_dispatch" -ge 1 ]; then
		ok "phase '$phase' defined + in dispatch"
	else
		bad "phase '$phase' missing (func=$has_func dispatch=$in_dispatch)"
	fi
done

# A2: 'all' mode excludes uninstall and autostart phases
all_block=$(sed -n '/^	all)/,/^		;;$/p' "$DRILL")
echo "$all_block" | grep -q "phase_uninstall" && bad "all mode includes phase_uninstall" || ok "all mode excludes phase_uninstall"
echo "$all_block" | grep -q "autostart" && bad "all mode includes autostart" || ok "all mode excludes autostart"

# A3: each phase contains both ok() and bad() (can go green and red)
for phase in pre apply health lifecycle independence rotate logs disable uninstall; do
	phase_body=$(awk "/^phase_${phase}\(\)/{p=1;next} /^phase_[a-z]/{if(p) p=0} p{print}" "$DRILL")
	has_ok=$(echo "$phase_body" | grep -c 'ok "')
	has_bad=$(echo "$phase_body" | grep -c 'bad "')
	if [ "$has_ok" -ge 1 ] && [ "$has_bad" -ge 1 ]; then
		ok "phase $phase: ok=$has_ok bad=$has_bad (can go both ways)"
	else
		bad "phase $phase: ok=$has_ok bad=$has_bad (missing one branch)"
	fi
done

echo "[tgproxy-neg] SUITE B — helper function logic"

# B1: jqok uses jsonfilter -e @.ok to extract the ok field
JQOK=$(grep -A2 "^jqok()" "$DRILL")
echo "$JQOK" | grep -q "jsonfilter -e '@.ok'" && ok "jqok uses jsonfilter -e @.ok" || bad "jqok pattern unrecognized"

# B2: lan_ip uses ip -o -4 addr show br-lan
LAN_IP_PATTERN=$(grep -A4 "^lan_ip()" "$DRILL")
echo "$LAN_IP_PATTERN" | grep -q "br-lan" && ok "lan_ip resolves via br-lan" || bad "lan_ip not using br-lan"
echo "$LAN_IP_PATTERN" | grep -q "ip.*-o.*-4.*addr" && ok "lan_ip uses ip -o -4 addr" || bad "lan_ip not using correct ip syntax"

# B3: proxy_pid uses pidof
grep -q "pidof.*tg-ws-proxy" "$DRILL" && ok "proxy_pid uses pidof" || bad "proxy_pid not using pidof"

# B4: proxy_listeners checks /proc via netstat
grep -q "netstat.*-tulpn" "$DRILL" && ok "proxy_listeners uses netstat -tulpn" || bad "proxy_listeners not using netstat"

echo "[tgproxy-neg] SUITE C — secret containment patterns"

# C1: logs phase redacts secret — check both exact-match and hex-token
log_body=$(awk "/^phase_logs\(\)/{p=1;next} /^phase_[a-z]/{if(p) p=0} p{print}" "$DRILL")
echo "$log_body" | grep -qF '$s1' && ok "logs phase checks exact secret match" || bad "logs phase missing exact secret check"
echo "$log_body" | grep -qE "tg://" && ok "logs phase checks tg:// links" || bad "logs phase missing tg:// check"
echo "$log_body" | grep -qE "hex.*token|\[0-9a-f\]\{32" && ok "logs phase checks 32-hex tokens" || bad "logs phase missing hex token check"

# C2: diagnostics_export is checked for secret
echo "$log_body" | grep -q "diagnostics_export" && ok "logs phase checks diagnostics_export" || bad "logs phase missing diagnostics_export check"

# C3: secret never appears in ok/bad messages (only compared/redacted)
SECRET_MSG=$(grep -c "SECRET\|a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" "$DRILL")
# Count only in actual message strings (inside "")
MSG_SECRET=$(grep -o '"[^"]*SECRET[^"]*"' "$DRILL" | grep -v "SECRET_CONF\|SECRET=" | wc -l)
[ "$MSG_SECRET" -eq 0 ] && ok "no secret value in drill messages" || bad "secret value found in drill messages: $MSG_SECRET"

echo "[tgproxy-neg] SUITE D — independence patterns"

# D1: independence phase checks nfqws2 pid stability
indep_body=$(awk "/^phase_independence\(\)/{p=1;next} /^phase_[a-z]/{if(p) p=0} p{print}" "$DRILL")
echo "$indep_body" | grep -q "pidof.*nfqws2" && ok "independence checks nfqws2 pid" || bad "independence missing nfqws2 pid check"
echo "$indep_body" | grep -q "zapret2 restart" && ok "independence checks zapret2 restart" || bad "independence missing zapret2 restart check"

echo "[tgproxy-neg] SUITE E — uninstall isolation"

# E1: uninstall checks manager packages survive
uninstall_body=$(awk "/^phase_uninstall\(\)/{p=1;next} /^phase_[a-z]/{if(p) p=0} p{print}" "$DRILL")
echo "$uninstall_body" | grep -q "apk info -e zapret2-manager" && ok "uninstall checks manager intact" || bad "uninstall missing manager intact check"
echo "$uninstall_body" | grep -q "apk info -e luci-app-zapret2-manager" && ok "uninstall checks luci intact" || bad "uninstall missing luci intact check"
echo "$uninstall_body" | grep -q "nfqws2" && ok "uninstall checks nfqws2 alive" || bad "uninstall missing nfqws2 check"

echo "[tgproxy-neg] SUITE F — smoke.sh dispatch structure"

# F1: gate_tgproxy does NOT call "apk del" or "reboot" as actual commands
SMOKE="$HERE/tools/smoke.sh"
[ -f "$SMOKE" ] || { echo "FATAL: $SMOKE not found" >&2; exit 2; }
start=$(grep -n "^gate_tgproxy()" "$SMOKE" | cut -d: -f1)
end=$(grep -n "^gate_tgproxy_reboot()" "$SMOKE" | cut -d: -f1)
tgproxy_body=$(sed -n "$((start+1)),$((end-1))p" "$SMOKE")
echo "$tgproxy_body" | grep -v "^[[:space:]]*#" | grep -qF "apk del" && bad "gate_tgproxy calls 'apk del'" || ok "gate_tgproxy no 'apk del'"
echo "$tgproxy_body" | grep -v "^[[:space:]]*#" | grep -v "tgproxy-reboot" | grep -qE "(^|[^a-z])reboot([^a-z]|$)" && bad "gate_tgproxy calls 'reboot'" || ok "gate_tgproxy no 'reboot'"

# F2: gate_tgproxy_uninstall delegates to drill uninstall phase
start2=$(grep -n "^gate_tgproxy_uninstall()" "$SMOKE" | cut -d: -f1)
end2=$(grep -n "^# ---- dispatch" "$SMOKE" | cut -d: -f1)
[ -z "$end2" ] && end2=$(wc -l < "$SMOKE")
uninstall_body=$(sed -n "$((start2+1)),$((end2-1))p" "$SMOKE" | tr -d '\000-\010\016-\037')
echo "$uninstall_body" | grep -q "tgproxy-drill.sh.*uninstall" && ok "gate_tgproxy_uninstall delegates to drill uninstall" || bad "gate_tgproxy_uninstall MISSING uninstall delegation"
echo "$uninstall_body" | grep -q "approve_or_skip" && ok "gate_tgproxy_uninstall uses approve_or_skip" || bad "gate_tgproxy_uninstall MISSING approve_or_skip"

# F3: all block excludes tgproxy gates
all_block=$(sed -n '/^  all)/,/^    ;;$/p' "$SMOKE")
for gate in tgproxy tgproxy-reboot tgproxy-uninstall; do
	echo "$all_block" | grep -qF "$gate" && bad "'all' includes '$gate'" || ok "'all' excludes '$gate'"
done

echo "[tgproxy-neg] SUITE G — proxy_quick_install wiring"

# G1: proxycfg_quick_install exported in proxycfg.uc
PCFG="$HERE/zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc"
grep -q "export const proxycfg_quick_install = function" "$PCFG" && ok "proxycfg_quick_install exported in proxycfg.uc" || bad "proxycfg_quick_install MISSING from proxycfg.uc"

# G2: proxy_quick_install registered in rpcd plugin
RPC="$HERE/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc"
grep -q "proxy_quick_install:" "$RPC" && ok "proxy_quick_install registered in rpcd plugin" || bad "proxy_quick_install MISSING from rpcd plugin"

# G3: proxy_quick_install in ACL write list
ACL="$HERE/luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json"
grep -q "proxy_quick_install" "$ACL" && ok "proxy_quick_install in ACL write list" || bad "proxy_quick_install MISSING from ACL"

# G4: quick_install mode in proxy-cli.uc dispatch
PCLI="$HERE/zapret2-manager/files/usr/libexec/zapret2-manager/proxy-cli.uc"
grep -q "quick_install" "$PCLI" && ok "quick_install mode in proxy-cli.uc" || bad "quick_install MISSING from proxy-cli.uc"

# G5: quick_install function in proxycfg.uc has both ok() and bad()-style paths
# (we check for rollback pattern indicating error handling)
QI_BODY=$(awk '/^export const proxycfg_quick_install = function /{p=1;next} /^export const proxycfg_/{if(p) p=0} p{print}' "$PCFG")
echo "$QI_BODY" | grep -q "rollback_apply" && ok "quick_install has rollback (bad path)" || bad "quick_install MISSING rollback paths"
echo "$QI_BODY" | grep -q "rpc_err" && ok "quick_install has rpc_err (error handling)" || bad "quick_install MISSING rpc_err calls"

echo "----------------------------------------"
if [ "$fails" -eq 0 ]; then
	echo "[tgproxy-neg] ALL CONTROLS GREEN"
	exit 0
else
	echo "[tgproxy-neg] $fails CONTROL(S) FAILED" >&2
	exit 1
fi
