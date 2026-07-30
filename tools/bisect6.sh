#!/bin/sh
echo "=== Test: Duplicate let i in the same function ==="
cat > /tmp/test-dupi.uc << 'UCEOF'
export const testfn = function() {
	for (let i = 0; i < 5; i++) { }
	for (let i = 0; i < 3; i++) { }
	return 1;
};
export const d6 = 1;
UCEOF
cat > /tmp/test-dupi-cli.uc << 'UCEOF'
import { d6 } from "./test-dupi.uc";
print(d6);
UCEOF
/usr/bin/ucode /tmp/test-dupi-cli.uc 2>&1
echo "EXIT: $?"
