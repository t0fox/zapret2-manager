#!/usr/bin/env bash
set -eu
set -o pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"
BUILD_ROOT=${BUILD_ROOT:-"$REPO_ROOT/build-apk"}
CACHE_DIR="$BUILD_ROOT/cache"
WORK_DIR="$BUILD_ROOT/work"
DIST_DIR=${DIST_DIR:-"$REPO_ROOT/dist"}
CONFIG_FILE="$REPO_ROOT/scripts/release/config.mjs"

die() {
	printf 'release build: ERROR: %s\n' "$*" >&2
	exit 1
}

need_command() {
	command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"
}

for command in awk cp curl find git grep make rm sha256sum tar tr wc zstd; do
	need_command "$command"
done
need_command node

[ -f "$CONFIG_FILE" ] || die "release config is missing: $CONFIG_FILE"
[ -d "$REPO_ROOT/zapret2-manager" ] || die "backend package directory is missing"
[ -d "$REPO_ROOT/luci-app-zapret2-manager" ] || die "LuCI package directory is missing"
[ -d "$REPO_ROOT/zapret2-manager-full" ] || die "full package directory is missing"

eval "$(node --input-type=module -e '
import { releaseConfig } from "./scripts/release/config.mjs";
const o = releaseConfig.openwrt;
console.log(`SDK_VERSION=${JSON.stringify(o.version)}`);
console.log(`SDK_TARGET=${JSON.stringify(o.target)}`);
console.log(`SDK_SUBTARGET=${JSON.stringify(o.subtarget)}`);
console.log(`SDK_FILENAME=${JSON.stringify(o.sdkFilename)}`);
console.log(`SDK_URL=${JSON.stringify(o.sdkUrl)}`);
console.log(`SDK_SHA256=${JSON.stringify(o.sdkSha256)}`);
console.log(`CORE_PACKAGES=${JSON.stringify(releaseConfig.packages.join(" "))}`);
' )"

case "$BUILD_ROOT" in
  "$REPO_ROOT"/*) ;;
  *) die "BUILD_ROOT must be under repository root: $BUILD_ROOT" ;;
esac
case "$DIST_DIR" in
  "$REPO_ROOT"/*) ;;
  *) die "DIST_DIR must be under repository root: $DIST_DIR" ;;
esac

CHECKED_OUT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
: <<'LEGACY_SHA_CHECK'
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) die "checked out commit is not a full SHA: $CHECKED_OUT_SHA" ;;
LEGACY_SHA_CHECK
printf '%s\n' "$CHECKED_OUT_SHA" | grep -Eq '^[0-9a-f]{40}$' || die "checked out commit is not a full SHA: $CHECKED_OUT_SHA"
if [ -n "${GITHUB_SHA:-}" ] && [ "$GITHUB_SHA" != "$CHECKED_OUT_SHA" ]; then
	die "GITHUB_SHA does not match checked out commit: $GITHUB_SHA != $CHECKED_OUT_SHA"
fi
GIT_REF=${GITHUB_REF:-$(git -C "$REPO_ROOT" symbolic-ref -q --short HEAD || printf 'HEAD')}

SDK_ARCHIVE="$CACHE_DIR/$SDK_FILENAME"
EXTRACT_DIR="$WORK_DIR/sdk-extract"

rm -rf "$WORK_DIR" "$DIST_DIR"
mkdir -p "$CACHE_DIR" "$EXTRACT_DIR" "$DIST_DIR"

if [ ! -f "$SDK_ARCHIVE" ]; then
	printf 'release build: downloading %s\n' "$SDK_URL"
	curl --fail --location --show-error --retry 3 --retry-all-errors \
		--connect-timeout 20 --output "$SDK_ARCHIVE" "$SDK_URL"
fi

ACTUAL_SDK_SHA=$(sha256sum "$SDK_ARCHIVE" | awk '{print $1}')
[ "$ACTUAL_SDK_SHA" = "$SDK_SHA256" ] || die "SDK SHA256 mismatch: expected $SDK_SHA256, got $ACTUAL_SDK_SHA"

printf 'release build: extracting verified SDK %s\n' "$SDK_FILENAME"
zstd --decompress --stdout "$SDK_ARCHIVE" | tar -xf - -C "$EXTRACT_DIR"
SDK_DIR=$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d -print -quit)
[ -n "$SDK_DIR" ] || die "SDK archive did not contain a top-level directory"
[ -x "$SDK_DIR/scripts/feeds" ] || die "SDK scripts/feeds is missing"
[ -f "$SDK_DIR/package/Makefile" ] || die "SDK package/Makefile is missing"
[ -d "$SDK_DIR/staging_dir/host" ] || die "SDK host staging directory is missing"
PACKAGE_ROOT="$SDK_DIR/package/z2m"

printf 'release build: updating and installing OpenWrt feeds\n'
FEED_NAMES='base packages luci'
FEEDS_READY=0
for FEED_ATTEMPT in 1 2 3; do
	if (
		cd "$SDK_DIR"
		./scripts/feeds update $FEED_NAMES
	); then
		FEEDS_READY=1
		for FEED_NAME in $FEED_NAMES; do
			if [ ! -d "$SDK_DIR/feeds/$FEED_NAME" ]; then
				printf 'release build: feed %s is missing after update\n' "$FEED_NAME" >&2
				FEEDS_READY=0
			fi
		done
	fi
	if [ "$FEEDS_READY" -eq 1 ] && (
		cd "$SDK_DIR"
		./scripts/feeds install $FEED_NAMES
	); then
		break
	fi
	if [ "$FEED_ATTEMPT" -eq 3 ]; then
		die 'OpenWrt feeds did not become complete after 3 bounded attempts'
	fi
	printf 'release build: retrying OpenWrt feeds (attempt %s/3)\n' "$((FEED_ATTEMPT + 1))" >&2
	sleep $((FEED_ATTEMPT * 5))
done

mkdir -p "$PACKAGE_ROOT"
for package in zapret2-manager luci-app-zapret2-manager zapret2-manager-full; do
	[ -f "$REPO_ROOT/$package/Makefile" ] || die "package Makefile is missing: $package"
	cp -a "$REPO_ROOT/$package" "$PACKAGE_ROOT/"
done
[ ! -e "$PACKAGE_ROOT/tg-ws-proxy-go" ] || die 'TG provider was copied into the SDK package namespace'
[ ! -e "$PACKAGE_ROOT/tg-ws-proxy-rs" ] || die 'TG provider was copied into the SDK package namespace'

for package in zapret2-manager luci-app-zapret2-manager zapret2-manager-full; do
	printf 'CONFIG_PACKAGE_%s=y\n' "$package" >> "$SDK_DIR/.config"
done
make -C "$SDK_DIR" -j2 defconfig

for package in zapret2-manager luci-app-zapret2-manager zapret2-manager-full; do
	printf 'release build: compiling %s\n' "$package"
	make -C "$SDK_DIR" -j2 "package/z2m/$package/compile" V=s
done

require_staged_file() {
	local pattern=$1
	local description=$2
	local count
	count=$(find "$SDK_DIR/build_dir" -type f -path "$pattern" | wc -l | awk '{print $1}')
	[ "$count" -gt 0 ] || die "staging verification failed: $description"
}

require_staged_dir() {
	local pattern=$1
	local description=$2
	local count
	count=$(find "$SDK_DIR/build_dir" -type d -path "$pattern" | wc -l | awk '{print $1}')
	[ "$count" -gt 0 ] || die "staging verification failed: $description"
}

require_staged_file '*/.pkgdir/zapret2-manager/usr/libexec/zapret2-manager/z2m-core-helper' 'backend z2m-core-helper'
require_staged_file '*/.pkgdir/zapret2-manager/usr/libexec/zapret2-manager/z2m-root-bootstrap' 'backend z2m-root-bootstrap'
require_staged_file '*/.pkgdir/zapret2-manager/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper' 'backend scanner firewall helper'
require_staged_file '*/.pkgdir/zapret2-manager/usr/libexec/zapret2-manager/z2m-helperd' 'backend z2m-helperd'
require_staged_file '*/.pkgdir/zapret2-manager/usr/libexec/zapret2-manager/*.uc' 'backend ucode files'
require_staged_dir '*/.pkgdir/zapret2-manager/usr/share/zapret2-manager' 'backend shared data'
require_staged_file '*/.pkgdir/zapret2-manager/etc/init.d/zapret2-manager' 'backend init script'
require_staged_dir '*/.pkgdir/luci-app-zapret2-manager/www/luci-static/resources/view/zapret2-manager' 'LuCI views'
require_staged_dir '*/.pkgdir/luci-app-zapret2-manager/usr/share/rpcd/acl.d' 'LuCI RPC ACL directory'
require_staged_dir '*/.pkgdir/luci-app-zapret2-manager/usr/share/luci/menu.d' 'LuCI menu directory'

find_product_apk() {
	local package=$1
	local pattern="$package-[0-9]*.apk"
	local -a matches
	mapfile -t matches < <(find "$SDK_DIR/bin" -type f -name "$pattern" -print | sort)
	[ "${#matches[@]}" -eq 1 ] || die "expected exactly one $package APK, found ${#matches[@]}"
	printf '%s\n' "${matches[0]}"
}

BACKEND_APK=$(find_product_apk zapret2-manager)
LUCI_APK=$(find_product_apk luci-app-zapret2-manager)
FULL_APK=$(find_product_apk zapret2-manager-full)

verify_full_package_dependency() {
	local dependency=$1
	if ! tar -xOzf "$FULL_APK" .PKGINFO | grep -Fqx "depend = $dependency"; then
		die "full package dependency metadata is missing: $dependency"
	fi
}

printf 'release build: verifying full package dependency metadata\n'
verify_full_package_dependency zapret2-manager
verify_full_package_dependency luci-app-zapret2-manager

cp -- "$BACKEND_APK" "$DIST_DIR/"
cp -- "$LUCI_APK" "$DIST_DIR/"
cp -- "$FULL_APK" "$DIST_DIR/"

export DIST_DIR CHECKED_OUT_SHA GIT_REF SDK_ACTUAL_SHA="$ACTUAL_SDK_SHA" SDK_FILENAME SDK_SHA256
export BACKEND_APK_NAME=$(basename -- "$BACKEND_APK")
export LUCI_APK_NAME=$(basename -- "$LUCI_APK")
export FULL_APK_NAME=$(basename -- "$FULL_APK")
node --input-type=module <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { releaseConfig } from './scripts/release/config.mjs';

const dist = process.env.DIST_DIR;
const artifactNames = [process.env.BACKEND_APK_NAME, process.env.LUCI_APK_NAME, process.env.FULL_APK_NAME];
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const packageFiles = ['zapret2-manager/Makefile', 'luci-app-zapret2-manager/Makefile', 'zapret2-manager-full/Makefile'];
const packageIdentity = packageFiles.map((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const version = source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)?.[1];
  const release = source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)?.[1];
  if (!version || !release) throw new Error(`missing package identity in ${file}`);
  return { version, release: Number(release) };
});
if (new Set(packageIdentity.map((item) => item.version)).size !== 1 ||
    new Set(packageIdentity.map((item) => item.release)).size !== 1) {
  throw new Error('manager package versions/releases are not synchronized');
}
const artifacts = artifactNames.map((filename, index) => {
  const file = path.join(dist, filename);
  const packageName = releaseConfig.packages[index];
  const stat = fs.statSync(file);
  return { package: packageName, filename, bytes: stat.size, sha256: digest(file) };
});
const manifest = {
  schema: releaseConfig.manifestSchema,
  project: { repository: releaseConfig.repository, gitCommit: process.env.CHECKED_OUT_SHA, gitRef: process.env.GIT_REF },
  package: packageIdentity[0],
  openwrt: {
    version: releaseConfig.openwrt.version,
    target: releaseConfig.openwrt.target,
    subtarget: releaseConfig.openwrt.subtarget,
    sdkFilename: process.env.SDK_FILENAME,
    sdkSha256: process.env.SDK_ACTUAL_SHA
  },
  artifacts,
  excludedOptionalPackages: [...releaseConfig.excludedOptionalPackages],
  installation: { ...releaseConfig.installation }
};
fs.writeFileSync(path.join(dist, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

(
	cd "$DIST_DIR"
	sha256sum "$BACKEND_APK_NAME" "$LUCI_APK_NAME" "$FULL_APK_NAME" build-manifest.json > SHA256SUMS
	sha256sum -c SHA256SUMS
)

printf 'release build: generated three APKs, build-manifest.json, and SHA256SUMS in %s\n' "$DIST_DIR"
