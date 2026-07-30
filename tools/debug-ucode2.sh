#!/bin/sh
# Debug the ucode syntax error at line 454
ssh -o StrictHostKeyChecking=no root@192.168.1.1 '
echo "=== lines 445-460 ==="
sed -n "445,460p" /usr/libexec/zapret2-manager/service-dns.uc | cat -A

echo "=== od first 5 lines of the file ==="
head -5 /usr/libexec/zapret2-manager/service-dns.uc | od -c

echo "=== trying simpler repro ==="
cat > /tmp/test-uc.uc << "MODULEEOF"
let x = "hello\nworld";
let y = x + "\n";
print(y);
function foo() {
  return "bar";
}
function baz() {
  return "qux";
}
MODULEEOF
/usr/bin/ucode /tmp/test-uc.uc 2>&1

echo "=== test module import ==="
cat > /tmp/test-main.uc << "MAINEOF"
import { foo } from "./test-uc.uc";
print(foo());
MAINEOF
/usr/bin/ucode /tmp/test-main.uc 2>&1
' 2>&1
