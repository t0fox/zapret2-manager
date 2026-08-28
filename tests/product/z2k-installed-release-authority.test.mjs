import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const registry = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'), 'utf8');
const coordinator = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
const authority = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc'), 'utf8');
const versions = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc'), 'utf8');
const runtimeCoordinator = path.resolve(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const runtimeSource = fs.readFileSync(runtimeCoordinator, 'utf8');
const authorityModule = path.resolve(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc');
const versionsModule = path.resolve(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ucodeArgs = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS_JSON
  ? JSON.parse(process.env.UCODE_ARGS_JSON)
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const ucodeLibraryPattern = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const ucodeLibraryArgs = ucodeLibraryPattern ? ['-L', ucodeLibraryPattern] : [];
const hasUcode = fs.existsSync(ucodeBin);

const SOURCE_COMMIT = 'a'.repeat(40);
const BASE_ASSETS = [
  { id: 'lua:alpha', type: 'lua', contentSha256: '1'.repeat(64), byteSize: 11, sourcePath: 'files/lua/alpha.lua' },
  { id: 'blob:beta', type: 'blob', contentSha256: '2'.repeat(64), byteSize: 22, sourcePath: 'files/fake/beta.bin' },
];

function legacyReceipt() {
  return {
    schema: 'asset-activation-receipt.v1', bundleId: 'z2k-curated-lua', version: 'r-79.7',
    source: 'necronicle/z2k', sourceCommit: SOURCE_COMMIT, activatedAt: 123,
    // Historical 2db63158 shape: only these four fields existed per receipt asset.
    assets: BASE_ASSETS.map(({ id, type, contentSha256, byteSize }) => ({ id, type, sha256: contentSha256, byteSize })),
  };
}

function listed(receipt = legacyReceipt(), assets = BASE_ASSETS) {
  return {
    ok: true, schema: 1, revision: 7,
    assets: assets.map(asset => ({ ...asset, path: `/etc/zapret2-manager/assets/${asset.id.replace(':', '/')}`, ownership: 'manager', revision: 1,
      provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: asset.sourceCommit || SOURCE_COMMIT,
        sourcePath: asset.sourcePath, bundleId: 'z2k-curated-lua', version: asset.version || 'r-79.7' } })),
    activationReceipts: [receipt],
  };
}

function invoke(module, expression) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucodeBin, [...ucodeArgs, ...ucodeLibraryArgs, '-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${ucodeDiagnostic([ucodeBin, ...ucodeArgs, ...ucodeLibraryArgs, '-e', source], ucodeLibraryPattern)}`);
  return JSON.parse(result.stdout);
}

test('Asset Registry exposes bounded activation receipts as the installed-release authority', () => {
  assert.match(registry, /activationReceipts/);
  assert.match(registry, /asset-activation-receipt\.v1/);
  assert.match(registry, /activatedAt/);
  assert.match(registry, /sourceCommit/);
  assert.match(registry, /return \{ ok: true, schema: 1, revision: state\.revision, assets: assets, activationReceipts:/);
});

test('Z2K local projection prefers a receipt, then reports bounded inference confidence', () => {
  assert.match(coordinator, /z2k_registry_installed_release/);
  assert.match(authority, /activation-receipt/);
  assert.match(coordinator, /known-manifest/);
  assert.match(coordinator, /inconsistent/);
  assert.match(coordinator, /installedRelease\s*:/);
  assert.match(authority, /confidence/);
});

test('technical source commits remain separate from installed release identity', () => {
  const projection = coordinator.slice(coordinator.indexOf('function z2k_local_projection'), coordinator.indexOf('function load_check_state'));
  assert.match(projection, /commit:/);
  assert.match(projection, /installedRelease:/);
  assert.match(projection, /provenance:/);
});

test('Engine RPC projections expose the same independent truth fields as the UI model', () => {
  assert.match(engine, /function canonical_engine_releases\s*\(/);
  assert.match(engine, /answer\.installed\s*=\s*\{ version:/);
  assert.match(engine, /answer\.available\s*=\s*\{ version:/);
  assert.match(engine, /answer\.updateState\s*=\s*latest == null \? 'unknown'/);
  assert.match(engine, /function canonical_engine_check\s*\(/);
  assert.match(engine, /answer\.compatibility\s*=\s*\{ state:/);
  assert.match(engine, /export const engine_check_release = function \(input\) \{ return canonical_engine_check\(input\); \}/);
});

test('legacy v1 receipt compatibility is explicit and shares the reinstall operation contract', () => {
  assert.match(authority, /legacy|top-level|sourcePath/);
  assert.match(authority, /provenance\.version\s*!=\s*receipt\.version/);
  assert.match(authority, /provenance\.sourceCommit\s*!=\s*receipt\.sourceCommit/);
  assert.match(versions, /export const z2k_target_operation/);
});

test('legacy receipt history has a canonical, ambiguity-checked runtime identity resolver', () => {
  const resolver = runtimeSource.slice(runtimeSource.indexOf('function z2k_classification_asset_for'), runtimeSource.indexOf('export const z2k_runtime_materialize_confirmed'));
  const target = runtimeSource.slice(runtimeSource.indexOf('export const z2k_runtime_confirmed_target'), runtimeSource.indexOf('export const z2k_runtime_materialize_confirmed'));
  assert.match(runtimeSource, /z2k_asset_id_from_classification/);
  assert.match(resolver, /newest|newer|complete/i);
  assert.match(resolver, /ambiguous|contradictory/i);
  assert.doesNotMatch(target, /z2k_classification_for\(classification, recorded\.sourcePath\)/);
});

const historicalClassification = [{
  sourcePath: 'files/fake/4pda.bin', class: 'exact-managed', type: 'bin',
  localName: 'runtime-assets/bin/4pda.bin', runtimeTarget: '/runtime-assets/bin/4pda.bin'
}];
const currentRuntimeAsset = {
  id: 'lua:z2k-modern-core', type: 'lua', contentSha256: '3'.repeat(64), byteSize: 33,
  provenance: { kind: 'catalog/upstream', bundleId: 'z2k-curated-lua', version: 'r-80.3', sourceCommit: 'c'.repeat(40), sourcePath: 'files/lua/z2k-modern-core.lua' }
};
const runtimeAuthority = { value: 'r-80.3', confidence: 'confirmed', authority: 'activation-receipt' };
const runtimeListed = (receipts, classification = historicalClassification) => ({
  ok: true, assets: [currentRuntimeAsset], activationReceipts: receipts,
  classification
});
const legacyRuntimeReceipt = (id = 'blob:4pda') => ({
  schema: 'asset-activation-receipt.v1', bundleId: 'z2k-curated-lua', version: 'r-79.7',
  source: 'necronicle/z2k', sourceCommit: 'a'.repeat(40), activatedAt: 100,
  assets: [{ id, type: 'blob', sha256: '4'.repeat(64), byteSize: 44 }]
});
const completeRuntimeReceipt = (sourcePath = 'files/fake/4pda.bin', version = 'r-80.3', sourceCommit = 'c'.repeat(40)) => ({
  schema: 'asset-activation-receipt.v1', bundleId: 'z2k-curated-lua', version,
  source: 'necronicle/z2k', sourceCommit, activatedAt: 200,
  assets: [{ id: 'blob:4pda', type: 'blob', sha256: '5'.repeat(64), byteSize: 55,
    sourceCommit, sourcePath, bundleId: 'z2k-curated-lua', version }]
});

function invokeRuntimeTarget(listed, classification = historicalClassification) {
  return invoke(runtimeCoordinator, `mod.z2k_runtime_confirmed_target(${JSON.stringify(listed)}, ${JSON.stringify({ files: classification })}, ${JSON.stringify(runtimeAuthority)})`);
}

test('A. legacy historical asset is mapped to a safe removal target', { skip: !hasUcode }, () => {
  const result = invokeRuntimeTarget(runtimeListed([legacyRuntimeReceipt()]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.target.removeTargets, [{ id: 'blob:4pda', type: 'blob', sourcePath: 'files/fake/4pda.bin', runtimeTarget: '/runtime-assets/bin/4pda.bin' }]);
});

test('B. unmappable legacy asset fails closed', { skip: !hasUcode }, () => {
  const result = invokeRuntimeTarget(runtimeListed([legacyRuntimeReceipt('blob:unknown')]));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
});

test('C. complete receipt metadata remains usable for runtime rematerialization', { skip: !hasUcode }, () => {
  const result = invokeRuntimeTarget(runtimeListed([completeRuntimeReceipt()]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.target.removeTargets[0].sourcePath, 'files/fake/4pda.bin');
});

test('D. mixed history prefers a complete descriptor consistently', { skip: !hasUcode }, () => {
  const result = invokeRuntimeTarget(runtimeListed([legacyRuntimeReceipt(), completeRuntimeReceipt()]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.target.removeTargets[0].sourcePath, 'files/fake/4pda.bin');
});

test('E. contradictory complete descriptors fail closed', { skip: !hasUcode }, () => {
  const classification = [
    ...historicalClassification,
    { sourcePath: 'files/fake/4pda-alt.bin', class: 'exact-managed', type: 'bin',
      localName: 'runtime-assets/bin/4pda.bin', runtimeTarget: '/runtime-assets/bin/4pda-alt.bin' }
  ];
  const result = invokeRuntimeTarget(runtimeListed([
    completeRuntimeReceipt('files/fake/4pda.bin', 'r-80.3', 'c'.repeat(40)),
    completeRuntimeReceipt('files/fake/4pda-alt.bin', 'r-80.2', 'd'.repeat(40))
  ], classification), classification);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
});

test('old r-79.7 receipt confirms the installed release and maps to reinstall', { skip: !hasUcode }, () => {
  const result = invoke(authorityModule, `mod.z2k_registry_installed_release(${JSON.stringify(listed())})`);
  assert.deepEqual(result, { value: 'r-79.7', confidence: 'confirmed', authority: 'activation-receipt' });
  assert.equal(invoke(versionsModule, "mod.z2k_target_operation('r-79.7', 'r-79.7')"), 'reinstall');
});

test('old receipt fails closed for hash, provenance, and extra active assets', { skip: !hasUcode }, () => {
  const hashMismatch = legacyReceipt();
  hashMismatch.assets[0].sha256 = 'f'.repeat(64);
  const wrongVersionAssets = BASE_ASSETS.map(asset => ({ ...asset, version: 'r-80.3' }));
  const wrongVersion = listed(legacyReceipt(), wrongVersionAssets);
  const wrongCommitAssets = BASE_ASSETS.map(asset => ({ ...asset, sourceCommit: 'b'.repeat(40) }));
  const wrongCommit = listed(legacyReceipt(), wrongCommitAssets);
  const extra = { ...BASE_ASSETS[0], id: 'lua:extra', sourcePath: 'files/lua/extra.lua' };
  for (const value of [
    listed(hashMismatch),
    wrongVersion,
    wrongCommit,
    listed(legacyReceipt(), [...BASE_ASSETS, extra]),
  ]) {
    assert.deepEqual(invoke(authorityModule, `mod.z2k_registry_installed_release(${JSON.stringify(value)})`), { value: null, confidence: 'unknown', authority: null });
  }
});
