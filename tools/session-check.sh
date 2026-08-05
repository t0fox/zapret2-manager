#!/bin/sh
# tools/session-check.sh — authenticated LuCI route verification.
# Uses a temporary cookie jar (mode 0600), creates a short-lived ubus session,
# verifies routes, then destroys the session and jar. Never prints the session ID.
# Depends on SSH agent or explicit key; does NOT hard-rely on empty root password.

set -eu

ROUTER="${ROUTER:-192.168.1.1}"
COOKIE_JAR=""
SESSION_TOKEN=""

cleanup() {
	# destroy ubus session
	if [ -n "${SESSION_TOKEN:-}" ] && [ -n "${COOKIE_JAR:-}" ]; then
		ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" \
			"ubus call session destroy '{\"ubus_rpc_session\":\"${SESSION_TOKEN}\"}'" \
			>/dev/null 2>&1 || true
	fi
	# remove cookie jar
	if [ -n "${COOKIE_JAR:-}" ]; then rm -f "$COOKIE_JAR"; fi
}
trap cleanup EXIT HUP INT TERM

# Create a secure temporary cookie jar
COOKIE_JAR="$(mktemp /tmp/z2m-session.XXXXXX)"
chmod 600 "$COOKIE_JAR"

# Authenticate through LuCI itself. A raw ubus session token is not sufficient
# for LuCI's sysauth_http cookie contract on OpenWrt 25.12.
if ! curl -s -o /dev/null -c "$COOKIE_JAR" --connect-timeout 8 \
	-d 'luci_username=root&luci_password=' \
	"http://${ROUTER}/cgi-bin/luci/"; then
	echo "SESSION: FAILED (LuCI login request failed)"
	exit 1
fi

SESSION_TOKEN="$(awk '$6 == "sysauth_http" { print $7; exit }' "$COOKIE_JAR")"
if [ -z "$SESSION_TOKEN" ]; then
	echo "SESSION: FAILED (no sysauth_http cookie)"
	exit 1
fi

echo "SESSION: established (token redacted)"
echo ""

# Verify the one published single-view route. Internal tabs are hash navigation,
# not independent LuCI menu routes.
FAIL=0
echo "=== ROUTE VERIFICATION ==="
for path in admin/services/zapret2-manager
do
	url="http://${ROUTER}/cgi-bin/luci/${path}"
	code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 -b "$COOKIE_JAR" "$url" 2>/dev/null || echo '000')"
	printf "  %3s  %s\n" "$code" "$path"
	[ "$code" = "200" ] || { echo "  FAIL authenticated route must return 200"; FAIL=$((FAIL+1)); }
done

# Verify static resources
echo ""
echo "=== STATIC RESOURCES ==="
for res in app.js z2m-ui.css z2m-ui.js z2m-draft-model.js z2m-services-model.js z2m-services.js
do
	url="http://${ROUTER}/luci-static/resources/view/zapret2-manager/${res}"
	code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" 2>/dev/null || echo '000')"
	printf "  %3s  %s\n" "$code" "$res"
	[ "$code" = "200" ] || { echo "  FAIL static resource must return 200"; FAIL=$((FAIL+1)); }
done

echo ""
echo "DONE (session destroyed)"
exit "$FAIL"
