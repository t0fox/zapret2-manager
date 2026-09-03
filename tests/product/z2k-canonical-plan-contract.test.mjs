import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const upstream = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
const component = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-component.uc');
const resourceUpdate = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const generator = read('tools/generate-z2k-classification.mjs');
const integration = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));
const nativePreflight = read('zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc');
const nativeManifest = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json'));
const nativeManifestSource = read('zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json');
const strategyCli = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const scannerAdapter = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh');

test('classification policy is explicit: production shell drift is advisory, trust roots are blocking', () => {
  assert.match(generator, /reviewPolicy/);
  const policies = Object.fromEntries(integration.files
    .filter(item => item.class === 'watched')
    .map(item => [item.sourcePath, item.reviewPolicy]));
  assert.equal(policies['files/z2k-config-validator.sh'], 'advisory');
  assert.equal(policies['files/z2k-geosite.sh'], 'advisory');
  assert.equal(policies['files/z2k-update-lists.sh'], 'advisory');
  assert.equal(policies['files/etc/z2k-roots.pem'], 'blocking');
  assert.equal(policies['files/etc/z2k-update-pub.pem'], 'blocking');
});

test('canonical plan separates update availability from attention and apply eligibility', () => {
  for (const field of ['updateState', 'attentionState', 'canApply', 'updates', 'rebases', 'reviews', 'advisoryReviews', 'blockingReviews', 'blockingReasons', 'manifest']) {
    assert.match(upstream, new RegExp('\\b' + field + '\\b'), `upstream plan must expose ${field}`);
  }
  assert.match(upstream, /canApply[\s\S]{0,240}updates/);
  assert.match(upstream, /advisoryReviews/);
  assert.match(upstream, /blockingReviews/);
  assert.match(upstream, /reviewPolicy/);
  assert.match(upstream, /unknown.*blocking|blocking.*unknown/i);
});

test('component planner consumes canonical upstream plan instead of a second precedence machine', () => {
  const start = component.indexOf('export const z2k_component_plan');
  const end = component.indexOf('export const z2k_component_apply');
  assert.ok(start >= 0 && end > start);
  const planBody = component.slice(start, end);
  assert.match(planBody, /z2k_upstream_plan\(remoteManifest\)/);
  assert.doesNotMatch(planBody, /for \(let sourcePath in keys\(checked\.manifest\.files_sha256\)\)/);
  assert.doesNotMatch(planBody, /if \(length\(watched\)\)/);
  assert.match(planBody, /attentionState/);
  assert.match(planBody, /canApply/);
});

test('check state carries a bounded plan token and update consumes the checked snapshot', () => {
  assert.match(resourceUpdate, /planToken/);
  assert.match(resourceUpdate, /ECHECK_STALE/);
  assert.match(resourceUpdate, /targetVersion/);
  assert.match(resourceUpdate, /z2k-target-v2/);
  assert.match(resourceUpdate, /checkedAt/);
  const updateBody = resourceUpdate.slice(resourceUpdate.indexOf('export const resource_center_update'));
  assert.doesNotMatch(updateBody, /signedForZ2k\s*=\s*z2k_upstream_check\(\)/, 'apply must not perform a second network check');
  assert.match(updateBody, /z2k_apply_prepared/);
  assert.match(resourceUpdate.slice(resourceUpdate.indexOf('function z2k_apply_prepared')), /planToken/);
});

test('available release and activation receipt version come from the selected catalog target', () => {
  assert.match(resourceUpdate, /z2k_resolve_version\(version\)/);
  assert.match(resourceUpdate, /targetVersion:\s*resolved\.version/);
  assert.match(resourceUpdate, /sourceCommit:\s*target\.targetCommitSha/);
  assert.match(resourceUpdate, /version:\s*target\.targetVersion/);
  const componentApply = component.slice(component.indexOf('export const z2k_component_apply'));
  assert.match(componentApply, /ELEGACY_LIFECYCLE/);
  assert.doesNotMatch(componentApply, /z2k_upstream_check\(\)|asset_registry_apply_bundle/);
});

test('compiler-input changes remain non-applicable through target preparation and release details', () => {
  assert.match(resourceUpdate, /length\(plan\.compilerInputs \|\| \[\]\)/);
  assert.match(resourceUpdate, /compiler-inputs|compilerInputs/);
  assert.match(versions, /length\(targetPlan\.compilerInputs \|\| \[\]\) == 0/);
});

test('native preflight consumes the installed resolver closure instead of a static Lua list', () => {
  assert.match(nativePreflight, /runtime-composition\.uc/,
    'native preflight must import the canonical runtime composition boundary');
  assert.match(nativePreflight, /runtimeAssets|dependencyIndex/,
    'native preflight must receive explicit runtime assets and dependency closure');
  assert.match(nativePreflight, /luaInit/,
    'native preflight must build the command from resolver-owned ordered luaInit');
  assert.doesNotMatch(nativePreflight, /RUNTIME_LUA_FILES\s*=|for \(let i = 0; i < length\(RUNTIME_LUA_FILES\)/,
    'native preflight must not maintain a hand-copied Lua load list');
  assert.doesNotMatch(nativeManifestSource, /luaFiles/,
    'native preflight manifest must remain static engine evidence only');
  assert.ok(nativeManifest.minNfqws2CompatVer >= 1);
});

test('Strategy Apply owns two resolver snapshots and final CAS before profile mutation', () => {
  assert.match(strategyCli, /runtime-composition\.uc/,
    'Strategy Apply must use the canonical resolver rather than a client snapshot');
  const first = strategyCli.indexOf('resolveInstalled');
  const writer = strategyCli.lastIndexOf('profiles_apply_candidate');
  const final = strategyCli.lastIndexOf('resolveInstalled');
  assert.ok(first >= 0 && final > first && writer > final,
    'Apply must resolve, preflight, re-resolve and only then call the profile writer');
  assert.match(strategyCli, /ESTALE/,
    'Registry/receipt/composition changes must fail closed as ESTALE');
  assert.match(strategyCli, /observedRegistryRevision|membershipDigest|compositionSnapshotId/,
    'final CAS must compare resolver-owned snapshot identity');
  assert.doesNotMatch(strategyCli, /input\.snapshotId\s*==|input\.compositionSnapshotId\s*==/,
    'client-supplied snapshot identifiers must not be the Apply authority');
});
