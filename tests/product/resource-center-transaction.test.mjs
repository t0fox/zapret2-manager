import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const strategyUpdate = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-update.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const z2kComponentPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-component.uc';
const z2kComponent = fs.existsSync(z2kComponentPath) ? read(z2kComponentPath) : '';

test('Asset Registry exposes a staged, hash-verified, all-or-nothing bundle transaction', () => {
  for (const fragment of ['asset_registry_apply_bundle', 'asset_registry_rollback_bundle', 'stagedPath', 'sha256_file(item.stagedPath)', 'atomic_write(path, entry.content)', 'oldStateRaw', 'EDEPENDENCY', 'EPOLICY', 'ECONFLICT'])
    assert.match(registry, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), fragment);
  assert.match(registry, /MAX_BUNDLE_BYTES/);
  assert.match(registry, /\.previous/);
  assert.match(registry, /postflight/);
  assert.match(registry, /rollbackAvailable: true/);
  assert.match(registry, /old.provenance.kind != 'catalog\/upstream'/);
  assert.match(registry, /item.expectedRevision == null/);
});

test('Resource coordinator checks manifests cheaply and downloads only changed assets', () => {
  for (const fragment of ['manifest-only', 'uclient-fetch', 'safeToUpdate', 'contentUrl', 'controlledTest', 'confirm !== true'])
    assert.match(coordinator, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), fragment);
  assert.match(coordinator, /asset_registry_apply_bundle/);
  assert.match(coordinator, /row.state == 'current'/);
  assert.match(coordinator, /state_label/);
  assert.match(coordinator, /z2k_upstream_check/);
  assert.match(coordinator, /signed Z2K manifest/);
  assert.match(coordinator, /sourceId == 'z2k-resources'/);
});

test('Resource Center RPCs and ACL expose read checks separately from update', () => {
  for (const method of ['resources_status', 'resources_check', 'resources_update']) {
    assert.match(rpc, new RegExp(method));
    assert.match(acl, new RegExp(method));
  }
  assert.match(rpc, /resources_update: \{ args: \{ edit: 'string' \}/);
});

test('Package-owned resource content is read-only and hash-verified from the package baseline', () => {
  assert.match(registry, /RESOURCE_MANIFEST/);
  assert.match(registry, /package_manifest_asset/);
  assert.match(registry, /ownership: 'package'/);
  assert.match(registry, /actual != item\.sha256/);
  assert.match(registry, /asset_registry_get_content/);
});

test('Z2K component resolver only stages exact-managed files and blocks adapted/platform lifecycle', () => {
  for (const fragment of ['z2k_component_plan', 'z2k_component_apply', 'exact-managed', 'adapted', 'ignored-platform', 'EZ2K_REBASE_REQUIRED', 'asset_registry_apply_bundle', 'postflight'])
    assert.match(z2kComponent, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), fragment);
  assert.match(z2kComponent, /request\.confirm !== true/);
  const applyBody = z2kComponent.slice(z2kComponent.indexOf('export const z2k_component_apply'));
  assert.match(applyBody, /z2k_upstream_check\(\)/, 'apply must re-verify the signed manifest server-side');
  assert.doesNotMatch(applyBody, /z2k_component_plan\(request\.remoteManifest\)/, 'apply must not trust a caller-supplied manifest');
  assert.doesNotMatch(applyBody, /init\.d|webpanel|z2k\.sh.*write|scheduler/);
});

test('Strategy catalog updates require a complete verified snapshot and retain last known good', () => {
  for (const fragment of ['completeSnapshot', 'dependenciesVerified', 'stagedRoot', 'strategy_catalog_load', 'lastKnownGoodRetained', 'MANAGED_ROOT'])
    assert.match(strategyUpdate, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), fragment);
  assert.match(strategyUpdate, /partial remote files are rejected/);
  assert.match(strategyUpdate, /usersPreserved: true/);
});
