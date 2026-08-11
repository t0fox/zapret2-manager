import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const MANIFEST = path.join(CATALOG_ROOT, 'manifest.json');
const EXPECTED_MANIFEST = path.join(ROOT, 'tests/fixtures/avatar-strategy/manifest.expected.json');
const CATALOG = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const APPLY = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const STATUS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-status.uc');
const RPC = path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const ACL = path.join(ROOT, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const PAGE = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js');
const PAGE_ADAPTER = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js');
const WORKFLOW_CORE = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow-core.js');
const MAKEFILE = path.join(ROOT, 'zapret2-manager/Makefile');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const HASH = 'a'.repeat(64);
const OLD_CONFIG_HASH = 'c'.repeat(64);
const NEW_CONFIG_HASH = 'd'.repeat(64);
const CANDIDATE = '--filter-tcp=443';
const CANDIDATE_HASH = createHash('sha256').update(CANDIDATE).digest('hex');

const read = file => fs.readFileSync(file, 'utf8');
const manifest = JSON.parse(read(MANIFEST));
const expectedManifest = JSON.parse(read(EXPECTED_MANIFEST));

function invoke(module, expression, env = {}) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

function runtimeChecks(value) {
  return { processPresent: value, singleInstance: value, rulesPresent: value,
    queueRegistered: value, ownerMatch: value };
}

function transactionHook(overrides = {}) {
  const { state: stateOverrides = {}, ...transactionOverrides } = overrides;
  return JSON.stringify({
    state: { strategy_apply_revalidate: { ok: true }, strategy_selection_apply: { ok: true }, ...stateOverrides },
    transaction: {
      currentOpt: '--filter-tcp=80',
      preflight: { status: 'verified', coverage: {
        cliSyntax: 'passed', luaLoad: 'passed', luaCompatibility: 'passed',
        functionExistence: 'passed', blobExistence: 'passed', runtimeArguments: 'passed',
        executionPlan: 'passed',
      }, diagnostics: [] },
      snapshot: { configBytes: 'old-config', configSha256: OLD_CONFIG_HASH, uciBytes: '', uciSha256: null },
      cas: { ok: true, configSha256: NEW_CONFIG_HASH },
      restart: [{ rc: 0, out: '' }, { rc: 0, out: '' }],
      verify: [{ ok: true, checks: runtimeChecks(true) }, { ok: true, checks: runtimeChecks(true) }],
      rollback: { restoreOk: true, configBytes: 'old-config', configSha256: OLD_CONFIG_HASH },
      configHash: OLD_CONFIG_HASH, candidateHash: HASH,
      ...transactionOverrides,
    },
    candidate: { ok: true, candidate: CANDIDATE, digest: CANDIDATE_HASH, profilesCount: 1,
      dependencies: { available: true }, nativeValidation: { status: 'verified', coverage: {
        cliSyntax: 'passed', luaLoad: 'passed', luaCompatibility: 'passed',
        functionExistence: 'passed', blobExistence: 'passed', runtimeArguments: 'passed',
        executionPlan: 'passed',
      }, diagnostics: [] } },
  });
}

function storage(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-avatar-integration-'));
  const strategies = path.join(root, 'strategies');
  const runtime = path.join(root, 'runtime');
  const lastGood = path.join(runtime, 'last-good');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.mkdirSync(lastGood, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(strategies, 'pinned-id.json'), JSON.stringify({
    schema: 1, id: 'pinned-id', revision: 1, name: 'Pinned Strategy',
    origin: 'user', is_builtin: false, metadata: { description: 'integration' },
    profiles: [{ id: 'p1', name: 'Pinned Profile', args: CANDIDATE, enabled: true }], updatedAt: 1,
  }), { mode: 0o600 });
  const env = {
    Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(runtime, 'reconciliation.json'),
    Z2M_STRATEGY_APPLY_UNCERTAIN: path.join(runtime, 'uncertain.json'),
    Z2M_STRATEGY_APPLY_LASTGOOD: lastGood,
    Z2M_STRATEGY_APPLY_BLOCK: path.join(lastGood, 'apply-block.json'),
    Z2M_STRATEGY_APPLY_LEASE: path.join(lastGood, 'apply-lease.json'),
    Z2M_STRATEGY_CONFIG_LOCK: path.join(runtime, 'config.lock'),
    Z2M_STRATEGY_PROFILE_MODULE: APPLY,
    Z2M_STRATEGY_PROFILE_CLI: path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply-cli.uc'),
    Z2M_STRATEGY_STATE_MODULE: STATE,
    Z2M_STRATEGY_UCODE_BIN: UCODE_BIN,
    Z2M_STRATEGY_LOCK: path.join(runtime, 'strategy.lock'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
  };
  fs.writeFileSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, JSON.stringify({ schema: 1, extensions: [] }), { mode: 0o644 });
  fs.writeFileSync(env.Z2M_STRATEGY_STATE, JSON.stringify({ schema: 1, revision: 0, favorites: [], selected: null }), { mode: 0o600 });
  try { return callback({ root, strategies, runtime, env }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function runStrategyFlow(env) {
  const strategy = { id: 'pinned-id', name: 'Pinned Strategy', profiles: [{ id: 'p1', args: CANDIDATE }] };
  const context = {
    environment: { listMode: 'none', functions: { fake: { present: true } }, blobs: { fake_default_tls: { present: true } }, lua: { 'desync.lua': { present: true } }, lists: {} },
    runtimeInputs: { source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2', baseArgs: [], luaInit: [], hostlists: [] },
  };
  const input = { strategy_id: 'pinned-id', revision: 1, catalog_digest: manifest.aggregateDigest };
  const preview = invoke(CLI, `mod.strategy_cli_dispatch('preview', ${JSON.stringify({ strategy_data: strategy })}, ${JSON.stringify(context)})`, env);
  const validate = invoke(CLI, `mod.strategy_cli_dispatch('validate', ${JSON.stringify(input)}, ${JSON.stringify(context)})`, env);
  const apply = invoke(CLI, `mod.strategy_cli_dispatch('apply', ${JSON.stringify(input)})`, {
    ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook(),
  });
  const selected = { revision: 1, selected: apply.strategy,
    digest: manifest.aggregateDigest, identity: { name: 'Pinned Strategy' } };
  const status = invoke(STATUS, `mod.derive_strategy_status(${JSON.stringify(selected)}, ${JSON.stringify({ configSha256: NEW_CONFIG_HASH, appliedConfigSha256: NEW_CONFIG_HASH, candidateSha256: CANDIDATE_HASH })}, ${JSON.stringify({ present: true, rulesPresent: true, count: 1 })})`, env);
  return { preview, validate, apply, status: { strategy: status }, selected };
}

test('Strategy identity survives catalog -> Preview -> Validate -> Apply -> status', () => storage(({ env }) => {
  const result = runStrategyFlow(env);
  assert.equal(result.preview.ok, true);
  assert.equal(result.preview.profiles_count >= 0, true);
  assert.equal(result.validate.strategyId, 'pinned-id');
  assert.equal(result.validate.error.code, 'EPREFLIGHT');
  assert.equal(result.apply.ok, true, JSON.stringify(result.apply));
  assert.equal(result.status.strategy.id, 'pinned-id');
  assert.equal(result.status.strategy.drift, false);
  assert.equal(result.selected.selected.id, 'pinned-id');
}));

test('rollback and identity reconciliation preserve the authoritative selection boundary', () => storage(({ env }) => {
  const rollback = invoke(APPLY, `mod.profiles_apply_candidate(${JSON.stringify(CANDIDATE)}, ${JSON.stringify(CANDIDATE_HASH)}, null)`, {
    ...env, Z2M_STRATEGY_APPLY_HOOK: transactionHook({
      restart: [{ rc: 1, out: 'restart failed' }, { rc: 0, out: '' }],
      verify: [{ ok: false, checks: runtimeChecks(false) }, { ok: true, checks: runtimeChecks(true) }],
    }),
  });
  assert.equal(rollback.ok, false);
  assert.equal(rollback.rolledBack, true);

  const oldIdentity = { id: 'pinned-id', origin: 'user', revision: 1, candidateSha256: HASH };
  const newIdentity = { ...oldIdentity, candidateSha256: 'b'.repeat(64) };
  assert.equal(invoke(STATE, `mod.strategy_selection_apply({expectedRevision:0,selected:${JSON.stringify(oldIdentity)}})`, env).ok, true);
  assert.equal(invoke(STATE, `mod.strategy_apply_uncertain_record(${JSON.stringify({
    oldConfigSha256: OLD_CONFIG_HASH, newConfigSha256: NEW_CONFIG_HASH,
    oldCandidateSha256: HASH, newCandidateSha256: newIdentity.candidateSha256,
    catalogDigest: manifest.aggregateDigest, oldIdentity, newIdentity,
    runtimeOutcome: { initial: runtimeChecks(false), rollback: runtimeChecks(false), restartRc: 1,
      rollbackRestartRc: 1, configRestored: false, identityRestored: false }, reason: 'integration',
  })})`, env).ok, true);
  const reconciled = invoke(STATE, `mod.strategy_apply_reconcile(${JSON.stringify({
    evidenceMarker: 'z2m-authoritative-reconcile.v1', currentConfigSha256: OLD_CONFIG_HASH,
    activeCandidateSha256: HASH, runtimeChecks: runtimeChecks(true),
  })})`, env);
  assert.deepEqual(reconciled, { ok: true, reconciled: 'old', selected: oldIdentity });
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_APPLY_UNCERTAIN), false);
}));

test('catalog digest, duplicate winner, protocol sets, package assets, and import are one pinned boundary', () => {
  const catalog = invoke(CATALOG, `mod.strategy_catalog_load(${JSON.stringify(CATALOG_ROOT)})`).catalog;
  assert.equal(catalog.aggregateDigest, expectedManifest.aggregateDigest);
  assert.equal(catalog.winners.z2k_all_in_one.winner, true);
  assert.equal(catalog.winners.z2k_all_in_one.id, 'z2k_all_in_one');
  for (const protocol of ['tcp', 'udp']) {
    for (const set of ['quick', 'standard', 'full']) {
      assert.deepEqual(catalog[protocol][set], expectedManifest.sets[protocol][set]);
      assert.equal(new Set(catalog[protocol][set]).size, catalog[protocol][set].length);
    }
  }
  assert.equal(manifest.physicalFileCount, 23);
  assert.deepEqual(fs.readdirSync(CATALOG_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), ['advanced', 'basic', 'builtin', 'direct']);
  for (const file of expectedManifest.files) {
    const asset = path.join(CATALOG_ROOT, ...file.path.split('/'));
    assert.equal(fs.statSync(asset).mode & 0o777, 0o644, file.path);
    assert.equal(createHash('sha256').update(fs.readFileSync(asset)).digest('hex'), file.sha256, file.path);
  }
  const draft = { schema: 1, profiles: [{ id: 'p1', name: 'Imported', opt: '--filter-tcp=443' }] };
  const cliSource = read(CLI);
  const importSource = cliSource.slice(cliSource.indexOf('function import_diagnostic'), cliSource.indexOf('function catalog_root'));
  assert.match(cliSource, /strategy_import_profiles_from_state/);
  assert.doesNotMatch(importSource, /save_state|profiles_apply_candidate\(|NFQWS2_OPT/);
  const imported = invoke(CLI, `mod.strategy_import_profiles_from_state(${JSON.stringify(draft)}, {mode:'preview'})`);
  assert.equal(imported.ok, true);
  assert.equal(imported.runtimeMutation, false);
  assert.deepEqual(imported.strategy.profiles.map(profile => profile.args), ['--filter-tcp=443']);
});

test('RPC, ACL, UI reachability, schema 3, and out-of-scope boundaries remain explicit', () => {
  const rpc = read(RPC);
  const acl = JSON.parse(read(ACL))['zapret2-manager'];
  const page = read(PAGE);
  const adapter = read(PAGE_ADAPTER);
  const workflowCore = read(WORKFLOW_CORE);
  const cli = read(CLI);
  const statusCompat = read(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc'));
  const methods = ['strategies_list', 'strategies_get', 'strategies_preview', 'strategies_validate', 'strategies_apply', 'strategies_catalog_status', 'strategies_catalog_reload', 'strategies_import_profiles'];
  for (const method of methods) assert.match(rpc, new RegExp(`\\b${method}:\\s*\\{`), method);
  for (const method of ['strategies_create', 'strategies_update', 'strategies_delete', 'strategies_duplicate', 'strategies_favorite', 'strategies_apply', 'strategies_import_profiles'])
    assert.ok(acl.write.ubus['zapret2-manager'].includes(method), method);
  assert.match(page, /ctx\.api\.strategies\.list/);
  assert.match(page, /ctx\.api\.service\.status/);
  assert.match(page, /Compatibility|Advanced/);
  assert.match(workflowCore, /Compatibility \/ Profiles/);
  assert.match(workflowCore, /indexOf\(state\.tab\) < 0/);
  assert.match(adapter, /mode === 'workflow'/);
  assert.match(statusCompat, /schema\s*:\s*3/);
  assert.doesNotMatch(page, /ctx\.api\.orchestra/);
  assert.doesNotMatch(rpc, /strategy.*Orchestra|ORCH_CLI.*STRATEGY/i);
  assert.doesNotMatch(cli, /schema\s*[:=]\s*4|Scanner|catalog_updater|online updater|router migration/i);
  assert.doesNotMatch(page, /DNS migration|router migration|online updater/i);
  assert.doesNotMatch(MAKEFILE, /catalogs\/presets compatibility tree/);
});
