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
# Default arch is the device arch, NOT "all": apk 3.0.5 refuses `arch: all`
# packages from a local v3 repo as "uninstallable" (arch:all is accepted from
# HTTP repos but not local). The Makefile keeps PKGARCH:=all for the official
# SDK/feed build; this manual local-build script targets the mediatek-filogic
# device, so aarch64_cortex-a53 produces installable apks. Override with ARCH=.
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
OUTDIR="$SDK/bin/packages/aarch64_cortex-a53/zapret2-manager"
mkdir -p "$OUTDIR"

# Version comes from the package Makefiles (single source), never a stale
# hardcode: PKG_VERSION + PKG_RELEASE of zapret2-manager (both packages bump
# together in this project). Override with VER=.
_PV="$(sed -n 's/^PKG_VERSION:=//p' "$REPO/zapret2-manager/Makefile" | head -1)"
_PR="$(sed -n 's/^PKG_RELEASE:=//p' "$REPO/zapret2-manager/Makefile" | head -1)"
VER="${VER:-${_PV:-0.1.0}-r${_PR:-1}}"

# mkfile <path> — write a postinst/postrm body from stdin to a temp file.
# Use a unique file in a writable home dir: mktemp in WSL defaults to root-owned
# /tmp, and a fixed path would make the post-install and post-deinstall scripts
# (luci-app builds two) overwrite each other.
mkscript() { mkdir -p "$HOME/z2m-build"; f=$(mktemp "$HOME/z2m-build/script.XXXXXX"); cat > "$f"; chmod 0755 "$f"; echo "$f"; }

build_one() {
  _name="$1"; _desc="$2"; _deps="$3"; _root="$4"; _postinst="$5"; _postrm="${6:-}"
  _provides="${7:-}"
  _preinst="${8:-}"
  _out="$OUTDIR/${_name}-${VER}.apk"
  set -- "$FAKE" "$APK" mkpkg
  set -- "$@" --info "name:${_name}"
  set -- "$@" --info "version:${VER}"
  set -- "$@" --info "description:${_desc}"
  set -- "$@" --info "arch:${ARCH:-all}"
  set -- "$@" --info "license:MIT"
  set -- "$@" --info "maintainer:Ásgeir"
  set -- "$@" --info "origin:package/${_name}"
  set -- "$@" --info "depends:${_deps}"
  [ -n "$_provides" ] && set -- "$@" --info "provides:${_provides}"
  [ -n "$_preinst"  ] && set -- "$@" --script "pre-install:${_preinst}"
  [ -n "$_postinst" ] && set -- "$@" --script "post-install:${_postinst}"
  [ -n "$_postrm"   ] && set -- "$@" --script "post-deinstall:${_postrm}"
  set -- "$@" --files "$_root" --output "$_out"
  # Sign if a key is provided. apk v3's solver refuses a bare unsigned local
  # .apk as "uninstallable": `apk add file.apk` adds a world pin `name><identity`
  # and the solver cannot match the unsigned file to it. A signature gives the
  # package a verifiable identity so the pin resolves. Install with
  # --allow-untrusted (or trust the public key in /etc/apk/keys/).
  [ -n "${APK_SIGN_KEY:-}" ] && set -- "$@" --sign-key "$APK_SIGN_KEY"
  "$@"
  echo "built: $_out"
  "$APK" manifest "$_out" 2>/dev/null | grep -E "^(name|version|arch|depends):" || true
}

# ---- zapret2-manager ---------------------------------------------------------
# Stage the package root $R per-file (mkdir -p each target dir, install -m each
# file), then `apk mkpkg --files $R` packages the whole tree. An earlier build
# failed with "failed to load script: Is a directory" — that was an arg-shift
# bug (the postinst slot received $R), NOT `--files <dir>`, which works fine.
R="$HOME/z2m-build/root"
mkdir -p "$R/etc/zapret2-manager" "$R/usr/libexec/zapret2-manager" \
         "$R/usr/share/rpcd/ucode" "$R/etc/hotplug.d/iface" "$R/etc/init.d"
install -m 0644 "$REPO/zapret2-manager/files/etc/zapret2-manager/state.json" \
                "$R/etc/zapret2-manager/state.json"
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
install -m 0644 "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/catalog/services.json" \
                "$R/usr/libexec/zapret2-manager/catalog/services.json"
# rpcd ucode plugin: install WITHOUT extension, matching the on-device `luci`
# plugin (/usr/share/rpcd/ucode/luci, no .uc). rpcd ucode.so scans the dir and
# loads each file; keeping .uc would diverge from convention.
install -m 0644 "$REPO/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc" \
                "$R/usr/share/rpcd/ucode/zapret2-manager"
install -m 0755 "$REPO/zapret2-manager/files/etc/hotplug.d/iface/90-zapret2-manager" \
                "$R/etc/hotplug.d/iface/90-zapret2-manager"
install -m 0755 "$REPO/zapret2-manager/files/etc/init.d/zapret2-manager" \
                "$R/etc/init.d/zapret2-manager"
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
  "zapret2 ucode" \
  "$R" "$ZPI" "" "" "$ZPRE"
rm -rf "$R" "$ZPI" "$ZPRE"

# ---- luci-app-zapret2-manager ------------------------------------------------
# Stage the package root $R. acl/menu are single files; the view directory is
# enumerated with a glob (NOT a hardcoded list) so every shipped page is
# included automatically — a per-file list silently drops pages when the UI
# grows (the luci-app Makefile has that bug today: it lists only overview.js
# while 8 pages ship). Recursive enumeration = no dropped pages.
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
  "$R" "$LPI" "$LPR"
rm -rf "$R" "$LPI" "$LPR"

echo "all done → $OUTDIR"
ls -l "$OUTDIR"/*.apk

# ---- INSTALL (apk v3 local-repo procedure) -----------------------------------
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
#   "$APK" mkndx --allow-untrusted --sign-key "$SDK/private-key.pem" \
#     -o "$REPODIR/packages.adb" "$REPODIR"/*.apk
#   # on the device: install the signing public key once, then:
#   apk add --repository /tmp/z2mrepo/aarch64_cortex-a53/packages.adb \
#     --allow-untrusted zapret2-manager luci-app-zapret2-manager
