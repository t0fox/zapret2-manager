import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-avatar.uc');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

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

test('Avatar adapter declares the canonical source identity', () => {
  assert.deepEqual(invoke('strategy_source_avatar_info'), {
    sourceId: 'avatar',
    canonicalPrefix: 'avatar:',
    repository: 'avatarDD/zapret-gui',
  });
});

test('Avatar adapter exposes the verified catalog as an immutable source snapshot', () => {
  const result = invoke('strategy_source_avatar_snapshot', [{ root: CATALOG_ROOT }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.snapshot.schema, 'z2m.strategy-source-snapshot.v1');
  assert.equal(result.snapshot.sourceId, 'avatar');
  assert.equal(result.snapshot.repository, 'avatarDD/zapret-gui');
  assert.match(result.snapshot.sourceCommit, /^[0-9a-f]{7,40}$/);
  assert.match(result.snapshot.contentDigest, /^[0-9a-f]{64}$/);
  assert.equal(result.snapshot.entryCount, 1836);
  assert.equal(result.snapshot.immutable, true);
});

test('Avatar entries are namespaced without changing upstream identity or winner semantics', () => {
  const result = invoke('strategy_source_avatar_list', [{ root: CATALOG_ROOT }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.entries.length > 0);
  const entry = result.entries.find((candidate) => candidate.upstreamId === 'z2k_all_in_one');
  assert.ok(entry, 'the verified Avatar winner must remain visible');
  assert.equal(entry.canonicalId, 'avatar:z2k_all_in_one');
  assert.equal(entry.sourceId, 'avatar');
  assert.equal(entry.upstreamId, 'z2k_all_in_one');
  assert.equal(entry.winner, true);
  assert.equal(entry.provenance.repository, 'avatarDD/zapret-gui');
});

test('Avatar adapter rejects foreign provenance instead of inventing Avatar ownership', () => {
  const result = invoke('strategy_source_avatar_normalize', [{
    id: 'z2k:shared',
    sourceId: 'z2k',
    upstreamId: 'shared',
    provenance: { repository: 'necronicle/z2k' },
  }]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EPROVENANCE');
});
