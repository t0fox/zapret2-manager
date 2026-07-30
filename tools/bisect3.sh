#!/bin/sh
echo "=== BISECT render_hosts_with_ownership ==="

echo "=== Test: lines 432-440 only (for loops, no sort/out) ==="
head -440 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/b440.uc
echo "}" >> /tmp/b440.uc
echo "export const d1 = 1;" >> /tmp/b440.uc
cat > /tmp/b440-cli.uc << 'UCEOF'
import { d1 } from "./b440.uc";
print(d1);
UCEOF
/usr/bin/ucode /tmp/b440-cli.uc 2>&1
echo "EXIT: $?"

echo "=== Test: lines 432-445 only (add keys, sort, no out) ==="
head -445 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/b445.uc
echo "}" >> /tmp/b445.uc
echo "export const d2 = 1;" >> /tmp/b445.uc
cat > /tmp/b445-cli.uc << 'UCEOF'
import { d2 } from "./b445.uc";
print(d2);
UCEOF
/usr/bin/ucode /tmp/b445-cli.uc 2>&1
echo "EXIT: $?"

echo "=== Test: lines 432-446 only (add out string) ==="
head -446 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/b446.uc
echo "}" >> /tmp/b446.uc
echo "export const d3 = 1;" >> /tmp/b446.uc
cat > /tmp/b446-cli.uc << 'UCEOF'
import { d3 } from "./b446.uc";
print(d3);
UCEOF
/usr/bin/ucode /tmp/b446-cli.uc 2>&1
echo "EXIT: $?"

echo "=== Test: replace '\"'\"'\\\\n'\"'\"' with LF in line 446 ==="
head -445 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/b446x.uc
# Build the rest manually to avoid quoting hell
cat >> /tmp/b446x.uc << 'UCEOF'
	let out = "# header" + chr(10);
	for (let i = 0; i < length(arr); i++) out += arr[i] + chr(10);
	if (length(out) > 16384) out = substr(out, 0, 16384);
	return out;
}
export const d3x = 1;
UCEOF
cat > /tmp/b446x-cli.uc << 'UCEOF'
import { d3x } from "./b446x.uc";
print(d3x);
UCEOF
/usr/bin/ucode /tmp/b446x-cli.uc 2>&1
echo "EXIT: $?"
