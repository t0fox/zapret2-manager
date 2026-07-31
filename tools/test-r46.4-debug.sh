#!/bin/bash
set -e
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "
echo '=== Check worker binary ==='
ls -la /usr/libexec/zapret2-manager/service-dns-apply-worker.uc
echo '=== Check latest job ==='
ls -la /tmp/zapret2-manager/service-dns-jobs/sdns-testrun001/
echo '=== Check job content ==='
cat /tmp/zapret2-manager/service-dns-jobs/sdns-testrun001/job.json
echo '=== Run worker manually ==='
/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-apply-worker.uc /tmp/zapret2-manager/service-dns-jobs/sdns-testrun001/job.json 2>&1
echo 'RC='$?
echo '=== Job after manual run ==='
cat /tmp/zapret2-manager/service-dns-jobs/sdns-testrun001/job.json
echo '=== Check timeout binary ==='
which timeout || echo 'timeout NOT found'
" 2>&1