#!/bin/sh
ssh -o StrictHostKeyChecking=no root@192.168.1.1 '
echo "=== line 454 in hex ==="
sed -n "454p" /usr/libexec/zapret2-manager/service-dns.uc | hexdump -C 2>/dev/null || {
  sed -n "454p" /usr/libexec/zapret2-manager/service-dns.uc | while IFS= read -r line; do
    printf "%s" "$line" | hexdump -C
  done
}

echo "=== md5sum of entire file ==="
md5sum /usr/libexec/zapret2-manager/service-dns.uc

echo "=== wc -l ==="
wc -l /usr/libexec/zapret2-manager/service-dns.uc

echo "=== Compare with local source ==="
echo "Router md5 (current): $(md5sum /usr/libexec/zapret2-manager/service-dns.uc | cut -d\" \" -f1)"
echo "Local source md5 will be checked separately"

echo "=== Check if there is a pre-existing backup ==="
ls -la /usr/libexec/zapret2-manager/service-dns.uc* 2>/dev/null

echo "=== Restore original r38 apk file for comparison ==="
apk extract /tmp/zpm.apk 2>/dev/null || true
' 2>&1
