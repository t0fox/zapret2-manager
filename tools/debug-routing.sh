#!/bin/bash
set -e
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "rm -f /tmp/zapret2-manager/service-dns-apply.lock"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "rm -rf /tmp/zapret2-manager/service-dns-jobs/sdns-debug"

echo '{"operationId":"sdns-debug"}' > /tmp/debug-e.json
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "cat > /tmp/debug-e.json" < /tmp/debug-e.json

echo "=== Apply (don't wait for worker) ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc apply-async /tmp/debug-e.json" &

sleep 1

echo "=== Routing conf immediately after apply ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "head -5 /etc/zapret2-manager/service-dns-routing.conf 2>/dev/null; wc -l /etc/zapret2-manager/service-dns-routing.conf"

echo "=== Job file immediately ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "python3 -c 'import json; d=json.load(open(\"/tmp/zapret2-manager/service-dns-jobs/sdns-debug/job.json\")); print(len(d.get(\"routingConf\",\"\")), \"chars routingConf\"); print(len(d.get(\"rules\",{})), \"rules\")' 2>/dev/null || echo python3-fail"

echo "=== Wait 8s for worker ==="
sleep 8

echo "=== Routing conf after worker ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "head -5 /etc/zapret2-manager/service-dns-routing.conf; wc -l /etc/zapret2-manager/service-dns-routing.conf"

echo "=== Job file after worker ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "python3 -c 'import json; d=json.load(open(\"/tmp/zapret2-manager/service-dns-jobs/sdns-debug/job.json\")); print(len(d.get(\"routingConf\",\"\")), \"chars routingConf\")' 2>/dev/null || echo fail"