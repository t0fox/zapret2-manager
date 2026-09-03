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
  const relative = 'advanced/http80_blockcheckw.txt';
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
      Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS,
      Z2M_Z2K_REFRESH_NATIVE_VALIDATE: '0',
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

test('Avatar refresh acquires the complete exact upstream revision instead of reusing the package baseline', () => {
  const root = sandbox('avatar-exact');
  const first = invoke(root, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  const nextCommit = '1111111111111111111111111111111111111111';
  const fixture = avatarFixture(nextCommit);
  const refreshed = invoke(root, 'strategy_source_refresh', ['avatar'], {
    Z2M_FIXTURE_MODE: 'avatar-v2', Z2M_AVATAR_FIXTURE_ROOT: fixture,
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  assert.equal(refreshed.snapshot.sourceCommit, nextCommit);
  assert.notEqual(refreshed.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('Avatar mismatched content fails closed and retains the prior LKG', () => {
  const root = sandbox('avatar-mismatch-lkg');
  const first = invoke(root, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  const nextCommit = '2222222222222222222222222222222222222222';
  const fixture = avatarFixture(nextCommit, true);
  const failed = invoke(root, 'strategy_source_refresh', ['avatar'], {
    Z2M_FIXTURE_MODE: 'avatar-corrupt', Z2M_AVATAR_FIXTURE_ROOT: fixture,
  });
  const current = invoke(root, 'strategy_source_current_snapshot', ['avatar']);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(current.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('Avatar network failure retains the prior LKG', () => {
  const root = sandbox('avatar-network-lkg');
  const first = invoke(root, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  const failed = invoke(root, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'avatar-error' });
  const current = invoke(root, 'strategy_source_current_snapshot', ['avatar']);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(current.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('Avatar source reads stay network-free after a verified snapshot exists', () => {
  const root = sandbox('avatar-read-no-network');
  const first = invoke(root, 'strategy_source_refresh', ['avatar'], { Z2M_FIXTURE_MODE: 'ok' });
  const current = invoke(root, 'strategy_source_current_snapshot', ['avatar'], { Z2M_FIXTURE_MODE: 'error' });
  const listed = invoke(root, 'strategy_source_get', ['avatar'], { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(current.snapshot.snapshotId, first.snapshot.snapshotId);
  assert.equal(listed.source.currentSnapshotId, first.snapshot.snapshotId);
});

test('Z2K refresh binds exact revision and raw content to a verified immutable snapshot', () => {
  const root = sandbox('z2k');
  const result = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.metadata.sourceCommit, 'a'.repeat(40));
  assert.equal(result.snapshot.sourceCommit, 'a'.repeat(40));
  assert.equal(result.snapshot.sourcePath, 'official:generate_nfqws2_opt_from_strategies');
  assert.match(result.snapshot.contentDigest, /^[0-9a-f]{64}$/);
  assert.equal(result.snapshot.sourceFiles.length, 5);
  assert.equal(Object.keys(result.snapshot.fileSha256).length, 5);
  assert.equal(result.snapshot.allInOne.profileCount, 7);
  assert.equal(result.snapshot.entries.length, 8);
  assert.equal(result.snapshot.entries.filter((entry) => entry.entryKind === 'all-in-one').length, 1);
  assert.equal(result.snapshot.entries.filter((entry) => entry.entryKind === 'standalone').length, 7);
  assert.ok(result.snapshot.entries.every((entry) => entry.sourceSnapshotId === result.snapshot.snapshotId));
  assert.ok(result.snapshot.entries.filter((entry) => entry.entryKind === 'standalone')
    .every((entry) => entry.usable === true && entry.nativeValidation.status === 'not_checked'));
  assert.match(result.snapshot.compilerSnapshotDigest, /^[0-9a-f]{64}$/);
  assert.match(result.snapshot.nfqws2OptSha256, /^[0-9a-f]{64}$/);
});

test('Z2K refresh fetches every compiler file from one exact revision', () => {
  const root = sandbox('z2k-two-files');
  const log = path.join(root, 'transport.log');
  const result = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'two-files', Z2M_FIXTURE_TRANSPORT_LOG: log });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.snapshot.sourceCommit, 'd'.repeat(40));
  assert.deepEqual(result.snapshot.sourceFiles, ['strats_new2.txt', 'quic_strats.ini', 'lib/utils.sh', 'lib/strategies.sh', 'lib/config_official.sh']);
  const rawUrls = fs.readFileSync(log, 'utf8').trim().split('\n').filter((url) => url.includes('raw.githubusercontent.com/necronicle/z2k/'));
  assert.deepEqual(rawUrls, result.snapshot.sourceFiles.map((relative) => `https://raw.githubusercontent.com/necronicle/z2k/${'d'.repeat(40)}/${relative}`));
});

test('Z2K verification and snapshot installation failures preserve the prior LKG', () => {
  const verifyRoot = sandbox('z2k-verify-fail');
  const verifyFailed = invoke(verifyRoot, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'z2k-invalid' });
  assert.equal(verifyFailed.ok, false, JSON.stringify(verifyFailed));
  assert.equal(verifyFailed.error.code, 'ECOMPILE');
  assert.equal(verifyFailed.error.phase, 'compile');

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

test('Z2K incomplete compiler snapshot fails closed and preserves the prior LKG', () => {
  const root = sandbox('z2k-incomplete');
  const first = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'ok' });
  const failed = invoke(root, 'strategy_source_refresh', ['z2k'], { Z2M_FIXTURE_MODE: 'z2k-incomplete' });
  const current = invoke(root, 'strategy_source_current_snapshot', ['z2k']);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'ENETWORK');
  assert.equal(current.snapshot.snapshotId, first.snapshot.snapshotId);
});

test('Z2K native preflight failure rejects the candidate before source activation', () => {
  const root = sandbox('z2k-native-fail');
  const failed = invoke(root, 'strategy_source_refresh', ['z2k'], {
    Z2M_FIXTURE_MODE: 'ok', Z2M_Z2K_REFRESH_NATIVE_VALIDATE: '1',
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'EPREFLIGHT');
  const current = invoke(root, 'strategy_source_current_snapshot', ['z2k']);
  assert.equal(current.snapshot, null);
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
