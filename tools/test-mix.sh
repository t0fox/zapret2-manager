#!/bin/sh
# Test ucode: export const + function mixing
cat > /tmp/test-exp.uc << 'UCEOF'
export const foo = function() { return 42; };
function bar() { return 43; }
export const qux = 1;
UCEOF
cat > /tmp/test-main.uc << 'UCEOF'
import { foo, qux } from "./test-exp.uc";
print(foo(), qux);
UCEOF
/usr/bin/ucode /tmp/test-main.uc 2>&1
echo "EXIT: $?"
