#!/bin/sh
# Test by replacing service-dns.uc in place and running the CLI wrapper
# Use a minimal test that doesn't require cross-file imports

echo "=== Test 1: Minimal ucode with just our helpers ==="
cat > /tmp/test-min.uc << 'UCEOF'
function _slice(arr, start, end) {
	let out = [];
	let lo = start != null ? start : 0;
	if (lo < 0) lo = length(arr) + lo;
	if (lo < 0) lo = 0;
	let hi = end != null ? end : length(arr);
	if (hi < 0) hi = length(arr) + hi;
	if (hi > length(arr)) hi = length(arr);
	for (let i = lo; i < hi; i++) push(out, arr[i]);
	return out;
}

function _clone_extend(base, overrides) {
	let obj = {};
	if (base != null) for (let kb in base) obj[kb] = base[kb];
	if (overrides != null) for (let ko in overrides) obj[ko] = overrides[ko];
	return obj;
}

export const render_hosts_with_ownership = function(records, ownershipMap) {
	let lineSet = {};
	for (let ii = 0; ii < length(records); ii++) {
		let r = records[ii];
		let owner = ownershipMap[r.hostname] || 'user';
		let ownerTag = (owner == 'user') ? '' : ' # owner:' + owner;
		for (let ki = 0; ki < length(r.A); ki++) lineSet[r.A[ki] + ' ' + r.hostname + ownerTag] = true;
		for (let kj = 0; kj < length(r.AAAA); kj++) lineSet[r.AAAA[kj] + ' ' + r.hostname + ownerTag] = true;
	}
	let arr = keys(lineSet);
	if (length(arr) > 256) arr = _slice(arr, 0, 256);
	arr.sort();
	let out = "# header\n";
	for (let iz = 0; iz < length(arr); iz++) out += arr[iz] + "\n";
	if (length(out) > 16384) out = substr(out, 0, 16384);
	return out;
};

export const dummy = 1;
UCEOF
cat > /tmp/test-min-cli.uc << 'UCEOF'
import { dummy } from "./test-min.uc";
print(dummy);
UCEOF
echo "=== Minimal test ==="
/usr/bin/ucode /tmp/test-min-cli.uc 2>&1
echo "EXIT: $?"

echo ""
echo "=== Test 2: Duplicate let k in same function ==="
cat > /tmp/test-dup.uc << 'UCEOF'
export const testfn = function() {
	let obj = {};
	for (let k in obj) obj[k] = 1;
	for (let k in obj) obj[k] = 2;
	return obj;
};
export const d2 = 1;
UCEOF
cat > /tmp/test-dup-cli.uc << 'UCEOF'
import { d2 } from "./test-dup.uc";
print(d2);
UCEOF
/usr/bin/ucode /tmp/test-dup-cli.uc 2>&1
echo "EXIT: $?"

echo ""
echo "=== Test 3: Duplicate let in export const with same var name ==="
cat > /tmp/test-dup2.uc << 'UCEOF'
export const testfn2 = function() {
	let k = 0;
	for (let k = 0; k < 5; k++) {}
	return 1;
};
export const d3 = 1;
UCEOF
cat > /tmp/test-dup2-cli.uc << 'UCEOF'
import { d3 } from "./test-dup2.uc";
print(d3);
UCEOF
/usr/bin/ucode /tmp/test-dup2-cli.uc 2>&1
echo "EXIT: $?"
