#!/bin/bash
set -e
# Clean old test, create fresh job, run worker manually
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "
rm -f /tmp/zapret2-manager/service-dns-apply.lock
rm -rf /tmp/zapret2-manager/service-dns-jobs/sdns-wtest

echo '=== Create fresh job ==='
mkdir -p /tmp/zapret2-manager/service-dns-jobs/sdns-wtest
cat > /tmp/zapret2-manager/service-dns-jobs/sdns-wtest/job.json << 'EOF'
{\"operationId\":\"sdns-wtest\",\"phase\":\"queued\",\"rendered\":\"# header\n\",\"records\":[],\"desiredHash\":\"abc\",\"statePath\":\"/etc/zapret2-manager/service-dns-state.json\",\"overridesPath\":\"/etc/zapret2-manager/dns-overrides.hosts\",\"snapDir\":\"/tmp/zapret2-manager/service-dns-jobs/sdns-wtest\",\"jobDir\":\"/tmp/zapret2-manager/service-dns-jobs/sdns-wtest\",\"createdAt\":\"2026-07-31T00:00:00Z\",\"updatedAt\":\"2026-07-31T00:00:00Z\",\"finished\":false,\"timings\":{\"writeMs\":0,\"reloadMs\":0,\"verifyMs\":0,\"rollbackMs\":0,\"totalMs\":0}}
EOF

echo '=== Run worker ==='
/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-apply-worker.uc /tmp/zapret2-manager/service-dns-jobs/sdns-wtest/job.json 2>&1
echo 'RC='\$?

echo '=== Job result ==='
cat /tmp/zapret2-manager/service-dns-jobs/sdns-wtest/job.json
" 2>&1