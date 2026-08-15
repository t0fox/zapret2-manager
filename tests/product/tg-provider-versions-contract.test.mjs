import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PROVIDER = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc';
const LEGACY_PROXY = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy.uc';

test('TG provider versions enumerate bounded official sources and verified artifacts', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  const rpc = fs.readFileSync(RPC, 'utf8');
  for (const marker of ['SOURCE_GITHUB', 'SOURCE_APK', 'versions', 'sourceId', 'release_candidate', 'assetSha256', 'installable', 'incompatibilityReason']) {
    assert.match(source, new RegExp(marker), `missing provider contract marker ${marker}`);
  }
  assert.match(source, /tg-ws-proxy-rs/);
  assert.match(source, /tg-ws-proxy-go/);
  assert.match(rpc, /proxy_provider_versions/);
});

test('TG install accepts only a checked real version/source selection', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /input_provider_version/);
  assert.match(source, /load_checked_candidate/);
  assert.match(source, /candidate\.sourceId/);
  assert.match(source, /candidate\.assetSha256/);
  assert.doesNotMatch(source, /install.*generic.*url/i);
});

test('official APK installation carries and verifies the upstream signing key transactionally', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  for (const marker of ['keyAssetName', 'keyAssetSha256', 'keyDownloadUrl', 'trustMode', '--keys-dir', '--allow-untrusted']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing APK trust marker ${marker}`);
  }
  assert.match(source, /tg-ws-proxy\.pem/);
  assert.match(source, /sha256-only/);
});

test('TG release compatibility separates architecture, artifact, signature, and installability', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  for (const marker of [
    'architectureCompatible', 'artifactAvailable', 'apkAvailable',
    'directBinaryAvailable', 'checksumAvailable', 'apkSignatureTrusted',
    'unavailableReason', 'packageName', 'sort_versions'
  ]) {
    assert.match(source, new RegExp(marker), `missing compatibility marker ${marker}`);
  }
  assert.match(source, /aarch64-unknown-linux-musl/);
  assert.match(source, /releaseName/);
  assert.match(source, /releaseBody/);
  assert.match(source, /releaseUrl/);
  assert.match(source, /assets/);
});

test('TG release versions preserve upstream tags and package revisions without deduplication', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  for (const marker of ['upstreamVersion', 'packageRevision', 'displayVersion', 'releaseTag']) {
    assert.match(source, new RegExp(marker), `missing version identity marker ${marker}`);
  }
  assert.match(source, /rev\(\[0-9\]\+\)/);
  assert.match(source, /packageRevision\s*:\s*1/);
});

test('TG version metadata distinguishes release presence from installability', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /releaseExists/);
  assert.match(source, /artifactAvailable/);
  assert.match(source, /packageMatchesTarget/);
  assert.match(source, /installable/);
});

test('Rust GitHub releases select the runtime archive instead of the LuCI-only APK', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /directBinaryAvailable && providerId == 'rust'/,
    'Rust must prefer the runtime archive when a release also publishes a LuCI APK');
  assert.match(source, /tg-ws-proxy-aarch64-unknown-linux-musl\.tar\.gz/);
  assert.match(source, /tar -xzf/,
    'the checked runtime archive must be extracted before atomic installation');
  assert.match(source, /candidate\.provider == 'rust'/);
  assert.match(source, /candidate\.provider == 'rust'[\s\S]*--version/);
  assert.match(source, /providerId != 'go' && providerId != 'rust'/);
  assert.match(source, /provider\.id != 'go' && provider\.id != 'rust'/);
  assert.match(source, /activeSourceId == SOURCE_GITHUB.*\? null/,
    'direct Rust installations must not fabricate an APK package version');
});

test('legacy proxy status does not fabricate a stale Rust package version', () => {
  const source = fs.readFileSync(LEGACY_PROXY, 'utf8');
  assert.doesNotMatch(source, /packageVersion\s*=\s*'2\.0\.0-r1'/,
    'compatibility status must not report the old synthetic Rust package after a direct-binary update');
});

test('canonical Go provider follows the new direct-binary upstream', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /d0mhate\/-tg-ws-proxy-Manager-go/);
  assert.doesNotMatch(source, /spatiumstas\/tg-ws-proxy-go/);
  assert.match(source, /v\[0-9\]\[0-9A-Za-z\._-\]\*/);
  assert.match(source, /tg-ws-proxy-openwrt-/);
  assert.match(source, /artifactFormat\s*==\s*'binary'/);
  assert.match(source, /BINARY_PATH/);
  assert.match(source, /chmod 755/);
});

test('canonical Go provider does not fabricate an APK-feed version from GitHub metadata', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /provider\.id == 'go'\) return false/);
});

test('bounded untrusted APK fallback cannot accept an arbitrary package or URL', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /--allow-untrusted/);
  assert.match(source, /assetSize/);
  assert.match(source, /assetSha256/);
  assert.match(source, /provider\.package|packageName/);
  assert.doesNotMatch(source, /input\.url|input\.package|generic.*install/i);
});
