#!/bin/sh
set -eu

# Bundled Strategy assets are package-owned inputs for the official nfqws2
# runtime. Existing upstream core Lua is never downgraded by this hook; custom
# Lua/blobs/lists are installed idempotently and are never deleted.
SRC=/usr/share/zapret2-manager/runtime-assets
BASE=/opt/zapret2
STATE_DIR=/etc/zapret2-manager/state/autocircular
STATE_ROOT=/etc/zapret2-manager/state

[ -d "$SRC" ] || exit 0
mkdir -p "$BASE/files/fake" "$BASE/lua" "$BASE/lists" "$BASE/ipset"
[ -e "$BASE/bin" ] || ln -s "$BASE/files/fake" "$BASE/bin"
mkdir -p /etc/zapret2-manager/lists
[ -f /etc/zapret2-manager/lists/whitelist.txt ] || touch /etc/zapret2-manager/lists/whitelist.txt

# The nfqws2 daemon persists circular host bindings while rpcd reads them from
# the canonical Z2M state path. Keep this narrow state directory writable by
# daemon without widening permissions on the rest of /etc/zapret2-manager.
mkdir -p "$STATE_DIR"
# The daemon must be able to traverse the state root before the narrower
# autocircular directory permissions can take effect. Keep the root itself
# non-world-readable while granting only daemon traversal.
chown root:daemon "$STATE_ROOT"
chmod 0750 "$STATE_ROOT"
chown root:daemon "$STATE_DIR"
chmod 0770 "$STATE_DIR"
if [ ! -e "$STATE_DIR/state.tsv" ]; then
	: > "$STATE_DIR/state.tsv"
fi
chown root:daemon "$STATE_DIR/state.tsv"
chmod 0660 "$STATE_DIR/state.tsv"

copy_if_missing_or_custom() {
	_src="$1"
	_dst="$2"
	_name=${_src##*/}
	case "$_name" in
		zapret-lib.lua|zapret-antidpi.lua|zapret-auto.lua|zapret-obfs.lua|zapret-pcap.lua|zapret-tests.lua)
			[ -e "$_dst" ] && return 0
			;;
	esac
	cp "$_src" "$_dst"
	chmod 0644 "$_dst"
}

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

# Keep the official OpenWrt init chain aligned with native-preflight. These
# package-owned extensions provide the z2k functions referenced by catalog
# Strategies; without them the daemon starts but silently cannot execute those
# profiles.
for INIT in "$BASE/init.d/openwrt/zapret2" /etc/init.d/zapret2; do
	if [ -f "$INIT" ] && grep -q '^LUAOPT=' "$INIT"; then
		sed -i 's|^LUAOPT=.*|LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua --lua-init=@$ZAPRET_BASE/lua/zapret-auto.lua --lua-init=@$ZAPRET_BASE/lua/z2k-modern-core.lua --lua-init=@$ZAPRET_BASE/lua/z2k-detectors.lua --lua-init=@$ZAPRET_BASE/lua/z2k-fooling-ext.lua --lua-init=@$ZAPRET_BASE/lua/z2k-state-persist.lua"|' "$INIT"
	fi
done

exit 0
