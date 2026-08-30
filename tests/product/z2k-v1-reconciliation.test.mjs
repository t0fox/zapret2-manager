import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const compositionPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const authorityPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc');
const coordinatorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const HAS_UCODE = fs.existsSync(UCODE_BIN);

function exists(file) { return fs.existsSync(file); }
function read(file) { return exists(file) ? fs.readFileSync(file, 'utf8') : ''; }
function invoke(expression) {
  const source = `import * as composition from ${JSON.stringify(compositionPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

const digest = value => value.repeat(64);
const legacyEntry = (id, type, sha, byteSize, sourcePath) => ({ id, type, sha256: digest(sha), byteSize, sourcePath });
const legacy = {
  schema: 'asset-activation-receipt.v1', bundleId: 'z2k-curated-lua', version: 'r-80.3',
  source: 'necronicle/z2k', sourceCommit: 'a'.repeat(40), activatedAt: 100,
  assets: [legacyEntry('lua:alpha', 'lua', 'a', 20, 'files/lua/alpha.lua'), legacyEntry('blob:beta', 'blob', 'b', 22, 'files/fake/beta.bin')],
};
const registryAssets = legacy.assets.map((entry, index) => ({
  id: entry.id, type: entry.type, contentSha256: entry.sha256, byteSize: entry.byteSize,
  path: `/etc/zapret2-manager/assets/${entry.id.replace(':', '/')}`, ownership: 'manager', revision: index + 1,
  provenance: { kind: 'catalog/upstream', bundleId: legacy.bundleId, source: legacy.source,
    version: legacy.version, sourceCommit: legacy.sourceCommit, sourcePath: entry.sourcePath },
}));

function fixture(classification) {
  return {
    receipt: legacy,
    registry: { ok: true, schema: 1, revision: 7, assets: registryAssets, activationReceipts: [legacy] },
    packageClassification: classification,
    staticBase: [],
  };
}

test('v1 authority is represented as V1_VERIFIED_MEMBERSHIP with explicit reconciliation required', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const result = invoke(`composition.resolveInstalled(${JSON.stringify(fixture([
    { sourcePath: 'files/lua/alpha.lua', type: 'lua', runtimeOrder: 90, role: 'lua-init' },
  ]))})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.compositionStatus, 'incomplete');
  assert.equal(result.lifecycleState, 'V1_VERIFIED_MEMBERSHIP');
  assert.equal(result.reconciliationRequired, true);
  assert.deepEqual(result.legacyMembership.map(entry => entry.id), ['lua:alpha', 'blob:beta']);
  assert.equal(result.luaInit, undefined, 'v1 must not invent canonical luaInit');
});

test('mutable package classification cannot invent v1 runtime order, role, or luaInit', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const result = invoke(`composition.resolveInstalled(${JSON.stringify(fixture([
    { sourcePath: 'files/lua/alpha.lua', type: 'lua', runtimeOrder: 1, role: 'lua-init' },
    { sourcePath: 'files/fake/beta.bin', type: 'lua', runtimeOrder: 2, role: 'lua-init' },
  ]))})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.luaInit, undefined);
  assert.equal(result.runtimeAssets, undefined);
  assert.match(JSON.stringify(result.blockingReasons || []), /RECONCILIATION_REQUIRED/);
});

test('same-release FRESH reconciliation requires exact v1 version/sourceCommit and membership proof', { todo: 'Task 4 transaction slice' }, () => {
  const authority = read(authorityPath);
  const coordinator = read(coordinatorPath);
  assert.match(authority, /V1_VERIFIED_MEMBERSHIP|reconciliationRequired/);
  assert.match(coordinator, /FRESH|fresh|z2k_upstream_check|z2k_resolve_version/);
  assert.match(coordinator, /sourceCommit/);
  assert.match(coordinator, /targetVersion/);
  assert.match(coordinator, /reinstall/);
  assert.match(coordinator, /RECONCILIATION_REQUIRED/);
  assert.match(coordinator, /membership|sourcePath|contentSha256|byteSize/);
  assert.doesNotMatch(coordinator, /current.*classification.*historical|historical.*current.*classification/i);
});

test('same-release V1 reconciliation takes byte size from the Registry-backed membership', () => {
  const coordinator = read(coordinatorPath);
  const start = coordinator.indexOf('function z2k_v1_reconciliation_check');
  const end = coordinator.indexOf('function z2k_registry_asset_type', start);
  assert.ok(start >= 0 && end > start, 'V1 reconciliation helper must be present');
  const reconciliation = coordinator.slice(start, end);
  assert.match(reconciliation, /registry_asset\(listed\.assets, old\.id\)/,
    'FRESH UPDATES.json does not carry byteSize; reconciliation must consult the validated Registry');
  assert.match(reconciliation, /current\.byteSize/,
    'V1 byte-size equality must be checked against the Registry-backed asset');
});

test('prepare fills missing target byte sizes from Registry or the existing immutable asset fetch', () => {
  const coordinator = read(coordinatorPath);
  assert.match(coordinator, /function z2k_target_assets_with_sizes/,
    'prepare needs an explicit size-evidence boundary before building canonical entries');
  const helperStart = coordinator.indexOf('function z2k_target_assets_with_sizes');
  const helperEnd = coordinator.indexOf('function z2k_v1_reconciliation_check', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'target size helper must be scoped before V1 reconciliation');
  const helper = coordinator.slice(helperStart, helperEnd);
  assert.match(helper, /registry_asset\(listed\.assets/,
    'unchanged target bytes should use the Registry without a redundant download');
  assert.match(helper, /uclient-fetch/,
    'changed/new target bytes must use the existing immutable SHA-bound asset fetch');
  assert.match(helper, /sha256\(/,
    'downloaded target size evidence must remain SHA verified');
  assert.match(coordinator, /z2k_target_assets_with_sizes\(resolved\.assets/,
    'prepare must consume the size-evidenced target before canonical composition');
});

test('v1 migration reuses the normal candidate transaction instead of a second updater', { todo: 'Task 4 transaction slice' }, () => {
  const coordinator = read(coordinatorPath);
  for (const step of [
    'resolveCandidate', 'pending', 'asset_registry_apply_bundle', 'materialize',
    'verifyMaterialized', 'verifyActivationProcess', 'finalize', 'asset-activation-receipt',
  ]) assert.match(coordinator, new RegExp(step, 'i'), `missing migration transaction step: ${step}`);
  assert.match(coordinator, /same.version|same_version|reinstall/i);
  assert.doesNotMatch(coordinator, /function\s+z2k_v1_(?:update|apply)|v1.*updater/i);
});

test('exact identity and membership mismatch remain reconciliation-required', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const wrongVersion = fixture([]);
  wrongVersion.receipt = { ...legacy, version: 'r-79.7' };
  const wrongCommit = fixture([]);
  wrongCommit.receipt = { ...legacy, sourceCommit: 'b'.repeat(40) };
  for (const value of [wrongVersion, wrongCommit]) {
    const result = invoke(`composition.resolveInstalled(${JSON.stringify(value)})`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'RECONCILIATION_REQUIRED');
  }
});

test('successful same-release reconciliation is an explicit reinstall handoff to v2 authority', { todo: 'Task 4 transaction slice' }, () => {
  const coordinator = read(coordinatorPath);
  assert.match(coordinator, /reinstall/);
  assert.match(coordinator, /asset-activation-receipt\.v2|schema:\s*['"]?2/);
  assert.match(coordinator, /sourceCommit/);
  assert.match(coordinator, /manifestSha256/);
  assert.match(coordinator, /classificationSha256/);
  assert.match(coordinator, /z2kMembership/);
});
