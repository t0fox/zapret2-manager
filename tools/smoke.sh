#!/bin/sh
# Infrastructure checks on a live router.
# Default mode is read-only and never runs reboot or Telegram Proxy drills.

set -u

HOST="${DEPLOY_HOST:-192.168.1.1}"
SSH_OPTS="-o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
SCP_OPTS="-O -o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
PASS=0
FAIL=0

log() { printf '[smoke] %s\n' "$*"; }
ok() { printf '[smoke]   PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '[smoke]   FAIL  %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }
die() { printf '[smoke] ERROR: %s\n' "$*" >&2; exit 2; }
say() { printf '%s\n' "$*"; }

approve_or_skip() {
	_label="$1"
	shift
	_prompt="$*"
	if [ "${TGPROXY_APPROVE:-0}" = "1" ]; then
		say "APPROVE $_label"
		log "TGPROXY_APPROVE=1 — auto-approved"
		return 0
	fi
	say "APPROVE $_label"
	printf '[smoke] %s Approved? [y/N] ' "$_prompt"
	read -r _ans
	[ "$_ans" = "y" ] || {
		log "not approved — skipping $_label"
		exit 0
	}
}

ssh_ok() {
	_desc="$1"
	shift
	ssh $SSH_OPTS "root@${HOST}" "$@" >/dev/null 2>&1
	_rc=$?
	[ "$_rc" -eq 255 ] && die "ssh transport failure during: $_desc"
	return "$_rc"
}

ssh_out() {
	_var="$1"
	_desc="$2"
	shift 2
	_val="$(ssh $SSH_OPTS "root@${HOST}" "$@" 2>/dev/null)"
	_rc=$?
	[ "$_rc" -eq 255 ] && die "ssh transport failure during: $_desc"
	eval "$_var=\"\$_val\""
}

want_nz() {
	[ -n "$1" ] && ok "$2" || bad "$2 (empty)"
}

# ---- tgproxy ---------------------------------------------------------------
gate_tgproxy() {
	log "gate tgproxy — approval-gated live drill"
	approve_or_skip "TG PROXY INSTALL" "Run the TG proxy apply, health, lifecycle, rotation and log drill on $HOST"
	ssh_ok "TG package installed" "apk info -e tg-ws-proxy-rs" || {
		bad "tg-ws-proxy-rs is not installed"
		return 1
	}
	ssh_out BASE_CONFIG_SHA "baseline config hash" "sha256sum /opt/zapret2/config | awk '{print \$1}'"
	ssh_out BASE_NFT_LINES "baseline nft lines" "nft list table inet zapret2 | wc -l"
	scp $SCP_OPTS "$(dirname "$0")/tgproxy-drill.sh" "root@${HOST}:/tmp/tgproxy-drill.sh" >/dev/null 2>&1 || die "scp drill failed"
	ssh_ok "chmod drill" "chmod +x /tmp/tgproxy-drill.sh" || die "chmod drill failed"
	if ssh $SSH_OPTS "root@${HOST}" "LAN_IP= BASE_CONFIG_SHA='$BASE_CONFIG_SHA' BASE_NFT_LINES='$BASE_NFT_LINES' sh /tmp/tgproxy-drill.sh all" 2>&1 | sed 's/^/[drill] /'; then
		ok "TG proxy live drill"
	else
		bad "TG proxy live drill"
	fi
	ssh_ok "remove staged drill" "rm -f /tmp/tgproxy-drill.sh" || true
}

# ---- tgproxy-reboot --------------------------------------------------------
gate_tgproxy_reboot() {
	log "gate tgproxy-reboot — separate destructive approval"
	approve_or_skip "TG PROXY REBOOT" "Enable TG proxy autostart and reboot $HOST"
	ssh_ok "TG package installed" "apk info -e tg-ws-proxy-rs" || {
		bad "tg-ws-proxy-rs is not installed"
		return 1
	}
	scp $SCP_OPTS "$(dirname "$0")/tgproxy-drill.sh" "root@${HOST}:/tmp/tgproxy-drill.sh" >/dev/null 2>&1 || die "scp drill failed"
	ssh_ok "chmod drill" "chmod +x /tmp/tgproxy-drill.sh" || die "chmod drill failed"
	ssh_ok "enable autostart" "sh /tmp/tgproxy-drill.sh autostart_enable" || {
		bad "TG proxy autostart enable"
		return 1
	}
	ssh $SSH_OPTS "root@${HOST}" reboot >/dev/null 2>&1
	log "reboot sent; waiting for router"
	i=0
	while [ "$i" -lt 60 ]; do
		sleep 5
		i=$((i + 1))
		if ssh $SSH_OPTS "root@${HOST}" true >/dev/null 2>&1; then
			break
		fi
	done
	[ "$i" -lt 60 ] || die "router did not return within 300 seconds"
	if ssh $SSH_OPTS "root@${HOST}" "sh /tmp/tgproxy-drill.sh autostart_check" 2>&1 | sed 's/^/[drill] /'; then
		ok "TG proxy post-reboot check"
	else
		bad "TG proxy post-reboot check"
	fi
	ssh_ok "disable autostart" "sh /tmp/tgproxy-drill.sh autostart_disable" || true
	ssh_ok "remove staged drill" "rm -f /tmp/tgproxy-drill.sh" || true
}

# ---- tgproxy-uninstall -----------------------------------------------------
gate_tgproxy_uninstall() {
	log "gate tgproxy-uninstall — separate destructive approval"
	approve_or_skip "TG PROXY UNINSTALL" "Uninstall tg-ws-proxy-rs from $HOST"
	ssh_ok "TG package installed" "apk info -e tg-ws-proxy-rs" || {
		log "tg-ws-proxy-rs is not installed"
		exit 0
	}
	ssh_out BASE_CONFIG_SHA "baseline config hash" "sha256sum /opt/zapret2/config | awk '{print \$1}'"
	ssh_out BASE_NFT_LINES "baseline nft lines" "nft list table inet zapret2 | wc -l"
	scp $SCP_OPTS "$(dirname "$0")/tgproxy-drill.sh" "root@${HOST}:/tmp/tgproxy-drill.sh" >/dev/null 2>&1 || die "scp drill failed"
	ssh_ok "chmod drill" "chmod +x /tmp/tgproxy-drill.sh" || die "chmod drill failed"
	if ssh $SSH_OPTS "root@${HOST}" "BASE_CONFIG_SHA='$BASE_CONFIG_SHA' BASE_NFT_LINES='$BASE_NFT_LINES' sh /tmp/tgproxy-drill.sh uninstall" 2>&1 | sed 's/^/[drill] /'; then
		ok "TG proxy uninstall drill"
	else
		bad "TG proxy uninstall drill"
	fi
	ssh_ok "remove staged drill" "rm -f /tmp/tgproxy-drill.sh" || true
}

# Library modules containing export are compiled through an import wrapper.
# CLI scripts are compiled directly. The rpcd plugin is intentionally excluded:
# its valid contract is a returned rpcd signature object and is verified by
# rpcd_plugin_loaded() through the actual loader.
ucode_syntax() {
	log "ucode syntax — libraries through module wrapper, CLI files directly"
	for f in \
		/usr/libexec/zapret2-manager/constants.uc \
		/usr/libexec/zapret2-manager/qlen.uc \
		/usr/libexec/zapret2-manager/apply.uc \
		/usr/libexec/zapret2-manager/apply-cli.uc \
		/usr/libexec/zapret2-manager/lists.uc \
		/usr/libexec/zapret2-manager/lists-cli.uc \
		/usr/libexec/zapret2-manager/status.uc \
		/usr/libexec/zapret2-manager/service.uc \
		/usr/libexec/zapret2-manager/watchdog.uc
	do
		ssh_ok "exists $f" test -f "$f" || {
			bad "missing $f"
			continue
		}
		base="$(basename "$f")"
		dir="$(dirname "$f")"
		tmp="$dir/.smoke-$base"
		ssh_ok "stage $f" "sed '1{/^#!/d}' '$f' > '$tmp'" || {
			bad "cannot stage $f"
			continue
		}
		if ssh_ok "has export $f" "grep -q -- export '$f'"; then
			command="printf 'import * as m from \"%s\";' '$tmp' > '$tmp.wrap'; ucode -c -o /dev/null '$tmp.wrap' >/dev/null 2>&1; rc=\$?; rm -f '$tmp.wrap' '$tmp'; [ \$rc -eq 0 ]"
		else
			command="ucode -c -o /dev/null '$tmp' >/dev/null 2>&1; rc=\$?; rm -f '$tmp'; [ \$rc -eq 0 ]"
		fi
		if ssh_ok "compile $f" "$command"; then
			ok "parse OK: $f"
		else
			bad "parse FAIL: $f"
		fi
	done

	ssh_ok "negative library stage" "printf 'export const broken = function() {\n' > /usr/libexec/zapret2-manager/.smoke-neg-lib.uc"
	if ssh_ok "negative library compile" "printf 'import * as m from \"/usr/libexec/zapret2-manager/.smoke-neg-lib.uc\";' > /usr/libexec/zapret2-manager/.smoke-neg-lib.wrap; ucode -c -o /dev/null /usr/libexec/zapret2-manager/.smoke-neg-lib.wrap >/dev/null 2>&1; rc=\$?; rm -f /usr/libexec/zapret2-manager/.smoke-neg-lib.wrap /usr/libexec/zapret2-manager/.smoke-neg-lib.uc; [ \$rc -eq 0 ]"; then
		bad "negative control: broken library compiled"
	else
		ok "negative control: broken library reddens gate"
	fi
	ssh_ok "negative CLI stage" "printf 'let x = \"unterminated\n' > /usr/libexec/zapret2-manager/.smoke-neg-cli.uc"
	if ssh_ok "negative CLI compile" "ucode -c -o /dev/null /usr/libexec/zapret2-manager/.smoke-neg-cli.uc >/dev/null 2>&1; rc=\$?; rm -f /usr/libexec/zapret2-manager/.smoke-neg-cli.uc; [ \$rc -eq 0 ]"; then
		bad "negative control: broken CLI compiled"
	else
		ok "negative control: broken CLI reddens gate"
	fi
}

rpcd_plugin_loaded() {
	log "rpcd_plugin_loaded — verify no-extension plugin through rpcd"
	if ssh_ok "rpcd object signature" "ubus -v list zapret2-manager >/dev/null 2>&1"; then
		ok "rpcd object zapret2-manager is registered"
	else
		bad "rpcd object zapret2-manager is not registered"
	fi
	if ssh_ok "rpcd status method" "ubus call zapret2-manager status '{}' >/dev/null 2>&1"; then
		ok "rpcd plugin serves status"
	else
		bad "rpcd plugin status call failed"
	fi
}

queue_qlen_match() {
	log "queue_qlen_match — status queue total vs queue 300"
	ssh_out rawq "raw nfnetlink queue" "cat /proc/net/netfilter/nfnetlink_queue"
	rawtotal="$(printf '%s\n' "$rawq" | awk '$1 == 300 { print $3; exit }')"
	[ -n "$rawtotal" ] || {
		bad "queue 300 is absent"
		return
	}
	ssh_out jsq "status queue total" "ubus call zapret2-manager status 2>/dev/null | jsonfilter -e '@.health.queue.queueTotal' 2>/dev/null"
	if [ "$rawtotal" = "$jsq" ]; then
		ok "queueTotal $jsq matches /proc"
	else
		bad "queueTotal '$jsq' does not match /proc '$rawtotal'"
	fi
}

fw_delegation() {
	log "fw_delegation — manager delegates to upstream zapret2 init"
	ssh_out upi "upstream init" "grep -F -- /etc/init.d/zapret2 /usr/libexec/zapret2-manager/service.uc 2>/dev/null"
	want_nz "$upi" "service.uc references upstream init"
	ssh_out sf "start_fw delegation" "grep -E -- 'UPSTREAM_INIT.*start_fw' /usr/libexec/zapret2-manager/service.uc 2>/dev/null"
	want_nz "$sf" "start_fw delegates through UPSTREAM_INIT"
	ssh_out ri "reload_ifsets delegation" "grep -E -- 'UPSTREAM_INIT.*reload_ifsets' /usr/libexec/zapret2-manager/service.uc 2>/dev/null"
	want_nz "$ri" "reload_ifsets delegates through UPSTREAM_INIT"
}

no_fw_stop() {
	log "no_fw_stop — no wholesale firewall stop"
	ssh_out service_hit "service code" "grep -F -- 'service firewall stop' /usr/libexec/zapret2-manager/service.uc 2>/dev/null; true"
	[ -z "$service_hit" ] && ok "service code has no firewall stop" || bad "service code contains firewall stop"
	ssh_out ui_hit "UI code" "grep -rF -- 'service firewall stop' /www/luci-static/resources/view/zapret2-manager/ 2>/dev/null; true"
	[ -z "$ui_hit" ] && ok "UI has no firewall stop" || bad "UI contains firewall stop"
}

menu_acl_shape() {
	log "menu_acl_shape — flat ACL dependency and matching ubus object"
	MENU="luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json"
	ACL="luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json"
	[ -f "$MENU" ] || {
		bad "missing $MENU"
		return
	}
	[ -f "$ACL" ] || {
		bad "missing $ACL"
		return
	}
	if python3 - "$MENU" "$ACL" <<'PY'
import json, sys
menu = json.load(open(sys.argv[1]))
acl = json.load(open(sys.argv[2]))
errors = []
for path, node in menu.items():
    value = (node.get('depends') or {}).get('acl')
    if not isinstance(value, list):
        errors.append('%s depends.acl is not a list' % path)
    elif value != ['zapret2-manager']:
        errors.append('%s depends.acl does not match ubus object' % path)
if list(acl) != ['zapret2-manager']:
    errors.append('ACL top-level key does not match ubus object')
read = (((acl.get('zapret2-manager') or {}).get('read') or {}).get('ubus') or {}).get('zapret2-manager')
if not read:
    errors.append('ACL has no read methods for zapret2-manager')
if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
PY
	then
		ok "menu and ACL shape"
	else
		bad "menu or ACL shape"
	fi
}

view_resource_present() {
	log "view_resource_present — root and every imported local module exist"
	if ssh_ok "current single-view resources" '
VIEWS=/www/luci-static/resources/view/zapret2-manager
[ -f "$VIEWS/app.js" ] || exit 1
[ -f "$VIEWS/z2m-ui.css" ] || exit 1
[ -f "$VIEWS/z2m-components.css" ] || exit 1
modules=$(grep -h "^'"'"'require view\.zapret2-manager\." "$VIEWS"/*.js 2>/dev/null | sed -n "s/^'"'"'require view\.zapret2-manager\.\([^ '"'"']*\).*$/\1/p" | sort -u)
for module in $modules; do
    [ -f "$VIEWS/$module.js" ] || exit 1
done
'; then
		ok "app.js, stylesheets and imported view.zapret2-manager modules exist"
	else
		bad "one or more current single-view resources are missing"
	fi
}

lists_paths() {
	log "lists_paths — managed paths are present in exact live flags"
	ssh_out mp_di "manifest domain include" "jsonfilter -i /usr/libexec/zapret2-manager/lists-model.json -e '@.lists.domainInclude.path' 2>/dev/null"
	ssh_out mp_de "manifest domain exclude" "jsonfilter -i /usr/libexec/zapret2-manager/lists-model.json -e '@.lists.domainExclude.path' 2>/dev/null"
	want_nz "$mp_di" "manifest domainInclude.path readable"
	want_nz "$mp_de" "manifest domainExclude.path readable"
	ssh_out pid "nfqws2 pid" "pidof nfqws2 2>/dev/null | tr ' ' '\n' | head -1"
	[ -n "$pid" ] || {
		bad "nfqws2 is not running"
		return
	}
	ssh_out argv "nfqws2 argv" "tr '\0' '\n' < /proc/$pid/cmdline"
	live_di="$(printf '%s\n' "$argv" | sed -n 's/^--hostlist=//p' | sort -u)"
	live_de="$(printf '%s\n' "$argv" | sed -n 's/^--hostlist-exclude=//p' | sort -u)"
	if printf '%s\n' "$live_di" | grep -Fqx -- "$mp_di"; then
		ok "managed domainInclude path is present among exact --hostlist values"
	else
		bad "managed domainInclude path '$mp_di' is absent from exact --hostlist values"
	fi
	if printf '%s\n' "$live_de" | grep -Fqx -- "$mp_de"; then
		ok "managed domainExclude path is present among exact --hostlist-exclude values"
	else
		bad "managed domainExclude path '$mp_de' is absent from exact --hostlist-exclude values"
	fi
	if [ -n "$mp_di" ] && [ -n "$mp_de" ] && [ "$mp_di" != "$mp_de" ]; then
		ok "editable include and exclude paths are distinct"
	else
		bad "editable include and exclude paths collide"
	fi
}

pause_fw_effect() {
	log "pause_fw_effect — informational mutation"
	ssh_ok "ensure running" "ubus call zapret2-manager start >/dev/null" || true
	sleep 1
	ssh_out before "table before" "/etc/init.d/zapret2 list_table 2>/dev/null | wc -l"
	ssh_ok "enter pause" "ubus call zapret2-manager stop >/dev/null" || true
	sleep 2
	ssh_out after "table after" "/etc/init.d/zapret2 list_table 2>/dev/null | wc -l"
	ssh_ok "resume" "ubus call zapret2-manager start >/dev/null" || true
	log "table lines before=$before after=$after"
}

gate_autostart() {
	log "gate autostart — destructive reboot"
	printf '[smoke] This reboots %s. Continue? [y/N] ' "$HOST"
	read -r ans
	[ "$ans" = "y" ] || {
		log "aborted"
		exit 0
	}
	ssh_ok "enable watchdog" "/etc/init.d/zapret2-manager enable" || die "cannot enable watchdog"
	ssh $SSH_OPTS "root@${HOST}" reboot >/dev/null 2>&1
	i=0
	while [ "$i" -lt 60 ]; do
		sleep 5
		i=$((i + 1))
		ssh $SSH_OPTS "root@${HOST}" true >/dev/null 2>&1 && break
	done
	[ "$i" -lt 60 ] || die "router did not return within 300 seconds"
	if ssh_ok "post-boot watchdog" "pgrep -f 'watchdog.uc' >/dev/null 2>&1"; then
		ok "watchdog auto-started"
	else
		bad "watchdog did not auto-start"
	fi
}

# ---- dispatch --------------------------------------------------------------
SELECTION="${1:-all}"
case "$SELECTION" in
  all)
    menu_acl_shape
    view_resource_present
    ucode_syntax
    rpcd_plugin_loaded
    queue_qlen_match
    fw_delegation
    no_fw_stop
    lists_paths
    ;;
  menu_acl_shape|view_resource_present|ucode_syntax|rpcd_plugin_loaded|queue_qlen_match|fw_delegation|no_fw_stop|lists_paths|pause_fw_effect|autostart)
    "$SELECTION"
    ;;
  tgproxy)
    gate_tgproxy
    ;;
  tgproxy-reboot)
    gate_tgproxy_reboot
    ;;
  tgproxy-uninstall)
    gate_tgproxy_uninstall
    ;;
  -h|--help)
    printf '%s\n' "usage: $0 [all|menu_acl_shape|view_resource_present|ucode_syntax|rpcd_plugin_loaded|queue_qlen_match|fw_delegation|no_fw_stop|lists_paths|pause_fw_effect|autostart|tgproxy|tgproxy-reboot|tgproxy-uninstall]"
    exit 0
    ;;
  *)
    die "unknown check: $SELECTION"
    ;;
esac

log "result: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && {
	log "ALL CHECKS GREEN"
	exit 0
}
log "CHECKS FAILED"
exit 1
