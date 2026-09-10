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
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const SOURCE_STORE_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const HARNESS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');
const AVATAR_PACKAGE_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');

function sandbox(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `z2m-source-refresh-${label}-`));
}

function avatarFixture(commit, corrupt = false) {
  const root = sandbox(`avatar-fixture-${commit.slice(0, 6)}`);
  fs.cpSync(AVATAR_PACKAGE_ROOT, root, { recursive: true });
  const relative = 'advanced/http80_zapret2_advanced.txt';
  const file = path.join(root, relative);
  fs.appendFileSync(file, `\n# exact upstream fixture ${commit}\n`);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.source.commit = commit;
  if (!corrupt) {
    const content = fs.readFileSync(file);
    const item = manifest.files.find(candidate => candidate.path === relative);
    item.byteSize = content.length;
    item.sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const aggregate = manifest.files.slice().sort((left, right) => left.path.localeCompare(right.path))
      .map(candidate => `${candidate.sha256}  catalogs/${candidate.path}\n`).join('');
    manifest.aggregateDigest = crypto.createHash('sha256').update(aggregate).digest('hex');
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return root;
}

function invoke(root, functionName, args = [], extraEnv = {}, module = MODULE) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  return invokeCode(root, source, extraEnv);
}

function invokeCode(root, source, extraEnv = {}) {
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_STRATEGY_SOURCES_ROOT: root,
      Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(root, 'metadata-cache'),
      Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(root, 'metadata-state'),
      Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(root, 'metadata-locks'),
      Z2M_UPDATE_SOURCE_TRANSPORT: TRANSPORT,
      Z2M_STRATEGY_SOURCE_CONTENT_TRANSPORT: TRANSPORT,
      Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS,
      Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: AVATAR_PACKAGE_ROOT,
      Z2M_UPDATE_SOURCE_TEST: '1',
      ...extraEnv,
    },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function prepareAndInstallAvatar(root, extraEnv = {}) {
  return invokeCode(root, `
    import * as refresh from ${JSON.stringify(MODULE)};
    import * as store from ${JSON.stringify(SOURCE_STORE_MODULE)};
    let prepared = refresh.strategy_source_refresh_prepare('avatar');
    let installed = prepared.ok
      ? store.strategy_source_install_verified_snapshot('avatar', { verified: true, snapshot: prepared.snapshot })
      : null;
    print(sprintf('%J', { prepared, installed }));
  `, extraEnv);
}

test('Avatar refresh prepares an immutable snapshot from accepted metadata', () => {
  const root = sandbox('avatar');
  const result = invoke(root, 'strategy_source_refresh_prepare', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.metadata.sourceCommit, 'f9dd3ea47a2239514f396a843b475c92c33f0b4c');
  assert.match(result.snapshot.snapshotId, /^avatar-/);
  assert.equal(result.snapshot.sourceId, 'avatar');
  assert.equal(result.snapshot.immutable, true);
});

test('Avatar fetch and verification failures fail closed before a source snapshot exists', () => {
  const fetchRoot = sandbox('avatar-fetch-fail');
  const fetchFailed = invoke(fetchRoot, 'strategy_source_refresh_prepare', ['avatar'], { Z2M_FIXTURE_MODE: 'avatar-error' });
  assert.equal(fetchFailed.ok, false, JSON.stringify(fetchFailed));
  assert.equal(fetchFailed.error.code, 'ENETWORK');
  assert.equal(invoke(fetchRoot, 'strategy_source_current_snapshot', ['avatar'], {}, SOURCE_STORE_MODULE).snapshot, null);

  const verifyRoot = sandbox('avatar-verify-fail');
  const corrupted = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-avatar-refresh-corrupt-'));
  fs.cpSync(AVATAR_PACKAGE_ROOT, corrupted, { recursive: true });
  fs.appendFileSync(path.join(corrupted, 'advanced/http80_zapret2_advanced.txt'), '\n# invalid refresh evidence\n');
  const verifyFailed = invoke(verifyRoot, 'strategy_source_refresh_prepare', ['avatar'], {
    Z2M_FIXTURE_MODE: 'ok', Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: corrupted,
  });
  assert.equal(verifyFailed.ok, false, JSON.stringify(verifyFailed));
  assert.equal(verifyFailed.error.code, 'EDIGEST');
  assert.equal(invoke(verifyRoot, 'strategy_source_current_snapshot', ['avatar'], {}, SOURCE_STORE_MODULE).snapshot, null);
});

test('Avatar refresh uses the exact accepted upstream revision', () => {
  const root = sandbox('avatar-exact');
  const first = invoke(root, 'strategy_source_refresh_prepare', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  const nextCommit = '1111111111111111111111111111111111111111';
  const fixture = avatarFixture(nextCommit);
  const refreshed = invoke(root, 'strategy_source_refresh_prepare', ['avatar'], {
    Z2M_FIXTURE_MODE: 'avatar-v2', Z2M_AVATAR_FIXTURE_ROOT: fixture,
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  assert.equal(refreshed.snapshot.sourceCommit, nextCommit);
  assert.notEqual(refreshed.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('Avatar content verification failure preserves the prior LKG', () => {
  const root = sandbox('avatar-mismatch-lkg');
  const first = prepareAndInstallAvatar(root, { Z2M_FIXTURE_MODE: 'ok' });
  const nextCommit = '2222222222222222222222222222222222222222';
  const fixture = avatarFixture(nextCommit, true);
  const failed = invoke(root, 'strategy_source_refresh_prepare', ['avatar'], {
    Z2M_FIXTURE_MODE: 'avatar-corrupt', Z2M_AVATAR_FIXTURE_ROOT: fixture,
  });
  const current = invoke(root, 'strategy_source_current_snapshot', ['avatar'], {}, SOURCE_STORE_MODULE);
  assert.equal(first.prepared.ok, true, JSON.stringify(first));
  assert.equal(first.installed.ok, true, JSON.stringify(first));
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'EDIGEST');
  assert.equal(current.snapshot.snapshotId, first.prepared.snapshot.snapshotId);
});

test('Avatar network failure preserves the prior LKG and reads remain network-free', () => {
  const root = sandbox('avatar-network-lkg');
  const first = prepareAndInstallAvatar(root, { Z2M_FIXTURE_MODE: 'ok' });
  const failed = invoke(root, 'strategy_source_refresh_prepare', ['avatar'], { Z2M_FIXTURE_MODE: 'avatar-error' });
  const current = invoke(root, 'strategy_source_current_snapshot', ['avatar'], { Z2M_FIXTURE_MODE: 'error' }, SOURCE_STORE_MODULE);
  const listed = invoke(root, 'strategy_source_get', ['avatar'], { Z2M_FIXTURE_MODE: 'error' }, SOURCE_STORE_MODULE);
  assert.equal(first.prepared.ok, true, JSON.stringify(first));
  assert.equal(first.installed.ok, true, JSON.stringify(first));
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'ENETWORK');
  assert.equal(current.snapshot.snapshotId, first.prepared.snapshot.snapshotId);
  assert.equal(listed.source.currentSnapshotId, first.prepared.snapshot.snapshotId);
});
