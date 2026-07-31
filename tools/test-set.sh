#!/bin/bash
echo '{"selections":{"youtube":"off"}}' | ssh -o StrictHostKeyChecking=no root@192.168.1.1 "cat > /tmp/test-set.json"
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc set /tmp/test-set.json"
