import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');

function sandbox(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `z2m-source-refresh-${label}-`));
}

function invoke(root, functionName, args = [], extraEnv = {}) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
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
      Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar'),
      Z2M_UPDATE_SOURCE_TEST: '1',
      ...extraEnv,
    },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

test('Avatar refresh validates accepted metadata and preserves the complete local snapshot model', () => {
  const root = sandbox('avatar');
  const result = invoke(root, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.metadata.sourceCommit, 'f9dd3ea47a2239514f396a843b475c92c33f0b4c');
  assert.match(result.snapshot.snapshotId, /^avatar-/);
  assert.equal(result.snapshot.sourceId, 'avatar');
  assert.equal(result.snapshot.immutable, true);
});

test('Avatar fetch and verification failures fail closed before a source snapshot exists', () => {
  const fetchRoot = sandbox('avatar-fetch-fail');
  const fetchFailed = invoke(fetchRoot, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'avatar-error' });
  assert.equal(fetchFailed.ok, false, JSON.stringify(fetchFailed));
  assert.equal(fetchFailed.error.code, 'ENETWORK');
  assert.equal(invoke(fetchRoot, 'strategy_source_current_snapshot', ['avatar']).snapshot, null);

  const verifyRoot = sandbox('avatar-verify-fail');
  const corrupted = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-avatar-refresh-corrupt-'));
  fs.cpSync(path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar'), corrupted, { recursive: true });
  fs.appendFileSync(path.join(corrupted, 'advanced/http80_blockcheckw.txt'), '\n# invalid refresh evidence\n');
  const verifyFailed = invoke(verifyRoot, 'strategy_source_refresh', ['avatar'], {
    Z2M_FIXTURE_MODE: 'ok', Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: corrupted,
  });
  assert.equal(verifyFailed.ok, false, JSON.stringify(verifyFailed));
  assert.equal(verifyFailed.error.code, 'EDIGEST');
  assert.equal(invoke(verifyRoot, 'strategy_source_current_snapshot', ['avatar']).snapshot, null);
});

test('Z2K refresh binds exact revision and raw content to a verified immutable snapshot', () => {
  const root = sandbox('z2k');
  const result = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.metadata.sourceCommit, 'a'.repeat(40));
  assert.equal(result.snapshot.sourceCommit, 'a'.repeat(40));
  assert.equal(result.snapshot.sourcePath, 'strats_new2.txt');
  assert.match(result.snapshot.contentDigest, /^[0-9a-f]{64}$/);
  assert.ok(result.snapshot.entries.length >= 3);
});

test('Z2K verification and snapshot installation failures preserve the prior LKG', () => {
  const verifyRoot = sandbox('z2k-verify-fail');
  const verifyFailed = invoke(verifyRoot, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'z2k-invalid' });
  assert.equal(verifyFailed.ok, false, JSON.stringify(verifyFailed));
  assert.equal(verifyFailed.error.code, 'EVERIFY');

  const installRoot = sandbox('z2k-install-fail');
  const first = invoke(installRoot, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, true, JSON.stringify(first));
  const failed = invoke(installRoot, 'strategy_source_refresh', ['z2k'], {
    Z2M_FIXTURE_MODE: 'v2', Z2M_STRATEGY_SOURCE_TEST: '1', Z2M_STRATEGY_SOURCE_INSTALL_FAIL: 'z2k',
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'EWRITE');
  const current = invoke(installRoot, 'strategy_source_current_snapshot', ['z2k']);
  assert.equal(current.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('refresh failure keeps the previous LKG and source reads remain network-free', () => {
  const root = sandbox('lkg');
  const first = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, true, JSON.stringify(first));
  const before = invoke(root, 'strategy_source_current_snapshot', ['z2k'], { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(before.ok, true, JSON.stringify(before));
  const failed = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  const after = invoke(root, 'strategy_source_current_snapshot', ['z2k'], { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(after.snapshot.snapshotId, before.snapshot.snapshotId);
  const listed = invoke(root, 'strategy_source_get', ['z2k'], { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal(listed.source.currentSnapshotId, before.snapshot.snapshotId);
});

test('source revision/content mismatch rejects before activation', () => {
  const root = sandbox('mismatch');
  const failed = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'mismatch' });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'ESTALE');
  const current = invoke(root, 'strategy_source_current_snapshot', ['z2k']);
  assert.equal(current.ok, true, JSON.stringify(current));
  assert.equal(current.snapshot, null);
});

test('identical refresh is idempotent and a new exact revision changes snapshot identity', () => {
  const root = sandbox('identity');
  const first = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  const same = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(same.ok, true, JSON.stringify(same));
  assert.equal(same.snapshot.snapshotId, first.snapshot.snapshotId);
  const changed = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'v2' });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.notEqual(changed.snapshot.snapshotId, first.snapshot.snapshotId);
  assert.equal(changed.snapshot.sourceCommit, 'b'.repeat(40));
});
