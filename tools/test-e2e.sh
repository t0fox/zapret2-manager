#!/bin/bash
set -e
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "
rm -f /tmp/zapret2-manager/service-dns-apply.lock
rm -rf /tmp/zapret2-manager/service-dns-jobs/sdns-e2etest

echo '=== Submit async apply ==='
echo '{\"operationId\":\"sdns-e2etest\"}' > /tmp/test-e2e.json
/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc apply-async /tmp/test-e2e.json
echo ''

echo '=== Wait 5s for worker ==='
sleep 5

echo '=== Check status ==='
/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc apply-status /tmp/test-e2e.json
echo ''

echo '=== Check lock ==='
cat /tmp/zapret2-manager/service-dns-apply.lock 2>/dev/null || echo 'nolock'
echo ''

echo '=== Check job ==='
cat /tmp/zapret2-manager/service-dns-jobs/sdns-e2etest/job.json
echo ''

echo '=== Check state ==='
cat /etc/zapret2-manager/service-dns-state.json | head -c 500
echo ''

echo '=== Done ==='
" 2>&1