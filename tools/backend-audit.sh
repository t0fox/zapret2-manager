#!/bin/sh
echo "=== CATALOG FILES ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ls -la /usr/libexec/zapret2-manager/catalog/ 2>/dev/null'

echo ""
echo "=== service-dns-profiles.json (first 10 lines) ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'head -10 /usr/libexec/zapret2-manager/catalog/service-dns-profiles.json 2>/dev/null'

echo ""
echo "=== service-dns-profiles.json (last 10 lines) ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'tail -10 /usr/libexec/zapret2-manager/catalog/service-dns-profiles.json 2>/dev/null'

echo ""
echo "=== service-dns-profiles.json size ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'wc -c /usr/libexec/zapret2-manager/catalog/service-dns-profiles.json 2>/dev/null'

echo ""
echo "=== Trying to load the catalog (ubus service_dns_providers) ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ubus call zapret2-manager service_dns_providers 2>/dev/null' | head -5

echo ""
echo "=== dnsprov_providers (first 10 lines) ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ubus call zapret2-manager dnsprov_providers 2>/dev/null' | head -10
