#!/bin/sh
# tools/tgproxy-drill.sh — router-side live acceptance drill for the optional
# TG WS Proxy. Runs ON the router (scp'd by tools/smoke.sh tgproxy), plain
# busybox ash, every step evidence-based; prints DRILL-PASS / DRILL-FAIL and
# exits non-zero on any failure.
#
# Phases:
#   pre           package/version/binary-hash/trusted-key/inert-on-install
#   apply         functional apply via production ubus (enabled LAN config),
#                 secret 0600/hex32, config 0600, LAN-only listener reread
#   health        proxy_health ok + route meanings (never "Telegram works")
#   lifecycle     restart (pid changes, listener verified) / stop / start
#   independence  proxy_restart never touches nfqws2; zapret2 restart never
#                 touches the proxy
#   rotate        secret rotates (0600, new value, restarted if running)
#   logs          logs_tail carries NO secret and NO tg:// link parameters
#   disable       enabled:false apply stops the service honestly
#   uninstall     apk del removes only own files; manager intact; honest
#                 installed:false afterwards
#
# Env (passed by smoke.sh):
#   LAN_IP            explicit LAN address (auto-detected from br-lan when empty)
#   BASE_CONFIG_SHA   baseline sha256 of /opt/zapret2/config (baseline preserve)
#   BASE_NFT_LINES    baseline `nft list table inet zapret2 | wc -l`
#
# The drill reads the secret FILE (as root) to compare values — allowed: it
# never prints them, only compares/hashes for change detection.

set -u
PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }
ok()  { say "DRILL-PASS  $1"; PASS=$((PASS+1)); }
bad() { say "DRILL-FAIL  $1" >&2; FAIL=$((FAIL+1)); }

PIN_VER='1.6.5-r1'
# binary SHA-256 of the pinned asset's tg-ws-proxy, derived locally from the
# SHA-256-verified tarball (54803f09…dc45a) — the trust anchor, not guessed.
PIN_BIN_SHA256='f45b6206ddb0fc661c58dd168cecb542dc9afa2bdfc48f38cc3e67fc19079bef'

ub() { # ub METHOD [PAYLOAD-JSON] — wraps the payload into the {"edit":"…"}
	# wire form, escaping the quotes (callers pass RAW single-quoted JSON).
	if [ $# -ge 2 ]; then
		local esc; esc=$(printf '%s' "$2" | sed 's/"/\\"/g')
		ubus call zapret2-manager "$1" "{\"edit\":\"$esc\"}"
	else
		ubus call zapret2-manager "$1"
	fi
}

jqok() { printf '%s' "$1" | jsonfilter -e '@.ok' 2>/dev/null; }

lan_ip() {
	if [ -n "${LAN_IP:-}" ]; then printf '%s' "$LAN_IP"; return; fi
	ip -o -4 addr show br-lan 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1
}

proxy_pid() { pidof tg-ws-proxy 2>/dev/null; }

proxy_listeners() { # rows owned by the proxy pid(s)
	local pids; pids=$(proxy_pid)
	[ -n "$pids" ] || return 0
	netstat -tulpn 2>/dev/null | awk -v p="$pids" 'BEGIN{n=split(p,a," ")} {for(i=1;i<=n;i++) if ($0 ~ "/" a[i] "/") print}'
}

phase_pre() {
	local v; v=$(apk info -v tg-ws-proxy-rs 2>/dev/null | head -1)
	[ "$v" = "tg-ws-proxy-rs-$PIN_VER" ] && ok "package version pinned ($v)" || bad "package version ($v) != $PIN_VER"
	local h; h=$(sha256sum /usr/bin/tg-ws-proxy 2>/dev/null | awk '{print $1}')
	[ "$h" = "$PIN_BIN_SHA256" ] && ok "binary SHA-256 matches the pinned asset" || bad "binary SHA-256 mismatch ($h)"
	[ -f /etc/apk/keys/z2m-build.pub ] && ok "trusted signing key present (signed install evidence)" || bad "trusted signing key missing from /etc/apk/keys"
	[ -x /etc/init.d/tg-ws-proxy ] && ok "procd init present" || bad "procd init missing"
	[ -f /usr/share/licenses/tg-ws-proxy-rs/LICENSE ] && ok "MIT license shipped" || bad "license file missing"
	if [ -z "$(proxy_pid)" ]; then ok "no proxy process after install (inert)"; else bad "proxy running without any apply (postinst must not start)"; fi
	if [ ! -f /etc/tg-ws-proxy/config.conf ]; then
		ok "no config before first apply"
	else
		grep -q '^ENABLED=0$' /etc/tg-ws-proxy/config.conf && ok "stock config inert (ENABLED=0)" || say "DRILL-NOTE  config already present (not a fresh install) — inert check skipped"
	fi
}

phase_apply() {
	local ip; ip=$(lan_ip)
	[ -n "$ip" ] || { bad "LAN address undetectable (no br-lan IPv4)"; return 1; }
	local cfg; cfg='{"enabled":true,"autostart":false,"host":"'"$ip"'","port":1443}'
	local out; out=$(ub proxy_config_apply '{"config":'"$cfg"',"expectedAppliedRevision":0}')
	[ "$(jqok "$out")" = "true" ] && ok "proxy_config_apply ok (enabled, host=$ip)" || { bad "apply failed: $out"; return 1; }
	local m; m=$(stat -c %a /etc/tg-ws-proxy/secret.conf 2>/dev/null)
	[ "$m" = "600" ] && ok "secret.conf mode 0600" || bad "secret.conf mode $m != 600"
	local s; s=$(sed -n 's/^SECRET=//p' /etc/tg-ws-proxy/secret.conf 2>/dev/null | head -1 | tr -d '\r')
	if [ "${#s}" -eq 32 ] && ! printf '%s' "$s" | grep -q '[^0-9a-f]'; then
		ok "secret is exactly 32 lowercase hex (value never printed)"
	else
		bad "secret format invalid"
	fi
	m=$(stat -c %a /etc/tg-ws-proxy/config.conf 2>/dev/null)
	[ "$m" = "600" ] && ok "config.conf mode 0600" || bad "config.conf mode $m != 600"
	[ -n "$(proxy_pid)" ] && ok "process running after enabled apply" || bad "no process after enabled apply"
	local lis; lis=$(proxy_listeners)
	printf '%s\n' "$lis" | grep -q "$ip:1443" && ok "LAN-only listener present ($ip:1443)" || bad "expected listener $ip:1443 not found in reread: $lis"
	if printf '%s\n' "$lis" | awk '{print $4}' | grep -qE '^(0\.0\.0\.0|\*|::):'; then
		bad "wildcard listener present (forbidden by v1 policy)"
	else
		ok "no wildcard listener"
	fi
}

phase_health() {
	local out; out=$(ub proxy_health '{}')
	[ "$(jqok "$out")" = "true" ] && ok "proxy_health ok (infra + local route)" || bad "proxy_health not ok: $out"
	printf '%s' "$out" | grep -q 'NOT an MTProto handshake' && ok "upstream route meaning is honest (no end-to-end claim)" || bad "upstream meaning missing"
}

phase_lifecycle() {
	local p1; p1=$(proxy_pid)
	[ -n "$p1" ] || { bad "lifecycle needs a running proxy (run apply first)"; return 1; }
	local out; out=$(ub proxy_restart)
	[ "$(jqok "$out")" = "true" ] && ok "proxy_restart ok" || bad "proxy_restart failed: $out"
	local p2; p2=$(proxy_pid)
	[ -n "$p2" ] && [ "$p2" != "$p1" ] && ok "restart produced a new pid ($p1 -> $p2)" || bad "pid did not change across restart ($p1 -> $p2)"
	local ip; ip=$(lan_ip)
	proxy_listeners | grep -q "$ip:1443" && ok "listener verified after restart" || bad "listener missing after restart"
	out=$(ub proxy_stop)
	[ "$(jqok "$out")" = "true" ] && ok "proxy_stop ok" || bad "proxy_stop failed: $out"
	[ -z "$(proxy_pid)" ] && ok "no process after stop" || bad "process survived stop"
	out=$(ub proxy_start)
	[ "$(jqok "$out")" = "true" ] && ok "proxy_start ok" || bad "proxy_start failed: $out"
	[ -n "$(proxy_pid)" ] && proxy_listeners | grep -q "$ip:1443" && ok "start reread: process + exact listener" || bad "start reread failed"
}

phase_independence() {
	local zp1; zp1=$(pidof nfqws2 2>/dev/null)
	local t1; t1=$(nft list table inet zapret2 2>/dev/null | wc -l)
	local out; out=$(ub proxy_restart)
	[ "$(jqok "$out")" = "true" ] || { bad "proxy_restart failed (independence phase)"; return 1; }
	local zp2; zp2=$(pidof nfqws2 2>/dev/null)
	local t2; t2=$(nft list table inet zapret2 2>/dev/null | wc -l)
	[ "$zp1" = "$zp2" ] && ok "proxy_restart left nfqws2 untouched (pid $zp2)" || bad "nfqws2 pid changed by proxy_restart ($zp1 -> $zp2)"
	[ "$t1" = "$t2" ] && ok "proxy_restart left the zapret2 nft table untouched ($t2 lines)" || bad "nft table changed by proxy_restart ($t1 -> $t2 lines)"
	local pp1; pp1=$(proxy_pid)
	/etc/init.d/zapret2 restart >/dev/null 2>&1
	sleep 3
	local pp2; pp2=$(proxy_pid)
	[ "$pp1" = "$pp2" ] && ok "zapret2 restart left the proxy untouched (pid $pp2)" || bad "proxy pid changed by zapret2 restart ($pp1 -> $pp2)"
}

phase_rotate() {
	local s1; s1=$(sed -n 's/^SECRET=//p' /etc/tg-ws-proxy/secret.conf 2>/dev/null | head -1 | tr -d '\r')
	local out; out=$(ub proxy_secret_rotate)
	[ "$(jqok "$out")" = "true" ] && ok "proxy_secret_rotate ok" || bad "rotate failed: $out"
	local s2; s2=$(sed -n 's/^SECRET=//p' /etc/tg-ws-proxy/secret.conf 2>/dev/null | head -1 | tr -d '\r')
	[ -n "$s1" ] && [ -n "$s2" ] && [ "$s1" != "$s2" ] && ok "secret value rotated (compared, never printed)" || bad "secret did not change across rotate"
	local m; m=$(stat -c %a /etc/tg-ws-proxy/secret.conf 2>/dev/null)
	[ "$m" = "600" ] && ok "rotated secret still 0600" || bad "rotated secret mode $m"
	printf '%s' "$out" | grep -q '"restarted":true' && ok "rotate restarted the running service" || say "DRILL-NOTE  rotate did not restart (service was stopped)"
	local ip; ip=$(lan_ip)
	[ -n "$(proxy_pid)" ] && proxy_listeners | grep -q "$ip:1443" && ok "listener verified after rotate-restart"
}

phase_logs() {
	local s1 s2 out
	s1=$(sed -n 's/^SECRET=//p' /etc/tg-ws-proxy/secret.conf 2>/dev/null | head -1 | tr -d '\r')
	out=$(ub proxy_logs_tail '{"n":200}')
	[ "$(jqok "$out")" = "true" ] || { bad "logs_tail not ok: $out"; return 1; }
	if printf '%s' "$out" | grep -q "$s1"; then bad "logs_tail leaked the current secret"; else ok "logs_tail carries no current secret"; fi
	if printf '%s' "$out" | grep -q 'tg://proxy?server='; then bad "logs_tail leaked a tg:// link with parameters"; else ok "logs_tail redacts tg:// links"; fi
	if printf '%s' "$out" | grep -qE '(dd|ee)?[0-9a-f]{32,}'; then bad "logs_tail leaked a secret-shaped hex token"; else ok "logs_tail redacts secret-shaped tokens"; fi
	out=$(ub diagnostics_export)
	if printf '%s' "$out" | grep -q "$s1"; then bad "diagnostics_export leaked the secret"; else ok "diagnostics_export carries no secret"; fi
}

phase_disable() {
	local out; out=$(ub proxy_config_apply '{"config":{"enabled":false},"expectedAppliedRevision":1}')
	if [ "$(jqok "$out")" != "true" ]; then
		# revision moved since the first apply — re-read and retry once
		local cur; cur=$(ub proxy_config_get)
		local rev; rev=$(printf '%s' "$cur" | jsonfilter -e '@.appliedRevision' 2>/dev/null)
		out=$(ub proxy_config_apply '{"config":{"enabled":false},"expectedAppliedRevision":'"${rev:-1}"'}')
	fi
	[ "$(jqok "$out")" = "true" ] && ok "disable apply ok" || bad "disable apply failed: $out"
	[ -z "$(proxy_pid)" ] && ok "service stopped after disable" || bad "service still running after disable"
	out=$(ub proxy_autostart_set '{"enabled":true}')
	[ "$(jqok "$out")" = "true" ] && ls /etc/rc.d/S*tg-ws-proxy >/dev/null 2>&1 && ok "autostart enable writes rc.d evidence" || bad "autostart enable failed"
	out=$(ub proxy_autostart_set '{"enabled":false}')
	[ "$(jqok "$out")" = "true" ] && ! ls /etc/rc.d/S*tg-ws-proxy >/dev/null 2>&1 && ok "autostart disable removes rc.d evidence" || bad "autostart disable failed"
}

phase_uninstall() {
	apk del tg-ws-proxy-rs >/dev/null 2>&1
	[ ! -e /usr/bin/tg-ws-proxy ] && [ ! -e /etc/init.d/tg-ws-proxy ] && ok "uninstall removed binary + init" || bad "package files survived apk del"
	apk info -e zapret2-manager >/dev/null 2>&1 && ok "zapret2-manager intact after proxy uninstall" || bad "zapret2-manager was removed with the proxy"
	apk info -e luci-app-zapret2-manager >/dev/null 2>&1 && ok "luci-app intact after proxy uninstall" || bad "luci-app was removed with the proxy"
	local out; out=$(ub proxy_status)
	local inst; inst=$(printf '%s' "$out" | jsonfilter -e '@.installed' 2>/dev/null)
	[ "$inst" = "false" ] && ok "honest installed:false after uninstall" || bad "proxy_status.installed not false after uninstall"
	if [ -n "${BASE_CONFIG_SHA:-}" ]; then
		local h; h=$(sha256sum /opt/zapret2/config 2>/dev/null | awk '{print $1}')
		[ "$h" = "$BASE_CONFIG_SHA" ] && ok "router baseline config preserved" || bad "baseline /opt/zapret2/config changed"
	fi
	if [ -n "${BASE_NFT_LINES:-}" ]; then
		local t; t=$(nft list table inet zapret2 2>/dev/null | wc -l)
		[ "$t" = "$BASE_NFT_LINES" ] && ok "router baseline nft table preserved ($t lines)" || bad "baseline nft table changed ($t != $BASE_NFT_LINES)"
	fi
	pidof nfqws2 >/dev/null 2>&1 && ok "nfqws2 alive after proxy uninstall" || bad "nfqws2 down after proxy uninstall"
}

phase_autostart_enable() {
	local out; out=$(ub proxy_autostart_set '{"enabled":true}')
	[ "$(jqok "$out")" = "true" ] && ls /etc/rc.d/S*tg-ws-proxy >/dev/null 2>&1 && ok "autostart enabled (rc.d link present)" || bad "autostart enable failed"
}

phase_autostart_check() {
	local ip; ip=$(lan_ip)
	[ -z "$ip" ] && { bad "LAN address undetectable (no br-lan IPv4)"; return 1; }
	local p; p=$(proxy_pid)
	[ -n "$p" ] && ok "proxy pid=$p after reboot" || { bad "proxy not running after reboot"; return 1; }
	local lis; lis=$(proxy_listeners)
	printf '%s\n' "$lis" | grep -q "$ip:1443" && ok "LAN-only listener $ip:1443 after reboot" || bad "expected listener not found: $lis"
	if printf '%s\n' "$lis" | awk '{print $4}' | grep -qE '^(0\.0\.0\.0|\*|::):'; then
		bad "wildcard listener present after reboot"
	else
		ok "no wildcard listener after reboot"
	fi
}

phase_autostart_disable() {
	local out; out=$(ub proxy_autostart_set '{"enabled":false}')
	[ "$(jqok "$out")" = "true" ] && ! ls /etc/rc.d/S*tg-ws-proxy >/dev/null 2>&1 && ok "autostart disabled (rc.d link removed)" || bad "autostart disable failed"
}

PHASE="${1:-all}"
case "$PHASE" in
	pre|apply|health|lifecycle|independence|rotate|logs|disable|uninstall|autostart_enable|autostart_check|autostart_disable) "phase_$PHASE" ;;
	all)
		phase_pre
		phase_apply
		phase_health
		phase_lifecycle
		phase_independence
		phase_rotate
		phase_logs
		phase_disable
		;;
	*) echo "unknown phase: $PHASE" >&2; exit 2 ;;
esac

say "DRILL-RESULT  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
