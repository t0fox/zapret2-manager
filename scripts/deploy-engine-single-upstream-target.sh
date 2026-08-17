#!/usr/bin/env bash
set -eu

# Direct SCP-compatible development deployment. No manager APK build/install,
# no reboot. The exact legacy engine files are removed after the new closure
# is staged and verified.
ROOT=${ROOT:-$(CDPATH= cd -- "${0%/*}/.." && pwd)}
TARGET=${TARGET:-root@192.168.1.1}
REMOTE_ROOT=${REMOTE_ROOT:-/tmp/z2m-engine-single-upstream}
BACKUP_ROOT=${BACKUP_ROOT:-$REMOTE_ROOT/backup}
SSH_CONNECT_TIMEOUT=${SSH_CONNECT_TIMEOUT:-5}
[ "${CONFIRM_TARGET_DEPLOY:-}" = ENGINE_SINGLE_UPSTREAM ] || { printf '%s\n' 'Set CONFIRM_TARGET_DEPLOY=ENGINE_SINGLE_UPSTREAM.' >&2; exit 2; }
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT")
manifest='
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js|/www/luci-static/resources/view/zapret2-manager/z2m-api.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runtime-state.js|/www/luci-static/resources/view/zapret2-manager/z2m-runtime-state.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js|/www/luci-static/resources/view/zapret2-manager/z2m-overview.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-model.js|/www/luci-static/resources/view/zapret2-manager/z2m-engine-model.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js|/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine.js|/www/luci-static/resources/view/zapret2-manager/z2m-engine.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js|/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js|/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css|/www/luci-static/resources/view/zapret2-manager/z2m-ui.css
luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js|/www/luci-static/resources/view/zapret2-manager/z2m-shell.js
zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc|/usr/libexec/zapret2-manager/core/status-collector.uc
zapret2-manager/files/usr/libexec/zapret2-manager/engine-legacy-detect.uc|/usr/libexec/zapret2-manager/engine-legacy-detect.uc
zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc|/usr/libexec/zapret2-manager/engine-catalog.uc
zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc|/usr/libexec/zapret2-manager/engine-manager.uc
zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc|/usr/libexec/zapret2-manager/engine-cli.uc
zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh|/usr/libexec/zapret2-manager/engine-operation-worker.sh
zapret2-manager/files/usr/libexec/zapret2-manager/service.uc|/usr/libexec/zapret2-manager/service.uc
zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc|/usr/share/rpcd/ucode/zapret2-manager-engine.uc
luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager-engine.json|/usr/share/rpcd/acl.d/luci-app-zapret2-manager-engine.json
'
remote(){ ssh "${SSH_OPTS[@]}" "$TARGET" "$@" </dev/null; }
remote "set -eu; umask 022; mkdir -p '$REMOTE_ROOT' '$BACKUP_ROOT'"
printf '%s\n' "$manifest" | while IFS='|' read -r repo_path target_path; do
  [ -n "$repo_path" ] || continue
  local_path=$ROOT/$repo_path; expected=$(sha256sum "$local_path" | awk '{print $1}'); stage_path=$REMOTE_ROOT/$(printf '%s' "$target_path" | tr '/' '_'); backup_path=$BACKUP_ROOT$target_path; backup_dir=${backup_path%/*}; case "$target_path" in *.sh) mode=0755;; *) mode=0644;; esac
  test -f "$local_path"
  remote "set -eu; if [ -e '$target_path' ]; then mkdir -p '$backup_dir'; cp -p '$target_path' '$backup_path'; fi"
  ssh "${SSH_OPTS[@]}" "$TARGET" "cat > '$stage_path'" < "$local_path"
  remote "set -eu; test \"\$(sha256sum '$stage_path' | awk '{print \$1}')\" = '$expected'; mkdir -p \$(dirname '$target_path'); cp -f '$stage_path' '$target_path'; chown root:root '$target_path'; chmod $mode '$target_path'; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'"
done
remote "set -eu; rm -f /usr/libexec/zapret2-manager/engine-providers.uc /usr/libexec/zapret2-manager/providers/remittor.uc /usr/libexec/zapret2-manager/providers/andrevich.uc /usr/libexec/zapret2-manager/providers/bolvan.uc; rmdir /usr/libexec/zapret2-manager/providers 2>/dev/null || true; /usr/bin/ucode /usr/libexec/zapret2-manager/engine-cli.uc releases >/tmp/z2m-engine-releases.json; /usr/bin/ucode /usr/libexec/zapret2-manager/engine-cli.uc status >/tmp/z2m-engine-status.json; rm -f /tmp/z2m-engine-releases.json /tmp/z2m-engine-status.json; /etc/init.d/zapret2-manager restart"
printf '%s\n' "$manifest" | while IFS='|' read -r repo_path target_path; do
  [ -n "$repo_path" ] || continue
  expected=$(sha256sum "$ROOT/$repo_path" | awk '{print $1}'); case "$target_path" in *.sh) mode='-rwxr-xr-x';; *) mode='-rw-r--r--';; esac
  remote "set -eu; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'; set -- \$(ls -ld '$target_path'); test \"\$1\" = '$mode'; test \"\$3:\$4\" = 'root:root'"
done
remote "set -eu; test ! -e /usr/libexec/zapret2-manager/engine-providers.uc; test ! -e /usr/libexec/zapret2-manager/providers/remittor.uc; test ! -e /usr/libexec/zapret2-manager/providers/andrevich.uc"
printf 'Deployed single-upstream engine closure; backup: %s\n' "$BACKUP_ROOT"
