import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const GENERATION = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];

function invoke(expression) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function invokeModule(module, expression, env) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function copyPackage(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(PACKAGE_ROOT, root, { recursive: true });
  return root;
}

function resolve(packageRoot, managedRoot) {
  return invoke(`mod.strategy_catalog_resolve({packageRoot:${JSON.stringify(packageRoot)},managedRoot:${JSON.stringify(managedRoot)},persist:false})`);
}

test('manifest-only managed candidate cannot shadow a verified package baseline', () => {
  const managed = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-managed-manifest-'));
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'manifest.json'), path.join(managed, 'manifest.json'));
  const result = resolve(PACKAGE_ROOT, managed);
  const summary = JSON.stringify({ ok: result.ok, kind: result.kind, fallbackUsed: result.fallbackUsed,
    verified: result.verified, verificationError: result.verificationError?.code, error: result.error?.code });
  assert.equal(result.ok, true, summary);
  assert.equal(result.kind, 'package', summary);
  assert.equal(result.fallbackUsed, true, summary);
  assert.equal(result.verified, true, summary);
  assert.equal(result.verificationError.code, 'EPATH', summary);
});

test('fully verified managed candidate is the sole active catalog authority', () => {
  const managed = copyPackage('z2m-managed-valid-');
  const result = resolve(PACKAGE_ROOT, managed);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.root, managed);
  assert.equal(result.kind, 'managed');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.verified, true);
  assert.equal(result.sourceCommit, 'f9dd3ea47a2239514f396a843b475c92c33f0b4c');
});

test('bad managed digest falls back to package and exposes a bounded reason', () => {
  const managed = copyPackage('z2m-managed-bad-');
  const target = path.join(managed, 'advanced/http80_blockcheckw.txt');
  fs.appendFileSync(target, '\n# tamper\n');
  const result = resolve(PACKAGE_ROOT, managed);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, 'package');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.verificationError.code, 'EDIGEST');
  assert.equal(result.verified, true);
});

test('both unverified candidates fail with EVERIFY instead of selecting by manifest presence', () => {
  const managed = copyPackage('z2m-managed-both-bad-');
  fs.appendFileSync(path.join(managed, 'advanced/http80_blockcheckw.txt'), '\n# tamper\n');
  const result = resolve(path.join(os.tmpdir(), 'z2m-missing-package-root'), managed);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
  assert.equal(result.error.managed.code, 'EDIGEST');
});

test('normal Strategy reads preserve the source-specific origin of v3 catalog entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-catalog-source-origin-'));
  const catalog = path.join(root, 'catalog');
  const stateRoot = path.join(root, 'state');
  const strategies = path.join(stateRoot, 'strategies');
  fs.mkdirSync(strategies, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateRoot, 'extensions.json'), JSON.stringify({ schema: 1, extensions: [] }));
  const entry = {
    canonicalId: 'z2k:shared', sourceId: 'z2k', upstreamId: 'shared',
    sourceSnapshotId: 'z2k-s1', sourceCommit: 'a'.repeat(40), name: 'Shared',
    profiles: [{ id: 'profile-1', enabled: true, args: '--filter-tcp=443' }],
    capabilities: { autocircular: false, discordUdp: false, protocols: ['tcp'] },
    is_builtin: false,
    requirements: { engine: 'nfqws2' },
    entryKind: 'standalone', usable: true, semanticDigest: 'e'.repeat(64),
    nativeValidation: { status: 'verified' },
    provenance: { repository: 'necronicle/z2k', sourceId: 'z2k', sourceCommit: 'a'.repeat(40),
      compilerSnapshotDigest: 'f'.repeat(64), officialProfileIndex: 0 },
  };
  const allInOneEntry = {
    canonicalId: 'z2k:z2k_all_in_one', sourceId: 'z2k', upstreamId: 'z2k_all_in_one',
    sourceSnapshotId: 'z2k-s1', sourceCommit: 'a'.repeat(40), name: 'z2k всё-в-одном',
    entryKind: 'all-in-one', usable: true,
    is_builtin: false,
    profiles: [{ id: 'all-in-one-1', enabled: true, args: '--filter-tcp=443' }],
    capabilities: { autocircular: true, discordUdp: true, protocols: ['tcp', 'udp'] },
    requirements: { engine: 'nfqws2' },
    provenance: { repository: 'necronicle/z2k', sourceId: 'z2k', sourceCommit: 'a'.repeat(40) },
  };
  const snapshot = {
    schema: 'z2m.strategy-source-snapshot.v1', sourceId: 'z2k', repository: 'necronicle/z2k',
    sourceCommit: 'a'.repeat(40), contentDigest: 'b'.repeat(64), snapshotId: 'z2k-s1',
    sourceFiles: ['strats_new2.txt', 'quic_strats.ini'],
    compilerSnapshotDigest: 'f'.repeat(64),
    allInOne: { canonicalId: 'z2k:z2k_all_in_one', digest: 'c'.repeat(64), profileCount: 1 },
    entryCount: 2, normalizedEntryCount: 2, immutable: true, published: true,
    entries: [entry, allInOneEntry],
  };
  const env = {
    Z2M_STRATEGY_CATALOG_GENERATION_ROOT: catalog,
    Z2M_STRATEGY_ROOT: stateRoot,
    Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(stateRoot, 'strategy-state.json'),
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(stateRoot, 'extensions.json'),
  };
  try {
    const published = invokeModule(GENERATION, `mod.strategy_catalog_generation_publish(${JSON.stringify({
      generatedAt: 1788202000,
      sources: { z2k: { enabled: true, currentSnapshotId: 'z2k-s1', snapshot } },
      userRevision: 1, userEntries: [],
    })})`, env);
    assert.equal(published.ok, true, JSON.stringify(published));
    const listed = invokeModule(CLI, `mod.strategy_cli_dispatch('list', {})`, env);
    const strategy = listed.strategies.find(item => item.id === 'z2k:shared');
    assert.equal(strategy.origin, 'z2k_builtin');
    assert.equal(strategy.is_builtin, false);
    assert.equal(strategy.sourceId, 'z2k');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normal Strategy reads stay on the active generation when legacy Avatar roots change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-catalog-authority-'));
  const catalog = path.join(root, 'catalog');
  const stateRoot = path.join(root, 'state');
  const strategies = path.join(stateRoot, 'strategies');
  const packageRoot = path.join(root, 'legacy-avatar');
  const managedRoot = path.join(root, 'legacy-managed');
  fs.mkdirSync(strategies, { recursive: true, mode: 0o700 });
  fs.cpSync(PACKAGE_ROOT, packageRoot, { recursive: true });
  fs.writeFileSync(path.join(stateRoot, 'extensions.json'), JSON.stringify({ schema: 1, extensions: [] }));
  const legacyUserPath = path.join(strategies, 'legacy-user.json');
  fs.writeFileSync(legacyUserPath, JSON.stringify({
    schema: 1, id: 'legacy-user', revision: 1, name: 'Legacy user', origin: 'user', is_builtin: false,
    metadata: {}, profiles: [{ id: 'profile-1', enabled: true, args: '--filter-tcp=443' }], updatedAt: 1,
  }));
  fs.chmodSync(legacyUserPath, 0o600);
  const commit = 'a'.repeat(40);
  const makeEntry = (sourceId, snapshotId, id) => ({
    canonicalId: `${sourceId}:${id}`, sourceId, upstreamId: id,
    sourceSnapshotId: snapshotId, sourceCommit: commit, name: id,
    profiles: [{ id: 'profile-1', enabled: true, args: '--filter-tcp=443' }],
    capabilities: { autocircular: false, discordUdp: false, protocols: ['tcp'] },
    ...(sourceId === 'z2k' ? { is_builtin: false } : {}),
    requirements: { engine: 'nfqws2' },
    ...(sourceId === 'z2k' ? {
      entryKind: 'standalone', usable: true, semanticDigest: 'e'.repeat(64),
      nativeValidation: { status: 'verified' },
    } : {}),
    provenance: { repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k', sourceId, sourceCommit: commit,
      ...(sourceId === 'z2k' ? { compilerSnapshotDigest: 'f'.repeat(64), officialProfileIndex: 0 } : {}) },
  });
  const makeSnapshot = (sourceId, snapshotId, entry) => {
    const snapshot = {
      schema: 'z2m.strategy-source-snapshot.v1', sourceId,
      repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k',
      sourceCommit: commit, contentDigest: sourceId === 'avatar' ? 'b'.repeat(64) : 'c'.repeat(64),
      snapshotId, entryCount: 1, normalizedEntryCount: 1, immutable: true, published: true, entries: [entry],
    };
    if (sourceId === 'z2k') {
      snapshot.sourceFiles = ['strats_new2.txt', 'quic_strats.ini'];
      snapshot.compilerSnapshotDigest = 'f'.repeat(64);
      snapshot.allInOne = { canonicalId: 'z2k:z2k_all_in_one', digest: 'd'.repeat(64), profileCount: 1 };
      snapshot.entryCount = 2;
      snapshot.normalizedEntryCount = 2;
      snapshot.entries.push({
        canonicalId: 'z2k:z2k_all_in_one', sourceId: 'z2k', upstreamId: 'z2k_all_in_one',
        sourceSnapshotId: snapshotId, sourceCommit: commit, name: 'z2k всё-в-одном',
        entryKind: 'all-in-one', usable: true, pinned: true,
        is_builtin: false,
        profiles: [{ id: 'all-in-one-1', enabled: true, args: '--filter-tcp=443' }],
        capabilities: { autocircular: true, discordUdp: true, protocols: ['tcp', 'udp'] },
        requirements: { engine: 'nfqws2' },
        provenance: { repository: 'necronicle/z2k', sourceId: 'z2k', sourceCommit: commit },
      });
    }
    return snapshot;
  };
  const avatar = makeEntry('avatar', 'avatar-s1', 'legacy-independent');
  const z2k = makeEntry('z2k', 'z2k-s1', 'canonical-independent');
  const env = {
    Z2M_STRATEGY_CATALOG_GENERATION_ROOT: catalog,
    Z2M_STRATEGY_CATALOG_PACKAGE_ROOT: packageRoot,
    Z2M_STRATEGY_CATALOG_MANAGED_ROOT: managedRoot,
    Z2M_STRATEGY_CATALOG_INDEX_PATH: path.join(catalog, 'strategy-catalog-index.json'),
    Z2M_STRATEGY_CATALOG_ACTIVE_POINTER: path.join(catalog, 'active.json'),
    Z2M_STRATEGY_ROOT: stateRoot,
    Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(stateRoot, 'strategy-state.json'),
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(stateRoot, 'extensions.json'),
  };
  try {
    const published = invokeModule(GENERATION, `mod.strategy_catalog_generation_publish(${JSON.stringify({
      generatedAt: 1788202100,
      sources: {
        avatar: { enabled: true, currentSnapshotId: 'avatar-s1', snapshot: makeSnapshot('avatar', 'avatar-s1', avatar) },
        z2k: { enabled: true, currentSnapshotId: 'z2k-s1', snapshot: makeSnapshot('z2k', 'z2k-s1', z2k) },
      }, userRevision: 1, userEntries: [{
        canonicalId: 'legacy-user', sourceId: 'user', upstreamId: 'legacy-user', revision: 1,
        name: 'Legacy user', profiles: [{ id: 'profile-1', enabled: true, args: '--filter-tcp=443' }],
      }],
    })})`, env);
    assert.equal(published.ok, true, JSON.stringify(published));
    const before = invokeModule(CLI, `mod.strategy_cli_dispatch('list', {})`, env);
    assert.equal(before.ok, true, JSON.stringify(before));
    const beforeIds = before.strategies.map(item => item.id);
    assert.deepEqual(beforeIds, ['avatar:legacy-independent', 'legacy-user', 'z2k:canonical-independent', 'z2k:z2k_all_in_one']);
    const allInOne = before.strategies.find(item => item.id === 'z2k:z2k_all_in_one');
    assert.equal(allInOne.is_builtin, false);
    assert.equal(allInOne.pinned, true);
    const legacyWire = before.strategies.find(item => item.id === 'legacy-user');
    assert.equal(legacyWire.sourceId, 'user');
    assert.equal(legacyWire.origin, 'user');
    assert.equal(legacyWire.is_builtin, false);
    const detail = invokeModule(CLI, `mod.strategy_cli_dispatch('get', { id: 'legacy-user' })`, env);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.strategy.origin, 'user');
    assert.equal(detail.strategy.sourceId, 'user');

    fs.appendFileSync(path.join(packageRoot, 'advanced/http80_blockcheckw.txt'), '\n# legacy root changed after generation publication\n');
    fs.writeFileSync(path.join(packageRoot, 'manifest.json'), '{"corrupt":true}');
    fs.mkdirSync(managedRoot, { recursive: true });
    fs.writeFileSync(path.join(managedRoot, 'manifest.json'), '{"corrupt":true}');

    const after = invokeModule(CLI, `mod.strategy_cli_dispatch('list', {})`, env);
    assert.equal(after.ok, true, JSON.stringify(after));
    assert.deepEqual(after.strategies.map(item => item.id), beforeIds);
    assert.deepEqual(after.strategies.map(item => item.sourceId), ['avatar', 'user', 'z2k', 'z2k']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
