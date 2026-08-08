#!/bin/sh
# Non-destructive post-deploy verification for Zapret2 Manager.

set -u

ROUTER="${ROUTER:-${DEPLOY_HOST:-192.168.1.1}}"
ROUTER_USER="${ROUTER_USER:-root}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"
ROUTE_BASE="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager"
STATIC_BASE="http://${ROUTER}/luci-static/resources/view/zapret2-manager"
HERE="$(cd "$(dirname "$0")" && pwd)"
FAIL=0
PASS=0

ok() {
	printf '[deploy-verify]   PASS  %s\n' "$1"
	PASS=$((PASS + 1))
}

bad() {
	printf '[deploy-verify]   FAIL  %s\n' "$1" >&2
	FAIL=$((FAIL + 1))
}

remote_ok() {
	desc="$1"
	shift
	ssh $SSH_OPTS "${ROUTER_USER}@${ROUTER}" "$@" >/dev/null 2>&1
	rc=$?
	if [ "$rc" -eq 0 ]; then
		ok "$desc"
	elif [ "$rc" -eq 255 ]; then
		bad "$desc (SSH transport failure)"
	else
		bad "$desc (remote rc=$rc)"
	fi
}

printf '=== AUTHENTICATED LUCI CHECK ===\n'
printf 'route: %s\n' "$ROUTE_BASE"
if ROUTER="$ROUTER" ROUTER_USER="$ROUTER_USER" \
	ROUTER_PASSWORD="${ROUTER_PASSWORD:-}" "$HERE/session-check.sh"; then
	ok "authenticated root route and canonical assets"
else
	bad "authenticated root route or canonical asset check"
fi

printf '\n=== DIRECT STATIC CHECK ===\n'
for url in \
	"${STATIC_BASE}/app.js" \
	"${STATIC_BASE}/z2m-ui.css" \
	"${STATIC_BASE}/z2m-components.css"
do
	code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 "$url" 2>/dev/null || true)"
	if [ "$code" = "200" ]; then
		ok "$code $url"
	else
		bad "${code:-transport failure} $url"
	fi
done

printf '\n=== ROUTER RUNTIME ===\n'
remote_ok "manager status RPC resolves" "ubus call zapret2-manager status '{}' >/dev/null"
remote_ok "nfqws2 is running" "pidof nfqws2 >/dev/null"
remote_ok "dnsmasq is running" "pidof dnsmasq >/dev/null"
remote_ok "nft table inet zapret2 exists" "nft list table inet zapret2 >/dev/null"
remote_ok "NFQUEUE 300 is registered" "awk '\$1 == 300 { found=1 } END { exit(found ? 0 : 1) }' /proc/net/netfilter/nfnetlink_queue"

printf '\n=== INSTALLED VERSIONS ===\n'
ssh $SSH_OPTS "${ROUTER_USER}@${ROUTER}" \
	"apk list --installed | grep -E '^(luci-app-zapret2-manager|zapret2-manager)'" 2>/dev/null || \
	bad "installed package versions unavailable"

printf '\n=== CONFIG SHA-256 ===\n'
ssh $SSH_OPTS "${ROUTER_USER}@${ROUTER}" \
	"sha256sum /etc/config/dhcp /etc/config/zapret2 /opt/zapret2/config 2>/dev/null" 2>/dev/null || \
	bad "config hashes unavailable"

printf '\n[deploy-verify] result: PASS=%s FAIL=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
