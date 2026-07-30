#!/bin/sh
# tools/verify-deploy-r38.sh — post-deploy verification (no token exposure)
# Uses a temporary cookie jar; creates and destroys a short-lived ubus session.
# Never prints, logs or persists session tokens.

set -eu

ROUTER="${ROUTER:-192.168.1.1}"
COOKIE_JAR=""
SESSION_TOKEN=""

cleanup() {
	if [ -n "${SESSION_TOKEN:-}" ] && [ -n "${COOKIE_JAR:-}" ]; then
		ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" \
			"ubus call session destroy '{\"ubus_rpc_session\":\"${SESSION_TOKEN}\"}'" \
			>/dev/null 2>&1 || true
	fi
	if [ -n "${COOKIE_JAR:-}" ]; then rm -f "$COOKIE_JAR"; fi
}
trap cleanup EXIT HUP INT TERM

# Create cookie jar
COOKIE_JAR="$(mktemp /tmp/z2m-verify.XXXXXX)"
chmod 600 "$COOKIE_JAR"

# Establish session
SESSION_RAW="$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" \
	'ubus call session create '"'"'{"username":"root","password":"","timeout":300}'"'"' 2>/dev/null)" || true
SESSION_TOKEN="$(echo "$SESSION_RAW" | sed -n 's/.*"ubus_rpc_session":"\([^"]*\)".*/\1/p')"
if [ -n "$SESSION_TOKEN" ]; then
	echo "192.168.1.1	FALSE	/	FALSE	0	sysauth	${SESSION_TOKEN}" > "$COOKIE_JAR"
	echo "=== SESSION: established (token redacted) ==="
	AUTH_FLAG="-b $COOKIE_JAR"
else
	echo "=== SESSION: FAILED — checking static resources only ==="
	AUTH_FLAG=""
fi
echo ""

echo "=== 1. PAGE ROUTE CHECK ==="
for path in \
	overview strategies blockcheck catalog orchestra \
	lists dns service-dns monitor proxy maintenance
do
	url="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager/$path"
	code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 $AUTH_FLAG "$url" 2>/dev/null || echo '000')"
	printf "  %3s  %s\n" "$code" "$path"
done

echo ""
echo "=== 2. STATIC RESOURCES ==="
for res in z2m-ui.css z2m-ui.js dns.js service-dns.js overview.js
do
	url="http://${ROUTER}/luci-static/resources/view/zapret2-manager/$res"
	code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" 2>/dev/null || echo '000')"
	printf "  %3s  %s\n" "$code" "$res"
done

echo ""
echo "=== 3. NON-REGRESSION ==="
echo "TG Proxy:"
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" netstat -tlnp 2>/dev/null | grep 1443 || echo "  NOT LISTENING"
echo "nfqws2:"
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" 'ps | grep nfqws2 | grep -v grep' 2>/dev/null || echo "  NOT RUNNING"
echo "dnsmasq:"
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" 'ps | grep dnsmasq | grep -v grep | head -1' 2>/dev/null || echo "  NOT RUNNING"

echo ""
echo "=== 4. CONFIG HASHES ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" 'md5sum /etc/config/dhcp /etc/config/zapret2 /opt/zapret2/config 2>/dev/null' 2>/dev/null

echo ""
echo "=== 5. PACKAGES ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" 'apk list --installed | grep -E "^zapret2|^luci-app-zapret2|^zapret2-manager "' 2>/dev/null

echo ""
echo "=== DONE (session destroyed) ==="
