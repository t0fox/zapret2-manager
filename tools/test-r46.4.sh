#!/bin/bash
set -e
# Test r46.4 async apply

cat > /tmp/test-e.json << 'EOF'
{"operationId":"sdns-testrun001"}
EOF

ssh -o StrictHostKeyChecking=no root@192.168.1.1 "cat > /tmp/test-e.json" < /tmp/test-e.json
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "echo === apply ===; /usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc apply-async /tmp/test-e.json"
echo "---"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "cat /tmp/zapret2-manager/service-dns-apply.lock 2>/dev/null || echo nolock"
echo "---"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "ls -la /tmp/zapret2-manager/service-dns-jobs/ 2>/dev/null"
echo "---"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "echo === status ===; /usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc apply-status /tmp/test-e.json"
echo "=== done ==="
