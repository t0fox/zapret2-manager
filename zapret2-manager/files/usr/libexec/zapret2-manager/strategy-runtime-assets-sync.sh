#!/bin/sh
set -eu
[ "${Z2M_SYNC_TRACE:-0}" = 1 ] && set -x
SYNC_LOG=${Z2M_SYNC_LOG:-/dev/null}
sync_log() { printf '%s\n' "sync: $*" >> "$SYNC_LOG" 2>/dev/null || true; }

# strategy-runtime-assets-sync.sh — Z2K runtime asset materialization.
#
# Bundled Strategy assets are package-owned inputs for the official nfqws2
# runtime. Existing upstream core Lua is never downgraded by this hook; custom
# Lua/blobs/lists are installed idempotently and are never deleted.
#
# Modes:
#   (no args)   materialize assets into the live engine roots
#   --verify    compare installed copies against the package baseline and
#               print a JSON verdict {ok, files, missing, mismatched};
#               exit non-zero when anything is missing or tampered
#
# Root overrides exist for sandboxed testing; on-target defaults are canonical.

SRC=${Z2M_RUNTIME_ASSETS_SRC:-/usr/share/zapret2-manager/runtime-assets}
BASE=${Z2M_RUNTIME_BASE:-/opt/zapret2}
STATE_ROOT=${Z2M_MANAGER_STATE_ROOT:-/etc/zapret2-manager/state}
STATE_DIR="$STATE_ROOT/autocircular"
ETC_ROOT=${Z2M_MANAGER_ETC_ROOT:-/etc/zapret2-manager}

[ -d "$SRC" ] || { printf '{"ok":false,"missing":["SRC:%s"],"mismatched":[],"count":0}\n' "$SRC"; exit 1; }
# The runtime base itself is owned by the engine payload/installer; only its
# direct children are created here (no recursive traversal), and re-running
# over an existing tree is a no-op per directory.
ensure_dir() { [ -d "$1" ] || mkdir "$1"; }
ensure_dir "$BASE/files"
ensure_dir "$BASE/files/fake"
ensure_dir "$BASE/lua"
ensure_dir "$BASE/lists"
ensure_dir "$BASE/ipset"
# nfqws2 drops privileges to nobody before reading Lua/blobs: keep the
# runtime asset directories world-traversable regardless of caller umask.
chmod 0755 "$BASE" "$BASE/files" "$BASE/files/fake" "$BASE/lua" "$BASE/lists" "$BASE/ipset" 2>/dev/null || true
[ -e "$BASE/bin" ] || ln -s "$BASE/files/fake" "$BASE/bin"
ensure_dir "$ETC_ROOT/lists"
[ -f "$ETC_ROOT/lists/whitelist.txt" ] || touch "$ETC_ROOT/lists/whitelist.txt"

# The nfqws2 daemon persists circular host bindings while rpcd reads them from
# the canonical Z2M state path. Keep this narrow state directory writable by
# daemon without widening permissions on the rest of /etc/zapret2-manager.
ensure_dir "$STATE_ROOT"
ensure_dir "$STATE_DIR"
if [ "$(id -u)" = "0" ]; then
	chown root:daemon "$STATE_ROOT" 2>/dev/null || true
	chmod 0750 "$STATE_ROOT"
	chown root:daemon "$STATE_DIR" 2>/dev/null || true
	chmod 0770 "$STATE_DIR"
fi
if [ ! -e "$STATE_DIR/state.tsv" ]; then
	: > "$STATE_DIR/state.tsv"
fi
if [ "$(id -u)" = "0" ]; then
	chown root:daemon "$STATE_DIR/state.tsv" 2>/dev/null || true
	chmod 0660 "$STATE_DIR/state.tsv"
fi

CORE_LUA='zapret-lib.lua zapret-antidpi.lua zapret-auto.lua zapret-obfs.lua zapret-pcap.lua zapret-tests.lua'
is_core_lua() {
	for name in $CORE_LUA; do
		[ "$1" = "$name" ] && return 0
	done
	return 1
}

copy_if_missing_or_custom() {
	_src="$1"
	_dst="$2"
	if is_core_lua "${_src##*/}" && [ -e "$_dst" ]; then
		return 0
	fi
	cp "$_src" "$_dst"
	chmod 0644 "$_dst"
}

materialize() {
	for _src in "$SRC"/bin/*; do
		[ -f "$_src" ] || continue
		copy_if_missing_or_custom "$_src" "$BASE/files/fake/${_src##*/}"
	done
	for _src in "$SRC"/lua/*; do
		[ -f "$_src" ] || continue
		copy_if_missing_or_custom "$_src" "$BASE/lua/${_src##*/}"
	done
	for _src in "$SRC"/lists/*; do
		[ -f "$_src" ] || continue
		# The catalog carries the option kind; keeping the bundled file in both
		# trusted roots makes a missing kind mapping impossible at Apply time.
		copy_if_missing_or_custom "$_src" "$BASE/lists/${_src##*/}"
		copy_if_missing_or_custom "$_src" "$BASE/ipset/${_src##*/}"
	done
}

# Keep the official OpenWrt init chain aligned with native-preflight. These
# package-owned extensions provide the z2k functions referenced by catalog
# Strategies; without them the daemon starts but silently cannot execute those
# profiles.
align_luaopt() {
	for INIT in "$BASE/init.d/openwrt/zapret2" /etc/init.d/zapret2; do
		if [ -f "$INIT" ] && grep -q '^LUAOPT=' "$INIT"; then
			sed -i 's|^LUAOPT=.*|LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua --lua-init=@$ZAPRET_BASE/lua/zapret-auto.lua --lua-init=@$ZAPRET_BASE/lua/z2k-modern-core.lua --lua-init=@$ZAPRET_BASE/lua/z2k-detectors.lua --lua-init=@$ZAPRET_BASE/lua/z2k-fooling-ext.lua --lua-init=@$ZAPRET_BASE/lua/z2k-state-persist.lua"|' "$INIT"
		fi
	done
}

verify() {
	files=''
	first=1
	missing=''
	mismatched=''
	count=0
	add_verdict() {
		_rel="$1"; _installed="$2"
		if [ ! -f "$_installed" ]; then
			missing="$missing${missing:+, }\"$_rel\""
		elif [ "$(sha256sum "$_installed" | awk '{print $1}')" != "$(sha256sum "$1" | awk '{print $1}')" ]; then
			mismatched="$mismatched${mismatched:+, }\"$_rel\""
		else
			files="$files${files:+, }{\"path\":\"$_rel\",\"sha256\":\"$(sha256sum "$_installed" | awk '{print $1}')\"}"
			count=$((count + 1))
		fi
	}
	for _src in "$SRC"/bin/*; do
		[ -f "$_src" ] || continue
		add_verdict "$_src" "$BASE/files/fake/${_src##*/}"
	done
	for _src in "$SRC"/lua/*; do
		[ -f "$_src" ] || continue
		add_verdict "$_src" "$BASE/lua/${_src##*/}"
	done
	for _src in "$SRC"/lists/*; do
		[ -f "$_src" ] || continue
		add_verdict "$_src" "$BASE/lists/${_src##*/}"
		add_verdict "$_src" "$BASE/ipset/${_src##*/}"
	done
	ok=1
	[ -z "$missing" ] || ok=0
	[ -z "$mismatched" ] || ok=0
	# A zero-file verdict means the package baseline was absent: Z2K cannot
	# be materialized from nothing. Fail closed.
	[ "$count" -ge 1 ] || ok=0
	ok_json=false
	[ "$ok" = 1 ] && ok_json=true
	printf '{"ok":%s,"files":[%s],"missing":[%s],"mismatched":[%s],"count":%s}\n' \
		"$ok_json" "$files" "$missing" "$mismatched" "$count"
	[ "$ok" = 1 ]
}

case "${1:-}" in
--verify)
	verify
	;;
'')
	materialize
	align_luaopt
	exit 0
	;;
*)
	printf 'usage: %s [--verify]\n' "$0" >&2
	exit 2
	;;
esac
