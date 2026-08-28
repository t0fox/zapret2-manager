import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-cli.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');

test('Z2K target planning has one immutable identity and a v2 prepared snapshot', () => {
  assert.match(versions, /z2k_resolve_version/);
  assert.match(versions, /manifestSha256/);
  assert.match(coordinator, /schema:\s*2/);
  assert.match(coordinator, /latestCheck/);
  assert.match(coordinator, /preparedTarget/);
  assert.match(coordinator, /z2k-target-v2/);
  assert.match(coordinator, /localFingerprint/);
  assert.match(coordinator, /targetVersion/);
  assert.match(coordinator, /preparedAt/);
  assert.match(coordinator, /z2k_target_membership_compatible/);
  assert.match(coordinator, /hybrid asset set/);
});

test('Z2K target planning records exact-managed removals for release transitions', () => {
  assert.match(coordinator, /removeIds/);
  assert.match(coordinator, /z2k_target_removals/);
  assert.match(coordinator, /localFingerprint[\s\S]*removeIds/);
  assert.match(coordinator, /asset_registry_apply_bundle\(\{[\s\S]*removeIds/);
  assert.match(coordinator, /sort\(removeIds\)/);
  assert.doesNotMatch(coordinator, /removeIds\.sort\(\)/);
  assert.doesNotMatch(coordinator, /rows\.sort\(\)/);
  assert.ok(coordinator.indexOf('function z2k_target_asset_valid') < coordinator.indexOf('function valid_prepared_target'));
});

test('target operation is explicit: install, upgrade, reinstall, or downgrade', () => {
  for (const operation of ['install', 'upgrade', 'reinstall', 'downgrade'])
    assert.match(coordinator, new RegExp("['\\\"]" + operation + "['\\\"]"));
  assert.match(coordinator, /z2k_compare_versions/);
  assert.match(coordinator, /resource_center_prepare_version/);
});

test('apply consumes the prepared target, downloads complete exact-managed assets by commit SHA, and never replans', () => {
  assert.match(coordinator, /request\.targetVersion/);
  assert.match(coordinator, /request\.planToken/);
  assert.match(coordinator, /ECHECK_STALE/);
  assert.match(coordinator, /asset_registry_apply_bundle/);
  assert.match(coordinator, /asset_registry_rollback_bundle/);
  assert.match(coordinator, /RAW_ROOT|raw\.githubusercontent\.com/);
  assert.match(coordinator, /targetCommitSha[\s\S]*item\.sourcePath/);
  const applyBody = coordinator.slice(coordinator.indexOf('export const resource_center_update'));
  assert.doesNotMatch(applyBody, /z2k_component_apply\(request\)/);
  assert.doesNotMatch(applyBody, /z2k_upstream_check\(\)/);
  assert.doesNotMatch(applyBody, /z2k-enhanced\/['\"] \+ sourcePath/);
});

test('CLI, RPC, and API expose catalog, lazy details, and prepare as read-only/prepare operations', () => {
  for (const mode of ['versions', 'details', 'prepare']) assert.match(cli, new RegExp("['\\\"]" + mode + "['\\\"]"));
  for (const method of ['z2k_versions', 'z2k_version_details', 'z2k_prepare_version']) assert.match(rpc, new RegExp(method));
  for (const method of ['z2kVersions', 'z2kVersionDetails', 'z2kPrepareVersion']) assert.match(api, new RegExp(method));
});

test('watched or advisory upstream files cannot become target assets or primary UI warnings', () => {
  assert.match(versions, /exact-managed/);
  assert.match(versions, /relevant_path/);
  assert.doesNotMatch(versions, /z2k-config-validator\.sh.*assets/);
  assert.match(coordinator, /advisoryReviews/);
});
