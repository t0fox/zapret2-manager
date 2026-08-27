import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const STATUS = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/status.uc');
const COLLECTOR = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc');
const NFT_RULE_OBSERVATION = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/nft-rule-observation.uc');
const OBSERVATIONS = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-observations.uc');
const COMPAT = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc');
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc';
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const LIBRARY = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const TOP = ['applied', 'draft', 'drift', 'engine', 'generatedAt', 'generation', 'health',
  'jobs', 'runtime', 'runtimeSummary', 'schema', 'serviceState', 'system', 'upstream', 'warnings'];

function run(source, env = {}) {
  const result = spawnSync(UCODE_BIN, [...LIBRARY, '-e', source], {
    cwd: ROOT, env: { ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      UCODE_PATH: `${process.env.UCODE_MODULE_PATH ?? path.join(LIBRARY_PATH, 'ucode')}/*.so`, ...env },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function importStatus(expression) {
  return run(`import * as status from '${COLLECTOR}'; print(sprintf('%J', ${expression}));`);
}

function deriveRuntime(runtime, appliedOpt) {
  return run(`import { derive_runtime_observation } from '${OBSERVATIONS}'; print(sprintf('%J', derive_runtime_observation(${JSON.stringify(runtime)}, ${JSON.stringify(appliedOpt)})));`);
}

function resolveNative(result) {
  return run(`import { resolve_native_status } from '${OBSERVATIONS}'; let calls = 0; let resolved = resolve_native_status(${JSON.stringify(result)}, function() { calls++; return { ok: true, data: { state: { generation: 0 } } }; }); print(sprintf('%J', { resolved: resolved, calls: calls }));`);
}

function nativeState(generation = 7, serviceState = 'stopped') {
  return { schemaVersion: 1, generation, generatedAt: '2026-08-10T12:00:00Z', serviceState,
    runtime: { processes: [], namespaces: [] }, transactions: [], jobs: [], warnings: [] };
}

function observations() {
  return {
    generatedAt: '2026-08-10T12:00:10Z',
    engine: { installed: true, packagePresent: true, binaryPresent: true, servicePresent: true },
    runtime: { present: false, count: 0, instances: [], strategies: null, profileCount: null,
      psSummary: '', rulesPresent: false },
    applied: { configPath: '/etc/zapret2/config', configPresent: false, configMtime: null,
      configSize: null, uci: null },
    draft: {},
    drift: { divergent: false, reason: 'process absent (nothing to compare)',
      basis: 'sha256-intermediate', appliedSha256: null,
      currentSha256: { config: null, uci: null }, normalizedRuntime: null },
    health: { qlenHealth: { state: 'unknown', threshold: 200, consecutiveOverThreshold: 0, critTurns: 3 },
      checks: [], queue: { number: 300, registered: false, reason: null, peerPortid: null,
        ownerPid: null, ownerConflict: false, queueTotal: null, copyRange: null,
        queueDropped: null, queueUserDropped: null, updatedAt: null } },
    system: { autostart: { enabled: false, symlinks: [] }, upgradable: null },
    upstream: { nfqws2Version: null, autohostlist: null }, warnings: [],
  };
}

test('current status collector freezes the schema-3 assembly contract before refactor', () => {
  const source = fs.readFileSync(STATUS, 'utf8');
  const collector = fs.readFileSync(COLLECTOR, 'utf8');
  const compat = fs.readFileSync(COMPAT, 'utf8');
  assert.match(compat, /schema:\s*3/);
  for (const key of TOP) assert.match(compat, new RegExp(`\\b${key}:`), key);
  assert.match(compat, /runtime_summary\(status\)/);
  assert.match(collector, /writefile\(PATHS\.status_json/);
});

test('rpc status method serves cached schema-3 snapshot non-blocking with three-second TTL', () => {
  const source = fs.readFileSync(RPC, 'utf8');
  assert.match(source, /const CACHE_TTL\s*=\s*3;/);
  assert.match(source, /status:\s*\{\s*call:\s*function\s*\(req\)\s*\{\s*return status_method\(req\);\s*\}\s*\}/);
  // Non-blocking contract: serve the cached snapshot immediately, never run
  // the full collector inline (it starved every other rpcd call on target).
  assert.match(source, /function status_method\(req\)\s*\{\s*status_refresh_async\(\);\s*let raw = readfile\(STATUS_JSON\);/);
  assert.match(source, /EPENDING/);
  assert.match(source, /function cache_fresh\(\)[\s\S]*?CACHE_TTL/);
  assert.match(source, /value\.stale = true;/);
  // The background refresh must be a single-flight mkdir-lock around the
  // standalone collector process, not an inline collection.
  assert.match(source, /function status_refresh_async\(\)[\s\S]*?status\.refresh\.lock[\s\S]*?COLLECTOR/);
  assert.doesNotMatch(source, /function status_method[\s\S]*?result_ok|schemaVersion:\s*1/);
});

test('future pure adapter projects authoritative native state into exact schema 3', () => {
  const result = run(`import { legacy_status_v3 } from '${COMPAT}'; print(sprintf('%J', legacy_status_v3(${JSON.stringify(nativeState())}, ${JSON.stringify(observations())})));`);
  assert.equal(result.schema, 3);
  assert.deepEqual(Object.keys(result).sort(), TOP);
  assert.equal(result.generation, 7);
  assert.equal(result.serviceState, 'stopped');
  assert.equal(result.generatedAt, observations().generatedAt);
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.runtimeSummary.schemaVersion, 1);
  assert.equal(result.runtimeSummary.source, 'status-v3');
});

test('schema-3 adapter preserves collected applied profile and strategy observations', () => {
  const obs = observations();
  obs.runtime.profileCount = 3;
  obs.runtime.strategies = 'tcp-80\ntcp-443\nquic';
  const result = run(`import { legacy_status_v3 } from '${COMPAT}'; print(sprintf('%J', legacy_status_v3(${JSON.stringify(nativeState())}, ${JSON.stringify(obs)})));`);

  assert.equal(result.schema, 3);
  assert.equal(result.runtime.profileCount, 3);
  assert.equal(result.runtime.strategies, obs.runtime.strategies);
});

test('pure adapter preserves native jobs and deterministic warning shape', () => {
  const state = nativeState(12, 'running');
  state.jobs = [{ id: 'J1', kind: 'verify', state: 'running', generation: 12,
    owner: 'jobs/verify', createdAt: state.generatedAt, updatedAt: state.generatedAt,
    result: null, error: null }];
  state.warnings = [{ code: 'native_warning', message: 'native issue' }];
  const obs = observations();
  obs.warnings = [{ code: 'observation_warning', message: 'observed issue', severity: 'error' }];
  const result = run(`import { legacy_status_v3 } from '${COMPAT}'; print(sprintf('%J', legacy_status_v3(${JSON.stringify(state)}, ${JSON.stringify(obs)})));`);
  assert.equal(result.generation, 12);
  assert.equal(result.serviceState, 'running');
  assert.deepEqual(result.jobs, state.jobs);
  assert.deepEqual(result.warnings, [
    { code: 'native_warning', message: 'native issue', severity: 'warn' },
    { code: 'observation_warning', message: 'observed issue', severity: 'error' },
  ]);
});

test('compatibility adapter is pure and delegates runtimeSummary to existing implementation', () => {
  const source = fs.readFileSync(COMPAT, 'utf8');
  assert.match(source, /import \{ runtime_summary \} from '\.\.\/runtime-summary\.uc';/);
  assert.match(source, /runtime_summary\(status\)/);
  assert.doesNotMatch(source, /\b(?:readfile|writefile|stat|lsdir|popen|system|exec|state_read|state_initialize|state_mutate|native_helper|ubus|uci)\s*\(/);
});

test('status permits cache publication and one ENOENT initialization but no generation mutation', () => {
  const source = fs.readFileSync(COLLECTOR, 'utf8');
  assert.match(source, /export const collect_observations = function/);
  assert.match(source, /export const collect = function/);
  assert.match(source, /native_result\s*=\s*state_read\(\)/);
  assert.match(source, /resolve_native_status\(native_result, state_initialize\)/);
  assert.match(source, /writefile\(PATHS\.status_json/);
  assert.doesNotMatch(source, /\bstate_mutate\s*\(/);
  assert.doesNotMatch(source, /profiles_(?:create|update|clone|delete|reorder|import_applied|apply)\s*\(/);
  assert.match(source, /legacy_status_v3\([\s\S]*?,\s*observations\)/);
});

test('collector derives profile count and strategy observation from controlled production inputs', () => {
  const runtime = { present: true, count: 1, instances: [{ pid: 17 }],
    strategies: 'tcp-80\ntcp-443', psSummary: 'nfqws2', rulesPresent: true };
  const result = deriveRuntime(runtime, '--a --new --b --new --c');

  assert.deepEqual(result, {
    present: true, count: 1, instances: [{ pid: 17 }],
    strategies: runtime.strategies, profileCount: 3,
    psSummary: 'nfqws2', rulesPresent: true,
  });
  assert.equal(deriveRuntime({ strategies: null }, null).profileCount, null);
});

test('profile count recognizes parsed separators rather than --new text inside values', () => {
  assert.equal(deriveRuntime({}, '--comment="literal --new text" --filter-tcp=80').profileCount, 1);
  assert.equal(deriveRuntime({}, '--comment="literal --new text" --new --filter-tcp=443').profileCount, 2);
  assert.equal(deriveRuntime({}, '--renew=1 --filter-tcp=80').profileCount, 1);
});

test('status integration initializes only missing state and never mutates generation', () => {
  const present = { ok: true, data: { state: { generation: 9 } } };
  const missing = { ok: false, error: { details: { helperCode: 'ENOENT' } } };
  const invalid = { ok: false, error: { details: { helperCode: 'ESCHEMA' } } };

  assert.deepEqual(resolveNative(present), { resolved: present, calls: 0 });
  assert.deepEqual(resolveNative(missing), {
    resolved: { ok: true, data: { state: { generation: 0 } } }, calls: 1,
  });
  assert.deepEqual(resolveNative(invalid), { resolved: invalid, calls: 0 });
});

test('status module exports collect_observations and collect as importable functions', () => {
  const source = fs.readFileSync(COLLECTOR, 'utf8');
  const exported = [...source.matchAll(/export const\s+([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map(match => match[1]).sort();
  assert.deepEqual(exported, ['collect', 'collect_observations']);
});

test('status CLI remains directly executable and delegates to the importable collector', () => {
  const source = fs.readFileSync(STATUS, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/ucode$/m);
  assert.match(source, /import \{ collect \} from '\.\/core\/status-collector\.uc';/);
  assert.doesNotMatch(source, /export const/);
});

test('observation collector preserves legacy runtime, drift, system, and upstream evidence', () => {
  const source = fs.readFileSync(COLLECTOR, 'utf8');
  const nftSource = fs.readFileSync(NFT_RULE_OBSERVATION, 'utf8');
  for (const evidence of [
    /VmRSS:/, /ps w/, /list_table/, /uci show zapret2/,
    /sha256sum/, /normalizedRuntime/, /reconcile_queue_owner/, /apk version -c/,
    /nfqws2_version\(\)/, /autohostlist_vars\(\)/, /date -u -r/,
  ]) assert.match(source, evidence);
  assert.match(nftSource, /nft list table inet/);
});

test('degraded native state remains schema 3 without healthy generation-zero fabrication', () => {
  const degraded = { schemaVersion: 1, generation: null, generatedAt: null, serviceState: 'error',
    runtime: { processes: [], namespaces: [] }, transactions: [], jobs: [],
    warnings: [{ code: 'ESCHEMA', message: 'Persisted state JSON is invalid.' }] };
  const result = run(`import { legacy_status_v3 } from '${COMPAT}'; print(sprintf('%J', legacy_status_v3(${JSON.stringify(degraded)}, ${JSON.stringify(observations())})));`);
  assert.equal(result.schema, 3);
  assert.deepEqual(Object.keys(result).sort(), TOP);
  assert.equal(result.generation, null);
  assert.equal(result.serviceState, 'error');
  assert.equal(result.warnings[0].code, 'ESCHEMA');
  assert.notEqual(result.serviceState, 'stopped');
});
