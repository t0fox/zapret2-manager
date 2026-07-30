#!/bin/sh
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 '
echo "=== service-dns.uc md5 ==="
md5sum /usr/libexec/zapret2-manager/service-dns.uc
echo "=== service-dns.uc lines ==="
wc -l /usr/libexec/zapret2-manager/service-dns.uc
echo "=== search parse failed ==="
grep -n "parse failed" /usr/libexec/zapret2-manager/service-dns.uc || echo "not found"
echo "=== rpcd restart ==="
/etc/init.d/rpcd restart
sleep 1
echo "=== retry service_dns_providers ==="
ubus call zapret2-manager service_dns_providers | head -3
echo "=== retry service_dns_status ==="
ubus call zapret2-manager service_dns_status | head -3
' 2>&1
