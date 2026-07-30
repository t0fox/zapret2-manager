#!/bin/sh
echo "=== HTTP ROUTE CHECK ==="
for p in \
  admin/services/zapret2-manager/overview \
  admin/services/zapret2-manager/strategies \
  admin/services/zapret2-manager/blockcheck \
  admin/services/zapret2-manager/catalog \
  admin/services/zapret2-manager/orchestra \
  admin/services/zapret2-manager/lists \
  admin/services/zapret2-manager/dns \
  admin/services/zapret2-manager/service-dns \
  admin/services/zapret2-manager/monitor \
  admin/services/zapret2-manager/proxy \
  admin/services/zapret2-manager/maintenance \
  view/zapret2-manager/z2m-ui.css \
  view/zapret2-manager/z2m-ui.js
do
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://192.168.1.1/cgi-bin/luci/$p" 2>/dev/null)
  echo "  $code $p"
done

echo "=== POST-DEPLOY VERIFICATION ==="
echo "TG Proxy:"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 netstat -tlnp 2>/dev/null | grep 1443
echo "nfqws2:"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ps | grep nfqws2 | grep -v grep | head -2' 2>/dev/null
echo "dnsmasq:"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'ps | grep dnsmasq | grep -v grep' 2>/dev/null
echo "=== INSTALLED VERSIONS ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'apk list --installed | grep zapret2' 2>/dev/null
echo "=== CONFIG HASHES ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 'md5sum /etc/config/dhcp /etc/config/zapret2 /opt/zapret2/config 2>/dev/null' 2>/dev/null
echo "=== DONE ==="
