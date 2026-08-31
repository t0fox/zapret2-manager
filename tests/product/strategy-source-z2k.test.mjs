import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc');
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/strategy-source-z2k');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const readFixture = (name) => fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8');

function invoke(functionName, args = [], extraEnv = {}) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...extraEnv },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

test('Z2K adapter declares the canonical source identity', () => {
  assert.deepEqual(invoke('strategy_source_z2k_info'), {
    sourceId: 'z2k',
    canonicalPrefix: 'z2k:',
    repository: 'necronicle/z2k',
  });
});

test('real strats_new2 records retain upstream IDs and become namespaced entries', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('strats_new2.txt'), { sourceCommit: 'a'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.entries.length >= 3);
  const rkn = result.entries.find((entry) => entry.upstreamId === 'manual_autocircular_rkn');
  assert.ok(rkn);
  assert.equal(rkn.canonicalId, 'z2k:manual_autocircular_rkn');
  assert.equal(rkn.sourceId, 'z2k');
  assert.equal(rkn.autocircular, true);
  assert.equal(rkn.provenance.repository, 'necronicle/z2k');
  assert.equal(rkn.provenance.sourcePath, 'strats_new2.txt');
});

test('Z2K parser derives Discord semantics from profile args and retains multi-profile entries', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('multi-profile.txt'), { sourceCommit: 'b'.repeat(40) }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  const allInOne = result.entries.find((entry) => entry.upstreamId === 'z2k_all_in_one');
  assert.ok(allInOne);
  assert.equal(allInOne.canonicalId, 'z2k:z2k_all_in_one');
  assert.equal(allInOne.profiles.length, 3);
  assert.deepEqual(allInOne.capabilities, {
    autocircular: true,
    discordUdp: true,
    protocols: ['tcp', 'udp'],
  });
  assert.equal(allInOne.provenance.repository, 'necronicle/z2k');
  assert.notEqual(allInOne.provenance.repository, 'avatarDD/zapret-gui');
});

test('malformed Z2K input is not usable and does not produce partial entries', () => {
  const result = invoke('strategy_source_z2k_parse', [readFixture('malformed.txt'), { sourceCommit: 'c'.repeat(40) }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
});

test('Z2K snapshot identity binds revision, exact content digest, order, and entry count', () => {
  const input = { content: readFixture('strats_new2.txt'), sourceCommit: 'd'.repeat(40), sourcePath: 'strats_new2.txt' };
  const first = invoke('strategy_source_z2k_prepare_snapshot', [input]);
  const second = invoke('strategy_source_z2k_prepare_snapshot', [input]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(second.snapshot, first.snapshot);
  assert.equal(first.snapshot.schema, 'z2m.strategy-source-snapshot.v1');
  assert.equal(first.snapshot.sourceId, 'z2k');
  assert.equal(first.snapshot.repository, 'necronicle/z2k');
  assert.equal(first.snapshot.sourceCommit, 'd'.repeat(40));
  assert.match(first.snapshot.contentDigest, /^[0-9a-f]{64}$/);
  assert.match(first.snapshot.snapshotId, /^z2k-[0-9a-f]{64}$/);
  assert.equal(first.snapshot.normalizedEntryCount, first.snapshot.entries.length);
  assert.equal(first.snapshot.immutable, true);
});

test('Z2K adapter rejects Avatar provenance and preserves canonical source separation', () => {
  const result = invoke('strategy_source_z2k_normalize', [{
    id: 'avatar:shared',
    sourceId: 'avatar',
    upstreamId: 'shared',
    provenance: { repository: 'avatarDD/zapret-gui' },
  }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EPROVENANCE');
});
