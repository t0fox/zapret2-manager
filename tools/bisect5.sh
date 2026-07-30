#!/bin/sh
echo "=== Test: Duplicate let k in for(;;) loops ==="
cat > /tmp/test-for.uc << 'UCEOF'
export const testfn = function(arr) {
	for (let k = 0; k < 5; k++) {}
	for (let k = 0; k < 3; k++) {}
	return 1;
};
export const d4 = 1;
UCEOF
cat > /tmp/test-for-cli.uc << 'UCEOF'
import { d4 } from "./test-for.uc";
print(d4);
UCEOF
/usr/bin/ucode /tmp/test-for-cli.uc 2>&1
echo "EXIT: $?"

echo ""
echo "=== Test: let k in for and then let arr with keys() ==="
cat > /tmp/test-keys.uc << 'UCEOF'
export const testfn2 = function(recs) {
	let lineSet = {};
	for (let i = 0; i < length(recs); i++) {
		let r = recs[i];
		for (let k = 0; k < length(r); k++) lineSet[r[k]] = true;
	}
	let arr = keys(lineSet);
	if (length(arr) > 10) arr = arr;
	arr.sort();
	return 1;
};
export const d5 = 1;
UCEOF
cat > /tmp/test-keys-cli.uc << 'UCEOF'
import { d5 } from "./test-keys.uc";
print(d5);
UCEOF
/usr/bin/ucode /tmp/test-keys-cli.uc 2>&1
echo "EXIT: $?"
