#!/usr/bin/env bash
set -eu

# Bounded TG-only deployment for the installation UX / durable operation slice.
# It never restarts tg-ws-proxy and never touches DNS or Strategy files.
ROOT=${ROOT:-$(CDPATH= cd -- "${0%/*}/.." && pwd)}
TARGET=${TARGET:-root@192.168.1.1}
REMOTE_ROOT=${REMOTE_ROOT:-/tmp/z2m-tg-installation-ux}
BACKUP_ROOT=${BACKUP_ROOT:-$REMOTE_ROOT/backup}
SSH_CONNECT_TIMEOUT=${SSH_CONNECT_TIMEOUT:-5}

[ "${CONFIRM_TARGET_DEPLOY:-}" = TG_ONLY ] || { printf '%s\n' 'Refusing target mutation. Set CONFIRM_TARGET_DEPLOY=TG_ONLY.' >&2; exit 2; }
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT")

manifest='
93efacd2c6564216411b39783b3abbf63bb01a43685fd3bdff4fb93bdcaa8698|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js|/www/luci-static/resources/view/zapret2-manager/z2m-api.js
a92a7377456e4e15e692353dfcacf4a13c25a1e00858939d2ebd14a7a1e65e28|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js|/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js
a09e44399fca009e4762b646818e59b3b2758a22979e28715a8de0426b64880a|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css|/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
68fe7e658aa12405ce7f778bbc2fe322ffd5fcaec86e3241a325c36820d2305c|zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc|/usr/libexec/zapret2-manager/proxy-provider.uc
b588f1c499992caa5f181643bf20f0722339df8ea970012f06c52136527473e9|zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-operation.uc|/usr/libexec/zapret2-manager/proxy-provider-operation.uc
c7a3f76768d2ebc8f810e86f5da3b5bbf798f2b0541c65f1c6dcfe9c3feb9779|zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-cli.uc|/usr/libexec/zapret2-manager/proxy-provider-cli.uc
20840557f50d4981ef2ae9fcfe0b80e29e9d30eb11dc69cc677a8dafa5df2231|zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc|/usr/libexec/zapret2-manager/tg-product.uc
47e24ab28ec2fd9b116dc75a2dfa428bcb180de419d803e449d43fb53248d655|zapret2-manager/files/usr/libexec/zapret2-manager/tg-product-cli.uc|/usr/libexec/zapret2-manager/tg-product-cli.uc
14da5f82076cc830b35596518efc26e367fb834bc5e169916983d746f609c0ea|zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc|/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc
0e818681d33407a4cf7fc7cd90b2fd3f4740556a93c6fe5d31b51ee91314d40a|zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc|/usr/share/rpcd/ucode/zapret2-manager.uc
'

remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@" </dev/null; }
remote "set -eu; umask 022; mkdir -p '$REMOTE_ROOT' '$BACKUP_ROOT'"

printf '%s\n' "$manifest" | while IFS='|' read -r expected repo_path target_path; do
    [ -n "$expected" ] || continue
    local_path=$ROOT/$repo_path
    stage_path=$REMOTE_ROOT/$(printf '%s' "$target_path" | tr '/' '_')
    backup_path=$BACKUP_ROOT$target_path
    backup_dir=${backup_path%/*}
    test -f "$local_path"
    actual=$(sha256sum "$local_path" | awk '{print $1}')
    test "$actual" = "$expected"
    remote "set -eu; if [ -e '$target_path' ]; then mkdir -p '$backup_dir'; cp -p '$target_path' '$backup_path'; fi"
    ssh "${SSH_OPTS[@]}" "$TARGET" "cat > '$stage_path'" < "$local_path"
    remote "set -eu; test \"\$(sha256sum '$stage_path' | awk '{print \$1}')\" = '$expected'; cp -f '$stage_path' '$target_path'; chown root:root '$target_path'; chmod 0644 '$target_path'; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'"
done

remote "set -eu; /etc/init.d/rpcd reload"
printf '%s\n' "$manifest" | while IFS='|' read -r expected repo_path target_path; do
    [ -n "$expected" ] || continue
    remote "set -eu; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'; ls -l '$target_path'"
done
printf 'Deployed TG installation UX candidate; Rust runtime was not restarted. Backup: %s\n' "$BACKUP_ROOT"
