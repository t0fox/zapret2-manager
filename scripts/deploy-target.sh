#!/usr/bin/env bash
set -eu

# Deploy one explicitly reviewed source -> target closure. The manifest is
# intentionally explicit: it is the reviewable transitive runtime closure,
# not a broad directory copy.
ROOT=${ROOT:-$(CDPATH= cd -- "${0%/*}/.." && pwd)}
TARGET=${TARGET:?TARGET must be set explicitly, for example root@router}
MANIFEST=${MANIFEST:?MANIFEST must point to the reviewed deployment manifest}
EXPECTED_COMMIT=${EXPECTED_COMMIT:?EXPECTED_COMMIT must identify the reviewed source commit}
REMOTE_ROOT=${REMOTE_ROOT:-/tmp/z2m-deploy}
BACKUP_ROOT=${BACKUP_ROOT:-$REMOTE_ROOT/backup}
SSH_CONNECT_TIMEOUT=${SSH_CONNECT_TIMEOUT:-5}

[ "${CONFIRM_TARGET_DEPLOY:-}" = YES ] || {
    printf '%s\n' 'Refusing target mutation. Set CONFIRM_TARGET_DEPLOY=YES.' >&2
    exit 2
}
[ -n "$MANIFEST" ] || {
    printf '%s\n' 'Refusing target mutation. Set MANIFEST to a reviewed repo|target|mode file.' >&2
    exit 2
}
[ -f "$MANIFEST" ] || { printf 'Manifest not found: %s\n' "$MANIFEST" >&2; exit 2; }
[ -n "$EXPECTED_COMMIT" ] || {
    printf '%s\n' 'Refusing target mutation. Set EXPECTED_COMMIT to the clean source HEAD.' >&2
    exit 2
}

git -C "$ROOT" diff --quiet
git -C "$ROOT" diff --cached --quiet
test "$(git -C "$ROOT" rev-parse HEAD)" = "$EXPECTED_COMMIT"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT")
remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@" </dev/null; }
remote "set -eu; umask 022; mkdir -p '$REMOTE_ROOT' '$BACKUP_ROOT'"

while IFS='|' read -r repo_path target_path mode extra; do
    case "$repo_path" in ''|'#'*) continue ;; esac
    [ -z "$extra" ] || { printf 'Invalid manifest row: %s\n' "$repo_path|$target_path|$mode|$extra" >&2; exit 2; }
    case "$target_path" in /[A-Za-z0-9._/-]*) ;; *) printf 'Unsafe target path: %s\n' "$target_path" >&2; exit 2 ;; esac
    case "$mode" in 0644|0755) ;; *) printf 'Unsupported mode: %s\n' "$mode" >&2; exit 2 ;; esac
    git -C "$ROOT" ls-files --error-unmatch -- "$repo_path" >/dev/null
    local_path=$ROOT/$repo_path
    test -f "$local_path"
    expected=$(sha256sum "$local_path" | awk '{print $1}')
    stage_path=$REMOTE_ROOT/$(printf '%s' "$target_path" | tr '/' '_')
    backup_path=$BACKUP_ROOT$target_path
    backup_dir=${backup_path%/*}
    remote "set -eu; if [ -e '$target_path' ]; then mkdir -p '$backup_dir'; cp -p '$target_path' '$backup_path'; fi"
    scp -q -O "${SSH_OPTS[@]}" "$local_path" "$TARGET:$stage_path"
    remote "set -eu; test \"\$(sha256sum '$stage_path' | awk '{print \$1}')\" = '$expected'; mkdir -p \$(dirname '$target_path'); cp -f '$stage_path' '$target_path'; chown root:root '$target_path'; chmod '$mode' '$target_path'; test \"\$(sha256sum '$target_path' | awk '{print \$1}')\" = '$expected'"
done < "$MANIFEST"

if [ "${RELOAD_RPCD:-1}" = 1 ]; then
    remote "set -eu; /etc/init.d/rpcd reload"
fi

printf 'Deployed reviewed closure from %s; backup: %s\n' "$EXPECTED_COMMIT" "$BACKUP_ROOT"
