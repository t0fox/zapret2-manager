import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const compositionPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const cliPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-cli.uc');
const cliApiPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-api.uc');
const coordinatorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const authorityPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const HAS_UCODE = fs.existsSync(UCODE_BIN);

function exists(file) { return fs.existsSync(file); }
function read(file) { return exists(file) ? fs.readFileSync(file, 'utf8') : ''; }

function invoke(expression, env = {}) {
  const source = `import * as composition from ${JSON.stringify(compositionPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function invokeCli(expression, env = {}) {
  const source = `import * as cli from ${JSON.stringify(cliApiPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

const HASH = value => value.charCodeAt(0).toString(16).padStart(2, '0').repeat(32);
const lifecycle = (id, kind, role, order, digest, sourcePath = `files/${kind}/${id.split(':')[1]}`) => ({
  id, owner: 'z2k-core', role, sourcePath, runtimeTarget: `/runtime-assets/${kind}/${id.split(':')[1]}`,
  contentSha256: HASH(digest), byteSize: order + 10, runtimeOrder: order,
  kind, type: 'lifecycle-managed', version: 'r-80.3', sourceCommit: 'c'.repeat(40),
  manifestSha256: HASH('m'), classificationSha256: HASH('c'),
});
const staticAsset = {
  id: 'engine:nfqws2', owner: 'package', role: 'engine', sourcePath: 'bin/nfqws2',
  runtimeTarget: '/opt/zapret2/bin/nfqws2', contentSha256: HASH('e'), byteSize: 100,
  kind: 'binary', type: 'package-static',
};

function v2Fixture() {
  const lua = lifecycle('lua:alpha', 'lua', 'lua-init', 10, 'a');
  const blob = lifecycle('blob:beta', 'blob', 'dependency', 20, 'b');
  const list = lifecycle('hostlist:gamma', 'hostlist', 'dependency', 30, 'd');
  const ipset = lifecycle('ipset:delta', 'ipset', 'dependency', 40, 'f');
  const membership = [lua, blob, list, ipset];
  const receipt = {
    schema: 'asset-activation-receipt.v2', bundleId: 'z2k-curated-lua', receiptId: 'receipt-r-80.3',
    version: 'r-80.3', source: 'necronicle/z2k', sourceCommit: 'c'.repeat(40),
    manifestSha256: HASH('m'), classificationSha256: HASH('c'), installedAuthorityRevision: 17,
    z2kMembership: membership, activatedAt: 100, activationEvidence: { pid: 100, starttime: 1 },
  };
  const assets = membership.map((entry, index) => ({
    ...entry, type: entry.kind, path: `/etc/zapret2-manager/assets/${entry.id.replace(':', '/')}`,
    ownership: 'manager', revision: index + 1,
    provenance: { kind: 'catalog/upstream', bundleId: 'z2k-curated-lua', source: 'necronicle/z2k',
      sourceCommit: 'c'.repeat(40), sourcePath: entry.sourcePath, version: 'r-80.3' },
  }));
  return {
    registry: { ok: true, schema: 1, revision: 17, assets, activationReceipts: [receipt] },
    receipt, staticBase: [staticAsset],
  };
}

function candidateFixture() {
  const lua = lifecycle('lua:alpha', 'lua', 'lua-init', 10, 'a');
  const blob = lifecycle('blob:beta', 'blob', 'dependency', 20, 'b');
  return {
    schema: 'z2k-target-v2', targetVersion: 'r-80.3', targetCommit: 'c'.repeat(40),
    manifestSha256: HASH('m'), classificationSha256: HASH('c'), assets: [lua, blob],
    removeIds: ['lua:obsolete'], planToken: 'z2k-plan-v1:17:80:r-80.3',
    contentIdentity: { membershipDigest: HASH('x') }, baseRegistryRevision: 17,
    staticBase: [staticAsset],
  };
}

test('canonical runtime composition module exposes the five planned lifecycle functions', () => {
  assert.ok(exists(compositionPath), 'runtime-composition.uc must be created before implementation');
  const source = read(compositionPath);
  for (const name of ['resolveInstalled', 'resolveCandidate', 'verifyMaterialized', 'verifyActivationProcess', 'verifyInstalledProcess'])
    assert.match(source, new RegExp(`export const ${name}\\s*=`), `${name} must be an exported resolver boundary`);
  assert.match(source, /runtimeAssets/);
  assert.match(source, /luaInit/);
  assert.match(source, /dependencyIndex/);
  assert.match(source, /scannerOverlay/);
});

test('installed authority revision remains distinct from later observed Registry revision', () => {
  const fixture = v2Fixture();
  fixture.registry.revision = 18;
  fixture.registry.assets.push({ id: 'user:note', type: 'other', path: '/etc/zapret2-manager/assets/user/note',
    ownership: 'user', contentSha256: HASH('u'), byteSize: 1, revision: 1,
    provenance: { kind: 'user', sourcePath: 'user/note' } });
  const result = invoke(`composition.resolveInstalled(${JSON.stringify({
    registry: fixture.registry, receipt: fixture.receipt, staticBase: fixture.staticBase,
  })})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.installedAuthorityRevision, 17);
  assert.equal(result.observedRegistryRevision, 18);
});

test('installed receipt with a future Registry revision fails closed', () => {
  const fixture = v2Fixture();
  fixture.registry.revision = 16;
  const result = invoke(`composition.resolveInstalled(${JSON.stringify(fixture)})`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EINCONSISTENT');
});

test('v2 installed resolution returns a complete, deterministic closure with Lua-only luaInit', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath), 'runtime-composition.uc must exist for UCode behavior tests');
  const fixture = v2Fixture();
  const first = invoke(`composition.resolveInstalled(${JSON.stringify(fixture)})`);
  const second = invoke(`composition.resolveInstalled(${JSON.stringify(fixture)})`);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.lifecycleState, 'installed');
  assert.equal(first.compositionStatus, 'canonical');
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(first.compositionSnapshotId, second.compositionSnapshotId);
  assert.equal(first.runtimeAssets.length, 5, JSON.stringify(first));
  assert.deepEqual(first.luaInit.map(entry => entry.id), ['lua:alpha']);
  for (const entry of first.runtimeAssets) {
    assert.equal(typeof entry.kind, 'string', entry.id);
    assert.equal(typeof entry.type, 'string', entry.id);
    assert.equal(typeof entry.contentSha256, 'string', entry.id);
  }
  assert.deepEqual(first.luaInit.map(entry => entry.kind), ['lua']);
  assert.equal(first.luaInit.some(entry => ['blob', 'hostlist', 'ipset'].includes(entry.kind)), false);
});

test('installed authority inconsistency fails closed and never falls back to package bytes', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const fixture = v2Fixture();
  fixture.registry.assets = fixture.registry.assets.slice(1);
  const result = invoke(`composition.resolveInstalled(${JSON.stringify(fixture)})`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.error.code, /^E/);
  assert.equal(result.runtimeAssets, undefined);
  assert.equal(result.luaInit, undefined);
});

test('candidate resolution works before an installed receipt and binds all prepared identity inputs', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const candidate = candidateFixture();
  const result = invoke(`composition.resolveCandidate(${JSON.stringify(candidate)})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.lifecycleState, 'candidate');
  assert.equal(result.receiptIdentity, null);
  assert.equal(result.baseRegistryRevision, 17);
  assert.equal(result.authority.targetVersion, 'r-80.3');
  assert.equal(result.authority.targetCommit, 'c'.repeat(40));
  assert.equal(result.authority.manifestSha256, HASH('m'));
  assert.equal(result.authority.classificationSha256, HASH('c'));
  assert.equal(result.authority.planToken, candidate.planToken);
  assert.deepEqual(result.authority.removeIds, ['lua:obsolete']);
  assert.deepEqual(result.luaInit.map(entry => entry.id), ['lua:alpha']);
});

test('candidate identity changes when order or content changes, while UI-independent input stays ignored', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const candidate = candidateFixture();
  const base = invoke(`composition.resolveCandidate(${JSON.stringify(candidate)})`);
  const reordered = { ...candidate, assets: [candidate.assets[1], { ...candidate.assets[0], runtimeOrder: 30 }] };
  const changed = { ...candidate, assets: [{ ...candidate.assets[0], contentSha256: HASH('z') }, candidate.assets[1]] };
  const uiOnly = { ...candidate, ui: { activeId: 'profile-2', mode: 'code', scrollTop: 900 } };
  assert.notEqual(base.snapshotId, invoke(`composition.resolveCandidate(${JSON.stringify(reordered)})`).snapshotId);
  assert.notEqual(base.snapshotId, invoke(`composition.resolveCandidate(${JSON.stringify(changed)})`).snapshotId);
  assert.equal(base.snapshotId, invoke(`composition.resolveCandidate(${JSON.stringify(uiOnly)})`).snapshotId);
});

test('candidate CAS distinguishes unrelated revision changes from its own N to N+1 commit', { todo: 'Task 4 transaction slice' }, () => {
  const coordinator = read(coordinatorPath);
  assert.match(coordinator, /baseRegistryRevision/);
  assert.match(coordinator, /observedRegistryRevision/);
  assert.match(coordinator, /committedAssetRevision/);
  assert.match(coordinator, /ESTALE/);
  assert.match(coordinator, /own|expected|committed/i);
  assert.match(coordinator, /membership.*candidate|candidate.*membership/i);
});

test('expected closure is resolvable without runtime files, while materialization and process evidence fail separately', { skip: !HAS_UCODE }, () => {
  assert.ok(exists(compositionPath));
  const candidate = candidateFixture();
  const resolved = invoke(`composition.resolveCandidate(${JSON.stringify(candidate)})`);
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  const materialized = invoke(`composition.verifyMaterialized(${JSON.stringify(resolved)}, ${JSON.stringify({ files: {}, configHash: null })})`);
  assert.equal(materialized.ok, false, JSON.stringify(materialized));
  assert.match(materialized.error.code, /^E/);
  assert.equal(invoke(`composition.verifyActivationProcess(${JSON.stringify(resolved)}, ${JSON.stringify({ pid: 1, createdForActivation: false })})`).ok, false);
  assert.equal(invoke(`composition.verifyInstalledProcess(${JSON.stringify(resolved)}, ${JSON.stringify({ pid: 200, configHash: null, runtimeHashes: {} })})`).ok, false);
});

test('steady-state proof accepts a later PID but rejects stale runtime evidence', { skip: !HAS_UCODE }, () => {
  const installed = invoke(`composition.resolveInstalled(${JSON.stringify(v2Fixture())})`);
  const hash = HASH('q');
  const evidence = {
    snapshotId: installed.snapshotId,
    membershipDigest: installed.membershipDigest,
    queueReady: true,
    pid: 200,
    processStarttime: '2000',
    processGeneration: 'generation-after-restart',
    configHash: hash,
    activeConfigHash: hash,
    runtimeHashes: Object.fromEntries(installed.runtimeAssets.map(entry => [entry.id, entry.contentSha256])),
    luaInitIds: installed.luaInit.map(entry => entry.id),
  };
  const steady = invoke(`composition.verifyInstalledProcess(${JSON.stringify(installed)}, ${JSON.stringify(evidence)})`);
  assert.equal(steady.ok, true, JSON.stringify(steady));
  const stale = { ...evidence, runtimeHashes: { ...evidence.runtimeHashes, 'lua:alpha': HASH('stale') } };
  assert.equal(invoke(`composition.verifyInstalledProcess(${JSON.stringify(installed)}, ${JSON.stringify(stale)})`).ok, false);
});

test('activation proof rejects an old PID generation even when argv and hashes look identical', { skip: !HAS_UCODE }, () => {
  const candidate = invoke(`composition.resolveCandidate(${JSON.stringify(candidateFixture())})`);
  const hash = HASH('q');
  const evidence = {
    snapshotId: candidate.snapshotId,
    membershipDigest: candidate.membershipDigest,
    queueReady: true,
    createdForActivation: true,
    pid: 100,
    processStarttime: '1000',
    processGeneration: 'generation-before-activation',
    configHash: hash,
    activeConfigHash: hash,
    runtimeHashes: Object.fromEntries(candidate.runtimeAssets.map(entry => [entry.id, entry.contentSha256])),
    luaInitIds: candidate.luaInit.map(entry => entry.id),
    previousProcesses: [{ pid: 100, starttime: '1000' }],
  };
  assert.equal(invoke(`composition.verifyActivationProcess(${JSON.stringify(candidate)}, ${JSON.stringify(evidence)})`).ok, false);
});

test('activation and steady-state process proofs are separate lifecycle contracts', () => {
  const source = read(compositionPath);
  assert.match(source, /verifyActivationProcess/);
  assert.match(source, /createdForActivation|activation.*pid|activationEvidence/i);
  assert.match(source, /verifyInstalledProcess/);
  assert.match(source, /steady|restart|reboot|starttime/i);
  assert.match(source, /configHash/);
  assert.match(source, /activeConfigHash/);
  assert.match(source, /previousProcesses/);
  assert.match(source, /membershipDigest/);
  assert.match(source, /runtimeHashes/);
  assert.match(source, /luaInit/);
});

test('legacy v1 is explicitly incomplete and cannot be reconstructed from mutable package classification', () => {
  const authority = read(authorityPath);
  const composition = read(compositionPath);
  assert.match(authority, /v1|legacy/i);
  assert.match(composition, /V1_VERIFIED_MEMBERSHIP/);
  assert.match(composition, /reconciliationRequired/);
  assert.match(composition, /RECONCILIATION_REQUIRED/);
  assert.match(composition, /same.release|same_release|reinstall/i);
  assert.doesNotMatch(composition, /current.*classification.*runtimeOrder|classification.*historical/i);
});

test('runtime CLI keeps candidate and installed materialization distinct and postflight verification-only', () => {
  assert.ok(exists(cliPath), 'runtime-composition-cli.uc must be created');
  assert.ok(exists(cliApiPath), 'runtime-composition-api.uc must be created');
  const source = read(cliPath);
  const api = read(cliApiPath);
  assert.doesNotMatch(source, /export\s+const/);
  assert.match(source, /runtime-composition-api\.uc/);
  assert.match(api, /export const runtime_composition_cli_dispatch/);
  for (const consumer of ['candidate-materialize', 'installed-materialize', 'scanner', 'install-proof', 'postflight'])
    assert.match(api, new RegExp(consumer));
  assert.match(api, /resolveCandidate\(input\.preparedTarget/);
  assert.match(api, /resolveInstalled\(input\)/);
  assert.match(api, /postflight/);
  assert.match(api, /verifyActivationProcess|verifyInstalledProcess/);
  assert.doesNotMatch(api, /lsdir|fallback.*list/i);
});

test('runtime CLI activation output resolves a lifecycle asset on the router UCode runtime', { skip: !HAS_UCODE }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-runtime-cli-materialize-'));
  const assetPath = '/etc/zapret2-manager/assets/lua/alpha.lua';
  const registryPath = path.join(temp, 'asset-registry.json');
  const contentSha256 = HASH('a');
  fs.writeFileSync(registryPath, JSON.stringify({
    schema: 1,
    revision: 1,
    assets: [{
      schema: 1, type: 'lua', id: 'lua:alpha', name: 'alpha.lua', ownership: 'manager',
      contentSha256, byteSize: 20, revision: 1, path: assetPath, references: [],
      provenance: {
        kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: 'c'.repeat(40),
        sourcePath: 'files/lua/alpha.lua', bundleId: 'z2k-curated-lua', version: 'r-80.3',
      },
    }],
    activationReceipts: [],
  }));
  const entry = lifecycle('lua:alpha', 'lua', 'lua-init', 10, 'a', 'files/lua/alpha.lua');
  try {
    const result = invokeCli(`cli.runtime_composition_cli_activation_output(${JSON.stringify({
      snapshotId: HASH('s') + '|rows\nasset|newline', compositionSnapshotId: HASH('p') + '|composition\nrow', membershipDigest: HASH('x'),
      runtimeAssets: [entry], luaInit: [entry], scannerOverlay: [],
    })}, false)`, {
      Z2M_UPDATE_SOURCE_TEST: '1',
      Z2M_ASSET_REGISTRY_STATE: registryPath,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.output, /SNAPSHOT\|[^\n]*%0A/);
    assert.equal(result.output.split('\n').some(line => line.startsWith('asset|')), false);
    assert.match(result.output, /ASSET\|lua:alpha\|lifecycle-managed\|lua\|/);
    assert.match(result.output, /LUA_INIT\|lua:alpha\|lifecycle-managed\|lua\|/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runtime CLI accepts semantic hostlist entries backed by Registry blob assets', { skip: !HAS_UCODE }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-runtime-cli-hostlist-'));
  const assetPath = '/etc/zapret2-manager/assets/blob/list';
  const registryPath = path.join(temp, 'asset-registry.json');
  const contentSha256 = HASH('h');
  fs.writeFileSync(registryPath, JSON.stringify({
    schema: 1,
    revision: 1,
    assets: [{
      schema: 1, type: 'blob', id: 'blob:list', name: 'list.txt', ownership: 'manager',
      contentSha256, byteSize: 20, revision: 1, path: assetPath, references: [],
      provenance: {
        kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: 'c'.repeat(40),
        sourcePath: 'files/lists/list.txt', bundleId: 'z2k-curated-lua', version: 'r-80.3',
      },
    }],
    activationReceipts: [],
  }));
  const entry = {
    id: 'blob:list', owner: 'z2k-core', role: 'dependency', kind: 'hostlist', type: 'lifecycle-managed',
    sourcePath: 'files/lists/list.txt', runtimeTarget: '/runtime-assets/lists/list.txt',
    contentSha256, byteSize: 20, version: 'r-80.3', sourceCommit: 'c'.repeat(40),
    manifestSha256: HASH('m'), classificationSha256: HASH('c'),
  };
  try {
    const result = invokeCli(`cli.runtime_composition_cli_activation_output(${JSON.stringify({
      snapshotId: HASH('s'), compositionSnapshotId: HASH('p'), membershipDigest: HASH('x'),
      runtimeAssets: [entry], luaInit: [], scannerOverlay: [],
    })}, false)`, {
      Z2M_UPDATE_SOURCE_TEST: '1',
      Z2M_ASSET_REGISTRY_STATE: registryPath,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.output, /ASSET\|blob:list\|lifecycle-managed\|hostlist\|/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runtime CLI direct UCode entry point is executable', { skip: !HAS_UCODE }, () => {
  const input = '/tmp/z2m-runtime-cli-test-' + process.pid + '.json';
  fs.writeFileSync(input, '{}', { mode: 0o600 });
  try {
    const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, cliPath, 'installed-materialize', input], {
      cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
      encoding: 'utf8', timeout: 30_000,
    });
    assert.notEqual(result.status, 255, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr || '', /Exports may only appear|Syntax error/);
  } finally { try { fs.unlinkSync(input); } catch (e) {} }
});

test('runtime CLI postflight never resolves a candidate', { skip: !HAS_UCODE }, () => {
  assert.equal(invokeCli(`cli.runtime_composition_cli_dispatch('postflight', {snapshot:{lifecycleState:'candidate'}, evidence:{}})`).ok, false);
});

test('router UCode resolves the runtime process observer before restart uses it', () => {
  const coordinator = read(coordinatorPath);
  const starttime = coordinator.indexOf('function z2k_process_starttime(');
  const helper = coordinator.indexOf('function z2k_runtime_processes(');
  const restart = coordinator.indexOf('function z2k_runtime_restart(');
  assert.ok(starttime >= 0, 'process starttime observer must exist');
  assert.ok(helper >= 0, 'runtime process observer must exist');
  assert.ok(restart >= 0, 'runtime restart helper must exist');
  assert.ok(starttime < helper, 'router UCode does not hoist the process starttime dependency');
  assert.ok(helper < restart, 'router UCode does not hoist this helper; define it before the restart consumer');
});
