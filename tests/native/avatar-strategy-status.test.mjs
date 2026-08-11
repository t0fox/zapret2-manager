import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const STATUS = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-status.uc');
const COLLECTOR = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc');
const CATALOG_ROOT = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const UCODE_LIBRARY_ARGS = process.env.UCODE_MODULE_PATH ? ['-L', process.env.UCODE_MODULE_PATH] : [];

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const CONFIG_HASH = 'c'.repeat(64);
const CATALOG_DIGEST = 'd'.repeat(64);

function run(source, env = {}) {
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function derive(selectedState, current, runtime, volatile = {}, env = {}) {
  return run(`import { derive_strategy_status } from '${STATUS}'; print(sprintf('%J', derive_strategy_status(${JSON.stringify(selectedState)}, ${JSON.stringify(current)}, ${JSON.stringify(runtime)}, ${JSON.stringify(volatile)})));`, env);
}

function treeSnapshot(root) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(current, entry.name);
      const relative = path.relative(root, file);
      if (entry.isDirectory()) visit(file);
      else entries.push([relative, fs.readFileSync(file).toString('hex')]);
    }
  }
  visit(root);
  return entries;
}

function temporaryStrategyStorage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-status-round1-'));
  const strategies = path.join(root, 'strategies');
  const runtime = path.join(root, 'runtime');
  const fakeBin = path.join(root, 'fake-bin');
  const mktempLog = path.join(root, 'mktemp.log');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.mkdirSync(fakeBin, { mode: 0o700 });
  fs.writeFileSync(path.join(fakeBin, 'mktemp'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$Z2M_STATUS_MKTEMP_LOG"\nexec /usr/bin/mktemp "$@"\n',
    { mode: 0o700 });
  const env = {
    Z2M_STRATEGY_ROOT: root,
    Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(runtime, 'strategy-reconciliation.json'),
    Z2M_STRATEGY_APPLY_UNCERTAIN: path.join(runtime, 'strategy-apply-uncertain.json'),
    Z2M_STRATEGY_APPLY_LASTGOOD: path.join(runtime, 'last-good'),
    Z2M_STRATEGY_APPLY_BLOCK: path.join(runtime, 'strategy-apply-block.json'),
    Z2M_STRATEGY_APPLY_LEASE: path.join(runtime, 'strategy-apply-lease.json'),
    Z2M_STRATEGY_LOCK: path.join(runtime, 'strategy-state.lock'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
    Z2M_STRATEGY_HASH_TAG: 'task11round1',
    Z2M_STATUS_MKTEMP_LOG: mktempLog,
    PATH: `${fakeBin}:${process.env.PATH}`,
  };
  fs.writeFileSync(env.Z2M_STRATEGY_STATE, JSON.stringify({
    schema: 1, revision: 1, favorites: [], selected: {
      id: 'fake_simple', origin: 'avatar_builtin', revision: 0, candidateSha256: HASH,
    },
  }));
  fs.chmodSync(env.Z2M_STRATEGY_STATE, 0o600);
  return { root, strategies, runtime, env };
}

function collectStatus(observations, env) {
  return run(`import { collect_strategy_status } from '${STATUS}'; print(sprintf('%J', collect_strategy_status(${JSON.stringify(observations)})));`, env);
}

function collectActual(env) {
  return run(`import { collect } from '${COLLECTOR}'; print(sprintf('%J', collect()));`, env);
}

function projection(result) {
  const value = { ...result };
  delete value.writes;
  delete value.persistedState;
  return value;
}

function selectedState() {
  return {
    revision: 4,
    selected: { id: 'user-one', origin: 'user', revision: 3, candidateSha256: HASH },
    identity: { name: 'User one' },
    digest: CATALOG_DIGEST,
  };
}

const healthyRuntime = { present: true, rulesPresent: true, count: 1 };

test('matching active Strategy has no derived drift and exposes identity provenance', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, appliedConfigSha256: CONFIG_HASH, candidateSha256: HASH }, healthyRuntime);

  assert.deepEqual(projection(result), {
    id: 'user-one', name: 'User one', origin: 'user', revision: 3,
    digest: CATALOG_DIGEST, candidateSha256: HASH,
    match: true, drift: false, availability: 'available', uncertain: false,
  });
});

test('drift is derived from the current config and candidate evidence and is never saved', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, appliedConfigSha256: CONFIG_HASH, candidateSha256: OTHER_HASH }, healthyRuntime,
    { reconciliation: { id: 'user-one', hash: OTHER_HASH, reason: 'drift' } });

  assert.equal(result.match, false);
  assert.equal(result.drift, true);
  assert.equal(result.availability, 'drifted');
  assert.equal(result.uncertain, false);
  assert.equal(result.writes.length, 0);
  assert.doesNotMatch(result.persistedState, /drift|runtime|queue|dependency/);
});

test('config-only change derives drift from the authoritative applied config hash', () => {
  const result = derive(selectedState(), {
    configSha256: OTHER_HASH, appliedConfigSha256: CONFIG_HASH, candidateSha256: HASH,
  }, healthyRuntime);

  assert.equal(result.match, false);
  assert.equal(result.drift, true);
  assert.equal(result.availability, 'drifted');
});

test('runtime absence makes a selected Strategy unavailable without claiming a match', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, appliedConfigSha256: CONFIG_HASH, candidateSha256: HASH },
    { present: false, rulesPresent: false, count: 0 });

  assert.equal(result.match, null);
  assert.equal(result.drift, null);
  assert.equal(result.availability, 'unavailable');
  assert.equal(result.uncertain, false);
});

test('volatile Apply uncertainty makes reconciliation uncertain without changing durable identity', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, appliedConfigSha256: CONFIG_HASH, candidateSha256: HASH }, healthyRuntime,
    { uncertain: { oldConfigSha256: OTHER_HASH, newConfigSha256: CONFIG_HASH } });

  assert.equal(result.match, null);
  assert.equal(result.drift, null);
  assert.equal(result.availability, 'uncertain');
  assert.equal(result.uncertain, true);
  assert.equal(result.writes.length, 0);
});

test('absent persisted identity is represented without inventing runtime or durable fields', () => {
  const result = derive({ revision: 0, selected: null },
    { configSha256: CONFIG_HASH, candidateSha256: HASH }, healthyRuntime);

  assert.deepEqual(projection(result), {
    id: null, name: null, origin: null, revision: null,
    digest: null, candidateSha256: null,
    match: null, drift: false, availability: 'absent', uncertain: false,
  });
  assert.equal(result.writes.length, 0);
});

test('derive is filesystem-pure even when Strategy storage paths are configured', () => {
  const storage = temporaryStrategyStorage();
  const before = treeSnapshot(storage.root);
  const result = derive(selectedState(), {
    configSha256: CONFIG_HASH, appliedConfigSha256: CONFIG_HASH, candidateSha256: HASH,
  }, healthyRuntime, {}, storage.env);

  assert.equal(result.writes.length, 0);
  assert.deepEqual(treeSnapshot(storage.root), before);
  assert.equal(fs.existsSync(storage.env.Z2M_STATUS_MKTEMP_LOG)
    ? fs.readFileSync(storage.env.Z2M_STATUS_MKTEMP_LOG, 'utf8') : '', '');
  fs.rmSync(storage.root, { recursive: true, force: true });
});

test('collect_strategy_status reads selection and volatile evidence without changing Strategy storage or emitting hash temp events', async () => {
  const storage = temporaryStrategyStorage();
  const observations = {
    drift: { currentSha256: { config: CONFIG_HASH }, appliedSha256: { config: CONFIG_HASH } },
    strategy: { candidateSha256: HASH },
    runtime: { present: true, rulesPresent: true, count: 1 },
  };
  const stateBefore = fs.readFileSync(storage.env.Z2M_STRATEGY_STATE);
  const rootBefore = treeSnapshot(storage.root);
  const events = [];
  const watcher = fs.watch('/tmp', (eventType, name) => {
    if (String(name).includes('z2m-strategy-hash.task11round1')) events.push({ eventType, name: String(name) });
  });
  let result;
  try {
    result = collectStatus(observations, storage.env);
  } finally {
    watcher.close();
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(result.id, 'fake_simple');
  assert.equal(result.match, true);
  assert.equal(result.drift, false);
  assert.equal(result.uncertain, false);
  assert.deepEqual(fs.readFileSync(storage.env.Z2M_STRATEGY_STATE), stateBefore);
  assert.deepEqual(treeSnapshot(storage.root), rootBefore);
  assert.equal(fs.existsSync(storage.env.Z2M_STATUS_MKTEMP_LOG)
    ? fs.readFileSync(storage.env.Z2M_STATUS_MKTEMP_LOG, 'utf8') : '', '');
  assert.deepEqual(events, []);
  fs.rmSync(storage.root, { recursive: true, force: true });
});

test('actual status collector publishes strategyStatus while preserving schema-3 fields and runtimeSummary', () => {
  const storage = temporaryStrategyStorage();
  let result;
  try {
    result = collectActual(storage.env);
  } finally {
    fs.rmSync(storage.root, { recursive: true, force: true });
  }
  assert.equal(result.schema, 3);
  assert.ok(result.strategyStatus);
  assert.deepEqual(Object.keys(result).sort(), [
    'applied', 'draft', 'drift', 'engine', 'generatedAt', 'generation', 'health', 'jobs',
    'runtime', 'runtimeSummary', 'schema', 'serviceState', 'strategyStatus', 'system',
    'upstream', 'warnings',
  ]);
  assert.equal(result.runtimeSummary.schemaVersion, 1);
  assert.equal(result.runtimeSummary.source, 'status-v3');
});
