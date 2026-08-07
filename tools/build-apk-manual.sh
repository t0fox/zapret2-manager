#!/bin/sh
# tools/build-apk-manual.sh — build zapret2-manager + luci-app .apk directly.
#
# WHY THIS EXISTS (read before judging it a hack):
# The standard `make package/zapret2-manager/compile` path is blocked by a
# hard coupling in the OpenWrt build system: a package with DEPENDS:=zapret2
# cannot be selected (CONFIG_PACKAGE_*=y) unless zapret2 is also selected, and
# selecting zapret2 makes `make` download+compile the upstream engine
# (bol-van/zapret2) — which the task explicitly forbids (upstream ships as a
# prebuilt .apk from remittor/zapret-openwrt releases) and which fails here
# anyway (SDK lacks libcap/zlib/luajit build deps). With zapret2 deselected,
# `make oldconfig` downgrades zapret2-manager off (=m→unset), so no .apk is
# packaged. Both DEPENDS spellings deadlock; the build system offers no way to
# say "runtime dep, do not build".
#
# This script produces the SAME .apk the Makefile would, using the SDK's own
# apk-tools (staging_dir/host/bin/apk mkpkg under fakeroot) — i.e. built in the
# SDK, just without the forced upstream compile. File tree + permissions + the
# postinst/postrm scripts mirror the Makefile's Package/install and
# Package/postinst definitions exactly. Metadata (name/version/arch/depends/
# license/maintainer/origin) mirrors the Makefile. Run on the WSL host that has
# the SDK; the repo is reached via /mnt/g/zapret2-manager.
#
# Usage (from Git Bash, MSYS_NO_PATHCONV=1 protects the /mnt/g path):
#   MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/g/zapret2-manager/tools/build-apk-manual.sh
# Output: <SDK>/bin/packages/aarch64_cortex-a53/zapret2-manager/*.apk

set -eu

# $HOME does not expand in an assignment in `bash -c` (non-login) — it stays empty,
# leaving SDK empty and apk mkpkg unable to find its binary. cd into the SDK
# dir with a literal path, then SDK=$PWD.
cd /home/kirill/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64
SDK="$PWD"
REPO="${REPO:-/mnt/g/zapret2-manager}"
# Default arch is the device arch, NOT "all": the manager contains a target-built
# helper, and apk 3.0.5 refuses `arch: all` packages from a local v3 repo as
# "uninstallable". This script targets the mediatek-filogic device, so
# aarch64_cortex-a53 produces installable apks. Override with ARCH=.
ARCH="${ARCH:-aarch64_cortex-a53}"
APK="$SDK/staging_dir/host/bin/apk"
FAKE="$SDK/staging_dir/host/bin/fakeroot"
# fakeroot finds libfakeroot.so via STAGING_DIR_HOST (the script sets
# FAKEROOT_LIB=${STAGING_DIR_HOST}/lib/libfakeroot.so). Without it, fakeroot
# aborts with "preload library libfakeroot.so not found".
export STAGING_DIR_HOST="$SDK/staging_dir/host"
# mktemp in this WSL defaults to /tmp which is root-owned (drwxrwxrwt) — the
# invoking user (kirill) can create files in it but NOT subdirectories, so
# `mkdir -p` inside the mktemp dir fails with "Permission denied". Use a
# TMPDIR inside the user's home (writable) so mktemp creates the build root there.
export TMPDIR="${TMPDIR:-$HOME/z2m-build}"
# Sign ALL packages with the project's private key. The router trusts the
# corresponding public key at /etc/apk/keys/z2m-build.pub (SHA-256
# c885bf8fa1cb0f0e501bd405ab3af21614f108c8ab2dbb78814656ce34b82998).
# Install the key into the SDK trust store so mkndx can verify APK signatures.
APK_SIGN_KEY="$SDK/private-key.pem"
mkdir -p "$SDK/staging_dir/etc/apk/keys"
cp "$SDK/public-key.pem" "$SDK/staging_dir/etc/apk/keys/z2m-build.pub"

OUTDIR="$SDK/bin/packages/aarch64_cortex-a53/zapret2-manager"
mkdir -p "$OUTDIR"

# Package metadata is the version authority. M8 keeps the backend, LuCI and
# full-stack release synchronized, but the manual builder still reads each
# package's own Makefile so an accidental divergence cannot mislabel an APK.
# VER= remains an explicit reproducible-build override for all three.
package_version() {
  _pkg="$1"
  _pv="$(sed -n 's/^PKG_VERSION:=//p' "$REPO/$_pkg/Makefile" | head -1)"
  _pr="$(sed -n 's/^PKG_RELEASE:=//p' "$REPO/$_pkg/Makefile" | head -1)"
  [ -n "$_pv" ] && [ -n "$_pr" ] || { echo "FATAL: package version missing for $_pkg" >&2; exit 1; }
  printf '%s-r%s' "$_pv" "$_pr"
}
MGR_VER="${VER:-$(package_version zapret2-manager)}"
LUCI_VER="${VER:-$(package_version luci-app-zapret2-manager)}"
FULL_VER="${VER:-$(package_version zapret2-manager-full)}"

# mkfile <path> — write a postinst/postrm body from stdin to a temp file.
# Use a unique file in a writable home dir: mktemp in WSL defaults to root-owned
# /tmp, and a fixed path would make the post-install and post-deinstall scripts
# (luci-app builds two) overwrite each other.
mkscript() { mkdir -p "$HOME/z2m-build"; f=$(mktemp "$HOME/z2m-build/script.XXXXXX"); cat > "$f"; chmod 0755 "$f"; echo "$f"; }

build_one() {
  _name="$1"; _desc="$2"; _deps="$3"; _root="$4"; _postinst="$5"; _postrm="${6:-}"
  _provides="${7:-}"
  _preinst="${8:-}"
  _ver="${9:-$VER}"
  _out="$OUTDIR/${_name}-${_ver}.apk"
  set -- "$FAKE" "$APK" mkpkg
  set -- "$@" --info "name:${_name}"
  set -- "$@" --info "version:${_ver}"
  set -- "$@" --info "description:${_desc}"
  set -- "$@" --info "arch:${ARCH}"
  set -- "$@" --info "license:MIT"
  set -- "$@" --info "maintainer:Ásgeir"
  set -- "$@" --info "origin:package/${_name}"
  # depends is emitted only when non-empty: the static-musl proxy binary has
  # NO runtime deps, and an empty `depends:` info line is an untested input.
  [ -n "$_deps" ] && set -- "$@" --info "depends:${_deps}"
  [ -n "$_provides" ] && set -- "$@" --info "provides:${_provides}"
  [ -n "$_preinst"  ] && set -- "$@" --script "pre-install:${_preinst}"
  [ -n "$_postinst" ] && set -- "$@" --script "post-install:${_postinst}"
  [ -n "$_postrm"   ] && set -- "$@" --script "post-deinstall:${_postrm}"
  set -- "$@" --files "$_root" --output "$_out"
  # Sign if a key is provided. apk v3's solver refuses a bare unsigned local
  # .apk as "uninstallable": `apk add file.apk` adds a world pin `name><identity`
  # and the solver cannot match the unsigned file to it. A signature gives the
  # package a verifiable identity so the pin resolves. The router trusts this
  # package via /etc/apk/keys/z2m-build.pub — --allow-untrusted is FORBIDDEN.
  [ -n "${APK_SIGN_KEY:-}" ] && set -- "$@" --sign-key "$APK_SIGN_KEY"
  "$@"
  echo "built: $_out"
  "$APK" manifest "$_out" 2>/dev/null | grep -E "^(name|version|arch|depends):" || true
}

# ---- z2m-core-helper build ---------------------------------------------------
TOOLCHAIN="$(echo "$SDK"/staging_dir/toolchain-*)"
TARGET="$(echo "$SDK"/staging_dir/target-*)"
TARGET_CC="$(echo "$TOOLCHAIN"/bin/*-openwrt-linux-musl-gcc)"
[ -x "$TARGET_CC" ] || { echo "FATAL: target compiler not found: $TARGET_CC" >&2; exit 1; }
[ -d "$TARGET/usr/include" ] && [ -d "$TARGET/usr/lib" ] \
  || { echo "FATAL: target sysroot not found: $TARGET" >&2; exit 1; }
HELPER_BUILD="$HOME/z2m-build/z2m-core-helper"
mkdir -p "$HELPER_BUILD"
"$TARGET_CC" --sysroot="$TARGET" -I"$TARGET/usr/include" -L"$TARGET/usr/lib" \
  -std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
  "$REPO/zapret2-manager/src/z2m-core-helper/atomic.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/base64.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/errors.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/files.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/main.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/mkdir.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/paths.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/protocol.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/roots.c" \
  "$REPO/zapret2-manager/src/z2m-core-helper/sha256.c" \
  -ljson-c -o "$HELPER_BUILD/z2m-core-helper"

# ---- zapret2-manager ---------------------------------------------------------
# Stage the package root $R per-file (mkdir -p each target dir, install -m each
# file), then `apk mkpkg --files $R` packages the whole tree. An earlier build
# failed with "failed to load script: Is a directory" — that was an arg-shift
# bug (the postinst slot received $R), NOT `--files <dir>`, which works fine.
R="$HOME/z2m-build/root"
mkdir -p "$R/etc/zapret2-manager/ipset" "$R/usr/libexec/zapret2-manager" \
         "$R/usr/share/rpcd/ucode" "$R/etc/hotplug.d/iface" "$R/etc/init.d" "$R/etc/zapret2-manager/presets" "$R/usr/share/zapret2-manager/presets"
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/state.json" \
                "$R/etc/zapret2-manager/state.json"
# Keep the manual package tree faithful to Package/zapret2-manager/install:
# upstream owns nfqws2 but its persisted argv references these two inputs.
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/ipset/games.txt" \
                "$R/etc/zapret2-manager/ipset/games.txt"
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/ipset/steam.txt" \
                "$R/etc/zapret2-manager/ipset/steam.txt"
for f in "$REPO/zapret2-manager/files/usr/share/zapret2-manager/presets"/*.txt; do install -m 0644 "$f" "$R/usr/share/zapret2-manager/presets/"; done
# Backend ucode is enumerated with a GLOB, not a hardcoded list (a per-file
# list silently drops new modules — the exact defect class the packaging gate
# covers for the Makefile; this script had it for the manual build).
for f in "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager"/*.uc; do
  install -m 0644 "$f" "$R/usr/libexec/zapret2-manager/"
done
for f in "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager"/*.sh; do
  install -m 0755 "$f" "$R/usr/libexec/zapret2-manager/"
done
# the declarative list-path model (router-derived manifest consumed by lists.uc)
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/lists-model.json" \
                "$R/usr/libexec/zapret2-manager/lists-model.json"
# the Service Catalog dataset (package-owned; the backend fails closed without it)
mkdir -p "$R/usr/libexec/zapret2-manager/catalog"
mkdir -p "$R/usr/libexec/zapret2-manager/services"
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/services/discord.json" \
                "$R/usr/libexec/zapret2-manager/services/discord.json"
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/catalog/services.json" \
                "$R/usr/libexec/zapret2-manager/catalog/services.json"
# every catalog dataset file (dns-providers.json today; glob, not a list —
# a new dataset silently dropped by an enumeration would fail closed on target)
for f in "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/catalog"/*.json; do
  install -m 0644 "$f" "$R/usr/libexec/zapret2-manager/catalog/"
done
# rpcd ucode plugin: install WITHOUT extension, matching the on-device `luci`
# plugin (/usr/share/rpcd/ucode/luci, no .uc). rpcd ucode.so scans the dir and
# loads each file; keeping .uc would diverge from convention.
install -m 0644 "$REPO/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc" \
                "$R/usr/share/rpcd/ucode/zapret2-manager"
install -m 0755 "$REPO/zapret2-manager/files/etc/hotplug.d/iface/90-zapret2-manager" \
                "$R/etc/hotplug.d/iface/90-zapret2-manager"
install -m 0755 "$REPO/zapret2-manager/files/etc/init.d/zapret2-manager" \
                "$R/etc/init.d/zapret2-manager"
install -m 0755 "$HELPER_BUILD/z2m-core-helper" \
                "$R/usr/libexec/zapret2-manager/z2m-core-helper"
# state.json preservation across upgrades: apk v3 mkpkg has no conffiles
# field, and an upgrade REPLACES package-owned files — drafts would be wiped.
# pre-install snapshots the live state; post-install restores it ONLY when
# the freshly installed file is the stock skeleton ({}) — a stock install
# never clobbers operator drafts, a deliberate stock downgrade is still
# possible by deleting state.json.prepkg first. (.bak rotation also persists,
# being package-unowned.)
ZPRE=$(mkscript <<'EOF'
#!/bin/sh
[ -f /etc/zapret2-manager/state.json ] && cp -f /etc/zapret2-manager/state.json /etc/zapret2-manager/state.json.prepkg 2>/dev/null
exit 0
EOF
)
ZPI=$(mkscript <<'EOF'
#!/bin/sh
if [ -f /etc/zapret2-manager/state.json.prepkg ]; then
	if [ "$(cat /etc/zapret2-manager/state.json 2>/dev/null)" = "{}" ]; then
		cp -f /etc/zapret2-manager/state.json.prepkg /etc/zapret2-manager/state.json 2>/dev/null
	fi
	rm -f /etc/zapret2-manager/state.json.prepkg
fi
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
EOF
)
build_one "zapret2-manager" \
  "Management backend for upstream zapret2" \
  "zapret2 ucode libjson-c" \
  "$R" "$ZPI" "" "" "$ZPRE" "$MGR_VER"
rm -rf "$R" "$ZPI" "$ZPRE"

# ---- luci-app-zapret2-manager ------------------------------------------------
# Stage the package root $R. acl/menu are single files; the view directory is
# enumerated with a glob (NOT a hardcoded list) so every shipped page is
# included automatically — a per-file list silently drops pages when the UI
# grows). Recursive enumeration = no dropped pages.
R="$HOME/z2m-build/root"
VIEW="$REPO/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager"
mkdir -p "$R/usr/share/rpcd/acl.d" "$R/usr/share/luci/menu.d" "$R/www/luci-static/resources/view/zapret2-manager"
install -m 0644 "$REPO/luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json" \
                "$R/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json"
install -m 0644 "$REPO/luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json" \
                "$R/usr/share/luci/menu.d/luci-app-zapret2-manager.json"
for js in "$VIEW"/*.js; do
  install -m 0644 "$js" "$R/www/luci-static/resources/view/zapret2-manager/"
done
for css in "$VIEW"/*.css; do
  [ -f "$css" ] && install -m 0644 "$css" "$R/www/luci-static/resources/view/zapret2-manager/"
done
LPI=$(mkscript <<'EOF'
#!/bin/sh
rm -f /var/luci-indexcache
rm -rf /var/luci-modulecache/* 2>/dev/null || true
/etc/init.d/rpcd reload
/etc/init.d/uhttpd reload
exit 0
EOF
)
LPR=$(mkscript <<'EOF'
#!/bin/sh
rm -f /var/luci-indexcache
rm -rf /var/luci-modulecache/* 2>/dev/null || true
exit 0
EOF
)
build_one "luci-app-zapret2-manager" \
  "LuCI frontend for zapret2-manager" \
  "luci-base zapret2-manager" \
  "$R" "$LPI" "$LPR" "" "" "$LUCI_VER"
rm -rf "$R" "$LPI" "$LPR"

# ---- tg-ws-proxy-rs (optional, pinned upstream binary) ------------------------
# PIN IS THE TRUST ANCHOR: version + SHA-256 are read from the package Makefile
# (single source — docs/research/tg-ws-proxy-provider.md records the ADR pin);
# the URL is the pinned GitHub RELEASE asset (never a "latest" endpoint). The
# asset is downloaded ON THE BUILD HOST (never on the router, never from LuCI)
# and the build FAILS CLOSED on any hash mismatch.
_TGV="$(sed -n 's/^PKG_VERSION:=//p' "$REPO/tg-ws-proxy-rs/Makefile" | head -1)"
_TGR="$(sed -n 's/^PKG_RELEASE:=//p' "$REPO/tg-ws-proxy-rs/Makefile" | head -1)"
_TGH="$(sed -n 's/^PKG_HASH:=//p'   "$REPO/tg-ws-proxy-rs/Makefile" | head -1)"
TGWS_PKG_VER="${_TGV:?PKG_VERSION missing in tg-ws-proxy-rs/Makefile}-r${_TGR:?PKG_RELEASE missing}"
TGWS_ASSET="tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz"
TGWS_URL="https://github.com/valnesfjord/tg-ws-proxy-rs/releases/download/v${_TGV}/${TGWS_ASSET}"
TGWS_SHA256="${_TGH:?PKG_HASH missing in tg-ws-proxy-rs/Makefile}"
TGWS_DL="$HOME/z2m-build/$TGWS_ASSET"
if [ ! -f "$TGWS_DL" ]; then
  echo "downloading pinned asset: $TGWS_URL"
  curl -fSL -o "$TGWS_DL" "$TGWS_URL"
fi
echo "$TGWS_SHA256  $TGWS_DL" | sha256sum -c - \
  || { echo "FATAL: pinned asset SHA-256 mismatch for $TGWS_ASSET — refusing to package" >&2; exit 1; }
R="$HOME/z2m-build/root"
mkdir -p "$R/usr/bin" "$R/etc/init.d" "$R/etc/tg-ws-proxy" \
         "$R/usr/share/licenses/tg-ws-proxy-rs"
tar -xzf "$TGWS_DL" -C "$HOME/z2m-build"   # the asset is exactly one file: ./tg-ws-proxy
install -m 0755 "$HOME/z2m-build/tg-ws-proxy" "$R/usr/bin/tg-ws-proxy"
install -m 0755 "$REPO/tg-ws-proxy-rs/files/etc/init.d/tg-ws-proxy" \
                "$R/etc/init.d/tg-ws-proxy"
install -m 0600 "$REPO/tg-ws-proxy-rs/files/etc/tg-ws-proxy/config.conf" \
                "$R/etc/tg-ws-proxy/config.conf"
install -m 0644 "$REPO/tg-ws-proxy-rs/files/usr/share/licenses/tg-ws-proxy-rs/LICENSE" \
                "$R/usr/share/licenses/tg-ws-proxy-rs/LICENSE"
TPI=$(mkscript <<'EOF'
#!/bin/sh
# no enable, no start: first run is an explicit operator action via
# zapret2-manager (proxy_config_apply / proxy_start), never an install side
# effect.
exit 0
EOF
)
build_one "tg-ws-proxy-rs" \
  "Telegram MTProto WebSocket bridge proxy (valnesfjord/tg-ws-proxy-rs, pinned+SHA-256-verified; /etc/tg-ws-proxy config+secret are operator state)" \
  "" \
  "$R" "$TPI" "" "" "" "$TGWS_PKG_VER"
rm -rf "$R" "$TPI" "$HOME/z2m-build/tg-ws-proxy"

# ---- Bundle tg-ws-proxy-rs .apk inside zapret2-manager (persistent local feed) -
# The built tg-ws-proxy-rs .apk is copied into zapret2-manager's data directory
# along with a TRUSTED signed index — both are immutable build artifacts. The
# index is signed with the build host's private key so that the router (which
# trusts z2m-build.pub in /etc/apk/keys/) can install from this local feed
# WITHOUT --allow-untrusted. The postinst MUST NOT rebuild or re-sign the
# index; the pre-built signed index ships inside the .apk.
_TGWS_APK="$OUTDIR/tg-ws-proxy-rs-${TGWS_PKG_VER}.apk"
_TGWS_BUNDLE="tg-ws-proxy-rs-${TGWS_PKG_VER}.apk"
_FEED_DIR="$HOME/z2m-build/feed"
rm -rf "$_FEED_DIR"
mkdir -p "$_FEED_DIR"
cp "$_TGWS_APK" "$_FEED_DIR/$_TGWS_BUNDLE"
# Create the signed index at build time. The SDK trust store already has
# z2m-build.pub (set up at the top of this script). The index is signed with
# the private key; the router verifies the index signature at install time
# using the same public key in /etc/apk/keys/z2m-build.pub.
echo "Signing feed index with $SDK/private-key.pem"
"$APK" mkndx --keys-dir "$SDK/staging_dir/etc/apk/keys" \
  --sign-key "$SDK/private-key.pem" -o "$_FEED_DIR/packages.adb" \
  "$_FEED_DIR"/*.apk

# ---- zapret2-manager (rebuild with bundled tg-ws-proxy-rs feed) ----------------
R="$HOME/z2m-build/root"
mkdir -p "$R/etc/zapret2-manager/ipset" "$R/usr/libexec/zapret2-manager" \
         "$R/usr/share/rpcd/ucode" "$R/etc/hotplug.d/iface" "$R/etc/init.d" \
         "$R/usr/share/zapret2-manager/feed" "$R/etc/zapret2-manager/presets" "$R/usr/share/zapret2-manager/presets"
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/state.json" \
                "$R/etc/zapret2-manager/state.json"
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/ipset/games.txt" \
                "$R/etc/zapret2-manager/ipset/games.txt"
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/ipset/steam.txt" \
                "$R/etc/zapret2-manager/ipset/steam.txt"
for f in "$REPO/zapret2-manager/files/usr/share/zapret2-manager/presets"/*.txt; do install -m 0644 "$f" "$R/usr/share/zapret2-manager/presets/"; done
for f in "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager"/*.uc; do
  install -m 0644 "$f" "$R/usr/libexec/zapret2-manager/"
done
for f in "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager"/*.sh; do
  install -m 0755 "$f" "$R/usr/libexec/zapret2-manager/"
done
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/lists-model.json" \
                "$R/usr/libexec/zapret2-manager/lists-model.json"
mkdir -p "$R/usr/libexec/zapret2-manager/catalog"
mkdir -p "$R/usr/libexec/zapret2-manager/services"
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/services/discord.json" \
                "$R/usr/libexec/zapret2-manager/services/discord.json"
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/catalog/services.json" \
                "$R/usr/libexec/zapret2-manager/catalog/services.json"
for f in "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/catalog"/*.json; do
  install -m 0644 "$f" "$R/usr/libexec/zapret2-manager/catalog/"
done
install -m 0644 "$REPO/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc" \
                "$R/usr/share/rpcd/ucode/zapret2-manager"
install -m 0755 "$REPO/zapret2-manager/files/etc/hotplug.d/iface/90-zapret2-manager" \
                "$R/etc/hotplug.d/iface/90-zapret2-manager"
install -m 0755 "$REPO/zapret2-manager/files/etc/init.d/zapret2-manager" \
                "$R/etc/init.d/zapret2-manager"
install -m 0755 "$HELPER_BUILD/z2m-core-helper" \
                "$R/usr/libexec/zapret2-manager/z2m-core-helper"
# Bundle the tg-ws-proxy-rs .apk + signed index for persistent local feed
install -m 0644 "$HOME/z2m-build/feed/$_TGWS_BUNDLE" \
                "$R/usr/share/zapret2-manager/feed/$_TGWS_BUNDLE"
install -m 0644 "$HOME/z2m-build/feed/packages.adb" \
                "$R/usr/share/zapret2-manager/feed/packages.adb"
# Also bundle the .sig if mkndx produced one (apk 3.0.5+ embeds .sig in
# packages.adb as a tail section; a standalone .sig is optional)
if [ -f "$HOME/z2m-build/feed/packages.adb.sig" ]; then
  install -m 0644 "$HOME/z2m-build/feed/packages.adb.sig" \
                  "$R/usr/share/zapret2-manager/feed/packages.adb.sig"
fi
ZPRE=$(mkscript <<'EOF'
#!/bin/sh
[ -f /etc/zapret2-manager/state.json ] && cp -f /etc/zapret2-manager/state.json /etc/zapret2-manager/state.json.prepkg 2>/dev/null
exit 0
EOF
)
ZPI=$(mkscript <<'EOF'
#!/bin/sh
if [ -f /etc/zapret2-manager/state.json.prepkg ]; then
	if [ "$(cat /etc/zapret2-manager/state.json 2>/dev/null)" = "{}" ]; then
		cp -f /etc/zapret2-manager/state.json.prepkg /etc/zapret2-manager/state.json 2>/dev/null
	fi
	rm -f /etc/zapret2-manager/state.json.prepkg
fi
# The signed feed was pre-built and bundled at build time (see the build
# script). The router trusts the index via /etc/apk/keys/z2m-build.pub.
# No runtime index rebuild is needed — the index is an immutable artifact.
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
EOF
)
build_one "zapret2-manager" \
  "Management backend for upstream zapret2" \
  "zapret2 ucode libjson-c" \
  "$R" "$ZPI" "" "" "$ZPRE" "$MGR_VER"
rm -rf "$R" "$ZPI" "$ZPRE"

# ---- zapret2-manager-full (meta-package: one-command install of the full stack) -
# Empty package root — no files to install. Dependencies are carried in metadata.
R="$HOME/z2m-build/root"
mkdir -p "$R"
build_one "zapret2-manager-full" \
  "Full zapret2-manager stack (backend + LuCI + TG proxy) — one-command install" \
  "zapret2-manager luci-app-zapret2-manager tg-ws-proxy-rs" \
  "$R" "" "" "" "" "$FULL_VER"
rm -rf "$R"

# ---- Create deploy-level signed index (all packages, for deploy.sh) ------------
# The index in $FEED_DIR only contains tg-ws-proxy-rs (for the bundled feed).
# This one indexes ALL built packages so deploy.sh can install the meta-package
# via apk add --repository <packages.adb> zapret2-manager-full.
echo "Signing deploy index with $SDK/private-key.pem"
"$APK" mkndx --keys-dir "$SDK/staging_dir/etc/apk/keys" \
  --sign-key "$SDK/private-key.pem" -o "$OUTDIR/packages.adb" \
  "$OUTDIR"/*.apk

echo "all done → $OUTDIR"
ls -l "$OUTDIR"/*.apk "$OUTDIR/packages.adb"

# ---- INSTALL (apk v3 local-repo procedure, TRUSTED — no --allow-untrusted) ---
# `apk add /tmp/file.apk` does NOT work for v3 packages: apk 3.0.5 adds a world
# pin `name><identity` and the solver refuses the bare local file as
# "uninstallable" (signing alone does not fix it). A v3 repository INDEX is
# required. Build the index with mkndx, point --repository at the packages.adb
# FILE (not the dir — apk searches the dir only for v2 APKINDEX.tar.gz), and
# match the device arch (arch:all is refused from a local v3 repo):
#
#   APK="$SDK/staging_dir/host/bin/apk"
#   REPODIR=/tmp/z2mrepo/aarch64_cortex-a53
#   mkdir -p "$REPODIR" && cp "$OUTDIR"/*.apk "$REPODIR"/
#   "$APK" mkndx --sign-key "$SDK/private-key.pem" \
#     -o "$REPODIR/packages.adb" "$REPODIR"/*.apk
#
# TRUSTED INSTALL (the only permitted path — --allow-untrusted is FORBIDDEN for
# these packages): copy the signing PUBLIC key onto the device once,
#   scp "$SDK/public-key.pem" root@<router>:/etc/apk/keys/z2m-local.pem
# then install the full stack in one command:
#   apk add --repository /tmp/z2mrepo/aarch64_cortex-a53/packages.adb \
#     zapret2-manager-full
# Or install individual packages:
#   apk add --repository /tmp/z2mrepo/aarch64_cortex-a53/packages.adb \
#     zapret2-manager luci-app-zapret2-manager tg-ws-proxy-rs
