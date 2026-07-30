#!/bin/sh
BIN=/usr/bin/ucode
SRC=/usr/libexec/zapret2-manager/service-dns.uc
APL=/usr/libexec/zapret2-manager/apply.uc
PRF=/usr/libexec/zapret2-manager/profiles-draft.uc

for LINES in 100 200 300 400 430 431 432; do
  echo "=== head -${LINES} ==="
  head -${LINES} "$SRC" > "/tmp/b${LINES}.uc"
  cp "$APL" "/tmp/apply.uc"
  cp "$PRF" "/tmp/profiles-draft.uc"
  echo "export const db${LINES} = 1;" >> "/tmp/b${LINES}.uc"
  cat > "/tmp/b${LINES}-cli.uc" << CLIEOF
import { db${LINES} } from "./b${LINES}.uc";
print(db${LINES});
CLIEOF
  $BIN "/tmp/b${LINES}-cli.uc" 2>&1 | grep -E "Syntax|line "
  echo "EXIT: $?"
  echo ""
done
