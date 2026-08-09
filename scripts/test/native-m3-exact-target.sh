#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

fail() { echo "native M3 exact-target: $*" >&2; exit 1; }
absolute_dir() { eval "value=\${$1:-}"; [ -n "$value" ] && [ "${value#/}" != "$value" ] && [ -d "$value" ] || fail "$1 must be an absolute directory"; }
absolute_executable() { eval "value=\${$1:-}"; [ -n "$value" ] && [ "${value#/}" != "$value" ] && [ -f "$value" ] && [ -x "$value" ] || fail "$1 must be an absolute executable"; }

[ "$(uname -s)" = Linux ] || fail 'Linux is required'
[ "$(id -u)" -eq 0 ] || fail 'real host UID 0 is required'
absolute_dir OPENWRT_SDK
absolute_dir SHARED_SDK
absolute_dir TARGET_ROOT
absolute_executable NODE_BIN
absolute_executable TARGET_CC
absolute_executable PROOT_BIN
absolute_executable QEMU_AARCH64
[ -x "$TARGET_ROOT/usr/bin/ucode" ] || fail 'target /usr/bin/ucode is missing'
[ -f "$TARGET_ROOT/usr/lib/ucode/socket.so" ] || fail 'target socket.so is missing'
[ "$(realpath "$OPENWRT_SDK")" != "$(realpath "$SHARED_SDK")" ] || fail 'OPENWRT_SDK must not be the shared SDK'
for directory in build_dir staging_dir tmp package package/feeds; do
	path="$OPENWRT_SDK/$directory"
	[ -d "$path" ] || fail "isolated SDK directory is missing: $path"
	[ ! -L "$path" ] || fail "isolated SDK directory must not be a symlink: $path"
done
file "$TARGET_ROOT/usr/bin/ucode" | grep -q 'ARM aarch64' || fail 'target ucode is not AArch64'
file "$TARGET_ROOT/usr/lib/ucode/socket.so" | grep -q 'ARM aarch64' || fail 'target socket.so is not AArch64'

export UCODE_BIN=$PROOT_BIN
export UCODE_ARGS="-q $QEMU_AARCH64 -R $TARGET_ROOT -b $ROOT:$ROOT -w $ROOT /usr/bin/ucode"
export UCODE_ARGS_PIPE="-q|$QEMU_AARCH64|-R|$TARGET_ROOT|-b|$ROOT:$ROOT|-w|$ROOT|/usr/bin/ucode"
export TARGET_SOCKET_MODULE="$TARGET_ROOT/usr/lib/ucode/socket.so"
export PROOT_NO_SECCOMP=1

log=$(mktemp "${TMPDIR:-/tmp}/native-m3-exact-target.XXXXXX")
phase_log=$(mktemp "${TMPDIR:-/tmp}/native-m3-exact-target-phase.XXXXXX")
trap 'rm -f "$log" "$phase_log"' 0 HUP INT TERM

run_phase() {
	phase=$1
	test_file=$2
	echo "$phase"
	if ! "$NODE_BIN" --test --test-concurrency=1 "$test_file" > "$phase_log" 2>&1; then
		cat "$phase_log"
		cat "$phase_log" >> "$log"
		fail "$phase failed"
	fi
	cat "$phase_log"
	cat "$phase_log" >> "$log"
}

run_phase 'production package E2E' tests/native/core/native-helper-production-e2e.test.mjs
run_phase 'exact-target adapter suite' tests/native/core/native-helper.test.mjs
run_phase 'exact-target broker spike suite' tests/native/core/native-helper-broker-spike.test.mjs
echo 'zero-skip and leak checks'
if grep -Eq '# SKIP|skipped [1-9]|# tests [0-9]+.*# skip [1-9]' "$log"; then
	fail 'an exact-target phase skipped tests'
fi
if pgrep -f 'z2m-(helperd|core-helper).*z2m-production-e2e-' >/dev/null 2>&1; then
	fail 'an exact-target helper process leaked'
fi
echo 'native M3 exact-target: PASS (zero skips, zero leaks)'
