import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PROVIDER = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc';

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
