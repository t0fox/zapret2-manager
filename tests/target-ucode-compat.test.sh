#!/usr/bin/env bash
set -euo pipefail

host="${DEPLOY_HOST:-192.168.1.1}"
root="/tmp/z2m-target-compat.$$"
cleanup() { ssh root@"$host" "rm -rf '$root'" >/dev/null 2>&1 || true; }
trap cleanup EXIT

ssh root@"$host" "mkdir -p '$root/usr/libexec/zapret2-manager' '$root/usr/share/rpcd/ucode'"
scp -O -q -r zapret2-manager/files/usr/libexec/zapret2-manager/* root@"$host":"$root/usr/libexec/zapret2-manager/"
scp -O -q zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc root@"$host":"$root/usr/share/rpcd/ucode/zapret2-manager"

ssh root@"$host" "
  set -eu
  for f in '$root/usr/libexec/zapret2-manager/orchestra-run.uc' '$root/usr/libexec/zapret2-manager/orchestra-worker-control.uc'; do
    d=\$(dirname \"\$f\"); b=\$(basename \"\$f\"); t=\"\$d/.compat-\$b\"; w=\"\$t.wrap\"
    sed '1{/^#!/d}' \"\$f\" > \"\$t\"
    printf 'import * as m from \"%s\";' \"\$t\" > \"\$w\"
    ucode -c -o /dev/null \"\$w\"
    rm -f \"\$t\" \"\$w\"
  done
  sed '1{/^#!/d}' '$root/usr/share/rpcd/ucode/zapret2-manager' > '$root/usr/share/rpcd/ucode/.compat-rpc'
  ucode -c -o /dev/null '$root/usr/share/rpcd/ucode/.compat-rpc'
  test -f '$root/usr/libexec/zapret2-manager/services/discord.json'
  rm -rf '$root'
"

if rg -n 'Array\.sort|Array\.concat|Math\.floor' zapret2-manager/files/usr/libexec/zapret2-manager/orchestra*.uc >/dev/null; then
  echo 'forbidden target runtime method or dynamic import found' >&2
  exit 1
fi
echo 'target UCode compatibility PASS'
