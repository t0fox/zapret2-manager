import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const compositionPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const coordinatorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const closurePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc');
const classificationPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ucodeAvailable = fs.existsSync(UCODE_BIN);

function read(file) { return fs.readFileSync(file, 'utf8'); }

const IDENTITY = {
  sourceCommit: 'c'.repeat(40),
  manifestSha256: 'm'.repeat(64),
  classificationSha256: 'd'.repeat(64),
};
function luaEntry(id, sourcePath) {
  const name = id.slice(4);
  return {
    id, owner: 'z2k-core', role: 'lua-init', kind: 'lua', type: 'lifecycle-managed',
    sourcePath, runtimeTarget: `/runtime-assets/lua/${name}.lua`,
    contentSha256: 'a'.repeat(64), byteSize: 10, runtimeOrder: Number(name === 'x' ? 0 : name === 'y' ? 1 : 2),
    version: 'r-80.3', ...IDENTITY,
  };
}
function provider(entry, functions) {
  return {
    id: entry.id, sourcePath: entry.sourcePath, runtimeTarget: entry.runtimeTarget,
    contentSha256: entry.contentSha256, owner: entry.owner, role: entry.role,
    byteSize: entry.byteSize, functions,
  };
}
function providerIndex(providers) {
  return { schema: 'z2m.runtime-provider-index.v1', complete: true, providers, luaProviders: providers };
}
function invokeClosure(targetEntries, targetIndex, args, installedEntries = []) {
  const source = `import * as composition from ${JSON.stringify(compositionPath)}; import { z2k_dependency_closure } from ${JSON.stringify(closurePath)}; let installed = ${JSON.stringify(installedEntries)}; let target = composition.runtime_composition_provider_index({composition: {runtimeAssets: ${JSON.stringify(targetEntries)}, lifecycleState: 'target'}, providerIndex: ${JSON.stringify(targetIndex)}}); let closure = target.ok ? z2k_dependency_closure({args: ${JSON.stringify(args)}, assets: targetEntries, functions: target.providerIndex.functions}) : target; print(sprintf('%J', {installedCount: length(installed), target: target, closure: closure}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, '-e', source])}`);
  return JSON.parse(result.stdout);
}

test('target provider index is a canonical runtime-composition projection', () => {
  const composition = read(compositionPath);
  assert.match(composition, /export const runtime_composition_provider_index\s*=/,
    'the canonical composition must expose one provider-index resolver');
  assert.match(composition, /providerIndex/);
  assert.match(composition, /contentSha256/);
  assert.match(composition, /sourcePath/);
  assert.match(composition, /runtimeTarget/);
});

test('target composition preserves immutable dependency aliases for non-Lua assets', () => {
  const coordinator = read(coordinatorPath);
  const start = coordinator.indexOf('function z2k_canonical_target_assets');
  const end = coordinator.indexOf('function make_stage_root', start);
  assert.ok(start >= 0 && end > start, 'canonical target asset projection must exist');
  const projection = coordinator.slice(start, end);
  assert.match(projection, /aliases:\s*item\.aliases/,
    'target aliases must be projected from the same immutable composition metadata');
  const classification = JSON.parse(read(classificationPath));
  const byPath = new Map(classification.files.map(item => [item.sourcePath, item]));
  for (const [sourcePath, alias] of [
    ['files/fake/quic_1.bin', 'quic1'],
    ['files/fake/quic_4.bin', 'quic4'],
    ['files/fake/quic_5.bin', 'quic5'],
    ['files/fake/quic_6.bin', 'quic6'],
    ['files/fake/quic_initial_dbankcloud_ru.bin', 'quic_dbankcloud'],
    ['files/fake/quic_initial_www_google_com.bin', 'quic_google'],
  ]) {
    assert.deepEqual(byPath.get(sourcePath)?.aliases, [alias], `${sourcePath} must declare its canonical dependency alias`);
  }
});

test('Z2K target inventory never takes Lua providers from installed asset-registry environment', () => {
  const coordinator = read(coordinatorPath);
  const start = coordinator.indexOf('function z2k_target_dependency_inventory');
  const end = coordinator.indexOf('function z2k_core_snapshot_for_target', start);
  assert.ok(start >= 0 && end > start, 'target inventory boundary must exist');
  const inventory = coordinator.slice(start, end);
  assert.match(inventory, /runtimeCandidate\.providerIndex/,
    'target inventory must consume the candidate composition provider index');
  assert.doesNotMatch(inventory, /asset_registry_environment\s*\(|environment\.functions|environment\.luaFunctions/,
    'target dependency truth must never be derived from installed environment functions');
});

test('target dependency truth follows target providers in both installed/target directions', () => {
  const composition = read(compositionPath);
  const coordinator = read(coordinatorPath);
  assert.match(composition, /Every dependency accepted for a candidate|candidate dependency truth/i,
    'the candidate dependency truth rule must remain next to the resolver');
  assert.match(coordinator, /z2k_target_provider_index\(runtimeInput,\s*resolved\.commitSha\)/,
    'prepare must bind provider evidence to the selected immutable target commit');
  assert.doesNotMatch(coordinator, /z2k_target_dependency_inventory[\s\S]{0,800}asset_registry_environment/,
    'installed X,Y,Z must not satisfy a target X,Y dependency on Z');
});

test('prepared target identity is bound to the canonical provider index', () => {
  const coordinator = read(coordinatorPath);
  assert.match(coordinator,
    /\|provider-index:'\s*\+\s*sprintf\('%J',\s*target\.providerIndex\s*\|\|\s*null\)/,
    'provider identities and function lists must participate in the checked target token');
  assert.match(coordinator,
    /let runtimeInput = resolveTargetRuntimeInput\(value\);[\s\S]*runtimeInput\.providerIndex\.complete[\s\S]*sprintf\('%J',\s*runtimeInput\.providerIndex\)\s*!=\s*sprintf\('%J',\s*value\.providerIndex\)/,
    'prepared target validation must re-resolve the provider index from the target composition');
});

test('target closure accepts a provider absent from installed X,Y when target contains X,Y,Z', { skip: !ucodeAvailable }, () => {
  const x = luaEntry('lua:x', 'files/lua/x.lua');
  const y = luaEntry('lua:y', 'files/lua/y.lua');
  const z = luaEntry('lua:z', 'files/lua/z.lua');
  const targetEntries = [x, y, z];
  const result = invokeClosure(targetEntries, providerIndex([
    provider(x, []), provider(y, []), provider(z, ['Z']),
  ]), '--lua-desync=Z', [x, y]);
  assert.equal(result.target.ok, true, JSON.stringify(result));
  assert.equal(result.closure.available, true, JSON.stringify(result));
  assert.deepEqual(result.closure.missing, []);
  assert.equal(result.closure.items.find(item => item.reference === 'Z').providerId, 'lua:z');
});

test('target closure rejects Z from installed X,Y,Z when target contains only X,Y', { skip: !ucodeAvailable }, () => {
  const x = luaEntry('lua:x', 'files/lua/x.lua');
  const y = luaEntry('lua:y', 'files/lua/y.lua');
  const z = luaEntry('lua:z', 'files/lua/z.lua');
  const result = invokeClosure([x, y], providerIndex([provider(x, []), provider(y, [])]), '--lua-desync=Z', [x, y, z]);
  assert.equal(result.target.ok, true, JSON.stringify(result));
  assert.equal(result.closure.available, false, JSON.stringify(result));
  assert.deepEqual(result.closure.missing[0], {
    class: 'lua-function', kind: 'lua-function', type: null, reference: 'Z', id: 'Z',
    owner: null, role: 'function', runtimeTarget: null, sourcePath: null,
    contentSha256: null, byteSize: null, providerId: null, provider: null,
    available: false, reason: 'unknown consumed dependency',
  });
});

test('moving a function between target Lua providers preserves closure and provider identity', { skip: !ucodeAvailable }, () => {
  const x = luaEntry('lua:x', 'files/lua/x.lua');
  const y = luaEntry('lua:y', 'files/lua/y.lua');
  const first = invokeClosure([x, y], providerIndex([provider(x, ['Z']), provider(y, [])]), '--lua-desync=Z');
  const second = invokeClosure([x, y], providerIndex([provider(x, []), provider(y, ['Z'])]), '--lua-desync=Z');
  assert.equal(first.closure.available, true, JSON.stringify(first));
  assert.equal(second.closure.available, true, JSON.stringify(second));
  assert.equal(first.closure.items.find(item => item.reference === 'Z').providerId, 'lua:x');
  assert.equal(second.closure.items.find(item => item.reference === 'Z').providerId, 'lua:y');
});

test('removing a target provider fails closed before closure can use it', { skip: !ucodeAvailable }, () => {
  const x = luaEntry('lua:x', 'files/lua/x.lua');
  const y = luaEntry('lua:y', 'files/lua/y.lua');
  const result = invokeClosure([x, y], providerIndex([provider(x, [])]), '--lua-desync=Z');
  assert.equal(result.target.ok, false, JSON.stringify(result));
  assert.equal(result.target.error.code, 'EDEPENDENCY');
  assert.equal(result.target.error.provider, 'lua:y');
  assert.equal(result.target.error.reason, 'provider index is incomplete');
});
