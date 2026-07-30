#!/bin/sh
# Test ucode compatibility on the router
echo "=== ucode -e basic ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "ucode -e 'print(\"hello\")'" 2>&1

echo "=== ucode -e slice ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "ucode -e 'let x = [1,2,3]; print(slice(x,-1)[0])'" 2>&1

echo "=== ucode -e export ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "ucode -e 'export const x = 1; print(x)'" 2>&1

echo "=== ucode service-dns direct check ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 "/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns.uc 2>&1 | head -5" 2>&1
