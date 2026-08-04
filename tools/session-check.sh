#!/bin/sh
# Authenticated verification for the single Zapret2 Manager LuCI route.
# Creates a short-lived ubus login session, keeps the token in a mode-0600
# cookie jar, verifies the root page and canonical static resources, then
# destroys the session. The token is never printed.

set -eu

ROUTER="${ROUTER:-192.168.1.1}"
ROUTER_USER="${ROUTER_USER:-root}"
ROUTER_PASSWORD="${ROUTER_PASSWORD:-}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"
ROUTE_BASE="http://${ROUTER}/cgi-bin/luci/admin/services/zapret2-manager"
STATIC_BASE="http://${ROUTER}/luci-static/resources/view/zapret2-manager"
COOKIE_JAR=""
SESSION_TOKEN=""
FAIL=0

cleanup() {
	if [ -n "${SESSION_TOKEN:-}" ]; then
		destroy_json="$(SESSION_TOKEN="$SESSION_TOKEN" python3 -c 'import json, os; print(json.dumps({"ubus_rpc_session": os.environ["SESSION_TOKEN"]}))')"
		printf '%s' "$destroy_json" | ssh $SSH_OPTS "${ROUTER_USER}@${ROUTER}" \
			'payload=$(cat); ubus call session destroy "$payload"' >/dev/null 2>&1 || true
	fi
	[ -z "${COOKIE_JAR:-}" ] || rm -f "$COOKIE_JAR"
}
trap cleanup EXIT HUP INT TERM

bad() {
	printf '  FAIL  %s\n' "$1" >&2
	FAIL=$((FAIL + 1))
}

ok() {
	printf '  PASS  %s\n' "$1"
}

COOKIE_JAR="$(mktemp /tmp/z2m-session.XXXXXX)"
chmod 600 "$COOKIE_JAR"

login_json="$(ROUTER_USER="$ROUTER_USER" ROUTER_PASSWORD="$ROUTER_PASSWORD" python3 -c '
import json, os
print(json.dumps({
    "username": os.environ["ROUTER_USER"],
    "password": os.environ["ROUTER_PASSWORD"],
    "timeout": 300,
}))
')"

if SESSION_RAW="$(printf '%s' "$login_json" | ssh $SSH_OPTS "${ROUTER_USER}@${ROUTER}" \
	'payload=$(cat); ubus call session login "$payload"' 2>/dev/null)"; then
	:
else
	printf 'SESSION: FAILED (session login transport failed)\n' >&2
	exit 1
fi

SESSION_TOKEN="$(printf '%s' "$SESSION_RAW" | python3 -c '
import json, sys
try:
    value = json.load(sys.stdin)
except Exception:
    value = {}
print(value.get("ubus_rpc_session") or "")
')"

if [ -z "$SESSION_TOKEN" ]; then
	printf 'SESSION: FAILED (login returned no session token)\n' >&2
	exit 1
fi

printf '%s\tFALSE\t/\tFALSE\t0\tsysauth\t%s\n' "$ROUTER" "$SESSION_TOKEN" > "$COOKIE_JAR"
printf 'SESSION: established (token redacted)\n'

printf '\n=== AUTHENTICATED ROOT ROUTE ===\n'
route_result="$(curl -sS -L --max-redirs 3 -o /dev/null \
	-w '%{http_code} %{url_effective}' --connect-timeout 8 \
	-b "$COOKIE_JAR" "$ROUTE_BASE" 2>/dev/null || true)"
route_code="${route_result%% *}"
route_effective="${route_result#* }"
case "$route_code:$route_effective" in
	200:*'/admin/services/zapret2-manager'*)
		ok "$route_code $route_effective"
		;;
	*)
		bad "root route returned '${route_result:-transport failure}'"
		;;
esac

printf '\n=== CANONICAL STATIC RESOURCES ===\n'
for res in \
	app.js \
	z2m-api.js \
	z2m-shell.js \
	z2m-draft-model.js \
	z2m-services-model.js \
	z2m-services.js \
	z2m-ui.css \
	z2m-components.css
do
	url="${STATIC_BASE}/${res}"
	code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 "$url" 2>/dev/null || true)"
	if [ "$code" = "200" ]; then
		ok "$code $res"
	else
		bad "${code:-transport failure} $res"
	fi
done

printf '\nSESSION: destroyed on exit\n'
[ "$FAIL" -eq 0 ] || exit 1
