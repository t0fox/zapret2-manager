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
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
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

function candidate(id, ordinal) {
  return {
    scannerId: id, protocol: 'tcp', ordinal,
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
      udp: { ports: '443', l7: 'quic', payload: 'quic_initial' },
      probeUrl: `https://${req.target}/`,
    },
    catalogDigest: DIGESTS.catalog, compilerDigest: DIGESTS.compiler,
    candidates: [candidate('c1', 1), candidate('c2', 2)],
  };
}

function hooks(stopAfter = null) {
  let probes = 0;
  return {
    plan: plan(),
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
        activate: { ok: true, identityVerified: true, expectedProcess: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, process: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, firewall: { table: 'zapret2', owner: 'scanner/session', ownedRules: ['scanner-rule'] }, nfqueue: { registered: true, peer_portid: 11 } },
        stabilize: [{ ok: true, stable: true }],
        cleanup: [{ ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true }],
      },
      lockRelease: { ok: true }, sessionCleanup: { ok: true, removed: true, verified: true },
    },
    baseline: { protocol: 'tcp', ipv4: { status: 'blocked', available: true }, ipv6: { status: 'skipped', available: false } },
    probe: { hosts: [{ host: 'kernel.org', addressFamily: 'ipv4', tls: { status: 'success', latencyMs: 10, readBytes: 128 }, body: { statusCode: 200, bytesReceived: 70000, kbps: 100, latencyMs: 10 } }] },
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
    assert.equal(result.state.plan, undefined);
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
    assert.equal(resumed.ok, false);
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
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.state.status, 'completed');
    assert.equal(result.state.counts.infrastructure > 0, true);
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

test('CLI responses are schema-versioned and request files are private fixed records', () => {
  const cli = fs.readFileSync(CLI, 'utf8');
    assert.match(cli, /SCHEMA_VERSION\s*=\s*1/);
  assert.match(cli, /mode|request/);
  assert.match(cli, /readlink/);
  assert.match(cli, /uid|mode|private/i);
});
