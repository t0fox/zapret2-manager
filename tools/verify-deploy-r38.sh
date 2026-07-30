#!/bin/sh
# tools/verify-deploy-r38.sh — comprehensive post-deploy verification

set -e

echo "=== 1. CREATE LUCI SESSION ==="
SID=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 \
  'ubus call session create '"'"'{"username":"root","timeout":600}'"'" 2>/dev/null \
  | sed -n 's/.*"ubus_rpc_session":"\([^"]*\)".*/\1/p')
echo "Session: ${SID:-FAILED}"

if [ -z "$SID" ]; then
  echo "Cannot create session — checking static resources only"
fi

echo ""
echo "=== 2. PAGE ROUTE CHECK ==="
for path in \
  overview strategies blockcheck catalog orchestra \
  lists dns service-dns monitor proxy maintenance
do
  url="http://192.168.1.1/cgi-bin/luci/admin/services/zapret2-manager/$path"
  if [ -n "$SID" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 --cookie "sysauth=$SID" "$url" 2>/dev/null)
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 "$url" 2>/dev/null)
  fi
  printf "  %3s  %s\n" "$code" "$path"
done

echo ""
echo "=== 3. STATIC RESOURCES ==="
for res in z2m-ui.css z2m-ui.js dns.js service-dns.js overview.js
do
  url="http://192.168.1.1/luci-static/resources/view/zapret2-manager/$res"
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" 2>/dev/null)
  printf "  %3s  %s\n" "$code" "$res"
done

echo ""
echo "=== 4. NON-REGRESSION CHECKS ==="
echo "TG Proxy (should show LISTEN on 1443):"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 netstat -tlnp 2>/dev/null | grep 1443 || echo "  NOT FOUND"
echo ""
echo "nfqws2 (should show running nfqws2):"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ps | grep nfqws2 | grep -v grep' 2>/dev/null || echo "  NOT FOUND"
echo ""
echo "dnsmasq (should be running):"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ps | grep dnsmasq | grep -v grep | head -1' 2>/dev/null || echo "  NOT FOUND"

echo ""
echo "=== 5. CONFIG HASHES (must match pre-deploy) ==="
echo "Pre: dhcp=ce584f6a, zapret2=72d2301a, upstream=6c9f3bc4"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'md5sum /etc/config/dhcp /etc/config/zapret2 /opt/zapret2/config 2>/dev/null' 2>/dev/null

echo ""
echo "=== 6. PACKAGE VERSIONS ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'apk list --installed | grep "^zapret2\|^luci-app-zapret2\|^zapret2-manager "' 2>/dev/null

echo ""
echo "=== 7. INSTALLED FILES CHECK ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ls -la /www/luci-static/resources/view/zapret2-manager/dns.js /www/luci-static/resources/view/zapret2-manager/service-dns.js /etc/zapret2-manager/ 2>/dev/null' 2>/dev/null

echo ""
echo "=== VERIFICATION COMPLETE ==="
