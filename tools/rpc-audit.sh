#!/bin/sh
echo "=== dns_get ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ubus call zapret2-manager dns_get' 2>/dev/null | python3 -c "
import sys,json
data=json.load(sys.stdin)
# redact
for k in ['ubus_rpc_session']:
    if k in data: data[k]='REDACTED'
print(json.dumps(data, indent=2))
" 2>/dev/null || ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ubus call zapret2-manager dns_get' 2>/dev/null | head -40

echo ""
echo "=== service_dns_providers (first 20 lines)==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ubus call zapret2-manager service_dns_providers' 2>/dev/null | head -20

echo ""
echo "=== service_dns_status ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@192.168.1.1 'ubus call zapret2-manager service_dns_status' 2>/dev/null | head -20
