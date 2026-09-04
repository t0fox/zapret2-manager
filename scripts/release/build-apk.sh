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

for command in awk basename cp curl find git grep head make mkdir rm sha256sum sort stat sleep tar test wc zstd; do
	need_command "$command"
done
need_command node

[ -f "$CONFIG_FILE" ] || die "release config is missing: $CONFIG_FILE"
[ -d "$REPO_ROOT/zapret2-manager/src" ] || die "backend source directory is missing"
[ -d "$REPO_ROOT/zapret2-manager/files" ] || die "backend files directory is missing"
[ -d "$REPO_ROOT/luci-app-zapret2-manager/files" ] || die "LuCI files directory is missing"
[ -f "$REPO_ROOT/zapret2-manager-full/Makefile" ] || die "full package Makefile is missing"

eval "$(node --input-type=module -e '
import { releaseConfig } from "./scripts/release/config.mjs";
const o = releaseConfig.openwrt;
console.log(`SDK_VERSION=${JSON.stringify(o.version)}`);
console.log(`SDK_TARGET=${JSON.stringify(o.target)}`);
console.log(`SDK_SUBTARGET=${JSON.stringify(o.subtarget)}`);
console.log(`SDK_FILENAME=${JSON.stringify(o.sdkFilename)}`);
console.log(`SDK_URL=${JSON.stringify(o.sdkUrl)}`);
console.log(`SDK_SHA256=${JSON.stringify(o.sdkSha256)}`);
console.log(`FULL_PACKAGE=${JSON.stringify(releaseConfig.packages[0])}`);
console.log(`EXTERNAL_DEPENDENCIES=${JSON.stringify(releaseConfig.externalDependencies.join(" "))}`);
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

printf 'release build: updating and installing OpenWrt feeds\n'
FEED_NAMES='base packages luci'
FEED_PACKAGES='ucode ucode-mod-fs ucode-mod-io ucode-mod-socket ucode-mod-uloop luci-base kmod-nfnetlink-queue kmod-nft-queue ncat flock uclient-fetch ca-bundle unzip jsonfilter libjson-c'
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
		./scripts/feeds install $FEED_PACKAGES
	); then
		break
	fi
	if [ "$FEED_ATTEMPT" -eq 3 ]; then
		die 'OpenWrt feeds did not become complete after 3 bounded attempts'
	fi
	printf 'release build: retrying OpenWrt feeds (attempt %s/3)\n' "$((FEED_ATTEMPT + 1))" >&2
	sleep $((FEED_ATTEMPT * 5))
done

PACKAGE_ROOT="$SDK_DIR/package/z2m"
FULL_PACKAGE_ROOT="$PACKAGE_ROOT/$FULL_PACKAGE"
mkdir -p "$FULL_PACKAGE_ROOT/sources/backend-src" \
	"$FULL_PACKAGE_ROOT/sources/backend-files" \
	"$FULL_PACKAGE_ROOT/sources/luci-files"
cp -- "$REPO_ROOT/zapret2-manager-full/Makefile" "$FULL_PACKAGE_ROOT/Makefile"
cp -a "$REPO_ROOT/zapret2-manager/src/." "$FULL_PACKAGE_ROOT/sources/backend-src/"
cp -a "$REPO_ROOT/zapret2-manager/files/." "$FULL_PACKAGE_ROOT/sources/backend-files/"
cp -a "$REPO_ROOT/luci-app-zapret2-manager/files/." "$FULL_PACKAGE_ROOT/sources/luci-files/"

printf '%s\n' 'CONFIG_PACKAGE_zapret2-manager-full=y' >> "$SDK_DIR/.config"
make -C "$SDK_DIR" -j2 defconfig
printf 'release build: compiling %s\n' "$FULL_PACKAGE"
make -C "$SDK_DIR" -j2 "package/z2m/$FULL_PACKAGE/compile" V=s

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

STAGED_ROOT="*/.pkgdir/$FULL_PACKAGE"
require_staged_file "$STAGED_ROOT/usr/libexec/zapret2-manager/z2m-core-helper" 'z2m-core-helper'
require_staged_file "$STAGED_ROOT/usr/libexec/zapret2-manager/z2m-root-bootstrap" 'z2m-root-bootstrap'
require_staged_file "$STAGED_ROOT/usr/libexec/zapret2-manager/z2m-scanner-firewall-helper" 'scanner firewall helper'
require_staged_file "$STAGED_ROOT/usr/libexec/zapret2-manager/z2m-helperd" 'z2m-helperd'
require_staged_file "$STAGED_ROOT/usr/libexec/zapret2-manager/*.uc" 'backend ucode files'
require_staged_file "$STAGED_ROOT/usr/share/rpcd/ucode/zapret2-manager.uc" 'rpcd object'
require_staged_dir "$STAGED_ROOT/usr/share/zapret2-manager" 'runtime assets'
require_staged_file "$STAGED_ROOT/etc/init.d/zapret2-manager" 'init script'
require_staged_file "$STAGED_ROOT/etc/hotplug.d/iface/90-zapret2-manager" 'hotplug runtime'
require_staged_dir "$STAGED_ROOT/www/luci-static/resources/view/zapret2-manager" 'LuCI views'
require_staged_dir "$STAGED_ROOT/usr/share/rpcd/acl.d" 'LuCI RPC ACL directory'
require_staged_dir "$STAGED_ROOT/usr/share/luci/menu.d" 'LuCI menu directory'

FULL_APK=$(find "$SDK_DIR/bin" -type f -name "$FULL_PACKAGE-[0-9]*.apk" -print | sort | head -n 1)
[ -n "$FULL_APK" ] || die "full package APK was not produced"
APK_COUNT=$(find "$SDK_DIR/bin" -type f -name '*.apk' | wc -l | awk '{print $1}')
[ "$APK_COUNT" -eq 1 ] || die "SDK produced $APK_COUNT APKs; expected only the full package"
APK_TOOL=$(find "$SDK_DIR/staging_dir/host" -type f -name apk -perm -u+x -print -quit)
[ -n "$APK_TOOL" ] || die 'OpenWrt SDK-native apk tool is missing'

FULL_METADATA_JSON=$("$APK_TOOL" adbdump --format json "$FULL_APK") || die 'full package metadata could not be decoded by SDK apk'
verify_metadata_field() {
	local field=$1
	local expected=$2
	if ! printf '%s' "$FULL_METADATA_JSON" | FIELD="$field" EXPECTED="$expected" node --input-type=module -e '
import fs from "node:fs";
const metadata = JSON.parse(fs.readFileSync(0, "utf8"));
const field = process.env.FIELD;
const expected = process.env.EXPECTED;
const values = metadata.info?.[field] ?? metadata[field];
const list = Array.isArray(values) ? values : [values];
if (!list.some((value) => String(value) === expected || String(value).startsWith(`${expected}=`))) process.exit(1);
'; then
		die "full package metadata is missing $field: $expected"
	fi
}
for dependency in $FEED_PACKAGES; do
	verify_metadata_field depends "$dependency"
done
verify_metadata_field provides zapret2-manager
verify_metadata_field provides luci-app-zapret2-manager

PAYLOAD_DIR="$WORK_DIR/full-payload"
mkdir -p "$PAYLOAD_DIR"
"$APK_TOOL" extract --destination "$PAYLOAD_DIR" "$FULL_APK" || die 'full package payload could not be extracted by SDK apk'
for relative in \
	usr/libexec/zapret2-manager/z2m-core-helper \
	usr/libexec/zapret2-manager/z2m-root-bootstrap \
	usr/libexec/zapret2-manager/z2m-scanner-firewall-helper \
	usr/libexec/zapret2-manager/z2m-helperd \
	usr/libexec/zapret2-manager/strategy-catalog-migration-cli.uc \
	usr/share/rpcd/ucode/zapret2-manager.uc \
	usr/share/zapret2-manager/runtime-composition-package.json \
	usr/share/zapret2-manager/runtime-assets/lua/z2k-modern-core.lua \
	etc/init.d/zapret2-manager \
	etc/hotplug.d/iface/90-zapret2-manager \
	usr/share/rpcd/acl.d/luci-app-zapret2-manager.json \
	usr/share/luci/menu.d/luci-app-zapret2-manager.json \
	www/luci-static/resources/view/zapret2-manager/z2m-api.js; do
	[ -f "$PAYLOAD_DIR/$relative" ] || die "full package payload is missing: $relative"
done
[ "$(stat -c '%a' "$PAYLOAD_DIR/usr/libexec/zapret2-manager/z2m-helperd")" = 755 ] || die 'z2m-helperd mode is not 0755'
[ "$(stat -c '%a' "$PAYLOAD_DIR/usr/share/rpcd/ucode/zapret2-manager.uc")" = 644 ] || die 'rpcd ucode mode is not 0644'

FULL_APK_NAME=$(basename -- "$FULL_APK")
cp -- "$FULL_APK" "$DIST_DIR/$FULL_APK_NAME"
export DIST_DIR CHECKED_OUT_SHA GIT_REF SDK_ACTUAL_SHA="$ACTUAL_SDK_SHA" SDK_FILENAME SDK_SHA256 FULL_APK_NAME
node --input-type=module <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { releaseConfig } from './scripts/release/config.mjs';

const dist = process.env.DIST_DIR;
const file = path.join(dist, process.env.FULL_APK_NAME);
const artifact = {
  package: releaseConfig.packages[0],
  filename: process.env.FULL_APK_NAME,
  bytes: fs.statSync(file).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
};
const source = fs.readFileSync('zapret2-manager-full/Makefile', 'utf8');
const packageIdentity = {
  version: source.match(/^PKG_VERSION\s*:?=\s*([^\s#]+)/m)?.[1],
  release: Number(source.match(/^PKG_RELEASE\s*:?=\s*([^\s#]+)/m)?.[1])
};
if (!packageIdentity.version || !Number.isInteger(packageIdentity.release)) throw new Error('full package identity is incomplete');
const manifest = {
  schema: releaseConfig.manifestSchema,
  project: { repository: releaseConfig.repository, gitCommit: process.env.CHECKED_OUT_SHA, gitRef: process.env.GIT_REF },
  package: packageIdentity,
  openwrt: {
    version: releaseConfig.openwrt.version,
    target: releaseConfig.openwrt.target,
    subtarget: releaseConfig.openwrt.subtarget,
    sdkFilename: process.env.SDK_FILENAME,
    sdkSha256: process.env.SDK_ACTUAL_SHA
  },
  artifact,
  externalDependencies: [...releaseConfig.externalDependencies],
  bundled: { ...releaseConfig.bundled },
  compatibility: {
    provides: [...releaseConfig.compatibility.provides],
    legacyPackages: [...releaseConfig.compatibility.legacyPackages]
  },
  excludedOptionalPackages: [...releaseConfig.excludedOptionalPackages],
  installation: { ...releaseConfig.installation }
};
fs.writeFileSync(path.join(dist, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

(
	cd "$DIST_DIR"
	sha256sum "$FULL_APK_NAME" build-manifest.json > SHA256SUMS
	sha256sum -c SHA256SUMS
)

printf 'release build: generated one full APK, build-manifest.json, and SHA256SUMS in %s\n' "$DIST_DIR"
