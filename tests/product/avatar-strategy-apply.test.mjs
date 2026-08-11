import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPLY = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const CATALOG_DIGEST = JSON.parse(fs.readFileSync(path.join(CATALOG_ROOT, 'manifest.json'), 'utf8')).aggregateDigest;
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];
const HASH = 'a'.repeat(64);

const environment = {
  listMode: 'none',
  paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/bin', listRoot: '/lists', ipsetRoot: '/lists' },
  functions: { fake: { present: true } },
  blobs: { fake_default_tls: { path: 'fake_default_tls.bin', present: true } },
  lua: { 'desync.lua': { present: true } },
  lists: {},
};

function invoke(module, expression, env = {}) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function strategy(overrides = {}) {
  return {
    id: 'user-one', name: 'User one', origin: 'user', is_builtin: false, metadata: {},
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: true }], ...overrides,
  };
}

function storage(callback, revision = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-apply-'));
  const strategies = path.join(root, 'strategies');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.mkdirSync(runtime, { mode: 0o700 });
  const recordPath = path.join(strategies, 'user-one.json');
  const record = { schema: 1, ...strategy(), revision, updatedAt: 1 };
  fs.writeFileSync(recordPath, JSON.stringify(record));
  fs.chmodSync(recordPath, 0o600);
  const env = {
    Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(runtime, 'reconciliation.json'),
    Z2M_STRATEGY_APPLY_UNCERTAIN: path.join(runtime, 'strategy-apply-uncertain.json'),
    Z2M_STRATEGY_LOCK: path.join(runtime, 'strategy.lock'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
  };
  fs.writeFileSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, JSON.stringify({ schema: 1, extensions: [] }));
  fs.chmodSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, 0o644);
  try { return callback({ record, env, root }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('Apply accepts only authoritative persisted Strategy identity', () => storage(({ record, env }) => {
  const source = { strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST };
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify(source)}).error.code`, env), 'EPREFLIGHT');
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', {strategy_data:${JSON.stringify(strategy())}}).error.code`, env), 'EINPUT');
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({ ...source, revision: 2 })}).error.code`, env), 'ECONFLICT');
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({ ...source, candidate:'--filter-tcp=80' })}).error.code`, env), 'EINPUT');
}));

test('Apply rejects zero enabled Profiles and missing dependencies before mutation', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  assert.match(source, /ENOENABLED/);
  assert.match(source, /EDEPENDENCY/);
  assert.match(source, /profilesCount == 0/);
  assert.match(source, /dependencies\.available/);
});

test('Apply compiles server-side, recomputes the candidate digest, and ignores client candidate/args', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  assert.match(source, /strategy_candidate\(resolved\.strategy/);
  assert.match(source, /candidate\.digest/);
  assert.match(source, /candidateSha256/);
  assert.match(source, /profiles_apply_candidate\(/);
  assert.match(source, /candidate or command/);
  assert.doesNotMatch(source, /input\.candidate\b/);
  assert.doesNotMatch(source, /input\.args\b/);
});

test('Strategy Apply uses Replace Full Set through the existing transaction engine', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const applySource = fs.readFileSync(APPLY, 'utf8');
  assert.match(source, /profiles_apply_candidate\(candidate\.candidate/);
  assert.match(source, /projection/);
  assert.match(applySource, /profiles_apply_candidate = function\(candidate, expectedHash, projection\)/);
  assert.match(applySource, /apply_candidate_pipeline/);
  assert.doesNotMatch(source, /set_var\s*\(/);
  assert.doesNotMatch(source, /set_var_cas\s*\(/);
  assert.doesNotMatch(source, /writefile\s*\(/);
});

test('the existing transaction retains snapshot, CAS, restart, verification, and exact rollback ordering', () => {
  const wholeSource = fs.readFileSync(APPLY, 'utf8');
  const source = wholeSource.slice(wholeSource.indexOf('function apply_candidate_pipeline'));
  const order = [
    'snapshot_apply()',
    'set_var_cas(OPT_VAR, dq_escape(f.candidate), snap.configSha256)',
    "run(UPSTREAM_INIT + ' restart')",
    'recollect_status()',
    'verify_status(',
    'read_config_bytes() == snap.configBytes',
    'rollbackVerify.ok',
  ];
  let cursor = 0;
  for (const marker of order) {
    const found = source.indexOf(marker, cursor);
    assert.ok(found >= 0, marker);
    cursor = found + marker.length;
  }
  assert.match(source, /restore_whole_file\(PATHS\.applied_conf, snap\.configBytes\)/);
});

test('successful verified Apply commits only the selected identity projection', () => storage(({ record, env }) => {
  const selection = invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:{id:'${record.id}',origin:'user',revision:${record.revision},candidateSha256:'${HASH}'}})`, env);
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.state.selected, { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(env.Z2M_STRATEGY_STATE, 'utf8')).selected).sort(),
    ['candidateSha256', 'id', 'origin', 'revision']);
  const applySource = fs.readFileSync(APPLY, 'utf8');
  assert.ok(applySource.indexOf('verify_status(recollect_status()') < applySource.indexOf("strategy_state_call('strategy_selection_apply'"));
}));

test('identity commit retry, failure, uncertain record, and deterministic reconciliation are explicit', () => {
  const source = fs.readFileSync(APPLY, 'utf8');
  const stateSource = fs.readFileSync(STATE, 'utf8');
  const cliSource = fs.readFileSync(CLI, 'utf8');
  assert.match(source, /strategy_selection_apply/);
  assert.match(source, /identity.*retry|retry.*identity/i);
  assert.match(source, /strategy_apply_uncertain|uncertain/);
  assert.match(source, /last-good/);
  assert.match(source, /old.*hash|hash.*old/i);
  assert.match(stateSource, /strategy_reconcile_get/);
  assert.match(stateSource, /strategy_reconcile_clear/);
  assert.match(cliSource, /blocked until explicit reconciliation/);
  assert.doesNotMatch(stateSource, /set_var_cas|restore_whole_file|NFQWS2_OPT|PATHS\.applied_conf/);
});

test('uncertain Apply is volatile, blocks normal Apply, and reconciles only with exact runtime evidence', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  const newIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: 'b'.repeat(64) };
  const oldHash = 'c'.repeat(64), newHash = 'd'.repeat(64);
  const saved = invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: oldHash, newConfigSha256: newHash, oldIdentity, newIdentity,
    runtimeOutcome: 'rollback-identity-failed', reason: 'test',
  })})`, env);
  assert.equal(saved.ok, true);
  assert.deepEqual(invoke(STATE, 'mod.strategy_apply_uncertain_get()', env).record, saved.record);
  const blocked = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  })})`, env);
  assert.equal(blocked.error.code, 'EUNCERTAIN');
  const reconciled = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    currentConfigSha256: oldHash, activeIdentity: oldIdentity, runtimeVerified: true,
  })})`, env);
  assert.deepEqual(reconciled, { ok: true, reconciled: 'old', selected: oldIdentity });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN), false);
}));

test('state identity failure decision requires rollback or volatile uncertainty, never reboot durability', () => {
  assert.deepEqual(invoke(STATE, `mod.strategy_identity_outcome({configHash:'${HASH}',identityOk:true,runtimeVerified:true})`),
    { ok: true, state: 'verified' });
  assert.equal(invoke(STATE, `mod.strategy_identity_outcome({configHash:'${HASH}',identityOk:false,runtimeVerified:true})`).state, 'rollback');
  assert.equal(invoke(STATE, `mod.strategy_identity_outcome({configHash:'${HASH}',identityOk:false,runtimeVerified:false})`).state, 'uncertain');
  assert.doesNotMatch(fs.readFileSync(STATE, 'utf8'), /reboot.*durab|durab.*reboot/i);
});

test('ordinary Profile and Strategy Preview callers remain non-mutating', () => {
  const cli = fs.readFileSync(CLI, 'utf8');
  const apply = fs.readFileSync(APPLY, 'utf8');
  assert.match(cli, /mode == 'preview'/);
  assert.match(cli, /mode == 'validate'/);
  assert.match(apply, /profiles_apply_run/);
  assert.match(apply, /profiles_apply_candidate/);
  assert.doesNotMatch(cli, /import \{[^}]*set_var/);
});
