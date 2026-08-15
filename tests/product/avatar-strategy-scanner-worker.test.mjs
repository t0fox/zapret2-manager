import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc');
const WORKER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc');
const RECONCILE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
const EXECUTOR = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc');
const ADAPTER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];
const DIGESTS = { catalog: 'c'.repeat(64), compiler: 'd'.repeat(64) };
const CLOSURE = { available: true, structurallyCompilable: true, items: [], missing: [] };
const DEPENDENCY_DIGEST = '5bc433818fda74ede1980fff9b730a2d75b61a3abf773912a1c891127f460dfa';

function invoke(module, expression, env = {}, timeout = 30_000) {
  const source = `import * as subject from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function request(overrides = {}) {
  return { target: 'example.com', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: null, ...overrides };
}

function candidate(id, ordinal, protocol = 'tcp') {
  return {
    scannerId: id, protocol, ordinal,
    compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'],
    compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST,
    dependencyClosure: CLOSURE,
  };
}

function plan(req = request()) {
  return {
    schema: 1, request: req,
    targetProfile: {
      profileKey: 'generic', primaryHost: req.target, testHosts: [req.target],
      hostlistDomains: [req.target], expectedHostlists: [],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '19302', l7: 'stun', payload: 'binding' },
      probeUrl: `https://${req.target}/`,
    },
    catalogDigest: DIGESTS.catalog, compilerDigest: DIGESTS.compiler,
    candidates: [candidate('c1', 1, req.protocol), candidate('c2', 2, req.protocol)],
  };
}

function hooks(stopAfter = null, protocol = 'tcp') {
  let probes = 0;
  return {
    plan: plan(request({ protocol })),
    identity: { pid: 41, startTime: 9001, exe: '/usr/bin/ucode', owner: 'scanner/worker', generation: 1 },
    transient: {
      lock: { held: true, owner: 'config/global' },
      snapshot: {
        ok: true, config: { sha256: '1'.repeat(64), bytes: 'NFQWS2_OPT=old' },
        identity: { id: 'old', origin: 'user', revision: 7, candidateSha256: '2'.repeat(64) },
        runtime: { process: { pid: 10, startTime: 20, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '3'.repeat(64), owner: 'runtime/nfqws2', generation: 4 }, rules: 'old-rules', nfqueue: { registered: true, peer_portid: 10 } },
        firewall: { table: 'zapret2', ownedRules: ['old-rule'], nfqueue: { registered: true, peerPortid: 10 } },
        artifacts: { config: '/opt/zapret2/config', firewall: 'zapret2', nfqueue: 300, temporaryRoot: '/tmp/zapret2-manager/scanner' },
        reconciliation: { generation: 4, reference: 'pre-scan-runtime' },
      },
    compile: { ok: true, candidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencies: CLOSURE, native: { status: 'verified' } },
      runtime: {
        activate: { ok: true, identityVerified: true, expectedProcess: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, process: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, firewall: { table: 'z2m_sc_11111111_22222222_0005_' + '3'.repeat(32), chain: 'z2m_0005_66666666', owner: 'scanner/session', ownerFlagRequested: true, ruleGeneration: 5, qnum: 300, rulesReady: true, activationOrder: 'queue-bound-before-redirect', ownedRules: ['z2m_0005_66666666'] }, nfqueue: { registered: true, peer_portid: 11, queue: 300 } },
        stabilize: [{ ok: true, stable: true }],
        cleanup: [{ ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true }],
      },
      lockRelease: { ok: true }, sessionCleanup: { ok: true, removed: true, verified: true },
    },
    baseline: protocol === 'udp'
      ? { protocol: 'udp', transport: 'stun', status: 'timeout', latencyMs: 4000, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 4100 }
      : { protocol: 'tcp', ipv4: { status: 'blocked', available: true, latencyMs: 10, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 110 }, ipv6: { status: 'skipped', available: false, latencyMs: 0, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 100 } },
    probe: protocol === 'udp'
      ? { transport: 'stun', status: 'success', attempts: 2, mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 180, latencyMs: 80, kbps: 3.2, markerEvidence: [{ name: 'stun', needle: 'mapped' }] }
      : { hosts: [{ host: 'kernel.org', addressFamily: 'ipv4', startedAt: 100, finishedAt: 110, tls: { status: 'success', latencyMs: 10, readBytes: 128, startedAt: 100, finishedAt: 110 }, body: { statusCode: 200, bytesReceived: 70000, kbps: 100, latencyMs: 10, startedAt: 100, finishedAt: 110 } }] },
    reconcile: { ok: true, recovery: { state: 'verified' } },
    controlSequence: stopAfter == null ? [{ stopRequested: false }] : [{ stopRequested: false }, { stopRequested: true }],
  };
}

function storageEnv(root) {
  return { Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_STATE_ROOT: root };
}

function invokeCli(expression, env = {}) {
  return invoke(CLI, expression, env);
}

function adapt(name, ...args) {
  return invoke(ADAPTER, `subject.${name}(${args.map(value => JSON.stringify(value)).join(', ')})`);
}

test('Task 6 modules expose bounded volatile state, worker, and fixed CLI contracts', () => {
  for (const file of [STATE, WORKER, CLI]) assert.equal(fs.existsSync(file), true, file);
  const state = fs.readFileSync(STATE, 'utf8');
  const worker = fs.readFileSync(WORKER, 'utf8');
  const cli = fs.readFileSync(CLI, 'utf8');
  for (const name of ['scanner_state_create', 'scanner_state_load', 'scanner_state_save', 'scanner_control_request'])
    assert.match(state, new RegExp(`export const ${name}\\s*=`));
  assert.match(worker, /export const scanner_worker_run\s*=/);
  for (const name of ['start', 'status', 'results', 'stop', 'resume', 'save-generated']) assert.match(cli, new RegExp(name));
  assert.match(state, /atomic|rename|mv/);
  assert.match(state, /expectedRevision|CAS|generation/);
  assert.match(worker, /startTime|starttime/);
  assert.doesNotMatch(`${state}\n${worker}\n${cli}`, /eval\s|system\s*\(|nft\s+flush|orchestra|dns|luci|router/i);
  assert.doesNotMatch(`${state}\n${worker}\n${cli}`, /write_var|set_var|strategy_user_(create|update|delete)/);
});

test('volatile records are atomic, bounded, CAS-protected, and separate from M5 manager state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-state-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const p = plan(req);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(p)})`, env);
    assert.equal(created.status, 'idle');
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify(created)})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const loaded = invoke(STATE, `subject.scanner_state_load(${JSON.stringify(saved.id)})`, env);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.revision, saved.revision);
    const stale = invoke(STATE, `subject.scanner_state_save(${JSON.stringify({ ...created, id: saved.id, revision: 0, status: 'running' })})`, env);
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, 'ECONFLICT');
    assert.equal(fs.existsSync(path.join(root, 'manager-state.json')), false);
    assert.ok(fs.readdirSync(root).some(name => name.endsWith('.record.json')));
    assert.ok(JSON.stringify(loaded).length < 100_000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('volatile records round-trip scanner double evidence through the native JSON contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-double-state-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const p = plan(req);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(p)})`, env);
    created.results = [{ candidateId: 'c1', ordinal: 1, verdict: 'working', success: true, score: 12.5,
      reason: null, evidence: { infrastructure: false, metrics: { successRate: 0.5, averageKbps: 3.25, averageLatencyMs: 80.5 } },
      planDigest: created.planDigest, evidenceIdentity: 'a'.repeat(64) }];
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify(created)})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const loaded = invoke(STATE, `subject.scanner_state_load(${JSON.stringify(saved.id)})`, env);
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    assert.equal(loaded.state.results[0].score, 12.5);
    assert.equal(loaded.state.results[0].evidence.metrics.averageKbps, 3.25);
    assert.equal(loaded.state.results[0].evidence.metrics.averageLatencyMs, 80.5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker runs one sequential lifecycle with identity, heartbeat, bounded results, and verified reconciliation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-worker-'));
  try {
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-one',request:${JSON.stringify(request())}}, ${JSON.stringify(hooks())})`, storageEnv(root));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.state.status, 'completed');
    assert.equal(result.state.recovery.state, 'verified');
    assert.deepEqual(result.state.results.map(row => row.candidateId), ['c1', 'c2']);
    assert.equal(result.state.progress, 2);
    assert.equal(result.state.currentCandidate, null);
    assert.equal(result.state.worker.pid, 41);
    assert.equal(result.state.worker.startTime, 9001);
    assert.equal(result.state.heartbeatAt != null, true);
    assert.equal(result.state.results[0].evidence.metrics.averageLatencyMs, 10);
    assert.equal(result.state.results[0].evidence.metrics.averageKbps, 100);
    assert.equal(result.state.results[0].evidence.metrics.perProbe[0].startedAt, 100);
    assert.equal(result.state.results[0].evidence.metrics.perProbe[0].finishedAt, 110);
    assert.equal(result.state.plan, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker binds each planned candidate to the active session before activation', () => {
  const worker = fs.readFileSync(WORKER, 'utf8');
  assert.match(worker, /let candidate = plan\.candidates\[i\];/);
  assert.match(worker, /let runtimeCandidate = copy\(candidate\);/);
  assert.match(worker, /runtimeCandidate\.sessionId = session\.sessionId/);
  assert.match(worker, /runtimeCandidate\.generation = session\.generation/);
  assert.match(worker, /runtimeCandidate\.argvNonce/);
  assert.match(worker, /scanner_candidate_activate\(runtimeCandidate, transient\)/);
  assert.match(worker, /let probeCandidate = \{ scannerId: candidate\.scannerId/);
  assert.match(worker, /probe_candidate\(probeCandidate, plan,/);
});

test('worker refuses terminal completion when the required Task 7 reconciliation provider is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-missing-reconcile-'));
  try {
    const testHooks = hooks();
    delete testHooks.reconcile;
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-missing-reconcile',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.notEqual(result.state.status, 'completed');
    assert.notEqual(result.state.status, 'cancelled');
    assert.equal(result.state.recovery.reconciliation.error.code, 'EDEPENDENCY');
    assert.equal(result.state.recovery.sessionCleanup.ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unproven cancellation is published only as error/uncertain after cleanup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-cancel-uncertain-'));
  try {
    const testHooks = hooks(1);
    testHooks.reconcile = { ok: false, error: { code: 'EVERIFY', message: 'restore not proven' } };
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-cancel-uncertain',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.recovery.state, 'uncertain');
    assert.equal(result.state.cancellationRequested, true);
    assert.notDeepEqual({ terminalState: result.state.status, recoveryState: result.state.recovery.state }, { terminalState: 'cancelled', recoveryState: 'uncertain' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stale worker recovery keeps infrastructure failure separate from Strategy verdict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-stale-recovery-'));
  try {
    const record = { worker: { pid: 41, startTime: 9001 }, _session: { sessionId: 'scan-stale-recovery', generation: 5 } };
    const result = invoke(RECONCILE, `subject.scanner_stale_worker_recover(${JSON.stringify(record)},{pid:41,startTime:9001},${JSON.stringify(hooks())})`, storageEnv(root));
    assert.equal(result.status, 'error', JSON.stringify(result));
    assert.equal(result.recovery.worker.state, 'dead', JSON.stringify(result));
    assert.equal(result.recovery.worker.identity.pid, 41);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stop is accepted and honored before the next candidate, while cancellation remains verified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-stop-'));
  try {
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-stop',request:${JSON.stringify(request())}}, ${JSON.stringify(hooks(1))})`, storageEnv(root));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.state.status, 'cancelled');
    assert.equal(result.state.recovery.state, 'verified');
    assert.equal(result.state.results.length, 1);
    assert.equal(result.state.progress, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('control request uses id and revision admission and stale workers cannot resume', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-control-'));
  try {
    const env = storageEnv(root);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(request())}, ${JSON.stringify(plan())})`, env);
    const started = invoke(STATE, `subject.scanner_state_save(${JSON.stringify({ ...created, id:'scan-control', status:'running', phase:'executing', worker:{pid:42,startTime:99,owner:'scanner/worker'}, heartbeatAt:1 })})`, env);
    assert.equal(started.ok, true, JSON.stringify(started));
    const accepted = invoke(STATE, `subject.scanner_control_request('scan-control', 'stop', ${JSON.stringify({ expectedRevision: started.revision })})`, env);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.control.stopRequested, true);
    const stale = invoke(WORKER, `subject.scanner_worker_resume({id:'scan-control',request:${JSON.stringify(request())},catalogDigest:'${DIGESTS.catalog}',compilerDigest:'${DIGESTS.compiler}',planDigest:'${'e'.repeat(64)}'}, { plan:${JSON.stringify(plan())}, identity:{pid:42,startTime:100} })`, env);
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, 'ESTALE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resume rejects a checkpoint whose heartbeat is stale even when identity digests match', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-stale-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const p = plan(req);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(p)})`, env);
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify({ ...created, id:'scan-stale', status:'running', phase:'probing', heartbeatAt:1, worker:{pid:42,startTime:99,owner:'scanner/worker'} })})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const resumed = invoke(WORKER, `subject.scanner_worker_resume({id:'scan-stale',requestDigest:'${saved.state.requestDigest}',catalogDigest:'${saved.state.catalogDigest}',compilerDigest:'${saved.state.compilerDigest}',planDigest:'${saved.state.planDigest}'},{plan:${JSON.stringify(p)},identity:{pid:42,startTime:99}})`, env);
    assert.equal(resumed.ok, false, JSON.stringify(resumed));
    assert.equal(resumed.error.code, 'ESTALE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resume requires exact request, catalog, compiler, plan, and cursor identity', () => {
  const source = fs.readFileSync(WORKER, 'utf8');
  for (const marker of ['requestDigest', 'catalogDigest', 'compilerDigest', 'planDigest', 'cursor', 'stale'])
    assert.match(source, new RegExp(marker));
  const cli = fs.readFileSync(CLI, 'utf8');
  assert.match(cli, /save-generated/);
  assert.match(cli, /EAPPLY|EUNAVAILABLE/);
});

test('CLI start dispatch validates the request and invokes the worker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-cli-start-'));
  try {
    const result = invokeCli(`subject.scanner_cli_dispatch('start', {id:'scan-cli', request:${JSON.stringify(request())}}, ${JSON.stringify(hooks())})`, storageEnv(root));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.state.status, 'completed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker invokes fixed adapters and never fabricates a successful production probe', () => {
  const source = fs.readFileSync(WORKER, 'utf8');
  assert.match(source, /scanner_probe_adapter_baseline/);
  assert.match(source, /scanner_probe_adapter_tcp/);
  assert.match(source, /scanner_probe_adapter_udp/);
  assert.doesNotMatch(source, /raw == null[\s\S]{0,500}status: 'success'/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-no-fake-'));
  try {
    const testHooks = hooks();
    delete testHooks.probe;
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-no-fake',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.error, 'EDEPENDENCY');
    assert.doesNotMatch(JSON.stringify(result.state), /NET_UNREACH|TIMEOUT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('adapter and transient failures preserve cleanup evidence and stop progression', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-cleanup-uncertain-'));
  try {
    const testHooks = hooks();
    testHooks.runtime = { ...testHooks.transient.runtime, activate: { ok: false, code: 'EOWNERSHIP', cleanup: { ok: false, processRemoved: false } } };
    testHooks.transient.runtime = testHooks.runtime;
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-cleanup-uncertain',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.recovery.state, 'uncertain');
    assert.equal(result.state.results.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker lifecycle exceptions publish uncertain infrastructure state and release ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-exception-'));
  try {
    const testHooks = hooks();
    testHooks.transient = null;
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-exception',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.recovery.state, 'uncertain');
    assert.equal(fs.existsSync(path.join(root, 'active.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('claim checkpoint failure releases the active marker even before a record exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-claim-failure-'));
  try {
    const testHooks = hooks();
    testHooks.publishFailureAt = 'claim';
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-claim-failure',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.recovery.activeRelease.ok, true, JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(root, 'active.json')), false);
    const recovery = invoke(STATE, `subject.scanner_state_load('scan-claim-failure')`, storageEnv(root));
    assert.equal(recovery.ok, true, JSON.stringify(recovery));
    assert.equal(recovery.state.recovery.activeRelease.ok, true, JSON.stringify(recovery));
    const second = invoke(WORKER, `subject.scanner_worker_run({id:'scan-claim-failure',request:${JSON.stringify(request())}}, ${JSON.stringify(hooks())})`, storageEnv(root));
    assert.equal(second.ok, true, JSON.stringify(second));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('active release removes the marker so two sequential production-shaped claims succeed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-claim-reuse-'));
  try {
    const env = storageEnv(root);
    const first = invoke(STATE, `subject.scanner_state_claim('scan-first',{pid:2,startTime:1})`, env);
    assert.equal(first.ok, true, JSON.stringify(first));
    const released = invoke(STATE, `subject.scanner_state_release('scan-first',{pid:2,startTime:1})`, env);
    assert.equal(released.ok, true, JSON.stringify(released));
    assert.equal(fs.existsSync(path.join(root, 'active.json')), false);
    const second = invoke(STATE, `subject.scanner_state_claim('scan-second',{pid:3,startTime:2})`, env);
    assert.equal(second.ok, true, JSON.stringify(second));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resume rejects caller-supplied plan identity and malformed checkpoint results', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-resume-authority-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const p = plan(req);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(p)})`, env);
    const checkpoint = { ...created, id: 'scan-authority', status: 'running', phase: 'probing', heartbeatAt: Math.floor(Date.now() / 1000), worker: { pid: 42, startTime: 99, owner: 'scanner/worker' }, cursor: { nextCandidate: 2 }, progress: 2, results: [{ candidateId: 'c1', ordinal: 1, verdict: 'working', success: true }, { candidateId: 'c1', ordinal: 1, verdict: 'working', success: true }] };
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify(checkpoint)})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const resumed = invoke(WORKER, `subject.scanner_worker_resume({id:'scan-authority',requestDigest:'${'0'.repeat(64)}',catalogDigest:'${'0'.repeat(64)}',compilerDigest:'${'0'.repeat(64)}',planDigest:'${'0'.repeat(64)}',plan:${JSON.stringify({})}},{plan:${JSON.stringify(p)},identity:{pid:42,startTime:99}})`, env);
    assert.equal(resumed.ok, false);
    assert.equal(resumed.error.code, 'ESTALE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('active worker claim rejects a second live identity, including the same scan id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-claim-'));
  try {
    const env = storageEnv(root);
    const first = invoke(STATE, `subject.scanner_state_claim('scan-claim',{pid:2,startTime:1})`, env);
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = invoke(STATE, `subject.scanner_state_claim('scan-claim',{pid:2,startTime:1})`, env);
    assert.equal(second.ok, false);
    assert.equal(second.error.code, 'EBUSY');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stop control is idempotent and stale revisions cannot overwrite it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-stop-cas-'));
  try {
    const env = storageEnv(root);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(request())}, ${JSON.stringify(plan())})`, env);
    const started = invoke(STATE, `subject.scanner_state_save(${JSON.stringify({ ...created, id:'scan-stop-cas', status:'running', worker:{pid:42,startTime:99,owner:'scanner/worker'} })})`, env);
    const accepted = invoke(STATE, `subject.scanner_control_request('scan-stop-cas','stop',{expectedRevision:${started.revision}})`, env);
    const repeated = invoke(STATE, `subject.scanner_control_request('scan-stop-cas','stop',{expectedRevision:${started.revision}})`, env);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.deepEqual(repeated.control, accepted.control);
    const stale = invoke(STATE, `subject.scanner_control_request('scan-stop-cas','stop',{expectedRevision:0})`, env);
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, 'ECONFLICT');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('first stop admission is create-if-absent and terminal stop retries compare-publish', () => {
  const source = fs.readFileSync(STATE, 'utf8');
  assert.match(source, /publish_revision\(id, '\.control\.json', control, expected\)/);
  assert.match(source, /expected = loadedControl\.present \? old\.revision : -1/);
  assert.match(source, /retry = scanner_control_load\(id\)/);
  assert.match(source, /publish_revision\('', ACTIVE, marker, expected\)/);
});

test('CLI responses are schema-versioned and request files are private fixed records', () => {
  const cli = fs.readFileSync(CLI, 'utf8');
    assert.match(cli, /SCHEMA_VERSION\s*=\s*1/);
  assert.match(cli, /mode|request/);
  assert.match(cli, /readlink/);
  assert.match(cli, /uid|mode|private/i);
  assert.match(cli, /ancestor|parent|root/i);
});

test('exception after activation runs centralized recovery and retains session, candidate, lock, and release evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-exception-after-activation-'));
  try {
    const testHooks = hooks();
    testHooks.throwAfterActivation = true;
    testHooks.transient.runtime = testHooks.transient.runtime;
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-after-activation',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.recovery.state, 'uncertain');
    assert.equal(result.state.recovery.sessionCleanup != null, true, JSON.stringify(result));
    assert.equal(result.state.recovery.candidateCleanup != null, true, JSON.stringify(result));
    assert.equal(result.state.recovery.lockRelease != null, true, JSON.stringify(result));
    assert.equal(result.state.recovery.activeRelease != null, true, JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(root, 'active.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('terminal finish preserves candidate cleanup evidence while adding terminal recovery evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-evidence-retention-'));
  try {
    const testHooks = hooks();
    testHooks.transient.runtime.cleanup = [{ ok: false, processRemoved: false, firewallRemoved: true, nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true }];
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-evidence-retention',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.recovery.evidence != null, true, JSON.stringify(result));
    assert.equal(result.state.recovery.sessionCleanup != null, true, JSON.stringify(result));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('publish failure stops the worker and records recovery instead of continuing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-publish-failure-'));
  try {
    const testHooks = hooks();
    testHooks.publishFailureAt = 'candidate-result';
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-publish-failure',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.recovery.state, 'uncertain');
    assert.equal(result.state.error != null, true);
    assert.equal(result.state.results.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('terminal checkpoint recovery does not claim durable evidence when recovery publication also fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-terminal-publish-failure-'));
  try {
    const testHooks = hooks();
    testHooks.publishFailureAt = 'terminal';
    testHooks.saveFailureAt = 'terminal-recovery';
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-terminal-publish-failure',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.recovery.state, 'uncertain');
    assert.equal(result.recovery.publication.ok, false, JSON.stringify(result));
    assert.equal(result.recovery.publication.durable, false, JSON.stringify(result));
    assert.equal(result.recovery.publication.retryRequired, true, JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(root, 'active.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('production execution consumes fixed adapter descriptors through the server executor', () => {
  const source = fs.readFileSync(WORKER, 'utf8');
  assert.match(source, /scanner_probe_execute/);
  assert.doesNotMatch(source, /adapted\.ok \? 'PROBE_OBSERVATION_UNAVAILABLE'/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-production-probe-'));
  try {
    const testHooks = hooks();
    delete testHooks.probe;
    testHooks.executor = { ok: true, observations: [{ transport: 'tls', status: 'error', error: 'HOST_UNAVAILABLE' }] };
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-production-probe',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.state.counts.infrastructure > 0, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fixed executor parses real HTTP status/body bytes and latency, and never treats invalid output as success', () => {
  const source = fs.readFileSync(EXECUTOR, 'utf8');
  assert.doesNotMatch(source, /curl/);
  assert.match(source, /native-helper|scanner_probe/);
  assert.doesNotMatch(source, /sh\s+-c|head\s+-c|printf\s+['"]|popen\s*\(/);
  const http = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 204 No Content\\r\\nContent-Length: 0\\r\\n\\r\\n', 1000, 1042)`);
  assert.equal(http.ok, true, JSON.stringify(http));
  assert.equal(http.observation.statusCode, 204);
  assert.equal(http.observation.bytesReceived, 0);
  assert.equal(http.observation.latencyMs, 42);
  const invalid = invoke(EXECUTOR, `subject.scanner_probe_parse_http('not an HTTP response', 1000, 1042)`);
  assert.equal(invalid.ok, false, JSON.stringify(invalid));
  assert.equal(invalid.error.code, 'EINDETERMINATE');
});

test('fixed HTTP parser handles interim responses, chunked framing, and truncated content', () => {
  const interim = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 100 Continue\\r\\n\\r\\nHTTP/1.1 206 Partial Content\\r\\nContent-Length: 5\\r\\nContent-Range: bytes 0-4/5\\r\\n\\r\\nhello', 1000, 1042, ${JSON.stringify({ range: 'bytes=0-4', readLimitBytes: 64, markerScanBytes: 8 })})`);
  assert.equal(interim.ok, true, JSON.stringify(interim));
  assert.equal(interim.observation.statusCode, 206);
  assert.equal(interim.observation.bytesReceived, 5);
  assert.equal(interim.observation.complete, true);
  assert.equal(interim.observation.rangeSatisfied, true);

  const chunked = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n5\\r\\nhello\\r\\n0\\r\\n\\r\\n', 1000, 1042, ${JSON.stringify({ readLimitBytes: 64, markerScanBytes: 8 })})`);
  assert.equal(chunked.ok, true, JSON.stringify(chunked));
  assert.equal(chunked.observation.bytesReceived, 5);
  assert.equal(chunked.observation.complete, true);

  const truncated = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 200 OK\\r\\nContent-Length: 10\\r\\n\\r\\nshort', 1000, 1042, ${JSON.stringify({ readLimitBytes: 64, markerScanBytes: 8 })})`);
  assert.equal(truncated.ok, false, JSON.stringify(truncated));
  assert.equal(truncated.error.code, 'EINDETERMINATE');

  const trailers = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n5\\r\\nhello\\r\\n0\\r\\nX-Trace: ok\\r\\n\\r\\n', 1000, 1042, ${JSON.stringify({ readLimitBytes: 64, markerScanBytes: 8 })})`);
  assert.equal(trailers.ok, true, JSON.stringify(trailers));
  assert.equal(trailers.observation.bytesReceived, 5);

  for (const raw of [
    'HTTP/1.1 200 OK\\r\\nContent-Length: -1\\r\\n\\r\\n',
    'HTTP/1.1 200 OK\\r\\nContent-Length: nope\\r\\n\\r\\n',
    'HTTP/1.1 200 OK\\r\\nContent-Length: 1\\r\\nContent-Length: 2\\r\\n\\r\\nx',
    'HTTP/1.1 200 OK\\r\\nTransfer-Encoding: gzip\\r\\n\\r\\n',
  ]) {
    const invalid = invoke(EXECUTOR, `subject.scanner_probe_parse_http(${JSON.stringify(raw)}, 1000, 1042, ${JSON.stringify({ readLimitBytes: 64 })})`);
    assert.equal(invalid.ok, false, JSON.stringify(invalid));
    assert.equal(invalid.error.code, 'EINDETERMINATE');
  }

	const shortRange = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 206 Partial Content\\r\\nContent-Length: 5\\r\\nContent-Range: bytes 0-3/5\\r\\n\\r\\nhello', 1000, 1042, ${JSON.stringify({ range: 'bytes=0-4', readLimitBytes: 64 })})`);
	assert.equal(shortRange.ok, true, JSON.stringify(shortRange));
	assert.equal(shortRange.observation.rangeSatisfied, false);

  for (const raw of [
    'HTTP/1.1 204 No Content\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n',
    'HTTP/1.1 205 Reset Content\\r\\nContent-Length: 1\\r\\n\\r\\nx',
    'HTTP/1.1 304 Not Modified\\r\\nContent-Length: 0\\r\\nContent-Length: 0\\r\\n\\r\\n',
    'HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n1\\r\\na\\r\\n0\\r\\nX-Trace: one\\r\\nX-Trace: two\\r\\n\\r\\n',
    'HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n1\\r\\na\\r\\n0\\r\\n\\r\\nJUNK',
    'HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n1\\r\\na\\r\\n0\\r\\nX-Trace: one\\r\\n\\r\\nJUNK',
  ]) {
    const invalid = invoke(EXECUTOR, `subject.scanner_probe_parse_http(${JSON.stringify(raw)}, 1000, 1042, ${JSON.stringify({ readLimitBytes: 64 })})`);
    assert.equal(invalid.ok, false, JSON.stringify(invalid));
    assert.equal(invalid.error.code, 'EINDETERMINATE');
  }
});

test('HTTP indeterminate transport is dependency evidence, never candidate failure evidence', () => {
  const executor = fs.readFileSync(EXECUTOR, 'utf8');
  const probes = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc'), 'utf8');
  assert.match(executor, /EINDETERMINATE/);
  assert.doesNotMatch(executor, /body:\s*\{ status: 'failed', error: 'PARSE_ERR'/);
  assert.match(probes, /infrastructure\('INVALID_OBSERVATION'/);
});

test('baseline evidence must include complete family observations before classification', () => {
  const probes = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc'), 'utf8');
  assert.match(probes, /baseline_family_complete/);
  assert.match(probes, /INCOMPLETE_BASELINE/);
});

test('fixed HTTP observations retain configured markers and measured throughput without success fabrication', () => {
  const marker = invoke(EXECUTOR, `subject.scanner_probe_parse_http('HTTP/1.1 200 OK\\r\\nContent-Length: 12\\r\\n\\r\\nblocked page', 1000, 2000, ${JSON.stringify({ readLimitBytes: 64, markerScanBytes: 64, markers: [{ name: 'isp_page', needles: ['blocked page'] }] })})`);
  assert.equal(marker.ok, true, JSON.stringify(marker));
  assert.equal(marker.observation.marker, 'isp_page');
  assert.equal(marker.observation.bytesReceived, 12);
  assert.equal(marker.observation.kbps, 0.1);
  assert.equal(marker.observation.markerEvidence[0].name, 'isp_page');
});

test('fixed executor parses STUN XOR-mapped IPv4 evidence and rejects no-response data', () => {
  const bytes = [1, 1, 0, 12, 33, 18, 164, 66, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 32, 0, 8, 0, 1, 17, 43, 225, 18, 166, 67];
  const packet = `b64dec('AQEADCESpEIBAgMEBQYHCAkKCwwAIAAIAAERK+ESpkM=')`;
  const parsed = invoke(EXECUTOR, `subject.scanner_probe_parse_stun(${packet}, 10, 75)`);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.observation.status, 'success');
  assert.equal(parsed.observation.mappedFamily, 'IPv4');
  assert.equal(parsed.observation.mappedAddress, '192.0.2.1');
  assert.equal(parsed.observation.latencyMs, 65);
  const invalid = invoke(EXECUTOR, `subject.scanner_probe_parse_stun('', 10, 75)`);
  assert.equal(invalid.ok, false, JSON.stringify(invalid));
  assert.equal(invalid.error.code, 'EINDETERMINATE');
});

test('fixed STUN parser requires a binding success response and preserves transaction identity', () => {
  const response = `b64dec('AQEADCESpEIBAgMEBQYHCAkKCwwAIAAIAAERK+ESpkM=')`;
  const wrongType = invoke(EXECUTOR, `subject.scanner_probe_parse_stun(${response}, 10, 75, ${JSON.stringify({ transactionId: '0102030405060708090a0b0c' })}, 0x0111)`);
  assert.equal(wrongType.ok, false, JSON.stringify(wrongType));
  const wrongTransaction = invoke(EXECUTOR, `subject.scanner_probe_parse_stun(${response}, 10, 75, ${JSON.stringify({ transactionId: '0c0b0a090807060504030201' })}, 0x0101)`);
  assert.equal(wrongTransaction.ok, false, JSON.stringify(wrongTransaction));
});

test('worker preserves native executor failure classes instead of inventing network evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-typed-failure-'));
  try {
    const testHooks = hooks();
    delete testHooks.probe;
    testHooks.executor = { ok: false, error: { code: 'EDEPENDENCY', message: 'broker unavailable', stage: 'transport' } };
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-typed-failure',request:${JSON.stringify(request())}}, ${JSON.stringify(testHooks)})`, storageEnv(root));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.state.status, 'error');
    assert.equal(result.state.error, 'EDEPENDENCY');
    assert.doesNotMatch(JSON.stringify(result.state), /NET_UNREACH|TIMEOUT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('executor preserves native helper dependency failures instead of returning unavailable observations', () => {
  const descriptor = { authority: 'scanner-probe-adapter.v1', adapterDigest: '7cd367ef2aed1be2567505bf978b2d2b73f97ff149cc48d64826ed4f2b8c885e',
    targetProfileDigest: 'a'.repeat(64), targetProfile: {}, request: { transport: 'tls', mode: 'quick', host: 'example.com',
      addressFamilies: ['ipv4'], port: 443, portRange: '443', timeoutMs: 100, retries: 1,
      tls: { timeoutMs: 6000, readLimitBytes: 2048 }, deadlineMs: Date.now() + 5000 } };
  const result = invoke(EXECUTOR, `subject.scanner_probe_execute(${JSON.stringify(descriptor)})`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EDEPENDENCY');
});

test('baseline worker descriptor carries the validated request mode and native STUN call carries all fields', () => {
  const worker = fs.readFileSync(WORKER, 'utf8');
  const executor = fs.readFileSync(EXECUTOR, 'utf8');
  assert.match(worker, /baselineProfile\s*=\s*\{ \.\.\.plan\.targetProfile, protocol: req\.protocol \}/);
  assert.match(worker, /scanner_probe_adapter_baseline\(baselineProfile, \{[^}]*mode: req\.mode/);
  assert.match(worker, /scanner_probe_adapter_baseline\(baselineProfile, \{[^}]*cancelToken: record\.id/);
  assert.match(executor, /transport:\s*'stun',[\s\S]*mode:\s*request\.mode[\s\S]*retries:\s*request\.retries[\s\S]*receiveLimitBytes:\s*request\.receiveLimitBytes/);
  assert.doesNotMatch(executor, /scanner_probe_parse_http\(raw, now, int\(time\(\) \* 1000\)/);
  assert.doesNotMatch(executor, /scanner_probe_parse_stun\(raw, now, int\(time\(\) \* 1000/);
});

test('adapter descriptors carry canonical URL/path, host identity, family, and pinned retry/read settings', () => {
  const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com', 'cdn.example.com'],
    probeUrl: 'https://example.com/probe/204', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
     udp: { ports: '443', l7: 'stun', payload: 'binding' } };
  const candidate = { scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) };
  const tcp = adapt('scanner_probe_adapter_tcp', candidate, profile, 'ipv6', { nowMs: 1000, deadlineMs: 20000, mode: 'standard' });
  assert.equal(tcp.ok, true, JSON.stringify(tcp));
  assert.deepEqual(tcp.request.hosts[0], { host: 'example.com', hostIdentity: 'example.com', addressFamily: 'ipv6', port: 443, portRange: '443', url: 'https://example.com/probe/204' });
  assert.equal(tcp.request.hosts[1].url, 'https://cdn.example.com/');
  assert.equal(tcp.request.hosts[1].hostIdentity, 'cdn.example.com');
  assert.equal(tcp.request.retries, 1);
  assert.deepEqual(tcp.request.body.markers, [{ name: 'isp_page', needles: ['blocked', 'access denied', 'captcha'] }]);
  assert.equal(tcp.request.body.minimumBytes, 65536);
  assert.equal(tcp.request.body.readChunkBytes, 4096);
  assert.equal(tcp.request.body.markerScanBytes, 8192);
  assert.equal(tcp.request.mode, 'standard');

  const udp = adapt('scanner_probe_adapter_udp', { ...candidate, protocol: 'udp' }, profile, { nowMs: 1000, deadlineMs: 20000 });
  assert.equal(udp.ok, true, JSON.stringify(udp));
  assert.equal(udp.request.port, 443);
  assert.equal(udp.request.portRange, profile.udp.ports);
  assert.equal(udp.request.transactionId, '0102030405060708090a0b0c');
});

test('planner, adapter, and native descriptor share STUN-only UDP semantics', () => {
  const planner = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc'), 'utf8');
  const adapter = fs.readFileSync(ADAPTER, 'utf8');
  assert.doesNotMatch(planner, /udp:\s*\{[^}]*l7:\s*'quic'[^}]*payload:\s*'quic_initial'/s);
  assert.match(planner, /udp:\s*\{[^}]*l7:\s*'stun'[^}]*payload:\s*'binding'/s);
  assert.match(adapter, /transport:\s*'stun'/);
  assert.doesNotMatch(`${planner}\n${adapter}`, /http3|http\/3|scanner_probe_adapter_quic|scanner_quic_classify/i);
});

test('scanner execution contract rejects shell-shaped descriptors and preserves typed transport status', () => {
  const executor = fs.readFileSync(EXECUTOR, 'utf8');
  assert.doesNotMatch(executor, /TIMEOUT\s*\+|command\s*\(|quote\s*\(|shell/i);
  assert.match(executor, /argv|fixed|deadline/i);
  const adapter = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(adapter, /targetProfileDigest|profileDigest/);
  assert.match(adapter, /markerScanBytes|readLimitBytes|retries|deadlineMs/);
});

test('executor enforces descriptor deadline and rejects caller executable/raw arguments', () => {
  const expired = invoke(EXECUTOR, `subject.scanner_probe_execute({request:{transport:'tls',host:'example.com',deadlineMs:1}})`);
  assert.equal(expired.ok, false);
  assert.equal(expired.error.code, 'EDEPENDENCY');
  const invalid = invoke(EXECUTOR, `subject.scanner_probe_execute({request:{transport:'tls',host:'example.com',deadlineMs:999999999999,executable:'/bin/sh'}})`);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'EDEPENDENCY');
});

test('resume uses retained immutable plan authority when the catalog changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-plan-authority-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const original = plan(req);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(original)})`, env);
    const checkpoint = { ...created, id: 'scan-plan-authority', status: 'running', phase: 'probing', heartbeatAt: Math.floor(Date.now() / 1000), worker: { pid: 42, startTime: 99, owner: 'scanner/worker' }, cursor: { nextCandidate: 1 }, progress: 1, results: [{ candidateId: 'c1', ordinal: 1, verdict: 'working', success: true, score: 1, reason: null, evidence: { infrastructure: false, baselineSuppressed: false, failureClass: null } }], plan: original, planCandidates: original.candidates };
    checkpoint.results[0].planDigest = created.planDigest;
    checkpoint.results[0].evidenceIdentity = invoke(STATE, `subject.scanner_state_digest(${JSON.stringify({ candidateId: 'c1', ordinal: 1, planDigest: created.planDigest, verdict: 'working', success: true, score: 1, reason: null, evidence: checkpoint.results[0].evidence })})`);
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify(checkpoint)})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const changed = { ...original, candidates: [original.candidates[1], original.candidates[0]] };
    const resumed = invoke(WORKER, `subject.scanner_worker_resume({id:'scan-plan-authority'},{plan:${JSON.stringify(changed)},identity:{pid:42,startTime:99},transient:${JSON.stringify(hooks().transient)},baseline:${JSON.stringify(hooks().baseline)},probe:${JSON.stringify(hooks().probe)},reconcile:${JSON.stringify(hooks().reconcile)}})`, env);
    assert.equal(resumed.ok, false, JSON.stringify({ saved: saved.state, resumed }));
    assert.equal(resumed.error.code, 'ESTALE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('terminal stop retry returns the existing terminal control/result rather than ESTATE or CONFLICT', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-terminal-stop-'));
  try {
    const env = storageEnv(root);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(request())}, ${JSON.stringify(plan())})`, env);
    const terminal = invoke(STATE, `subject.scanner_state_save(${JSON.stringify({ ...created, id:'scan-terminal-stop', status:'completed', phase:'completed', finishedAt:1 })})`, env);
    const first = invoke(STATE, `subject.scanner_control_request('scan-terminal-stop','stop',{expectedRevision:${terminal.revision}})`, env);
    const retry = invoke(STATE, `subject.scanner_control_request('scan-terminal-stop','stop',{expectedRevision:${terminal.revision}})`, env);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.deepEqual(retry.control, first.control);
    assert.equal(retry.idempotent, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker preserves scanner verdict score and complete evidence in the ranked row', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-ranking-evidence-'));
  try {
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-ranking-evidence',request:${JSON.stringify(request())}}, ${JSON.stringify(hooks())})`, storageEnv(root));
    assert.equal(result.ok, true, JSON.stringify(result));
    const row = result.state.results[0];
    assert.equal(row.score, 2000);
    assert.equal(row.evidence.metrics.averageLatencyMs, 10);
    assert.equal(row.evidence.metrics.averageKbps, 100);
    assert.equal(row.evidence.metrics.perProbe[0].body.bytesReceived, 70000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resume reuses retained baseline identity without a second baseline executor call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-resume-baseline-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const p = plan(req);
    const baseline = invoke(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc'),
      `subject.scanner_baseline_classify(${JSON.stringify(hooks().baseline)})`);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(p)})`, env);
    const row = { candidateId: 'c1', ordinal: 1, verdict: 'working', success: true, score: 2000, reason: null,
      evidence: { infrastructure: false, baselineSuppressed: false, failureClass: null, metrics: { averageKbps: 100, averageLatencyMs: 10, successRate: 1, perProbe: [] } },
      planDigest: created.planDigest };
    row.evidenceIdentity = invoke(STATE, `subject.scanner_state_digest(${JSON.stringify({ candidateId: row.candidateId, ordinal: row.ordinal, planDigest: row.planDigest, verdict: row.verdict, success: row.success, score: row.score, reason: row.reason, evidence: row.evidence })})`, env);
    const checkpoint = { ...created, id: 'scan-resume-baseline', status: 'running', phase: 'probing',
      heartbeatAt: Math.floor(Date.now() / 1000), worker: { pid: 41, startTime: 9001, owner: 'scanner/worker', generation: 1 },
      cursor: { nextCandidate: 1 }, progress: 1, results: [row], baseline, baselineIdentity: invoke(STATE, `subject.scanner_state_digest(${JSON.stringify(baseline)})`, env), baselineExecutorCalls: 1 };
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify(checkpoint)})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.state.baseline.protocol, 'tcp');
    assert.equal(saved.state.baseline.byAddressFamily.ipv4.status, 'blocked');
    assert.equal(saved.state.planAuthority.candidates.length, 2);
    assert.equal(saved.state.planDigest, created.planDigest);
    const testHooks = hooks();
    testHooks.baseline = null;
    const resumed = invoke(WORKER, `subject.scanner_worker_resume({id:'scan-resume-baseline'},{identity:${JSON.stringify(testHooks.identity)},transient:${JSON.stringify(testHooks.transient)},probe:${JSON.stringify(testHooks.probe)},reconcile:${JSON.stringify(testHooks.reconcile)},executor:${JSON.stringify({ ok: true, observations: [{ hosts: [{ host: 'kernel.org', addressFamily: 'ipv4', startedAt: 100, finishedAt: 110, tls: { status: 'success', latencyMs: 10, readBytes: 128 }, body: { statusCode: 200, bytesReceived: 70000, kbps: 100, latencyMs: 10 } }] }] })},executorCalls:{baseline:1}})`, env);
    assert.equal(resumed.ok, true, JSON.stringify({ loaded: invoke(STATE, `subject.scanner_state_load('scan-resume-baseline')`, env), resumed }));
    assert.equal(resumed.state.baselineExecutorCalls, 1, JSON.stringify(resumed));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resume returns a dependency when the retained baseline is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-resume-no-baseline-'));
  try {
    const env = storageEnv(root);
    const req = request();
    const p = plan(req);
    const created = invoke(STATE, `subject.scanner_state_create(${JSON.stringify(req)}, ${JSON.stringify(p)})`, env);
    const saved = invoke(STATE, `subject.scanner_state_save(${JSON.stringify({ ...created, id: 'scan-resume-no-baseline', status: 'running', heartbeatAt: Math.floor(Date.now() / 1000), worker: { pid: 41, startTime: 9001, owner: 'scanner/worker' } })})`, env);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const resumed = invoke(WORKER, `subject.scanner_worker_resume({id:'scan-resume-no-baseline'},{identity:${JSON.stringify(hooks().identity)}})`, env);
    assert.equal(resumed.ok, false, JSON.stringify(resumed));
    assert.equal(resumed.error.code, 'EDEPENDENCY');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('worker persists complete UDP verdict evidence without collapsing transport fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-udp-evidence-'));
  try {
    const result = invoke(WORKER, `subject.scanner_worker_run({id:'scan-udp-evidence',request:${JSON.stringify(request({ protocol: 'udp' }))}}, ${JSON.stringify(hooks(null, 'udp'))})`, storageEnv(root));
    assert.equal(result.ok, true, JSON.stringify(result));
    const metrics = result.state.results[0].evidence.metrics;
    assert.equal(metrics.protocol, 'udp');
    assert.equal(metrics.attempts, 2);
    assert.equal(metrics.mappedFamily, 'IPv4');
    assert.equal(metrics.bytesReceived, 32);
    assert.equal(metrics.exitCode, 0);
    assert.equal(metrics.signal, 0);
    assert.equal(metrics.startedAt, 100);
    assert.equal(metrics.finishedAt, 180);
    assert.equal(metrics.latencyMs, 80);
    assert.equal(metrics.stunLatencyMs, 80);
    assert.equal(metrics.kbps, 3.2);
    assert.deepEqual(metrics.markerEvidence, [{ name: 'stun', needle: 'mapped' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
