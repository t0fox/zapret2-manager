#!/bin/sh
# tools/deploy.sh — build and install zapret2-manager packages on the router.
#
# Phases (run in order; each may be skipped):
#   build   : compile the two packages with the OpenWrt SDK (needs OPENWRT_SDK)
#   install : scp the .apk to the router and `apk add` them
#   verify  : clear LuCI caches, reload rpcd+uhttpd, check the page loads
#
# Hard rules (docs/architecture.md §7):
#   - ssh rc=255 is a dropped connection, NOT a result → treated as failure.
#   - never restart firewall wholesale. deploy.sh touches no firewall state.
#
# Usage:
#   tools/deploy.sh                 # install+verify to 192.168.1.1
#   tools/deploy.sh build           # also build (needs OPENWRT_SDK=/path)
#   DEPLOY_HOST=192.168.1.1 OPENWRT_SDK=/sdk tools/deploy.sh build install verify
#
# Env:
#   DEPLOY_HOST     router host (default 192.168.1.1)
#   OPENWRT_SDK     path to OpenWrt SDK root (only needed for `build`)

set -u   # no -e: we inspect return codes explicitly (rc=255 rule)

HOST="${DEPLOY_HOST:-192.168.1.1}"
ARCH="${DEPLOY_ARCH:-aarch64_cortex-a53}"
SDK_DIR="${OPENWRT_SDK:-}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

log()  { printf '[deploy] %s\n' "$*"; }
die()  { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

# ssh_run DESC CMD... — run on router; rc=255 = comms failure (die), else return rc.
ssh_run() {
  _desc="$1"; shift
  ssh -o ConnectTimeout=8 -o BatchMode=yes "root@${HOST}" "$@"
  _rc=$?
  [ "$_rc" -eq 255 ] && die "ssh comms failure (rc=255) during: $_desc"
  return "$_rc"
}

scp_to() { scp -O -o ConnectTimeout=8 -o BatchMode=yes "$1" "root@${HOST}:$2" || die "scp failed: $1"; }

# ---- parse phase args --------------------------------------------------------
PHASES=""
for a in "$@"; do
  case "$a" in
    build|install|verify) PHASES="$PHASES $a" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown arg: $a" ;;
  esac
done
[ -z "$PHASES" ] && PHASES=" install verify"   # default: skip build if none given

# ---- build -------------------------------------------------------------------
do_build() {
  [ -z "$SDK_DIR" ] && die "build requested but OPENWRT_SDK not set"
  [ -d "$SDK_DIR" ] || die "OPENWRT_SDK=$SDK_DIR is not a directory"
  log "building in SDK: $SDK_DIR"
  cd "$SDK_DIR" || die "cannot cd to SDK"
  # Feed is expected to be registered (./scripts/feeds link zapret2-manager /path).
  for p in zapret2-manager luci-app-zapret2-manager; do
    log "  make package/$p/compile"
    if ! make "package/$p/compile" V=s; then
      die "build failed for $p"
    fi
  done
  APKDIR="$SDK_DIR/bin/packages/$ARCH"
  log "artifacts under: $APKDIR"
  cd "$HERE"
}

# ---- install -----------------------------------------------------------------
do_install() {
  log "installing on $HOST"
  APK_MGR=""
  APK_MGR=$(ssh_run "detect apk" "command -v apk") || true
  [ -n "$APK_MGR" ] || die "router has no 'apk' binary — wrong package manager (opkg?)"

  # Locate the signed build output
  APKDIR=""
  if [ -n "$SDK_DIR" ] && [ -d "$SDK_DIR/bin/packages/$ARCH/zapret2-manager" ]; then
    APKDIR="$SDK_DIR/bin/packages/$ARCH/zapret2-manager"
  fi
  [ -z "$APKDIR" ] && die "no signed build output found (set OPENWRT_SDK or run tools/build-apk-manual.sh first)"
  [ -f "$APKDIR/packages.adb" ] || die "signed packages.adb not found in $APKDIR — build with tools/build-apk-manual.sh (standard make does not produce a signed index)"

  # Create a temporary v3 repository on the router with the signed artifacts.
  # apk add --repository <file>.adb installs from the signed index — every APK
  # is verified against the feed index signature, which itself must match
  # /etc/apk/keys/z2m-build.pub on the router.
  REPO_DIR="/tmp/z2m-repo"
  ssh_run "create temp repo" "rm -rf $REPO_DIR && mkdir -p $REPO_DIR" || die "cannot create $REPO_DIR on router"

  for f in "$APKDIR"/*.apk; do
    [ -f "$f" ] && scp_to "$f" "$REPO_DIR/$(basename "$f")"
  done
  scp_to "$APKDIR/packages.adb" "$REPO_DIR/packages.adb"
  # Also copy standalone .sig if present (apk 3.0.5+ embeds .sig in packages.adb)
  [ -f "$APKDIR/packages.adb.sig" ] && scp_to "$APKDIR/packages.adb.sig" "$REPO_DIR/packages.adb.sig" || true

  # Install the meta-package — solver resolves all deps through the signed index
  if ssh_run "install zapret2-manager-full" \
    apk add --upgrade --repository "$REPO_DIR/packages.adb" \
      zapret2-manager zapret2-manager-full luci-app-zapret2-manager tg-ws-proxy-rs; then
    log "full stack installed from signed index"
  else
    ssh_run "cleanup temp repo" "rm -rf $REPO_DIR" || true
    die "signed install failed"
  fi
  ssh_run "cleanup temp repo" "rm -rf $REPO_DIR" || true
}

# ---- verify ------------------------------------------------------------------
do_verify() {
  log "verifying on $HOST"
  # The Makefile postinst clears caches and reloads rpcd/uhttpd. We redo it
  # defensively in case a prior install skipped postinst.
  ssh_run "clear luci caches" "rm -f /tmp/luci-indexcache; rm -rf /tmp/luci-modulecache/* 2>/dev/null; true"
  ssh_run "reload rpcd"    "/etc/init.d/rpcd reload"   || die "rpcd reload failed"
  ssh_run "reload uhttpd"  "/etc/init.d/uhttpd reload" || die "uhttpd reload failed"

  # Package presence.
  for p in zapret2-manager luci-app-zapret2-manager; do
    ssh_run "apk info $p" apk info "$p" >/dev/null || die "$p not installed"
  done
  log "  packages present"

  # Page loads (LuCI admin path). 200 = ok; the view itself renders client-side.
  code=$(ssh_run "luci http" "wget -qO- --spider 'http://127.0.0.1/cgi-bin/luci/admin/services/zapret2-manager' 2>/dev/null; echo \$?")
  # wget --spider prints headers; simpler: use uclient-fetch or curl if present.
  if command -v curl >/dev/null 2>&1; then
    code=$(ssh_run "luci http" "curl -sk -o /dev/null -w '%{http_code}' 'http://127.0.0.1/cgi-bin/luci/admin/services/zapret2-manager'")
  else
    # uclient-fetch is always present on OpenWrt
    code=$(ssh_run "luci http" "uclient-fetch -q -O /dev/null 'http://127.0.0.1/cgi-bin/luci/admin/services/zapret2-manager' 2>/dev/null; echo \$?")
  fi
  case "$code" in
    200|302|403|0|"") log "  LuCI page reachable (http=$code)" ;;
    *) die "LuCI page unreachable (http=$code)" ;;
  esac
  log "deploy OK on $HOST"
}

# ---- run ---------------------------------------------------------------------
for phase in $PHASES; do
  case "$phase" in
    build)   do_build ;;
    install) do_install ;;
    verify)  do_verify ;;
  esac
done
log "done."
