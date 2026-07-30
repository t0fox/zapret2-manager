#!/bin/sh
# Extract lines 432-460 of service-dns.uc and test if they compile with ucode
cat > /tmp/test-block.uc << 'UCEOF'
// simulate the exact block near line 432-454
export const render_hosts_with_ownership = function(records, ownershipMap) {
	let lineSet = {};
	for (let i = 0; i < length(records); i++) {
		let r = records[i];
		let owner = ownershipMap[r.hostname] || 'user';
		let ownerTag = (owner == 'user') ? '' : ' # owner:' + owner;
		for (let k = 0; k < length(r.A); k++) lineSet[r.A[k] + ' ' + r.hostname + ownerTag] = true;
		for (let k = 0; k < length(r.AAAA); k++) lineSet[r.AAAA[k] + ' ' + r.hostname + ownerTag] = true;
	}
	let arr = keys(lineSet);
	if (length(arr) > 256) arr = _slice(arr, 0, 256);
	arr.sort();
	let out = "# header\n";
	for (let i = 0; i < length(arr); i++) out += arr[i] + "\n";
	if (length(out) > 16384) out = substr(out, 0, 16384);
	return out;
};

function parse_existing_overrides() {
	return {};
}

export const dummy = 1;
UCEOF
echo "block" > /tmp/test-block.uc
# Now copy the actual lines from the installed file
head -454 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/test-head.uc
echo "export const dummyxx = 1;" >> /tmp/test-head.uc
cat > /tmp/test-head-cli.uc << 'UCEOF'
import { dummyxx } from "./test-head.uc";
print(dummyxx);
UCEOF
echo "=== TEST HEAD 454 ==="
/usr/bin/ucode /tmp/test-head-cli.uc 2>&1
echo "EXIT: $?"

echo ""
echo "=== TEST HEAD 453 ==="
head -453 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/test-h453.uc
echo "export const dummyxx = 1;" >> /tmp/test-h453.uc
cat > /tmp/test-h453-cli.uc << 'UCEOF'
import { dummyxx } from "./test-h453.uc";
print(dummyxx);
UCEOF
/usr/bin/ucode /tmp/test-h453-cli.uc 2>&1
echo "EXIT: $?"

echo ""
echo "=== TEST HEAD 452 ==="
head -452 /usr/libexec/zapret2-manager/service-dns.uc > /tmp/test-h452.uc
echo "export const dummyxx = 1;" >> /tmp/test-h452.uc
cat > /tmp/test-h452-cli.uc << 'UCEOF'
import { dummyxx } from "./test-h452.uc";
print(dummyxx);
UCEOF
/usr/bin/ucode /tmp/test-h452-cli.uc 2>&1
echo "EXIT: $?"
