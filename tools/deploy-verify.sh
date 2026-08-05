#!/bin/sh
set -u

HOST="${DEPLOY_HOST:-192.168.1.1}"
ROUTE_BASE="http://${HOST}/cgi-bin/luci"
STATIC_BASE="http://${HOST}/luci-static/resources/view/zapret2-manager"
FAIL=0

echo "=== AUTHENTICATED ROUTE CHECK ==="
ROUTER="$HOST" "$(dirname "$0")/session-check.sh" || FAIL=$((FAIL+1))

echo "=== UNAUTHENTICATED ROUTE EVIDENCE (403 is expected) ==="
for p in \
  admin/services/zapret2-manager/app \
  admin/services/zapret2-manager/orchestra-strategy \
  admin/services/zapret2-manager/strategies \
  admin/services/zapret2-manager/orchestra \
  admin/services/zapret2-manager/lists \
  admin/services/zapret2-manager/dns \
  admin/services/zapret2-manager/service-dns \
  admin/services/zapret2-manager/monitor \
  admin/services/zapret2-manager/proxy \
  admin/services/zapret2-manager/maintenance
do
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${ROUTE_BASE}/$p" 2>/dev/null)
  echo "  $code $p"
done

echo "=== STATIC RESOURCE CHECK (canonical URL, exact 200 required) ==="
for res in app.js z2m-ui.css z2m-components.css z2m-draft-model.js z2m-services-model.js z2m-services.js
do
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "${STATIC_BASE}/${res}" 2>/dev/null)
  echo "  $code asset ${res}"
  [ "$code" = "200" ] || FAIL=$((FAIL+1))
done

echo "=== POST-DEPLOY VERIFICATION ==="
echo "TG Proxy:"
ssh -o StrictHostKeyChecking=no "root@${HOST}" netstat -tlnp 2>/dev/null | grep 1443
echo "nfqws2:"
ssh -o StrictHostKeyChecking=no "root@${HOST}" 'ps | grep nfqws2 | grep -v grep | head -2' 2>/dev/null
echo "dnsmasq:"
ssh -o StrictHostKeyChecking=no "root@${HOST}" 'ps | grep dnsmasq | grep -v grep' 2>/dev/null
echo "=== INSTALLED VERSIONS ==="
ssh -o StrictHostKeyChecking=no "root@${HOST}" 'apk list --installed | grep zapret2' 2>/dev/null
echo "=== CONFIG HASHES ==="
ssh -o StrictHostKeyChecking=no "root@${HOST}" 'md5sum /etc/config/dhcp /etc/config/zapret2 /opt/zapret2/config 2>/dev/null' 2>/dev/null
echo "=== DONE ==="
exit "$FAIL"
