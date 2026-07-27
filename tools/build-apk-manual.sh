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

SDK="${OPENWRT_SDK:-$HOME/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64}"
REPO="${REPO:-/mnt/g/zapret2-manager}"
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

VER="0.1.0-r1"

# mkfile <path> — write a postinst/postrm body from stdin to a temp file.
mkscript() { f=$(mktemp); cat > "$f"; chmod 0755 "$f"; echo "$f"; }

build_one() {
  _name="$1"; _desc="$2"; _deps="$3"; _root="$4"; _postinst="$5"; _postrm="${6:-}"
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
  [ -n "$_postinst" ] && set -- "$@" --script "post-install:${_postinst}"
  [ -n "$_postrm"   ] && set -- "$@" --script "post-deinstall:${_postrm}"
  set -- "$@" --files "$_root" --output "$_out"
  "$@"
  echo "built: $_out"
  "$APK" manifest "$_out" 2>/dev/null | grep -E "^(name|version|arch|depends):" || true
}

# ---- zapret2-manager ---------------------------------------------------------
# Standard LuCI app build copies the view/system/library directories wholesale.
# Per-file enumeration is the cause of one view being present and another absent on the
# device (platform fact 1). Copy the directories whole instead.
R="$HOME/z2m-build/root"
# Backend: copy the whole /usr/libexec/zapret2-manager directory (libraries: apply.uc,
# backup.uc, constants.uc, lists.uc, qlen.uc; thin wrappers: service.uc, status.uc,
# watchdog.uc — libraries have no shebang, wrappers do).
mkdir -p "$R/usr/libexec/zapret2-manager"
cp -a "$REPO/zapret2-manager/files/usr/libexec/zapret2-manager/." "$R/usr/libexec/zapret2-manager/"
# rpcd ucode plugin: install WITHOUT extension, matching the on-device `luci`
# plugin (/usr/share/rpcd/ucode/luci, no .uc). rpcd ucode.so scans the dir and
# loads each file; keeping .uc would diverge from convention.
mkdir -p "$R/usr/share/rpcd/ucode"
install -m 0644 "$REPO/zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc" \
                "$R/usr/share/rpcd/ucode/zapret2-manager"
mkdir -p "$R/etc/hotplug.d/iface"
install -m 0755 "$REPO/zapret2-manager/files/etc/hotplug.d/iface/90-zapret2-manager" \
                "$R/etc/hotplug.d/iface/90-zapret2-manager"
mkdir -p "$R/etc/init.d"
install -m 0755 "$REPO/zapret2-manager/files/etc/init.d/zapret2-manager" \
                "$R/etc/init.d/zapret2-manager"
ZPI=$(mkscript <<'EOF'
#!/bin/sh
/etc/init.d/rpcd reload
/etc/init.d/zapret2-manager enable
exit 0
EOF
)
build_one "zapret2-manager" \
  "Management backend for upstream zapret2" \
  "zapret2 ucode" \
  "$R" "$ZPI"
rm -rf "$R" "$ZPI"

# ---- luci-app-zapret2-manager ------------------------------------------------
# Standard LuCI app build copies the view/menu/acl directories wholesale
# (platform fact 1: per-file enumeration drops views).
R="$HOME/z2m-build/root"
mkdir -p "$R/usr/share/rpcd/acl.d" "$R/usr/share/luci/menu.d" "$R/www/luci-static/resources/view/zapret2-manager"
cp -a "$REPO/luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/." "$R/usr/share/rpcd/acl.d/"
cp -a "$REPO/luci-app-zapret2-manager/files/usr/share/luci/menu.d/." "$R/usr/share/luci/menu.d/"
cp -a "$REPO/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/." "$R/www/luci-static/resources/view/zapret2-manager/"
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
