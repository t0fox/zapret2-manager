import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const registry = read('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const strategyUpdate = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-update.uc');
const strategyCatalogRefresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc');
const strategySourceRefresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const strategySources = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const resourceCli = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-cli.uc');
const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');

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
  for (const method of ['z2k_versions', 'z2k_version_details', 'z2k_prepare_version_start']) {
    assert.match(rpc, new RegExp(method));
    assert.match(acl, new RegExp(method));
  }
});

test('Z2K strategy refresh stays owned by Core while Avatar remains independently refreshable', () => {
  for (const source of [strategySourceRefresh, strategySources]) {
    assert.match(source, /code: 'EMANAGED'/);
    assert.match(source, /owner: 'z2k-core'/);
  }
  assert.match(strategySourceRefresh, /if \(id == 'z2k'\) return managed_z2k\(\)/);
  assert.match(strategySourceRefresh, /if \(id != 'avatar'\) return error\('EINPUT'/);
  assert.match(strategySourceRefresh, /strategy_source_avatar_snapshot/);
  assert.match(strategyCatalogRefresh, /id == 'z2k'\) return \{ ok: false, error: \{ code: 'EMANAGED', owner: 'z2k-core'/);
});

test('REGRESSION: resources_status uses the bounded status projection at the RPC boundary', () => {
  assert.match(rpc, /resources_status_method\(req\).*resource_cli_action\('status-summary'\)/s,
    'resources_status must not send the unbounded lifecycle status through rpcd');
  assert.match(resourceCli, /mode == 'status-summary'/,
    'the resource CLI must expose the RPC-safe status mode');
  assert.match(resourceCli, /resource_center_status_summary/,
    'the CLI must project status through the coordinator-owned summary');
  assert.match(coordinator, /resource_center_status_summary/,
    'the bounded projection must remain owned by the Resource Center coordinator');
  assert.doesNotMatch(coordinator.slice(coordinator.indexOf('function z2k_status_collection')),
    /\bundefined\b/, 'the UCode projection must not use the JavaScript-only undefined literal');
  assert.match(coordinator, /function z2k_status_installed/,
    'installed resource rows must be projected instead of sending repeated dependency payloads');
  assert.match(coordinator, /function z2k_status_review_details/,
    'review details must keep only bounded UI evidence');
});

test('Package-owned resource content is read-only and hash-verified from the package baseline', () => {
  assert.match(registry, /RESOURCE_MANIFEST/);
  assert.match(registry, /package_manifest_asset/);
  assert.match(registry, /ownership: 'package'/);
  assert.match(registry, /actual != item\.sha256/);
  assert.match(registry, /asset_registry_get_content/);
});

test('Strategy catalog updates require a complete verified snapshot and retain last known good', () => {
  for (const fragment of ['completeSnapshot', 'dependenciesVerified', 'stagedRoot', 'strategy_catalog_load', 'lastKnownGoodRetained', 'MANAGED_ROOT'])
    assert.match(strategyUpdate, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), fragment);
  assert.match(strategyUpdate, /rejected-incomplete-source|complete verified catalog snapshot is required/);
  assert.match(strategyUpdate, /usersPreserved: true/);
});
