import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const registry = read('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const page = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');

test('fresh selected-tag resolution uses one exact ref and avoids full catalog construction', () => {
  assert.match(versions, /function z2k_resolve_tag_fresh\s*\(/);
  assert.match(versions, /git\/ref\/tags\/['"] \+ version/);
  assert.match(versions, /refs\/tags\/['"] \+ version/);
  assert.match(versions, /objectType\s*==\s*['"]commit['"]/);
  assert.match(versions, /git\/tags\/['"] \+ tagSha/);
  const start = versions.indexOf('export const z2k_resolve_version');
  assert.ok(start >= 0);
  const body = versions.slice(start, versions.indexOf('export const z2k_compare_versions', start));
  assert.doesNotMatch(body, /z2k_versions\(\{\s*fresh:\s*true\s*\}\)/);
  assert.match(body, /z2k_resolve_tag_fresh\(version\)/);
});

test('Registry derives lifecycle management and protects only the canonical Z2K bundle', () => {
  assert.match(registry, /function (?:asset_)?management\s*\(/);
  assert.match(registry, /catalog\/upstream/);
  assert.match(registry, /z2k-curated-lua/);
  assert.match(registry, /owner:\s*['"]z2k-core['"]/);
  assert.match(registry, /editable:\s*false/);
  assert.match(registry, /deletable:\s*false/);
  const updateStart = registry.indexOf('export const asset_registry_update');
  const applyStart = registry.indexOf('export const asset_registry_apply_bundle');
  const deleteStart = registry.indexOf('export const asset_registry_delete');
  assert.ok(updateStart >= 0 && applyStart > updateStart && deleteStart > applyStart);
  assert.match(registry.slice(updateStart, applyStart), /EPOLICY/);
  assert.match(registry.slice(deleteStart), /EPOLICY/);
  assert.match(registry.slice(updateStart, applyStart), /Ресурс управляется Z2K Core/);
});

test('selected target removal references fail during prepare before target persistence', () => {
  assert.match(coordinator, /EZ2K_RESOURCE_CONFLICT/);
  assert.match(coordinator, /conflictingAssets/);
  const prepareStart = coordinator.indexOf('export const resource_center_prepare_version');
  const applyStart = coordinator.indexOf('function z2k_apply_prepared');
  const prepareBody = coordinator.slice(prepareStart, applyStart);
  assert.ok(prepareBody.indexOf('z2k_resource_conflicts') < prepareBody.indexOf('save_prepared_target'));
  assert.match(coordinator, /references/);
});

test('Resources consumes backend management projection for lifecycle read-only behavior', () => {
  assert.match(model, /management/);
  assert.match(page, /management\(asset\)\.editable/);
  assert.match(page, /management\(asset\)\.deletable/);
  assert.match(page, /Управляется Z2K Core/);
  assert.match(page, /Этот ресурс входит в установленную версию Z2K/);
  assert.match(page, /mode !== 'edit' \|\| !lifecycleManaged\(asset\)/);
  assert.doesNotMatch(page, /readOnly: asset\.ownership === 'package'/);
});

test('import collision rejects an existing lifecycle asset before assets.update', () => {
  const importStart = page.indexOf('function importPanel');
  const importEnd = page.indexOf('function hexRows', importStart);
  const body = page.slice(importStart, importEnd);
  assert.match(body, /lifecycleManaged\(current\)/);
  assert.match(body, /не может быть перезаписан/);
  assert.ok(body.indexOf('не может быть перезаписан') < body.indexOf('ctx.api.assets.update'));
});

test('prepared Z2K snapshots ignore unrelated user edits but detect managed state changes', () => {
  const fingerprintStart = coordinator.indexOf('function z2k_local_fingerprint');
  const fingerprintEnd = coordinator.indexOf('function z2k_target_token', fingerprintStart);
  const fingerprint = coordinator.slice(fingerprintStart, fingerprintEnd);
  assert.match(fingerprint, /targetAssets/);
  assert.match(fingerprint, /removeIds/);
  assert.doesNotMatch(fingerprint, /state\.revision/);

  const applyStart = coordinator.indexOf('function z2k_apply_prepared');
  const applyEnd = coordinator.indexOf('export const resource_center_update', applyStart);
  const apply = coordinator.slice(applyStart, applyEnd);
  assert.match(apply, /z2k_local_fingerprint\(target\.assets, listed, target\.removeIds\)/);
  assert.match(apply, /fingerprint == null \|\| fingerprint != target\.localFingerprint/);
  assert.match(registry, /is_z2k_lifecycle_asset\(asset\).*EPOLICY/);
});

test('selected fresh resolver reports bounded REST requests separately from raw manifest fetch', () => {
  assert.match(versions, /REST_REQUEST_COUNT/);
  assert.match(versions, /network_diagnostics\(['"]selected-tag['"]\)/);
  assert.match(versions, /fetch_text\(url, MAX_MANIFEST, ['"]z2m-z2k-manifest['"], false\)/);
  assert.match(versions, /restRequestCount: REST_REQUEST_COUNT/);
  assert.match(coordinator, /diagnostics: resolved\.diagnostics/);
});
