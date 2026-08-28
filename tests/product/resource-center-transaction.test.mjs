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
  assert.ok(registry.indexOf('function sha256_file') < registry.indexOf('function postflight'), 'postflight must use a previously declared hash helper in router ucode');
  assert.ok(registry.indexOf('function content_size') < registry.indexOf('function postflight'), 'postflight must use a previously declared size helper in router ucode');
  assert.match(registry, /rollbackAvailable: true/);
  assert.match(registry, /old.provenance.kind != 'catalog\/upstream'/);
  assert.match(registry, /item.expectedRevision == null/);
});

test('Asset Registry removes only declared upstream assets inside the same transaction', () => {
	assert.match(registry, /removeIds/);
	assert.match(registry, /EREFERENCED/);
	assert.match(registry, /old\.provenance\.kind != 'catalog\/upstream'/);
	assert.match(registry, /state\.assets[\s\S]*removeIds/);
	assert.match(registry, /removed:/);
});

test('Asset Registry accepts canonical upstream IDs whose slugs begin with a digit', () => {
	assert.match(registry, /match\(value, \/\^\[a-z0-9\]\[a-z0-9._-\]\*\$\//);
});

test('Resource coordinator keeps generic bundles transactional and routes Z2K through prepared targets', () => {
  for (const fragment of ['manifest-only', 'uclient-fetch', 'safeToUpdate', 'contentUrl', 'controlledTest', 'confirm !== true'])
    assert.match(coordinator, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), fragment);
  assert.match(coordinator, /asset_registry_apply_bundle/);
  assert.match(coordinator, /row.state == 'current'/);
  assert.match(coordinator, /state_label/);
  assert.match(coordinator, /z2k_apply_prepared/);
  assert.match(coordinator, /z2k-target-v2/);
  assert.match(coordinator, /ECHECK_STALE/);
  assert.match(coordinator, /sourceId == 'z2k-resources'/);
});

test('Resource Center RPCs and ACL expose read checks separately from update', () => {
  for (const method of ['resources_status', 'resources_check', 'resources_update']) {
    assert.match(rpc, new RegExp(method));
    assert.match(acl, new RegExp(method));
  }
  assert.match(rpc, /resources_update: \{ args: \{ edit: 'string' \}/);
  for (const method of ['z2k_versions', 'z2k_version_details', 'z2k_prepare_version']) {
    assert.match(rpc, new RegExp(method));
    assert.match(acl, new RegExp(method));
  }
});

test('Package-owned resource content is read-only and hash-verified from the package baseline', () => {
  assert.match(registry, /RESOURCE_MANIFEST/);
  assert.match(registry, /package_manifest_asset/);
  assert.match(registry, /ownership: 'package'/);
  assert.match(registry, /actual != item\.sha256/);
  assert.match(registry, /asset_registry_get_content/);
});

test('Z2K legacy component boundary is retired while the read-only planner remains compatible', () => {
  for (const fragment of ['z2k_component_plan', 'z2k_component_apply', 'exactManaged', 'adapted', 'ignored-platform', 'ELEGACY_LIFECYCLE'])
    assert.match(z2kComponent, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), fragment);
  const applyBody = z2kComponent.slice(z2kComponent.indexOf('export const z2k_component_apply'));
  assert.doesNotMatch(applyBody, /z2k_upstream_check\(\)/, 'retired apply must not perform network work');
  assert.doesNotMatch(applyBody, /asset_registry_apply_bundle/, 'retired apply must not mutate assets');
  assert.doesNotMatch(applyBody, /init\.d|webpanel|z2k\.sh.*write|scheduler/);
});

test('Legacy resource update requests fail closed instead of entering the old Z2K lifecycle', () => {
  assert.match(coordinator, /request\.component == 'z2k-runtime'/);
  assert.match(coordinator, /ELEGACY_LIFECYCLE/);
  assert.doesNotMatch(coordinator, /z2k_component_apply\(request\)/);
});

test('Strategy catalog updates require a complete verified snapshot and retain last known good', () => {
  for (const fragment of ['completeSnapshot', 'dependenciesVerified', 'stagedRoot', 'strategy_catalog_load', 'lastKnownGoodRetained', 'MANAGED_ROOT'])
    assert.match(strategyUpdate, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), fragment);
  assert.match(strategyUpdate, /rejected-incomplete-source|complete verified catalog snapshot is required/);
  assert.match(strategyUpdate, /usersPreserved: true/);
});
