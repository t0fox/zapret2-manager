import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const rootFor = (label) => `/tmp/z2m-strategy-sources-${process.pid}-${label}-${Date.now()}`;

function invoke(functionName, args = [], root) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_STRATEGY_SOURCES_ROOT: root,
    },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

const snapshot = (sourceId = 'avatar', id = `${sourceId}-snapshot-1`) => {
  const result = {
    schema: 'z2m.strategy-source-snapshot.v1', sourceId,
    repository: sourceId === 'avatar' ? 'avatarDD/zapret-gui' : 'necronicle/z2k',
    sourceCommit: 'a'.repeat(40), contentDigest: 'b'.repeat(64),
    snapshotId: id, entryCount: sourceId === 'z2k' ? 1 : 0,
    normalizedEntryCount: sourceId === 'z2k' ? 1 : 0, immutable: true,
  };
  if (sourceId === 'z2k') {
    result.sourceFiles = ['strats_new2.txt', 'quic_strats.ini'];
    result.allInOne = { canonicalId: 'z2k:z2k_all_in_one', digest: 'c'.repeat(64), profileCount: 1 };
    result.entries = [{
      canonicalId: 'z2k:z2k_all_in_one', sourceId: 'z2k', upstreamId: 'z2k_all_in_one',
      sourceSnapshotId: id, sourceCommit: 'a'.repeat(40), entryKind: 'all-in-one', usable: true,
      profiles: [{ id: 'all-in-one-1', enabled: true, args: '--filter-tcp=443' }],
    }];
  }
  return result;
};

test('both strategy sources are enabled by default and receive durable state', () => {
  const root = rootFor('defaults');
  const result = invoke('strategy_sources_get', [], root);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.config.schema, 'z2m.strategy-sources.v1');
  assert.equal(result.config.revision, 1);
  assert.deepEqual(result.config.sources, { avatar: { enabled: true }, z2k: { enabled: true } });
  assert.equal(invoke('strategy_source_get', ['avatar'], root).source.enabled, true);
  assert.equal(invoke('strategy_source_get', ['z2k'], root).source.enabled, true);
});

test('unknown sources are rejected and enable mutation uses revision CAS', () => {
  const root = rootFor('cas');
  const unknown = invoke('strategy_source_get', ['telegram'], root);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'EINPUT');
  const changed = invoke('strategy_source_set_enabled', ['avatar', false, 1], root);
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(changed.config.revision, 2);
  const stale = invoke('strategy_source_set_enabled', ['avatar', true, 1], root);
  assert.equal(stale.ok, false, JSON.stringify(stale));
  assert.equal(stale.error.code, 'ESTALE');
  assert.equal(invoke('strategy_source_get', ['avatar'], root).source.enabled, false);
});

test('disable preserves the exact last-known-good snapshot', () => {
  const root = rootFor('lkg');
  const prepared = { verified: true, snapshot: snapshot('avatar', 'avatar-good-1') };
  const installed = invoke('strategy_source_install_verified_snapshot', ['avatar', prepared], root);
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(installed.source.currentSnapshotId, 'avatar-good-1');
  const disabled = invoke('strategy_source_set_enabled', ['avatar', false, 1], root);
  assert.equal(disabled.ok, true, JSON.stringify(disabled));
  const current = invoke('strategy_source_current_snapshot', ['avatar'], root);
  assert.equal(current.ok, true, JSON.stringify(current));
  assert.equal(current.snapshot.snapshotId, 'avatar-good-1');
  assert.equal(invoke('strategy_source_get', ['avatar'], root).source.lastKnownGoodSnapshotId, 'avatar-good-1');
});

test('invalid candidate never replaces the current LKG', () => {
  const root = rootFor('candidate');
  invoke('strategy_source_install_verified_snapshot', ['z2k', { verified: true, snapshot: snapshot('z2k', 'z2k-good-1') }], root);
  const failed = invoke('strategy_source_install_verified_snapshot', ['z2k', {
    verified: false, snapshot: { ...snapshot('z2k', 'z2k-bad-1'), contentDigest: 'not-a-digest' },
  }], root);
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'EVERIFY');
  const current = invoke('strategy_source_current_snapshot', ['z2k'], root);
  assert.equal(current.snapshot.snapshotId, 'z2k-good-1');
});

test('snapshot authority is the recorded ID, never an arbitrary directory scan', () => {
  const source = fs.readFileSync(MODULE, 'utf8');
  assert.doesNotMatch(source, /readdir|glob\(|find\s+\//);
  const root = rootFor('authority');
  invoke('strategy_source_install_verified_snapshot', ['avatar', { verified: true, snapshot: snapshot() }], root);
  const current = invoke('strategy_source_current_snapshot', ['avatar'], root);
  assert.equal(current.snapshot.snapshotId, 'avatar-snapshot-1');
});
