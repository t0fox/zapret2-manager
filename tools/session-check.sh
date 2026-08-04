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

# Create a short-lived ubus session (5 min)
SESSION_RAW="$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "root@${ROUTER}" \
	'ubus call session create '"'"'{"username":"root","password":"","timeout":300}'"'"' 2>/dev/null)" || {
	echo "SESSION: FAILED (cannot create ubus session)"
	exit 1
}

SESSION_TOKEN="$(echo "$SESSION_RAW" | sed -n 's/.*"ubus_rpc_session":"\([^"]*\)".*/\1/p')"
if [ -z "$SESSION_TOKEN" ]; then
	echo "SESSION: FAILED (no token in response)"
	exit 1
fi

# Write token to cookie jar (secure, never printed)
echo "192.168.1.1	FALSE	/	FALSE	0	sysauth	${SESSION_TOKEN}" > "$COOKIE_JAR"

echo "SESSION: established (token redacted)"
echo ""

# Verify routes
echo "=== ROUTE VERIFICATION ==="
for path in \
	app orchestra-strategy orchestra strategies dns service-dns \
	lists monitor proxy maintenance
do
	url="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager/${path}"
	code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 -b "$COOKIE_JAR" "$url" 2>/dev/null || echo '000')"
	printf "  %3s  %s\n" "$code" "$path"
done

# Verify static resources
echo ""
echo "=== STATIC RESOURCES ==="
for res in app.js z2m-ui.css z2m-ui.js z2m-draft-model.js z2m-services-model.js z2m-services.js
do
	url="http://${ROUTER}/luci-static/resources/view/zapret2-manager/${res}"
	code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" 2>/dev/null || echo '000')"
	printf "  %3s  %s\n" "$code" "$res"
done

echo ""
echo "DONE (session destroyed)"
