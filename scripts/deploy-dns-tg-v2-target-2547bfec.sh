#!/usr/bin/env bash
set -eu

# Bounded, backup-first deployment for the DNS/TG v2 candidate.
# This script is intentionally guarded: it will not touch a target unless the
# operator explicitly sets CONFIRM_TARGET_DEPLOY=YES.

SCRIPT_DIR=${0%/*}
[ "$SCRIPT_DIR" = "$0" ] && SCRIPT_DIR=.
ROOT=${ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
TARGET=${TARGET:-root@192.168.1.1}
REMOTE_ROOT=${REMOTE_ROOT:-/tmp/z2m-dns-tg-v2-2547bfec}
BACKUP_ROOT=${BACKUP_ROOT:-$REMOTE_ROOT/backup}
SSH_CONNECT_TIMEOUT=${SSH_CONNECT_TIMEOUT:-5}

if [ "${CONFIRM_TARGET_DEPLOY:-}" != "YES" ]; then
    printf '%s\n' 'Refusing target mutation. Set CONFIRM_TARGET_DEPLOY=YES to deploy.' >&2
    exit 2
fi

SSH_OPTS=(
    -o BatchMode=yes
    -o ConnectTimeout="$SSH_CONNECT_TIMEOUT"
)

manifest='
82ccec74642e776f46bca4d87bd5d132063567f3162f5824b8cfe3bc66166fc8|luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json|/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json
2e310dc03560759eb1186c07074e2f2a33f5788998e386da4061f7d85b16e0c2|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js|/www/luci-static/resources/view/zapret2-manager/app.js
954784412c200028aaa2f356f88d65b69545f5564175b4e54db8faccd5df7f6b|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js|/www/luci-static/resources/view/zapret2-manager/z2m-api.js
cb66e29eea77a218617454275b38c3c523baf4fb2e3210e62615f563f2886a3f|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-service-adapter.js|/www/luci-static/resources/view/zapret2-manager/z2m-dns-service-adapter.js
ad4b8486e94ef3c7fe9e55d71c0ee457966b56d7bb9d8ef561b917130772dee4|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js|/www/luci-static/resources/view/zapret2-manager/z2m-dns.js
946aa24d4575eb3fc4e71c2f30bcd2d3f1442d2993e90f4254499b39019bd045|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-gate.js|/www/luci-static/resources/view/zapret2-manager/z2m-engine-gate.js
2444c9c23a8ed634155410624ea06bb1499b3ca63b1b8e5924e97856552883e9|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js|/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js
023a5c4abc8da2807696e1ca5ee3158cdc4e1dce3038c3f975be678bef5ce975|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js|/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js
38577b7af5d3e8ea9c09dc6c876ae550d8b75366bc85f1e570f362abc081dac6|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css|/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
aed3abffa444d433a5b8ec8e53942c0fbef558e0e213802761df47e9b64f35d5|zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc|/usr/libexec/zapret2-manager/asset-registry.uc
d02f459e492df8986e2d1c43404681e61c25965b2fd4ad8eb2e9e43c36af4094|zapret2-manager/files/usr/libexec/zapret2-manager/dns-product-cli.uc|/usr/libexec/zapret2-manager/dns-product-cli.uc
032d94d589bde7cd67ed35f3255d3212f48280ccdac4d25ed544f77c85df6c89|zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc|/usr/libexec/zapret2-manager/dns-product.uc
7a1a76e010b96eb394b6bfd090cc78b0017d510f8163848f94a5aa239b41efac|zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc|/usr/libexec/zapret2-manager/dns.uc
3488385fd3d4c4e761a582229a134a79acbcd27460d660ba9ed3e88431674146|zapret2-manager/files/usr/libexec/zapret2-manager/providers/remittor.uc|/usr/libexec/zapret2-manager/providers/remittor.uc
10ae04f281baf606da93e5b5ac3fad81f388b14e75df7089bdf5d4633b4537e9|zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc|/usr/libexec/zapret2-manager/scanner-probe-executor.uc
2001734c920c1535e4188c94767c74bbb15aefba6ee02be612626e1f7834c34d|zapret2-manager/files/usr/libexec/zapret2-manager/tg-product-cli.uc|/usr/libexec/zapret2-manager/tg-product-cli.uc
b4133b47dda9f2bf8a54e9e9346562be5c8e636660d75116351840f77c6afb51|zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc|/usr/libexec/zapret2-manager/tg-product.uc
'

remote() {
    ssh "${SSH_OPTS[@]}" "$TARGET" "$@" </dev/null
}

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

printf 'Deployed candidate 2547bfec with backup at %s; rpcd reloaded.\n' "$BACKUP_ROOT"
