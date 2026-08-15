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
1713b37c70eb09fb645302d8b2df420e79dcbde0eb84a43af935a3c83a5aea31|luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json|/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json
c2bd86ee1fafd473072d9f275f8a3de95344627eb06c399fc4f1af72ed4a622c|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js|/www/luci-static/resources/view/zapret2-manager/app.js
337b96654bde520e569925e8715edf25cc09a946c6e830652fc2bcadd58c319f|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js|/www/luci-static/resources/view/zapret2-manager/z2m-api.js
cb66e29eea77a218617454275b38c3c523baf4fb2e3210e62615f563f2886a3f|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-service-adapter.js|/www/luci-static/resources/view/zapret2-manager/z2m-dns-service-adapter.js
ad4b8486e94ef3c7fe9e55d71c0ee457966b56d7bb9d8ef561b917130772dee4|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js|/www/luci-static/resources/view/zapret2-manager/z2m-dns.js
946aa24d4575eb3fc4e71c2f30bcd2d3f1442d2993e90f4254499b39019bd045|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-gate.js|/www/luci-static/resources/view/zapret2-manager/z2m-engine-gate.js
bb346e2e38c13587617c99d9f170477ddf6507c959a266c97d472ae133ecacf8|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js|/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js
023a5c4abc8da2807696e1ca5ee3158cdc4e1dce3038c3f975be678bef5ce975|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js|/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js
d37e142fc30d24594983f85d6c69084de09120db244c787e1f48d3bb905fa355|luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css|/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
aed3abffa444d433a5b8ec8e53942c0fbef558e0e213802761df47e9b64f35d5|zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc|/usr/libexec/zapret2-manager/asset-registry.uc
d02f459e492df8986e2d1c43404681e61c25965b2fd4ad8eb2e9e43c36af4094|zapret2-manager/files/usr/libexec/zapret2-manager/dns-product-cli.uc|/usr/libexec/zapret2-manager/dns-product-cli.uc
032d94d589bde7cd67ed35f3255d3212f48280ccdac4d25ed544f77c85df6c89|zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc|/usr/libexec/zapret2-manager/dns-product.uc
7a1a76e010b96eb394b6bfd090cc78b0017d510f8163848f94a5aa239b41efac|zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc|/usr/libexec/zapret2-manager/dns.uc
3488385fd3d4c4e761a582229a134a79acbcd27460d660ba9ed3e88431674146|zapret2-manager/files/usr/libexec/zapret2-manager/providers/remittor.uc|/usr/libexec/zapret2-manager/providers/remittor.uc
10ae04f281baf606da93e5b5ac3fad81f388b14e75df7089bdf5d4633b4537e9|zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc|/usr/libexec/zapret2-manager/scanner-probe-executor.uc
429c1abb9bc5d2c408dcfcfa6aad104dbbb113bf3e688446e5b9153847d197ac|zapret2-manager/files/usr/libexec/zapret2-manager/tg-product-cli.uc|/usr/libexec/zapret2-manager/tg-product-cli.uc
e99aa351dafbf2a1c50f3798a29040dd401c76d182c86eb5e309577dc2a82138|zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc|/usr/libexec/zapret2-manager/tg-product.uc
eceb88484684e2260dcd79aef5fc7f5dbac8ed1d877aec5a78df12ea99fa435b|zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-cli.uc|/usr/libexec/zapret2-manager/proxy-provider-cli.uc
deb19f12c338055a2cb0a18df826586fd8b432176066138d1a4822827066b4e5|zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc|/usr/libexec/zapret2-manager/proxy-provider.uc
a7ef09b53891dd460744c312a9c6a239ea9e61ed7d9f39905225ebd41dab2774|zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc|/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc
8b08f4268ebac81c20387bdcaa9c138a539acd0dba95baff5827c43a65ae8ab5|zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc|/usr/share/rpcd/ucode/zapret2-manager.uc
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
