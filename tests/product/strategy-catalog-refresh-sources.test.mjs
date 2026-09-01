import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc');
const GENERATION_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
const SOURCES_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');

function sandbox(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `z2m-catalog-refresh-${label}-`));
}

function environment(root, mode = 'ok', extraEnv = {}) {
  return {
    ...process.env,
    LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
    Z2M_STRATEGY_CATALOG_REFRESH_STATE_PATH: path.join(root, 'refresh-state.json'),
    Z2M_STRATEGY_SOURCES_ROOT: path.join(root, 'sources'),
    Z2M_STRATEGY_CATALOG_GENERATION_ROOT: path.join(root, 'catalog'),
    Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(root, 'metadata-cache'),
    Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(root, 'metadata-state'),
    Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(root, 'metadata-locks'),
    Z2M_UPDATE_SOURCE_TRANSPORT: TRANSPORT,
    Z2M_STRATEGY_SOURCE_CONTENT_TRANSPORT: TRANSPORT,
    Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar'),
    Z2M_UPDATE_SOURCE_TEST: '1',
    Z2M_FIXTURE_MODE: mode,
    ...extraEnv,
  };
}

function invoke(root, module, functionName, args = [], mode = 'ok', extraEnv = {}) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: environment(root, mode, extraEnv),
    encoding: 'utf8', timeout: 45_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function seed(root) {
  fs.writeFileSync(path.join(root, 'refresh-state.json'), JSON.stringify({
    operationId: 'test-refresh', state: 'running', phase: 'queued', percent: 5,
    startedAt: 1788200000, heartbeatAt: 1788200000, finishedAt: null,
    result: null, error: null,
  }));
}

test('catalog refresh fetches, verifies, merges, and activates every enabled source', () => {
  const root = sandbox('all');
  seed(root);
  const result = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(result.state, 'completed', JSON.stringify(result));
  assert.equal(result.result.sourceSnapshots.avatar.mode, 'fresh');
  assert.equal(result.result.sourceSnapshots.z2k.mode, 'fresh');
  assert.match(result.result.generationId, /^generation-/);
  assert.deepEqual(result.phaseHistory, [
    'queued', 'avatar-fetch', 'avatar-verify', 'z2k-fetch', 'z2k-verify',
    'merge', 'indexing', 'activating', 'done',
  ]);
  const status = invoke(root, MODULE, 'catalog_refresh_status', [], 'error');
  assert.equal(status.phase, 'done');
  assert.equal(status.percent, 100);
});

test('one source failure uses its current LKG and still publishes the successful source result', () => {
  const root = sandbox('lkg');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const initialGeneration = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(initialGeneration.ok, true, JSON.stringify(initialGeneration));

  seed(root);
  const second = invoke(root, MODULE, 'catalog_refresh_worker_run', [], 'z2k-error');
  assert.equal(second.state, 'completed', JSON.stringify(second));
  assert.equal(second.result.sourceSnapshots.avatar.mode, 'fresh');
  assert.equal(second.result.sourceSnapshots.z2k.mode, 'lkg');
  assert.equal(second.result.sourceSnapshots.z2k.error.code, 'ENETWORK');
  const after = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.match(after.index.sources.z2k.snapshotId, /^z2k-/);
});

test('both source failures preserve the previously active generation', () => {
  const root = sandbox('preserve');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const initial = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(initial.ok, true, JSON.stringify(initial));

  seed(root);
  const second = invoke(root, MODULE, 'catalog_refresh_worker_run', [], 'error');
  assert.equal(second.state, 'completed', JSON.stringify(second));
  assert.equal(second.result.preserved, true, JSON.stringify(second));
  assert.equal(second.result.generationId, initial.index.generationId);
  const after = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(after.index.generationId, initial.index.generationId);
});

test('source failure without an LKG is a bounded refresh error and publishes no generation', () => {
  const root = sandbox('no-lkg');
  seed(root);
  const result = invoke(root, MODULE, 'catalog_refresh_worker_run', [], 'error');
  assert.equal(result.state, 'error', JSON.stringify(result));
  assert.equal(result.error.code, 'ENETWORK');
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(generation.ok, false, JSON.stringify(generation));
  assert.equal(generation.error.code, 'ESTALE');
});

test('source enablement rebuilds the unified catalog from exact LKG snapshots without fetching', () => {
  const root = sandbox('toggle');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const disabled = invoke(root, SOURCES_MODULE, 'strategy_source_set_enabled', ['z2k', false, 1]);
  assert.equal(disabled.ok, true, JSON.stringify(disabled));
  const rebuilt = invoke(root, MODULE, 'catalog_refresh_rebuild');
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt));
  const afterDisable = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(afterDisable.index.sources.z2k, undefined);
  assert.ok(afterDisable.index.sources.avatar);
  const enabled = invoke(root, SOURCES_MODULE, 'strategy_source_set_enabled', ['z2k', true, 2]);
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const reenabled = invoke(root, MODULE, 'catalog_refresh_rebuild');
  assert.equal(reenabled.ok, true, JSON.stringify(reenabled));
  const afterEnable = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.ok(afterEnable.index.sources.z2k);
});

test('generation publication failure rolls fresh source activation back with the old generation', () => {
  const root = sandbox('transaction-rollback');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const before = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['z2k']);
  assert.equal(before.source.currentSnapshotId, first.result.sourceSnapshots.z2k.snapshotId);

  seed(root);
  const failed = invoke(root, MODULE, 'catalog_refresh_worker_run', [], 'v2', {
    Z2M_STRATEGY_GENERATION_FAIL_PHASE: 'pointer',
  });
  assert.equal(failed.state, 'error', JSON.stringify(failed));
  const after = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['z2k']);
  assert.equal(after.source.currentSnapshotId, before.source.currentSnapshotId);
  assert.equal(after.source.lastKnownGoodSnapshotId, before.source.lastKnownGoodSnapshotId);
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(generation.ok, true, JSON.stringify(generation));
  assert.equal(generation.index.generationId, first.result.generationId);
});

test('source enablement transaction restores config when generation publication fails', () => {
  const root = sandbox('toggle-transaction');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const failed = invoke(root, MODULE, 'catalog_source_set_enabled', ['z2k', false, 1], 'ok', {
    Z2M_STRATEGY_GENERATION_FAIL_PHASE: 'pointer',
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  const configAfterFailure = invoke(root, SOURCES_MODULE, 'strategy_sources_get');
  assert.equal(configAfterFailure.config.sources.z2k.enabled, true);
  const generationAfterFailure = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.ok(generationAfterFailure.index.sources.z2k);

  const disabled = invoke(root, MODULE, 'catalog_source_set_enabled', ['z2k', false, 1]);
  assert.equal(disabled.ok, true, JSON.stringify(disabled));
  const generationAfterDisable = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(generationAfterDisable.index.sources.z2k, undefined);
});

test('stale refresh journal rolls source activation back after a process crash', () => {
  const root = sandbox('crash-recovery');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const before = invoke(root, SOURCES_MODULE, 'strategy_sources_get');
  const refreshed = invoke(root, path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc'), 'strategy_source_refresh', ['z2k'], 'v2');
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  const ahead = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['z2k']);
  assert.notEqual(ahead.source.currentSnapshotId, before.sources.z2k.currentSnapshotId);
  fs.writeFileSync(path.join(root, 'refresh-state.json'), JSON.stringify({
    operationId: 'crashed-refresh', state: 'running', phase: 'z2k-fetch', percent: 35,
    startedAt: 1, heartbeatAt: 1, finishedAt: null, result: null, error: null,
    transaction: { kind: 'catalog-refresh', phase: 'staged',
      previousActivations: {
        avatar: { currentSnapshotId: before.sources.avatar.currentSnapshotId, lastKnownGoodSnapshotId: before.sources.avatar.lastKnownGoodSnapshotId },
        z2k: { currentSnapshotId: before.sources.z2k.currentSnapshotId, lastKnownGoodSnapshotId: before.sources.z2k.lastKnownGoodSnapshotId }
      }, desiredSources: {} }
  }));
  const recovered = invoke(root, MODULE, 'catalog_refresh_status', [], 'error');
  assert.equal(recovered.state, 'error', JSON.stringify(recovered));
  assert.equal(recovered.error.code, 'ERECOVERED', JSON.stringify(recovered));
  const after = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['z2k']);
  assert.equal(after.source.currentSnapshotId, before.sources.z2k.currentSnapshotId);
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(generation.index.generationId, first.result.generationId);
});

test('stale journal commits when the generation pointer already contains the staged source set', () => {
  const root = sandbox('crash-commit');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const before = invoke(root, SOURCES_MODULE, 'strategy_sources_get');
  const refreshed = invoke(root, path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc'), 'strategy_source_refresh', ['z2k'], 'v2');
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  const current = invoke(root, SOURCES_MODULE, 'strategy_sources_get');
  const rebuilt = invoke(root, MODULE, 'catalog_refresh_rebuild');
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt));
  fs.writeFileSync(path.join(root, 'refresh-state.json'), JSON.stringify({
    operationId: 'crashed-after-publish', state: 'running', phase: 'activating', percent: 90,
    startedAt: 1, heartbeatAt: 1, finishedAt: null, result: null, error: null,
    transaction: { kind: 'catalog-refresh', phase: 'publishing',
      previousActivations: {
        avatar: { currentSnapshotId: before.sources.avatar.currentSnapshotId, lastKnownGoodSnapshotId: before.sources.avatar.lastKnownGoodSnapshotId },
        z2k: { currentSnapshotId: before.sources.z2k.currentSnapshotId, lastKnownGoodSnapshotId: before.sources.z2k.lastKnownGoodSnapshotId }
      }, desiredSources: {
        avatar: { enabled: true, snapshotId: current.sources.avatar.currentSnapshotId },
        z2k: { enabled: true, snapshotId: current.sources.z2k.currentSnapshotId }
      } }
  }));
  const recovered = invoke(root, MODULE, 'catalog_refresh_status', [], 'error');
  assert.equal(recovered.state, 'completed', JSON.stringify(recovered));
  assert.equal(recovered.result.recovered, 'committed', JSON.stringify(recovered));
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(generation.index.generationId, rebuilt.generationId);
  const after = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['z2k']);
  assert.equal(after.source.currentSnapshotId, current.sources.z2k.currentSnapshotId);
});
