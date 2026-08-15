#!/usr/bin/env bash
set -eu

# Bounded P01-only deployment. It transfers only the Dashboard's changed
# frontend closure and never mutates backend, TG, DNS, or other page files.
ROOT=${ROOT:-$(CDPATH= cd -- "${0%/*}/.." && pwd)}
TARGET=${TARGET:-root@192.168.1.1}
REMOTE_ROOT=${REMOTE_ROOT:-/tmp/z2m-dashboard-parity}
BACKUP_ROOT=${BACKUP_ROOT:-$REMOTE_ROOT/backup}
SSH_CONNECT_TIMEOUT=${SSH_CONNECT_TIMEOUT:-5}
EXPECTED_COMMIT=${EXPECTED_COMMIT:-}

[ "${CONFIRM_TARGET_DEPLOY:-}" = DASHBOARD_ONLY ] || {
    printf '%s\n' 'Refusing target mutation. Set CONFIRM_TARGET_DEPLOY=DASHBOARD_ONLY.' >&2
    exit 2
}
[ -n "$EXPECTED_COMMIT" ] || {
    printf '%s\n' 'Refusing target mutation. Set EXPECTED_COMMIT to the committed P01 HEAD.' >&2
    exit 2
}
if [ -f "$ROOT/.git" ]; then
    GIT_DIR=$(sed -n 's/^gitdir: //p' "$ROOT/.git" | tr '\\' '/')
    case "$GIT_DIR" in
        [A-Za-z]:/*) GIT_DIR=/mnt/$(printf '%s' "$GIT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's#:/#/#') ;;
    esac
    GIT_CMD=(git --git-dir="$GIT_DIR" --work-tree="$ROOT")
else
    GIT_CMD=(git -C "$ROOT")
fi
test "$("${GIT_CMD[@]}" rev-parse HEAD)" = "$EXPECTED_COMMIT"
test -z "$("${GIT_CMD[@]}" status --porcelain)"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT")
manifest='
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js|/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js|/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js|/www/luci-static/resources/view/zapret2-manager/z2m-shell.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css|/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
'

remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@" </dev/null; }
remote "set -eu; umask 022; mkdir -p '$REMOTE_ROOT' '$BACKUP_ROOT'"

printf '%s\n' "$manifest" | while IFS='|' read -r repo_path target_path; do
    [ -n "$repo_path" ] || continue
    local_path=$ROOT/$repo_path
    expected=$(sha256sum "$local_path" | awk '{print $1}')
    stage_path=$REMOTE_ROOT/$(printf '%s' "$target_path" | tr '/' '_')
    backup_path=$BACKUP_ROOT$target_path
    backup_dir=${backup_path%/*}
    test -f "$local_path"
    remote "set -eu; if [ -e '$target_path' ]; then mkdir -p '$backup_dir'; cp -p '$target_path' '$backup_path'; fi"
    ssh "${SSH_OPTS[@]}" "$TARGET" "cat > '$stage_path'" < "$local_path"
    remote "set -eu; test \"\$(sha256sum '$stage_path' | awk '{print \$1}')\" = '$expected'; cp -f '$stage_path' '$target_path'; chown root:root '$target_path'; chmod 0644 '$target_path'; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'"
done

remote "set -eu; /etc/init.d/rpcd reload"
printf '%s\n' "$manifest" | while IFS='|' read -r repo_path target_path; do
    [ -n "$repo_path" ] || continue
    expected=$(sha256sum "$ROOT/$repo_path" | awk '{print $1}')
    remote "set -eu; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'; set -- \$(ls -ld '$target_path'); test \"\$1\" = '-rw-r--r--'; test \"\$3:\$4\" = 'root:root'; ls -l '$target_path'"
done
printf 'Deployed P01 Dashboard commit %s; backup: %s\n' "$EXPECTED_COMMIT" "$BACKUP_ROOT"
