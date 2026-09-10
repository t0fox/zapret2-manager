import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc');
const GENERATION_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
const SOURCES_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const SOURCE_REFRESH_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');
const HARNESS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh');
const AVATAR_PACKAGE_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');

function sandbox(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `z2m-catalog-refresh-${label}-`));
}

function avatarFixture(commit) {
  const root = sandbox(`avatar-fixture-${commit.slice(0, 6)}`);
  fs.cpSync(AVATAR_PACKAGE_ROOT, root, { recursive: true });
  const relative = 'advanced/http80_zapret2_advanced.txt';
  const file = path.join(root, relative);
  fs.appendFileSync(file, `\n# exact refresh fixture ${commit}\n`);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.source.commit = commit;
  const content = fs.readFileSync(file);
  const item = manifest.files.find(candidate => candidate.path === relative);
  item.byteSize = content.length;
  item.sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const aggregate = manifest.files.slice().sort((left, right) => left.path.localeCompare(right.path))
    .map(candidate => `${candidate.sha256}  catalogs/${candidate.path}\n`).join('');
  manifest.aggregateDigest = crypto.createHash('sha256').update(aggregate).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return root;
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
    Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS,
    Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar'),
    Z2M_UPDATE_SOURCE_TEST: '1',
    Z2M_FIXTURE_MODE: mode,
    ...extraEnv,
  };
}

function invokeCode(root, source, mode = 'ok', extraEnv = {}) {
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

function invoke(root, module, functionName, args = [], mode = 'ok', extraEnv = {}) {
  return invokeCode(root,
    `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`,
    mode, extraEnv);
}

function seed(root) {
  fs.writeFileSync(path.join(root, 'refresh-state.json'), JSON.stringify({
    operationId: 'test-refresh', state: 'running', phase: 'queued', percent: 5,
    startedAt: 1788200000, heartbeatAt: 1788200000, finishedAt: null,
    result: null, error: null,
  }));
}

test('catalog refresh activates the current Avatar source and leaves Z2K Core ownership intact', () => {
  const root = sandbox('avatar');
  seed(root);
  const result = invoke(root, MODULE, 'catalog_refresh_worker_run');
  assert.equal(result.state, 'completed', JSON.stringify(result));
  assert.equal(result.result.sourceSnapshots.avatar.mode, 'fresh');
  assert.equal(result.result.sourceSnapshots.z2k, undefined);
  assert.match(result.result.generationId, /^generation-/);
  assert.deepEqual(result.phaseHistory, [
    'queued', 'avatar-fetch', 'avatar-verify', 'merge', 'indexing', 'activating', 'done',
  ]);
  const catalog = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(catalog.ok, true, JSON.stringify(catalog));
  assert.ok(catalog.index.sources.avatar);
  assert.equal(catalog.index.sources.z2k, undefined);
  const status = invoke(root, MODULE, 'catalog_refresh_status', [], 'error');
  assert.equal(status.phase, 'done');
  assert.equal(status.percent, 100);
});

test('Avatar refresh failure uses its current LKG and preserves the active generation', () => {
  const root = sandbox('lkg');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  const initial = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(initial.ok, true, JSON.stringify(initial));

  seed(root);
  const second = invoke(root, MODULE, 'catalog_refresh_worker_run', [], 'error');
  assert.equal(second.state, 'completed', JSON.stringify(second));
  assert.equal(second.result.preserved, true, JSON.stringify(second));
  assert.equal(second.result.sourceSnapshots.avatar.mode, 'lkg');
  assert.equal(second.result.sourceSnapshots.avatar.error.code, 'ENETWORK');
  assert.equal(second.result.generationId, first.result.generationId);
  const after = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(after.index.generationId, initial.index.generationId);
});

test('Avatar failure without an LKG is a bounded refresh error and publishes no generation', () => {
  const root = sandbox('no-lkg');
  seed(root);
  const result = invoke(root, MODULE, 'catalog_refresh_worker_run', [], 'error');
  assert.equal(result.state, 'error', JSON.stringify(result));
  assert.equal(result.error.code, 'ENETWORK');
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(generation.ok, false, JSON.stringify(generation));
  assert.equal(generation.error.code, 'ESTALE');
});

test('single-source Avatar preparation failure returns a bounded error state', () => {
  const root = sandbox('single-source-fetch-failure');
  seed(root);
  invoke(root, MODULE, 'catalog_refresh_worker_run');
  const disableZ2K = invoke(root, MODULE, 'catalog_source_set_enabled', ['z2k', false, 1]);
  assert.equal(disableZ2K.ok, true, JSON.stringify(disableZ2K));
  const failed = invoke(root, MODULE, 'catalog_refresh_source', ['avatar'], 'error');
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'ENETWORK');
  assert.equal(failed.state.state, 'error');
  assert.equal(failed.state.error.code, 'ENETWORK');
});

test('source enablement rebuilds the unified catalog from exact Avatar LKG without fetching', () => {
  const root = sandbox('toggle');
  seed(root);
  const first = invoke(root, MODULE, 'catalog_refresh_worker_run');
  const disableZ2K = invoke(root, MODULE, 'catalog_source_set_enabled', ['z2k', false, 1]);
  assert.equal(disableZ2K.ok, true, JSON.stringify(disableZ2K));

  const disabledAvatar = invoke(root, MODULE, 'catalog_source_set_enabled', ['avatar', false, 2]);
  assert.equal(disabledAvatar.ok, true, JSON.stringify(disabledAvatar));
  const withoutAvatar = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(withoutAvatar.index.sources.avatar, undefined);

  const enabledAvatar = invoke(root, MODULE, 'catalog_source_set_enabled', ['avatar', true, 3]);
  assert.equal(enabledAvatar.ok, true, JSON.stringify(enabledAvatar));
  const afterEnable = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(afterEnable.index.sources.avatar.snapshotId, first.result.sourceSnapshots.avatar.snapshotId);
});

test('generation publication failure keeps the active Avatar generation unchanged', () => {
  const root = sandbox('rebuild-rollback');
  seed(root);
  invoke(root, MODULE, 'catalog_refresh_worker_run');
  const before = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  const failed = invoke(root, MODULE, 'catalog_refresh_rebuild', [], 'ok', {
    Z2M_STRATEGY_CATALOG_ACTIVE_POINTER: path.join(root, 'missing', 'active.json'),
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  const after = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(after.index.generationId, before.index.generationId);
});

test('single-source Avatar refresh rolls back activation when generation publication fails', () => {
  const root = sandbox('single-source-rollback');
  seed(root);
  invoke(root, MODULE, 'catalog_refresh_worker_run');
  const disableZ2K = invoke(root, MODULE, 'catalog_source_set_enabled', ['z2k', false, 1]);
  assert.equal(disableZ2K.ok, true, JSON.stringify(disableZ2K));
  const before = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['avatar']);
  const beforeGeneration = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');

  const failed = invoke(root, MODULE, 'catalog_refresh_source', ['avatar'], 'ok', {
    Z2M_STRATEGY_CATALOG_ACTIVE_POINTER: path.join(root, 'missing', 'active.json'),
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  const after = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['avatar']);
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(after.source.currentSnapshotId, before.source.currentSnapshotId);
  assert.equal(after.source.lastKnownGoodSnapshotId, before.source.lastKnownGoodSnapshotId);
  assert.equal(generation.index.generationId, beforeGeneration.index.generationId);
});

test('stale Avatar activation journal rolls back after a process crash', () => {
  const root = sandbox('crash-recovery');
  seed(root);
  invoke(root, MODULE, 'catalog_refresh_worker_run');
  const before = invoke(root, SOURCES_MODULE, 'strategy_sources_get');
  const beforeGeneration = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  const fixture = avatarFixture('1'.repeat(40));
  const activated = invokeCode(root, `import * as refresh from ${JSON.stringify(SOURCE_REFRESH_MODULE)}; import * as store from ${JSON.stringify(SOURCES_MODULE)}; let prepared = refresh.strategy_source_refresh_prepare('avatar'); print(sprintf('%J', store.strategy_source_install_verified_snapshot('avatar', { verified: true, snapshot: prepared.snapshot })));`, 'avatar-v2', {
    Z2M_AVATAR_FIXTURE_ROOT: fixture,
  });
  assert.equal(activated.ok, true, JSON.stringify(activated));
  const ahead = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['avatar']);
  assert.notEqual(ahead.source.currentSnapshotId, before.sources.avatar.currentSnapshotId);

  fs.writeFileSync(path.join(root, 'refresh-state.json'), JSON.stringify({
    operationId: 'crashed-refresh', state: 'running', phase: 'activating', percent: 90,
    startedAt: 1, heartbeatAt: 1, finishedAt: null, result: null, error: null,
    transaction: { kind: 'catalog-refresh', phase: 'staged',
      previousActivations: {
        avatar: { currentSnapshotId: before.sources.avatar.currentSnapshotId,
          lastKnownGoodSnapshotId: before.sources.avatar.lastKnownGoodSnapshotId },
        z2k: { currentSnapshotId: before.sources.z2k.currentSnapshotId,
          lastKnownGoodSnapshotId: before.sources.z2k.lastKnownGoodSnapshotId },
      }, desiredSources: {} },
  }));
  const recovered = invoke(root, MODULE, 'catalog_refresh_status', [], 'error');
  assert.equal(recovered.state, 'error', JSON.stringify(recovered));
  assert.equal(recovered.error.code, 'ERECOVERED', JSON.stringify(recovered));
  const after = invoke(root, SOURCES_MODULE, 'strategy_source_get', ['avatar']);
  const generation = invoke(root, GENERATION_MODULE, 'strategy_catalog_generation_read');
  assert.equal(after.source.currentSnapshotId, before.sources.avatar.currentSnapshotId);
  assert.equal(generation.index.generationId, beforeGeneration.index.generationId);
});
