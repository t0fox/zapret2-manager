import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const UI = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js',
  'utf8'
);
const PROVIDER = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc',
  'utf8'
);
const PRODUCT = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc',
  'utf8'
);
const RPC = fs.readFileSync(
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc',
  'utf8'
);

test('TG ready projection accepts the canonical health listener check', () => {
  assert.match(UI, /health\.checks/);
  assert.match(UI, /listenerCheck/);
  assert.match(UI, /listenerCheck\s*\|\|/);
});

test('TG versions expose official release candidates to the product facade', () => {
  assert.match(PROVIDER, /export const proxy_provider_versions/);
  assert.match(PROVIDER, /official-github-release/);
  assert.match(PROVIDER, /artifactAvailable/);
  assert.match(PRODUCT, /proxy_provider_versions/);
  assert.match(PRODUCT, /releaseName/);
  assert.match(PRODUCT, /releaseBody/);
  assert.match(PRODUCT, /releaseUrl/);
});

test('TG update checks use verified direct release artifacts per provider adapter', () => {
  assert.match(PROVIDER, /assetSha256/);
  // Verified download of the exact GitHub release asset, per-adapter install.
  assert.match(PROVIDER, /function download_verified_artifact/);
  assert.match(PROVIDER, /function install_rust_archive/);
  assert.match(PROVIDER, /function install_go_apk/);
  assert.match(PROVIDER, /sha256sum/);
  assert.match(PROVIDER, /uclient-fetch/);
  assert.doesNotMatch(PROVIDER, /apk add --simulate[\s\S]*candidate\.installable/);
});

test('TG parameterized RPC decodes edit before invoking product functions', () => {
  assert.match(RPC, /function tg_edit_input/);
  assert.match(RPC, /tg_product_check_updates_method/);
  assert.match(RPC, /tg_product_check_updates_method\(req\)/);
});
