import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPLY = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const RESULTS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const CATALOG_DIGEST = JSON.parse(fs.readFileSync(path.join(CATALOG_ROOT, 'manifest.json'), 'utf8')).aggregateDigest;
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];
const HASH = 'a'.repeat(64);
const OLD_CONFIG_HASH = 'c'.repeat(64);
const NEW_CONFIG_HASH = 'd'.repeat(64);
const CANDIDATE = '--filter-tcp=443';
const CANDIDATE_HASH = createHash('sha256').update(CANDIDATE).digest('hex');

test('Strategy Apply source contract re-resolves installed authority immediately before mutation', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  assert.match(source, /resolveInstalled/);
  assert.match(source, /strategy.*snapshot|installed.*snapshot/i);
  assert.match(source, /observedRegistryRevision|membershipDigest|compositionSnapshotId/);
  assert.match(source, /ESTALE/);
  assert.match(source, /profiles_apply_candidate/);
});

test('Strategy Apply invokes the OpenWrt init owner through rc.common', () => {
  const source = fs.readFileSync(APPLY, 'utf8');
  assert.match(source, /function upstream_action\(action\)/);
  assert.match(source, /sh \/etc\/rc\.common/);
  assert.doesNotMatch(source, /run\(UPSTREAM_INIT \+ ' restart'\)/);
});

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

function runtimeChecks(verified) {
  return { processPresent: verified, singleInstance: verified, rulesPresent: verified,
    queueRegistered: verified, ownerMatch: verified };
}

function runtimeComposition(overrides = {}) {
  return {
    ok: true, lifecycleState: 'installed', compositionStatus: 'canonical',
    snapshotId: 'z2k-lifecycle-v2|installed-a', compositionSnapshotId: 'z2k-composition-v2|installed-a',
    membershipDigest: HASH, observedRegistryRevision: 17,
    lifecycleIdentity: { kind: 'installed', release: 'r-80.3', sourceCommit: 'c'.repeat(40) },
    receiptIdentity: { receiptId: 'receipt-r-80.3' }, runtimeAssets: [], luaInit: [],
    dependencyIndex: {}, scannerOverlay: [], ...overrides,
  };
}

function transactionHook(overrides = {}) {
  const { state: stateOverrides = {}, candidate: candidateOverride = null,
    reconciliation: reconciliationOverride = null, runtimeComposition: runtimeCompositionOverride = null,
    ...transactionOverrides } = overrides;
  const hook = { runtimeComposition: runtimeCompositionOverride || runtimeComposition(), state: {
    strategy_apply_revalidate: { ok: true },
    strategy_selection_apply: { ok: true },
    ...stateOverrides,
  }, transaction: {
    currentOpt: '--filter-tcp=80',
    preflight: { status: 'verified', coverage: {
      cliSyntax: 'passed', luaLoad: 'passed', luaCompatibility: 'passed',
      functionExistence: 'passed', blobExistence: 'passed', runtimeArguments: 'passed',
      executionPlan: 'passed'
    }, diagnostics: [] },
    snapshot: { configBytes: 'old-config', configSha256: OLD_CONFIG_HASH,
      uciBytes: '', uciSha256: null },
    cas: { ok: true, configSha256: NEW_CONFIG_HASH },
    restart: [{ rc: 0, out: '' }, { rc: 0, out: '' }],
    verify: [{ ok: true, checks: runtimeChecks(true) }, { ok: true, checks: runtimeChecks(true) }],
    rollback: { restoreOk: true, configBytes: 'old-config', configSha256: OLD_CONFIG_HASH },
    appliedIdentity: { config: NEW_CONFIG_HASH, uci: null },
    rollbackAppliedIdentity: { config: OLD_CONFIG_HASH, uci: null },
    configHash: OLD_CONFIG_HASH, candidateHash: HASH,
    ...transactionOverrides
  }};
  if (candidateOverride != null) hook.candidate = candidateOverride;
  if (reconciliationOverride != null) hook.reconciliation = { evidence: reconciliationOverride };
  return JSON.stringify(hook);
}

function strategyCandidateStub() {
  return {
    ok: true, candidate: CANDIDATE, digest: CANDIDATE_HASH, profilesCount: 1,
    dependencies: { available: true },
    nativeValidation: { status: 'verified', coverage: {
      cliSyntax: 'passed', luaLoad: 'passed', luaCompatibility: 'passed',
      functionExistence: 'passed', blobExistence: 'passed', runtimeArguments: 'passed',
      executionPlan: 'passed'
    }, diagnostics: [] }
  };
}

function strategyProjection(record, selected, previousCandidateSha256 = HASH) {
  return {
    callerContext: 'strategy_apply', operationNonce: 'apply-op',
    strategyId: record.id, strategyOrigin: 'user', strategyRevision: record.revision,
    catalogDigest: CATALOG_DIGEST, expectedRevision: selected == null ? 0 : 1,
    selectionRevision: selected == null ? 0 : 1, expectedSelected: selected,
    previousCandidateSha256, candidateSha256: CANDIDATE_HASH,
    expectedConfigSha256: OLD_CONFIG_HASH, previousSelected: selected,
    selected: { id: record.id, origin: 'user', revision: record.revision, candidateSha256: CANDIDATE_HASH }
  };
}

function storage(callback, revision = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-apply-'));
  const strategies = path.join(root, 'strategies');
  const runtime = path.join(root, 'runtime');
  const lastGood = path.join(runtime, 'last-good');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.mkdirSync(lastGood, { mode: 0o700 });
  const recordPath = path.join(strategies, 'user-one.json');
  const record = { schema: 1, ...strategy(), revision, updatedAt: 1 };
  fs.writeFileSync(recordPath, JSON.stringify(record));
  fs.chmodSync(recordPath, 0o600);
  const env = {
    Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(runtime, 'reconciliation.json'),
    Z2M_STRATEGY_APPLY_UNCERTAIN: path.join(runtime, 'strategy-apply-uncertain.json'),
    Z2M_STRATEGY_APPLY_LASTGOOD: lastGood,
    Z2M_STRATEGY_APPLY_BLOCK: path.join(lastGood, 'strategy-apply-block.json'),
    Z2M_STRATEGY_APPLY_LEASE: path.join(lastGood, 'strategy-apply-lease.json'),
    Z2M_STRATEGY_CONFIG_LOCK: path.join(runtime, 'config.lock'),
    Z2M_STRATEGY_PROFILE_MODULE: APPLY,
    Z2M_STRATEGY_PROFILE_CLI: path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply-cli.uc'),
    Z2M_STRATEGY_STATE_MODULE: STATE,
    Z2M_STRATEGY_UCODE_BIN: UCODE_BIN,
    Z2M_STRATEGY_SERVER_TEST: '1',
    Z2M_STRATEGY_RUNTIME_INPUTS: JSON.stringify({ source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2',
      baseArgs: ['--qnum=30999'], luaInit: ['/opt/zapret2/lua/zapret-lib.lua'], hostlists: ['/lists/netrogat.txt'] }),
    Z2M_STRATEGY_RUNTIME_ENVIRONMENT: JSON.stringify(environment),
    Z2M_STRATEGY_LOCK: path.join(runtime, 'strategy.lock'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
  };
  fs.writeFileSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, JSON.stringify({ schema: 1, extensions: [] }));
  fs.chmodSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, 0o644);
  try {
    const result = callback({ record, env, root });
    if (result && typeof result.then === 'function') return result.finally(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.rmSync(root, { recursive: true, force: true });
    return result;
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
}

function holdUcode(module, expression, env) {
  const resultPath = path.join(os.tmpdir(), `z2m-held-${process.pid}-${Date.now()}.json`);
  const source = `import { popen, writefile } from 'fs'; import * as mod from ${JSON.stringify(module)}; let result = ${expression}; writefile(getenv('Z2M_HOLD_RESULT'), sprintf('%J', result)); let hold = popen('sleep 3', 'r'); if (hold) hold.close();`;
  const child = spawn(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT, env: { ...process.env, ...env, Z2M_HOLD_RESULT: resultPath, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let stderr = '', settled = false;
    const timer = setTimeout(() => { if (!settled) { child.kill('SIGKILL'); reject(new Error('held ucode timed out')); } }, 10_000);
    const poll = setInterval(() => {
      if (settled || !fs.existsSync(resultPath)) return;
      settled = true; clearTimeout(timer); clearInterval(poll);
      try { const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); fs.rmSync(resultPath, { force: true }); resolve({ child, result, stderr }); }
      catch (error) { reject(error); }
    }, 25);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', () => { });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => { if (!settled) { clearTimeout(timer); clearInterval(poll); reject(new Error(`held ucode exited ${code}: ${stderr}`)); } });
  });
}

test('Apply accepts only authoritative persisted Strategy identity', () => storage(({ record, env }) => {
  const source = { strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST };
  const runtimeEnv = { ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook() };
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify(source)}).error.code`, runtimeEnv), 'EPREFLIGHT');
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', {strategy_data:${JSON.stringify(strategy())}}).error.code`, runtimeEnv), 'EINPUT');
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({ ...source, revision: 2 })}).error.code`, runtimeEnv), 'ECONFLICT');
  assert.equal(invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({ ...source, candidate:'--filter-tcp=80' })}).error.code`, runtimeEnv), 'EINPUT');
}));

test('Apply rejects zero enabled Profiles and missing dependencies before mutation', () => storage(({ record, env }) => {
  const zero = { ...record, revision: record.revision + 1,
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: false }] };
  fs.writeFileSync(path.join(env.Z2M_STRATEGY_DIR, `${record.id}.json`), JSON.stringify(zero));
  const zeroResult = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: zero.revision, catalog_digest: CATALOG_DIGEST,
  })}, ${JSON.stringify({ environment, runtimeInputs: { source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2', baseArgs: [], luaInit: [], hostlists: [] } })})`, { ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook() });
  assert.equal(zeroResult.error.code, 'ENOENABLED');
  const missing = { ...zero, revision: zero.revision + 1,
    profiles: [{ id: 'p1', args: '--lua-init=@lua/missing.lua', enabled: true }] };
  fs.writeFileSync(path.join(env.Z2M_STRATEGY_DIR, `${record.id}.json`), JSON.stringify(missing));
  const missingResult = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: missing.revision, catalog_digest: CATALOG_DIGEST,
  })}, ${JSON.stringify({ environment: { ...environment, lua: { 'missing.lua': { present: false } } }, runtimeInputs: { source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2', baseArgs: [], luaInit: [], hostlists: [] } })})`, { ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook() });
  assert.equal(missingResult.error.code, 'EDEPENDENCY');
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_STATE), false);
}));

test('successful verified Apply commits only the selected identity projection', () => storage(({ record, env }) => {
  const selection = invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:{id:'${record.id}',origin:'user',revision:${record.revision},candidateSha256:'${HASH}'}})`, env);
  assert.equal(selection.ok, true);
  assert.deepEqual(selection.state.selected, { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(env.Z2M_STRATEGY_STATE, 'utf8')).selected).sort(),
    ['candidateSha256', 'id', 'origin', 'revision']);
}));

test('uncertain Apply is volatile, blocks normal Apply, and reconciles only with exact runtime evidence', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  const newIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: 'b'.repeat(64) };
  const oldHash = 'c'.repeat(64), newHash = 'd'.repeat(64);
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const saved = invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: oldHash, newConfigSha256: newHash, oldCandidateSha256: HASH,
     newCandidateSha256: newIdentity.candidateSha256, catalogDigest: CATALOG_DIGEST, oldIdentity, newIdentity,
    runtimeOutcome: { initial: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: true, ownerMatch: true },
      rollback: { processPresent: false, singleInstance: false, rulesPresent: false, queueRegistered: false, ownerMatch: false },
      restartRc: 1, rollbackRestartRc: 1, configRestored: false, identityRestored: false }, reason: 'test',
  })})`, env);
  assert.equal(saved.ok, true);
  assert.deepEqual(invoke(STATE, 'mod.strategy_apply_uncertain_get()', env).record, saved.record);
  const blocked = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  })})`, env);
  assert.equal(blocked.error.code, 'EUNCERTAIN');
  const reconciled = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: oldHash, activeCandidateSha256: HASH,
    runtimeChecks: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: true, ownerMatch: true },
  })})`, env);
  assert.deepEqual(reconciled, { ok: true, reconciled: 'old', selected: oldIdentity });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN), false);
}));

test('reconciliation refuses an ordinary output hash collision without changing persisted selection', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  const newIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: 'b'.repeat(64) };
  const saved = invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: OLD_CONFIG_HASH, newConfigSha256: NEW_CONFIG_HASH,
     oldCandidateSha256: HASH, newCandidateSha256: newIdentity.candidateSha256, catalogDigest: CATALOG_DIGEST,
    oldIdentity, newIdentity,
    runtimeOutcome: { initial: runtimeChecks(false), rollback: runtimeChecks(false), restartRc: 1, rollbackRestartRc: 1,
      configRestored: false, identityRestored: false }, reason: 'hash-collision',
  })})`, env);
  assert.equal(saved.ok, true);
  const reconciled = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: NEW_CONFIG_HASH,
    activeCandidateSha256: NEW_CONFIG_HASH,
    runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.equal(reconciled.error.code, 'ECONFLICT');
  assert.equal(invoke(STATE, 'mod.strategy_selection_get()', env).selected, null);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN), true);
}));

test('reconciliation commits new identity only from the exact persisted old Strategy selection', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  const newIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: 'b'.repeat(64) };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  assert.equal(invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: OLD_CONFIG_HASH, newConfigSha256: NEW_CONFIG_HASH,
     oldCandidateSha256: HASH, newCandidateSha256: newIdentity.candidateSha256, catalogDigest: CATALOG_DIGEST,
    oldIdentity, newIdentity,
    runtimeOutcome: { initial: runtimeChecks(false), rollback: runtimeChecks(false), restartRc: 1, rollbackRestartRc: 1,
      configRestored: false, identityRestored: false }, reason: 'new-authoritative-state',
  })})`, env).ok, true);
  const reconciled = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: NEW_CONFIG_HASH,
    activeCandidateSha256: newIdentity.candidateSha256, runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.reconciled, 'new');
  assert.deepEqual(invoke(STATE, 'mod.strategy_selection_get()', env).selected, newIdentity);
}));

test('dead pending Apply guard clears only through exact authoritative old-state reconciliation', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const begun = invoke(STATE, `mod.strategy_apply_begin(${JSON.stringify({
    strategyId: record.id, strategyRevision: record.revision, catalogDigest: CATALOG_DIGEST,
    oldConfigSha256: OLD_CONFIG_HASH, oldCandidateSha256: HASH,
  })})`, env);
  assert.equal(begun.ok, true);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), true);
  const recovered = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: OLD_CONFIG_HASH,
    activeCandidateSha256: HASH, runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.deepEqual(recovered, { ok: true, reconciled: 'pending-old', selected: oldIdentity });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), false);
}));

test('dead pending Apply guard recovers a first Apply with null old selection', () => storage(({ record, env }) => {
  const begun = invoke(STATE, `mod.strategy_apply_begin(${JSON.stringify({
    strategyId: record.id, strategyRevision: record.revision, catalogDigest: CATALOG_DIGEST,
    oldConfigSha256: OLD_CONFIG_HASH, oldCandidateSha256: HASH,
  })})`, env);
  assert.equal(begun.ok, true);
  const recovered = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: OLD_CONFIG_HASH,
    activeCandidateSha256: HASH, runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.deepEqual(recovered, { ok: true, reconciled: 'pending-old', selected: null });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), false);
}));

test('live pending Apply guard cannot be stolen or cleared by reconciliation', async () => storage(async ({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const begun = await holdUcode(STATE, `mod.strategy_apply_begin(${JSON.stringify({
    strategyId: record.id, strategyRevision: record.revision, catalogDigest: CATALOG_DIGEST,
    oldConfigSha256: OLD_CONFIG_HASH, oldCandidateSha256: HASH,
  })})`, env);
  assert.equal(begun.result.ok, true);
  const recovered = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: OLD_CONFIG_HASH,
    activeCandidateSha256: HASH, runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.equal(recovered.error.code, 'ELOCKED');
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), true);
  if (begun.child.exitCode == null) await new Promise((resolve, reject) => {
    begun.child.once('error', reject);
    begun.child.once('exit', code => code == 0 || code == null ? resolve() : reject(new Error(`held ucode exit ${code}`)));
    begun.child.kill('SIGTERM');
  });
}));

test('profiles_apply_candidate executes a verified Strategy transaction through the boundary', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const result = invoke(APPLY, `mod.profiles_apply_candidate(${JSON.stringify(CANDIDATE)}, '${CANDIDATE_HASH}', ${JSON.stringify(strategyProjection(record, oldIdentity))})`, {
    ...env, Z2M_CONFIG_LOCKED: '1', Z2M_STRATEGY_APPLY_HOOK: transactionHook(),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.identity.ok, true);
  assert.deepEqual(result.appliedIdentity, { config: NEW_CONFIG_HASH, uci: null });
  assert.deepEqual(invoke(STATE, 'mod.strategy_selection_get()', env).selected, oldIdentity);
}));

test('profiles_apply_candidate executes restart failure and verified rollback through the boundary', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const result = invoke(APPLY, `mod.profiles_apply_candidate(${JSON.stringify(CANDIDATE)}, '${CANDIDATE_HASH}', ${JSON.stringify(strategyProjection(record, oldIdentity))})`, {
    ...env, Z2M_CONFIG_LOCKED: '1', Z2M_STRATEGY_APPLY_HOOK: transactionHook({
      state: { strategy_selection_get: { ok: true, revision: 1, selected: oldIdentity } },
      restart: [{ rc: 1, out: 'restart failed' }, { rc: 0, out: '' }],
      verify: [{ ok: false, checks: runtimeChecks(false) }, { ok: true, checks: runtimeChecks(true) }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ETARGET');
  assert.equal(result.rolledBack, true);
  assert.deepEqual(result.rollbackAppliedIdentity, { config: OLD_CONFIG_HASH, uci: null });
  assert.deepEqual(invoke(STATE, 'mod.strategy_selection_get()', env).selected, oldIdentity);
}));

test('profiles_apply_candidate retries identity commit once and reports verified retry', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const result = invoke(APPLY, `mod.profiles_apply_candidate(${JSON.stringify(CANDIDATE)}, '${CANDIDATE_HASH}', ${JSON.stringify(strategyProjection(record, oldIdentity))})`, {
    ...env, Z2M_CONFIG_LOCKED: '1', Z2M_STRATEGY_APPLY_HOOK: transactionHook({
      state: { strategy_selection_apply: [
        { ok: false, error: { code: 'ECONFLICT', message: 'injected identity race' } },
        { ok: true, state: { selected: { id: record.id, origin: 'user', revision: record.revision, candidateSha256: CANDIDATE_HASH } } },
      ] },
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.identity.ok, true);
  assert.equal(result.identityRetry.ok, true);
}));

test('profiles_apply_candidate rolls back when identity commit and retry both fail', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const result = invoke(APPLY, `mod.profiles_apply_candidate(${JSON.stringify(CANDIDATE)}, '${CANDIDATE_HASH}', ${JSON.stringify(strategyProjection(record, oldIdentity))})`, {
    ...env, Z2M_CONFIG_LOCKED: '1', Z2M_STRATEGY_APPLY_HOOK: transactionHook({
      state: { strategy_selection_get: { ok: true, revision: 1, selected: oldIdentity }, strategy_selection_apply: [
        { ok: false, error: { code: 'ECONFLICT', message: 'injected identity race' } },
        { ok: false, error: { code: 'ECONFLICT', message: 'injected identity retry failure' } },
      ] },
      restart: [{ rc: 0, out: '' }, { rc: 0, out: '' }],
      verify: [{ ok: true, checks: runtimeChecks(true) }, { ok: true, checks: runtimeChecks(true) }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EVERIFY');
  assert.equal(result.rolledBack, true);
  assert.equal(result.uncertain, false);
}));

test('profiles_apply_candidate preserves the blocker when uncertainty persistence fails', () => storage(({ record, env }) => {
  const oldIdentity = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  const result = invoke(APPLY, `mod.profiles_apply_candidate(${JSON.stringify(CANDIDATE)}, '${CANDIDATE_HASH}', ${JSON.stringify(strategyProjection(record, oldIdentity))})`, {
    ...env, Z2M_CONFIG_LOCKED: '1', Z2M_STRATEGY_APPLY_HOOK: transactionHook({
      state: { strategy_apply_uncertain_record: { ok: false, error: { code: 'EIO', message: 'injected persistence failure' } } },
      restart: [{ rc: 1, out: 'restart failed' }, { rc: 1, out: 'rollback restart failed' }],
      verify: [{ ok: false, checks: runtimeChecks(false) }, { ok: false, checks: runtimeChecks(false) }],
      rollback: { restoreOk: false, configBytes: 'wrong-config', configSha256: 'e'.repeat(64) },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EVERIFY');
  assert.equal(result.uncertain, true);
  assert.equal(result.uncertaintyPersistence.ok, false);
}));

test('strategy_apply executes a successful transaction through the injected candidate and profile seams', () => storage(({ record, env }) => {
  const hook = transactionHook({ candidate: strategyCandidateStub() });
  const result = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  })})`, { ...env, Z2M_STRATEGY_APPLY_HOOK: hook });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.strategy, { id: record.id, origin: 'user', revision: record.revision, candidateSha256: CANDIDATE_HASH });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), false);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_LEASE), false);
}));

test('strategy_apply rejects a Registry/runtime composition change before the profile writer', () => storage(({ record, env }) => {
  const before = runtimeComposition({ observedRegistryRevision: 17 });
  const after = runtimeComposition({ observedRegistryRevision: 18,
    snapshotId: 'z2k-lifecycle-v2|installed-b', compositionSnapshotId: 'z2k-composition-v2|installed-b' });
  const result = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
    snapshotId: 'client-forged-snapshot',
  })})`, { ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook({
    candidate: strategyCandidateStub(), runtimeComposition: [before, after],
  }) });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ESTALE');
}));

test('strategy_apply executes restart failure and verified rollback through the injected seams', () => storage(({ record, env }) => {
  const result = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  })})`, { ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook({
    candidate: strategyCandidateStub(),
    state: { strategy_selection_get: { ok: true, revision: 0, selected: null } },
    restart: [{ rc: 1, out: 'restart failed' }, { rc: 0, out: '' }],
    verify: [{ ok: false, checks: runtimeChecks(false) }, { ok: true, checks: runtimeChecks(true) }],
  }) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ETARGET');
  assert.equal(result.rolledBack, true);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), false);
}));

test('successful strategy_apply guard-release failure records evidence and reconciles the old state', () => storage(({ record, env }) => {
  const result = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  })})`, { ...env,
    Z2M_STRATEGY_APPLY_END_RESULT: JSON.stringify({ ok: false, error: { code: 'EIO', message: 'release failed' } }),
    Z2M_STRATEGY_APPLY_HOOK: transactionHook({ candidate: strategyCandidateStub() }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EUNCERTAIN');
  const recordValue = JSON.parse(fs.readFileSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN, 'utf8'));
  assert.equal(recordValue.oldCandidateSha256, HASH);
  assert.equal(recordValue.newCandidateSha256, CANDIDATE_HASH);
  assert.equal(recordValue.oldIdentity, null);
  const reconciled = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: OLD_CONFIG_HASH,
    activeCandidateSha256: HASH, runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.deepEqual(reconciled, { ok: true, reconciled: 'old', selected: null });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN), false);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_BLOCK), false);
}));

test('strategy_apply reconciliation holds the config lock while collecting evidence', async () => storage(async ({ env }) => {
  const evidence = { ok: true, evidenceMarker: 'z2m-authoritative-reconcile.v1',
    currentConfigSha256: OLD_CONFIG_HASH, activeCandidateSha256: HASH, runtimeChecks: runtimeChecks(true) };
  const holder = spawn('flock', ['-x', env.Z2M_STRATEGY_CONFIG_LOCK, '-c', 'sleep 1.5'], { stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 150));
  const started = Date.now();
  const result = invoke(CLI, `mod.strategy_cli_dispatch('reconcile', { forged: true }, { forged: true })`, {
    ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook({ reconciliation: evidence }),
  });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reconciled, false);
  assert.ok(elapsed >= 900, `reconciliation did not wait for config lock: ${elapsed}ms`);
  if (holder.exitCode == null) await new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.once('exit', code => code == 0 ? resolve() : reject(new Error(`flock holder exit ${code}`)));
  });
}));

test('state identity failure decision requires rollback or volatile uncertainty, never reboot durability', () => {
  assert.deepEqual(invoke(STATE, `mod.strategy_identity_outcome({configHash:'${HASH}',identityOk:true,runtimeVerified:true})`),
    { ok: true, state: 'verified' });
  assert.equal(invoke(STATE, `mod.strategy_identity_outcome({configHash:'${HASH}',identityOk:false,runtimeVerified:true})`).state, 'rollback');
  assert.equal(invoke(STATE, `mod.strategy_identity_outcome({configHash:'${HASH}',identityOk:false,runtimeVerified:false})`).state, 'uncertain');
});

test('projection boundary rejects stale or concurrent sidecars and preserves no-projection callers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-projection-boundary-'));
  const sidecar = path.join(root, 'projection.json');
  const hash = 'e'.repeat(64);
  const projection = { callerContext: 'strategy_apply', operationNonce: 'apply-op',
    expectedRevision: 0, selectionRevision: 0, strategyRevision: 3,
    strategyId: 'user-one', strategyOrigin: 'user', catalogDigest: CATALOG_DIGEST,
    previousCandidateSha256: hash, candidateSha256: hash,
    selected: null, previousSelected: null, expectedSelected: null };
  const envelope = {
    schema: 1, marker: 'z2m-strategy-apply-projection.v1', callerContext: 'strategy_apply',
    transactionNonce: 'nonce-one', candidateSha256: hash, projection,
  };
  fs.writeFileSync(sidecar, JSON.stringify(envelope), { mode: 0o600 });
  try {
    assert.deepEqual(invoke(APPLY, `mod.profiles_projection_boundary('${hash}')`),
      { ok: true, present: false, projection: null });
    const valid = invoke(APPLY, `mod.profiles_projection_boundary('${hash}')`, {
      Z2M_STRATEGY_PROJECTION_PATH: sidecar,
      Z2M_STRATEGY_PROJECTION_NONCE: 'nonce-one',
      Z2M_STRATEGY_PROJECTION_MARKER: 'z2m-strategy-apply-projection.v1',
      Z2M_STRATEGY_PROJECTION_CALLER: 'strategy_apply',
    });
    assert.deepEqual(valid, { ok: true, present: true, projection });
    assert.equal(invoke(APPLY, `mod.profiles_projection_boundary('${hash}')`, {
      Z2M_STRATEGY_PROJECTION_PATH: sidecar,
      Z2M_STRATEGY_PROJECTION_NONCE: 'nonce-two',
      Z2M_STRATEGY_PROJECTION_MARKER: 'z2m-strategy-apply-projection.v1',
      Z2M_STRATEGY_PROJECTION_CALLER: 'strategy_apply',
    }).error.code, 'EINPUT');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ordinary Profile adapter calls cannot consume an externally supplied Strategy sidecar', () => storage(({ record, env }) => {
  const sidecar = path.join(env.Z2M_STRATEGY_ROOT, 'ordinary-sidecar.json');
  const projection = strategyProjection(record, null);
  fs.writeFileSync(sidecar, JSON.stringify({ schema: 1, marker: 'z2m-strategy-apply-projection.v1',
    callerContext: 'strategy_apply', transactionNonce: 'external-nonce', candidateSha256: CANDIDATE_HASH, projection }));
  fs.chmodSync(sidecar, 0o600);
  const result = invoke(APPLY, `mod.profiles_apply_candidate('${CANDIDATE}', '${CANDIDATE_HASH}')`, {
    ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook(),
    Z2M_STRATEGY_PROJECTION_PATH: sidecar, Z2M_STRATEGY_PROJECTION_NONCE: 'external-nonce',
    Z2M_STRATEGY_PROJECTION_MARKER: 'z2m-strategy-apply-projection.v1', Z2M_STRATEGY_PROJECTION_CALLER: 'strategy_apply',
  });
  assert.equal(result.ok, true);
  assert.equal(result.identity, null);
  assert.equal(fs.existsSync(sidecar), true);
}));

test('Apply guard fails closed on insecure last-good or uncertainty write failure and blocks the next Apply', () => storage(({ record, env }) => {
  fs.chmodSync(env.Z2M_STRATEGY_APPLY_LASTGOOD, 0o755);
  const guard = invoke(STATE, 'mod.strategy_apply_guard_status()', env);
  assert.equal(guard.blocked, true);
  assert.equal(invoke(STATE, `mod.strategy_apply_begin(${JSON.stringify({
    strategyId: record.id, strategyRevision: record.revision, catalogDigest: CATALOG_DIGEST,
  })})`, env).ok, false);
  fs.chmodSync(env.Z2M_STRATEGY_APPLY_LASTGOOD, 0o700);
  const begun = invoke(STATE, `mod.strategy_apply_begin(${JSON.stringify({
    strategyId: record.id, strategyRevision: record.revision, catalogDigest: CATALOG_DIGEST,
  })})`, env);
  assert.equal(begun.ok, true);
  const target = path.join(env.Z2M_STRATEGY_APPLY_LASTGOOD, 'uncertain-target');
  fs.writeFileSync(target, 'keep');
  fs.rmSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN, { force: true });
  fs.symlinkSync(target, env.Z2M_STRATEGY_APPLY_UNCERTAIN);
  assert.equal(invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: '1'.repeat(64), newConfigSha256: '2'.repeat(64),
     oldCandidateSha256: '3'.repeat(64), newCandidateSha256: '4'.repeat(64), catalogDigest: CATALOG_DIGEST,
    oldIdentity: null, newIdentity: null,
    runtimeOutcome: { initial: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: true, ownerMatch: true },
      rollback: { processPresent: false, singleInstance: false, rulesPresent: false, queueRegistered: false, ownerMatch: false }, restartRc: 1, rollbackRestartRc: 1,
      configRestored: false, identityRestored: false }, reason: 'write-failure',
  })})`, env).ok, false);
  const blocked = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify({
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  })})`, env);
  assert.equal(blocked.error.code, 'EUNCERTAIN');
}));

test('Apply lease blocks concurrent Strategy revision changes until the transaction ends', async () => storage(async ({ record, env }) => {
  const begun = await holdUcode(STATE, `mod.strategy_apply_begin(${JSON.stringify({
    strategyId: record.id, strategyRevision: record.revision, catalogDigest: CATALOG_DIGEST,
  })})`, env);
  assert.equal(begun.result.ok, true);
  const selected = { id: record.id, origin: 'user', revision: record.revision, candidateSha256: HASH };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(selected)},applyNonce:'${begun.result.operationNonce}'})`, env).ok, true);
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(selected)},applyNonce:'${begun.result.operationNonce}'})`, env).error.code, 'ECONFLICT');
  assert.equal(invoke(STATE, `mod.strategy_selection_restore({expectedRevision:1,selected:null,applyNonce:'${begun.result.operationNonce}'})`, env).ok, true);
  const update = invoke(STATE, `mod.strategy_user_update(${JSON.stringify({
    id: record.id, expectedRevision: record.revision, strategy: strategy({ name: 'raced' }),
  })})`, env);
  assert.equal(update.error.code, 'ELOCKED');
  assert.equal(invoke(STATE, `mod.strategy_apply_end({applyNonce:'${begun.result.operationNonce}'})`, env).ok, true);
  assert.equal(invoke(STATE, `mod.strategy_user_update(${JSON.stringify({
    id: record.id, expectedRevision: record.revision, strategy: strategy({ name: 'after' }),
  })})`, env).ok, true);
  if (begun.child.exitCode == null) await new Promise((resolve, reject) => {
    begun.child.once('error', reject);
    begun.child.once('exit', code => code == 0 || code == null ? resolve() : reject(new Error(`held ucode exit ${code}`)));
    begun.child.kill('SIGTERM');
  });
}));

test('reconciliation ignores request context and requires authoritative runtime evidence', () => storage(({ record, env }) => {
  const forged = invoke(CLI, `mod.strategy_cli_dispatch('reconcile', {forged:true}, {reconciliation:{
    runtimeVerified:true, currentConfigSha256:'${'a'.repeat(64)}', activeIdentity:null
  }})`, env);
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'EVERIFY');
  const request = path.join(env.Z2M_STRATEGY_ROOT, 'not-read.json');
  assert.equal(invoke(CLI, `mod.strategy_cli_request('reconcile', '${request}')`, env).error.code, 'EVERIFY');
  assert.equal(record.id, 'user-one');
}));

test('runtime uncertainty records preserve bounded verified checks and rollback-success is not uncertain', () => storage(({ env }) => {
  const outcome = {
    initial: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: true, ownerMatch: true },
    rollback: { processPresent: true, singleInstance: true, rulesPresent: true, queueRegistered: true, ownerMatch: true },
    restartRc: 0, rollbackRestartRc: 0, configRestored: true, identityRestored: true,
  };
  const saved = invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: '3'.repeat(64), newConfigSha256: '4'.repeat(64),
     oldCandidateSha256: '5'.repeat(64), newCandidateSha256: '6'.repeat(64), catalogDigest: CATALOG_DIGEST,
    oldIdentity: null, newIdentity: null, runtimeOutcome: outcome, reason: 'verified-checks',
  })})`, env);
  assert.equal(saved.ok, true);
  assert.deepEqual(invoke(STATE, 'mod.strategy_apply_uncertain_get()', env).record.runtimeOutcome, outcome);
  const decision = invoke(APPLY, `mod.profiles_strategy_failure_decision(${JSON.stringify({
    primaryFailed: true, rollbackVerified: true, identityRestored: true,
  })})`);
  assert.deepEqual(decision, { uncertain: false, rolledBack: true });
  const uncertain = invoke(APPLY, `mod.profiles_strategy_failure_decision(${JSON.stringify({
    primaryFailed: true, rollbackVerified: true, identityRestored: false,
  })})`);
  assert.deepEqual(uncertain, { uncertain: true, rolledBack: false });
}));
test('scanner handoff: existing Strategy ID returned, unmatched generated cannot Apply, Save payload only', () => {
  const existing = invoke(RESULTS, `mod.scanner_best_reference({ranked:[{strategyId:'catalog-one',strategyRevision:0,saveRequired:false}]},{})`);
  assert.deepEqual(existing, { kind: 'strategy', strategyId: 'catalog-one', revision: 0, saveRequired: false });
  const generated = invoke(RESULTS, `mod.scanner_best_reference({ranked:[{candidateId:'generated:one',identityKind:'generated',saveRequired:true}]},{})`);
  assert.deepEqual(generated, { kind: 'generated', strategyId: null, revision: null, candidateId: 'generated:one', saveRequired: true });
  const saved = invoke(RESULTS, `mod.scanner_save_generated_validate({candidate:{profile:{name:'generated'}},compiler:{version:'1'},catalog:{version:'2'},deps:[],provenance:{source:'scanner'}})`);
  assert.equal(saved.ok, true);
  assert.equal(saved.savePayload.type, 'SaveStrategy');
  assert.doesNotMatch(fs.readFileSync(RESULTS, 'utf8'), /scanner_.*apply|apply_.*scanner/i);
});
