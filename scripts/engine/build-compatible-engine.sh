#!/usr/bin/env bash
# build-compatible-engine.sh — canonical reproducible producer for the
# z2m-compatible-engine artifact.
#
# Pipeline (every step fail-closed):
#   1  read identity from upstreams/engine-integration.json (single authority)
#   2  checkout bol-van/zapret2 at the exact pinned commit (rev-parse verified)
#   3  verify each patch SHA256 against the pinned digests
#   4  git apply --check + apply the 3-patch series in order
#   5  static capability scan of the patched tree (3/3 required)
#   6  cross-compile nfqws2 via the OpenWrt SDK toolchain for the target arch
#   7  assemble embedded-layout archive + machine-readable manifest
#   8  self-validate with validate-engine-manifest.mjs (digests recomputed)
#
# Environment:
#   ARCH            OpenWrt architecture id (default: aarch64_cortex-a53)
#   OPENWRT_SDK     extracted OpenWrt SDK whose staging_dir toolchain matches ARCH
#   ENGINE_WORKDIR  scratch dir      (default: build-engine/)
#   ENGINE_DIST_DIR output dir       (default: dist-engine/)
#   UPSTREAM_CACHE  optional local bare clone of bol-van/zapret2 for offline runs
#   SKIP_UPSTREAM_QUERY=1  do not query bol-van HEAD (offline builds)
#
# Upstream guard: when bol-van master advances past the pinned base this is an
# explicit, machine-readable `upstreamState.advanced=true` notice — never a
# silent rebuild against unknown source. The artifact is ALWAYS built from the
# pinned commit.

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
cd "$REPO_ROOT"

die() { printf 'engine-producer: ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf 'engine-producer: %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "required command missing: $1"; }
for command in git node sha256sum tar awk grep make; do need "$command"; done

ARCH=${ARCH:-aarch64_cortex-a53}
WORK=${ENGINE_WORKDIR:-"$REPO_ROOT/build-engine"}
DIST=${ENGINE_DIST_DIR:-"$REPO_ROOT/dist-engine"}
INTEGRATION_JSON="$REPO_ROOT/zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json"
[ -f "$INTEGRATION_JSON" ] || die "integration authority missing: $INTEGRATION_JSON"

PRODUCER_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD)
printf '%s\n' "$PRODUCER_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || die "producer commit is not a full sha"

# ---------------------------------------------------------------- step 1: identity
eval "$(node --input-type=module -e "
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
console.log('BASE_REPO=' + JSON.stringify(j.engineBase.repository));
console.log('BASE_COMMIT=' + JSON.stringify(j.engineBase.commit));
console.log('PATCH_COUNT=' + j.patchSeries.length);
j.patchSeries.forEach((p, i) => {
  console.log('PATCH_ID_' + i + '=' + JSON.stringify(p.id));
  console.log('PATCH_SHA_' + i + '=' + JSON.stringify(p.sha256));
  console.log('PATCH_PATH_' + i + '=' + JSON.stringify(p.path));
});
" "$INTEGRATION_JSON")"
[ "$PATCH_COUNT" = "3" ] || die "expected exactly 3 pinned patches, found $PATCH_COUNT"
info "base=$BASE_REPO@$BASE_COMMIT arch=$ARCH"

# ------------------------------------------------------------- step 2: pinned base
mkdir -p "$WORK" "$DIST"
SRC="$WORK/zapret2-src"
rm -rf "$SRC"
if [ -n "${UPSTREAM_CACHE:-}" ] && [ -d "$UPSTREAM_CACHE/.git" ]; then
  info "seeding upstream clone from cache: $UPSTREAM_CACHE"
  git clone -q --no-checkout "$UPSTREAM_CACHE" "$SRC"
else
  git clone -q "https://github.com/$BASE_REPO.git" "$SRC"
fi
git -C "$SRC" fetch -q origin "$BASE_COMMIT" || die "pinned base commit not reachable on $BASE_REPO"
git -C "$SRC" checkout -q --detach "$BASE_COMMIT"
ACTUAL=$(git -C "$SRC" rev-parse HEAD)
[ "$ACTUAL" = "$BASE_COMMIT" ] || die "BASE_COMMIT_MISMATCH: checked out $ACTUAL != pinned $BASE_COMMIT"
info "pinned base commit checked out and verified"

UPSTREAM_HEAD=""
if [ "${SKIP_UPSTREAM_QUERY:-0}" != "1" ]; then
  UPSTREAM_HEAD=$(git -C "$SRC" ls-remote origin refs/heads/master 2>/dev/null | awk '{print $1}') || true
fi
if [ -n "$UPSTREAM_HEAD" ] && [ "$UPSTREAM_HEAD" != "$BASE_COMMIT" ]; then
  info "NOTICE: upstream master ($UPSTREAM_HEAD) advanced past pinned base; building PINNED source only"
fi

# --------------------------------------------------- steps 3+4: patch verify/apply
for index in 0 1 2; do
  eval "path=\$PATCH_PATH_$index"; eval "want=\$PATCH_SHA_$index"; eval "id=\$PATCH_ID_$index"
  full="$REPO_ROOT/$path"
  [ -f "$full" ] || die "PATCH_MISSING: $path"
  have=$(sha256sum "$full" | awk '{print $1}')
  [ "$have" = "$want" ] || die "PATCH_DIGEST_MISMATCH: $id ($have != $want)"
done
for index in 0 1 2; do
  eval "id=\$PATCH_ID_$index"; eval "path=\$PATCH_PATH_$index"
  git -C "$SRC" apply --check "$REPO_ROOT/$path" || die "PATCH_APPLY_CHECK_FAILED: $id does not apply to pinned base"
  git -C "$SRC" apply "$REPO_ROOT/$path" || die "PATCH_APPLY_FAILED: $id"
  info "applied $id"
done

# ------------------------------------------------ step 5: static capability scan
TLS_TOKENS='z2k_grease z2k_alpn z2k_psk z2k_keyshare z2k_earlydata z2k_pha z2k_sct z2k_delegcred'
tls_ok=1
grep -rqF 'z2k_tls_mod.h' "$SRC/nfq2" || tls_ok=0
for token in $TLS_TOKENS; do grep -rqF "$token" "$SRC/nfq2" || tls_ok=0; done
[ "$tls_ok" = 1 ] || die "CAPABILITY_EVIDENCE_MISSING: Z2K_TLS_MOD markers absent after patching"
grep -qF 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod' "$SRC/lua/zapret-antidpi.lua" \
  || die "CAPABILITY_EVIDENCE_MISSING: ANTIDPI_REPEATS_LOOP marker absent in zapret-antidpi.lua"
grep -qF 'family_split' "$SRC/lua/zapret-auto.lua" \
  || die "CAPABILITY_EVIDENCE_MISSING: AUTO_FAMILY_SPLIT marker absent in zapret-auto.lua"
info "static capability evidence 3/3 present in patched tree"

# --------------------------------------------------------- step 6: target build
TOOLCHAIN_DIR=$(ls -d "$OPENWRT_SDK"/staging_dir/toolchain-* 2>/dev/null | head -n 1) \
  || die "OPENWRT_SDK/staging_dir/toolchain-* not found (set OPENWRT_SDK)"
CROSS_BIN=$(find "$TOOLCHAIN_DIR/bin" -maxdepth 1 -name '*-gcc' | head -n 1) || true
[ -x "$CROSS_BIN" ] || die "toolchain gcc not found under $TOOLCHAIN_DIR/bin"
CROSS="$(basename "$CROSS_BIN" -gcc)-"
info "cross compiler prefix: $CROSS"

make -C "$SRC/nfq2" clean >/dev/null 2>&1 || true
make -C "$SRC/nfq2" CROSS_COMPILE="$CROSS" -j"$(nproc)" \
  || die "BUILD_FAILED: nfqws2 did not compile for $ARCH"
[ -x "$SRC/nfq2/nfqws2" ] || die "BUILD_FAILED: nfqws2 binary absent"

NFQWS2_SHA=$(sha256sum "$SRC/nfq2/nfqws2" | awk '{print $1}')

# ---------------------------------------------- step 7: archive + manifest layout
VERSION="r77-z2m-$(date -u +%Y%m%d%H%M)"
ROOTNAME="zapret2-$VERSION-z2m"
STAGE="$WORK/$ROOTNAME"
rm -rf "$STAGE"
mkdir -p "$STAGE/binaries/linux-arm64" "$STAGE/lua"
cp -a "$SRC/nfq2/nfqws2" "$STAGE/binaries/linux-arm64/nfqws2"
for helper in ip2net mdig; do
  [ -x "$SRC/$helper/$helper" ] && cp -a "$SRC/$helper/$helper" "$STAGE/binaries/linux-arm64/$helper"
done
for dir in common ipset files init.d blockcheck2.d; do
  [ -d "$SRC/$dir" ] && cp -a "$SRC/$dir" "$STAGE/$dir"
done
[ -f "$SRC/blockcheck2.sh" ] && cp -a "$SRC/blockcheck2.sh" "$STAGE/"
[ -f "$SRC/config.default" ] && cp -a "$SRC/config.default" "$STAGE/"
cp -a "$SRC/lua/." "$STAGE/lua/"

ARTIFACT_NAME="z2m-engine-${VERSION}-${ARCH}.tar.gz"
ARTIFACT_PATH="$DIST/$ARTIFACT_NAME"
tar -czf "$ARTIFACT_PATH" -C "$WORK" "$ROOTNAME"
ARTIFACT_SHA=$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')
ARTIFACT_SIZE=$(wc -c < "$ARTIFACT_PATH" | tr -d ' ')

LUA_INPUT="$WORK/lua-files.json"
{
  printf '['
  first=1
  while IFS= read -r luafile; do
    rel="lua/${luafile#"$STAGE/lua/"}"
    digest=$(sha256sum "$luafile" | awk '{print $1}')
    [ "$first" = 1 ] || printf ', '
    first=0
    printf '{"path":"%s","sha256":"%s"}' "$rel" "$digest"
  done < <(find "$STAGE/lua" -name '*.lua' -type f | sort)
  printf ']'
} > "$LUA_INPUT"

SDK_VERSION=$(basename "$OPENWRT_SDK" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || echo unknown)

node --input-type=module -e "
import fs from 'node:fs';
const lua = JSON.parse(fs.readFileSync('$LUA_INPUT', 'utf8'));
const input = {
  version: '$VERSION',
  architecture: '$ARCH',
  artifactName: '$ARTIFACT_NAME',
  artifactSha256: '$ARTIFACT_SHA',
  artifactSize: '$ARTIFACT_SIZE',
  nfqws2Sha256: '$NFQWS2_SHA',
  upstreamHeadSha: '${UPSTREAM_HEAD:-}',
  sdkVersion: '$SDK_VERSION',
  toolchain: '$(basename \"$TOOLCHAIN_DIR\")',
  builtAt: new Date().toISOString(),
  producerCommit: '$PRODUCER_COMMIT',
  luaFiles: lua
};
fs.writeFileSync('$WORK/manifest-input.json', JSON.stringify(input, null, 2));
"
node "$SCRIPT_DIR/write-manifest.mjs" "$WORK/manifest-input.json" "$DIST/${ARTIFACT_NAME%.tar.gz}.manifest.json"

# ------------------------------------------------------- step 8: self-validation
MANIFEST_PATH="$DIST/${ARTIFACT_NAME%.tar.gz}.manifest.json"
node "$SCRIPT_DIR/validate-engine-manifest.mjs" "$MANIFEST_PATH" "$ARTIFACT_PATH" \
  || die "MANIFEST_INVALID: produced manifest failed validation"

info "OK: $ARTIFACT_NAME sha256=$ARTIFACT_SHA nfqws2Sha256=$NFQWS2_SHA"
exit 0
