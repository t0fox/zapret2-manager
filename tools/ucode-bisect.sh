#!/bin/sh
# Smart fix: compare r37 original vs our fixes, find the ucode issues incrementally
set -e

echo "=== Step 1: Check original r37 compiles ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 '
md5sum /usr/libexec/zapret2-manager/service-dns.uc
# Try compiling with just the first few hundred lines to find the error
head -453 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/test-part1.uc
echo "// placeholder" >> /tmp/test-part1.uc
echo "export const dummy = 1;" >> /tmp/test-part1.uc
/usr/bin/ucode /usr/libexec/zapret2-manager/service-dns-cli.uc providers 2>&1 | head -3
'

echo ""
echo "=== Step 2: Binary search for syntax error ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 '
# Try lines 1-400
head -400 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/test-part.uc
echo "export const dummy = 1;" >> /tmp/test-part.uc
echo "=== Lines 1-400 ==="
# Create minimal CLI wrapper to test this
cat > /tmp/test-cli.uc << "CLIEOF"
import { dummy } from "./test-part.uc";
print(dummy);
CLIEOF
/usr/bin/ucode /tmp/test-cli.uc 2>&1
'

echo ""
echo "=== Step 3: Try lines 1-440 ==="
ssh -o StrictHostKeyChecking=no root@192.168.1.1 '
head -440 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/test-part2.uc
echo "export const dummy = 1;" >> /tmp/test-part2.uc
cat > /tmp/test-cli2.uc << "CLIEOF"
import { dummy } from "./test-part2.uc";
print(dummy);
CLIEOF
/usr/bin/ucode /tmp/test-cli2.uc 2>&1
'
