import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const STATUS = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-status.uc');
const COLLECTOR = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc');
const OBSERVATIONS = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-observations.uc');
const COMPAT = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const LIBRARY = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const CONFIG_HASH = 'c'.repeat(64);
const CATALOG_DIGEST = 'd'.repeat(64);

function run(source, env = {}) {
  const result = spawnSync(UCODE_BIN, [...LIBRARY, '-e', source], {
    cwd: ROOT,
    env: { ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      UCODE_PATH: `${process.env.UCODE_MODULE_PATH ?? path.join(LIBRARY_PATH, 'ucode')}/*.so`, ...env },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function derive(selectedState, current, runtime, volatile = {}) {
  return run(`import { derive_strategy_status } from '${STATUS}'; print(sprintf('%J', derive_strategy_status(${JSON.stringify(selectedState)}, ${JSON.stringify(current)}, ${JSON.stringify(runtime)}, ${JSON.stringify(volatile)})));`);
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
    { configSha256: CONFIG_HASH, candidateSha256: HASH }, healthyRuntime);

  assert.deepEqual(projection(result), {
    id: 'user-one', name: 'User one', origin: 'user', revision: 3,
    digest: CATALOG_DIGEST, candidateSha256: HASH,
    match: true, drift: false, availability: 'available', uncertain: false,
  });
});

test('drift is derived from the current config and candidate evidence and is never saved', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, candidateSha256: OTHER_HASH }, healthyRuntime,
    { reconciliation: { id: 'user-one', hash: OTHER_HASH, reason: 'drift' } });

  assert.equal(result.match, false);
  assert.equal(result.drift, true);
  assert.equal(result.availability, 'drifted');
  assert.equal(result.uncertain, false);
  assert.equal(result.writes.length, 0);
  assert.doesNotMatch(result.persistedState, /drift|runtime|queue|dependency/);
});

test('runtime absence makes a selected Strategy unavailable without claiming a match', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, candidateSha256: HASH },
    { present: false, rulesPresent: false, count: 0 });

  assert.equal(result.match, null);
  assert.equal(result.drift, null);
  assert.equal(result.availability, 'unavailable');
  assert.equal(result.uncertain, false);
});

test('volatile Apply uncertainty makes reconciliation uncertain without changing durable identity', () => {
  const result = derive(selectedState(),
    { configSha256: CONFIG_HASH, candidateSha256: HASH }, healthyRuntime,
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

test('schema-3 compatibility keeps existing fields and adds only the read-only Strategy projection', () => {
  const compat = fs.readFileSync(COMPAT, 'utf8');
  assert.match(compat, /schema:\s*3/);
  for (const key of ['generatedAt', 'generation', 'serviceState', 'engine', 'runtime', 'applied',
    'draft', 'drift', 'health', 'system', 'upstream', 'jobs', 'warnings', 'runtimeSummary']) {
    assert.match(compat, new RegExp(`\\b${key}:`), key);
  }
  assert.match(compat, /strategyStatus/);
  assert.match(compat, /runtime_summary\(status\)/);
});

test('status projection and observations have a read-only boundary with no feature or manager-state writes', () => {
  const status = fs.readFileSync(STATUS, 'utf8');
  const collector = fs.readFileSync(COLLECTOR, 'utf8');
  const observations = fs.readFileSync(OBSERVATIONS, 'utf8');

  assert.match(status, /export const derive_strategy_status/);
  assert.match(status, /strategy_selection_get|read-only/);
  assert.doesNotMatch(status, /\b(?:writefile|state_mutate|strategy_selection_set|strategy_selection_apply)\s*\(/);
  assert.match(collector, /collect_strategy_status/);
  assert.doesNotMatch(collector, /\bstate_mutate\s*\(/);
  assert.doesNotMatch(observations, /\b(?:writefile|state_mutate|strategy_selection_set|strategy_selection_apply)\s*\(/);
});
