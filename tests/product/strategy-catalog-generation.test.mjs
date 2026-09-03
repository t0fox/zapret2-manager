import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
const CATALOG_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const rootFor = (label) => `/tmp/z2m-strategy-generation-${process.pid}-${label}-${Date.now()}`;

function invoke(functionName, args = [], root, extraEnv = {}) {
  return invokeModule(MODULE, functionName, args, root, extraEnv);
}

function invokeModule(module, functionName, args = [], root, extraEnv = {}) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_STRATEGY_CATALOG_GENERATION_ROOT: root,
      ...extraEnv,
    },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function entry(sourceId, upstreamId, snapshotId) {
  return {
    canonicalId: `${sourceId}:${upstreamId}`, sourceId, upstreamId,
    sourceSnapshotId: snapshotId, sourceCommit: 'a'.repeat(40),
    name: `${sourceId} ${upstreamId}`, profiles: [{ id: 'profile-1', enabled: true, args: '--filter-tcp=443' }],
    capabilities: { autocircular: false, discordUdp: false, protocols: ['tcp'] },
    requirements: { engine: 'nfqws2' },
    ...(sourceId === 'z2k' ? {
      entryKind: 'standalone', usable: true, semanticDigest: 'e'.repeat(64),
      nativeValidation: { status: 'verified' },
    } : {}),
    provenance: {
      repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k', sourceId,
      ...(sourceId === 'z2k' ? { compilerSnapshotDigest: 'f'.repeat(64), officialProfileIndex: 0 } : {}),
    },
  };
}

function allInOneEntry(snapshotId) {
  return {
    ...entry('z2k', 'z2k_all_in_one', snapshotId),
    canonicalId: 'z2k:z2k_all_in_one',
    name: 'z2k всё-в-одном',
    entryKind: 'all-in-one', poolKey: 'all-in-one', pinned: true, usable: true,
    profiles: [{ id: 'all-in-one-1', enabled: true, args: '--filter-tcp=443' }],
  };
}

function source(sourceId, snapshotId, enabled = true, published = true, upstreamId = 'shared') {
  const entries = [entry(sourceId, upstreamId, snapshotId)];
  if (sourceId === 'z2k') entries.push(allInOneEntry(snapshotId));
  const snapshot = {
    schema: 'z2m.strategy-source-snapshot.v1', sourceId,
    repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k',
    sourceCommit: 'a'.repeat(40), contentDigest: sourceId === 'avatar' ? 'b'.repeat(64) : 'c'.repeat(64),
    snapshotId, entryCount: entries.length, normalizedEntryCount: entries.length, immutable: true,
    published, entries,
  };
  if (sourceId === 'z2k') {
    snapshot.sourceFiles = ['strats_new2.txt', 'quic_strats.ini'];
    snapshot.compilerSnapshotDigest = 'f'.repeat(64);
    snapshot.allInOne = { canonicalId: 'z2k:z2k_all_in_one', digest: 'd'.repeat(64), profileCount: 1 };
  }
  return { enabled, currentSnapshotId: snapshotId, snapshot };
}

test('Avatar and Z2K are merged into one v3 index without collapsing shared upstream IDs', () => {
  const root = rootFor('merge');
  const result = invoke('strategy_catalog_generation_build', [{
    generatedAt: 1788200000,
    sources: { avatar: source('avatar', 'avatar-s1'), z2k: source('z2k', 'z2k-s1') }, userRevision: 7,
  }], root);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.candidate.index.schema, 'z2m.strategy-read-index.v3');
  assert.equal(result.candidate.index.sources.avatar.snapshotId, 'avatar-s1');
  assert.equal(result.candidate.index.sources.z2k.snapshotId, 'z2k-s1');
  assert.deepEqual(result.candidate.index.entries.map(item => item.canonicalId).sort(), ['avatar:shared', 'z2k:shared', 'z2k:z2k_all_in_one']);
  assert.equal(result.candidate.index.userRevision, 7);
  assert.match(result.candidate.index.indexDigest, /^[0-9a-f]{64}$/);
});

test('disabled and unpublished source snapshots never enter the candidate index', () => {
  const root = rootFor('gates');
  const result = invoke('strategy_catalog_generation_build', [{
    generatedAt: 1788200001,
    sources: {
      avatar: source('avatar', 'avatar-disabled', false),
      z2k: source('z2k', 'z2k-unpublished', true, false),
    }, userRevision: 1,
  }], root);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.candidate.index.sources, {});
  assert.deepEqual(result.candidate.index.entries, []);
});

test('published generation survives a fresh process read and publication failure', () => {
  const root = rootFor('lkg');
  const firstInput = { generatedAt: 1788200002, sources: { avatar: source('avatar', 'avatar-good') }, userRevision: 1 };
  const first = invoke('strategy_catalog_generation_publish', [firstInput], root);
  assert.equal(first.ok, true, JSON.stringify(first));
  const initial = invoke('strategy_catalog_generation_read', [], root);
  assert.equal(initial.ok, true, JSON.stringify(initial));
  assert.equal(initial.index.generationId, first.generationId);
  const failed = invoke('strategy_catalog_generation_publish', [{
    generatedAt: 1788200003, sources: { z2k: source('z2k', 'z2k-new') }, userRevision: 2,
  }], root, { Z2M_STRATEGY_GENERATION_FAIL_PHASE: 'pointer' });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'EWRITE');
  const after = invoke('strategy_catalog_generation_read', [], root);
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.index.generationId, initial.index.generationId);
});

test('generation, index, and final pointer publication failures leave the old authority readable', () => {
  for (const phase of ['generation', 'index', 'pointer']) {
    const root = rootFor(`fail-${phase}`);
    const first = invoke('strategy_catalog_generation_publish', [{
      generatedAt: 1788200010, sources: { avatar: source('avatar', 'avatar-old') }, userRevision: 1,
    }], root);
    assert.equal(first.ok, true, JSON.stringify(first));
    const failed = invoke('strategy_catalog_generation_publish', [{
      generatedAt: 1788200011, sources: { z2k: source('z2k', 'z2k-new') }, userRevision: 2,
    }], root, { Z2M_STRATEGY_GENERATION_FAIL_PHASE: phase });
    assert.equal(failed.ok, false, `${phase}: ${JSON.stringify(failed)}`);
    const afterRestart = invoke('strategy_catalog_generation_read', [], root);
    assert.equal(afterRestart.ok, true, `${phase}: ${JSON.stringify(afterRestart)}`);
    assert.equal(afterRestart.index.generationId, first.generationId);
  }
});

test('legacy index repair becomes a no-op after v3 generation publication', () => {
  const root = rootFor('legacy-noop');
  const first = invoke('strategy_catalog_generation_publish', [{
    generatedAt: 1788200012, sources: { avatar: source('avatar', 'avatar-active') }, userRevision: 1,
  }], root);
  assert.equal(first.ok, true, JSON.stringify(first));
  const repair = invokeModule(CATALOG_MODULE, 'strategy_catalog_write_read_index', [], root, {
    Z2M_STRATEGY_CATALOG_PACKAGE_ROOT: path.join(ROOT, 'missing-legacy-package'),
    Z2M_STRATEGY_CATALOG_MANAGED_ROOT: path.join(ROOT, 'missing-legacy-managed'),
  });
  assert.equal(repair.ok, true, JSON.stringify(repair));
  assert.equal(repair.written, true);
  assert.equal(repair.generationId, first.generationId);
  const after = invoke('strategy_catalog_generation_read', [], root);
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.index.generationId, first.generationId);
});

test('generation build failure leaves the previous active generation untouched', () => {
  const root = rootFor('build-failure');
  const first = invoke('strategy_catalog_generation_publish', [{
    generatedAt: 1788200004, sources: { avatar: source('avatar', 'avatar-good') }, userRevision: 1,
  }], root);
  assert.equal(first.ok, true, JSON.stringify(first));
  const failed = invoke('strategy_catalog_generation_publish', [{
    generatedAt: 1788200005, sources: { avatar: { enabled: true, currentSnapshotId: 'avatar-bad', snapshot: { published: true } } }, userRevision: 2,
  }], root);
  assert.equal(failed.ok, false, JSON.stringify(failed));
  const current = invoke('strategy_catalog_generation_read', [], root);
  assert.equal(current.ok, true, JSON.stringify(current));
  assert.equal(current.index.generationId, first.generationId);
});

test('pointer and index digest mismatch fails closed', () => {
  const root = rootFor('mismatch');
  const first = invoke('strategy_catalog_generation_publish', [{
    generatedAt: 1788200006, sources: { z2k: source('z2k', 'z2k-good') }, userRevision: 1,
  }], root);
  assert.equal(first.ok, true, JSON.stringify(first));
  const indexPath = path.join(root, 'strategy-catalog-index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.generationId = 'generation-tampered';
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const result = invoke('strategy_catalog_generation_read', [], root);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ESTALE');
});
