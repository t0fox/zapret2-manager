import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TRANSIENT = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-transient.uc');
const APPLY = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc');
const PROFILES_APPLY = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const RUNTIME_ADAPTER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];
const DEPENDENCY_CLOSURE = { available: true, structurallyCompilable: true, items: [], missing: [] };
const DEPENDENCY_DIGEST = '5bc433818fda74ede1980fff9b730a2d75b61a3abf773912a1c891127f460dfa';

function invoke(expression, env = {}) {
  const source = `import * as subject from ${JSON.stringify(TRANSIENT)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT, env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

const hooks = {
  lock: { held: true, owner: 'config/global' },
  snapshot: { ok: true,
    config: { sha256: '1'.repeat(64), bytes: 'NFQWS2_OPT=old' },
    identity: { id: 'old', origin: 'user', revision: 7, candidateSha256: '2'.repeat(64) },
    runtime: { process: { pid: 10, startTime: 20, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '3'.repeat(64), owner: 'runtime/nfqws2', generation: 4 }, rules: 'old-rules', nfqueue: { registered: true, peer_portid: 10 } },
    firewall: { table: 'zapret2', ownedRules: ['old-rule'], nfqueue: { registered: true, peerPortid: 10 } },
    artifacts: { config: '/opt/zapret2/config', firewall: 'zapret2', nfqueue: 300, temporaryRoot: '/tmp/zapret2-manager/scanner' },
    reconciliation: { generation: 4, reference: 'pre-scan-runtime' },
  },
  compile: { ok: true, candidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencies: DEPENDENCY_CLOSURE, native: { status: 'verified' } },
  runtime: { activate: { ok: true, identityVerified: true, expectedProcess: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, process: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, firewall: { table: 'zapret2', owner: 'scanner/session', ownedRules: ['scanner-rule'] }, nfqueue: { registered: true, peer_portid: 11 } }, stabilize: [{ ok: true, stable: true }], cleanup: [{ ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true }] },
  sessionCleanup: { ok: true, removed: true, verified: true },
};

test('transient Scanner exports only the Task 5 lifecycle and documents the Task 7 boundary', () => {
  const source = fs.readFileSync(TRANSIENT, 'utf8');
  for (const name of ['scanner_session_begin', 'scanner_candidate_activate', 'scanner_candidate_cleanup'])
    assert.match(source, new RegExp(`export const ${name}\\s*=`));
  assert.doesNotMatch(source, /export const scanner_session_restore/);
  assert.match(source, /Task 7 boundary marker/);
  assert.match(source, /ScannerSession/);
  assert.match(source, /CandidateAttempt/);
  assert.match(source, /CleanupEvidence/);
});

test('transient session snapshots once, stays neutral between candidates, and preserves identity', () => {
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [{ scannerId: 'one', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencyClosure: DEPENDENCY_CLOSURE }] })}, ${JSON.stringify(hooks)})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.snapshotCaptures, 1);
  assert.equal(result.originalRestores, 0);
  assert.equal(result.session.state, 'neutral');
  assert.deepEqual(result.preserved, { config: true, identity: true, runtime: true, firewall: true });
  assert.equal(result.attempts[0].cleanup.ok, true);
});

test('candidate failure is distinct from infrastructure failure and does not stop the session', () => {
  const value = { ...hooks, runtime: { ...hooks.runtime, stabilize: [{ ok: true, stable: false, candidateFailure: 'TIMEOUT' }, { ok: true, stable: false, candidateFailure: 'TIMEOUT' }, { ok: true, stable: false, candidateFailure: 'TIMEOUT' }] } };
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [{ scannerId: 'one', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencyClosure: DEPENDENCY_CLOSURE }, { scannerId: 'two', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencyClosure: DEPENDENCY_CLOSURE }] })}, ${JSON.stringify(value)})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.attempts[0].failure.kind, 'candidate');
  assert.equal(result.attempts[1].failure.kind, 'candidate');
});

test('dependency, identity, and cleanup failures fail closed with distinct stages', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencyClosure: DEPENDENCY_CLOSURE };
  const unavailable = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({ ...hooks, compile: { ...hooks.compile, dependencies: { available: false } } })})`);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.kind, 'infrastructure');
  assert.equal(unavailable.error.stage, 'preflight');

  const mismatch = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({ ...hooks, runtime: { ...hooks.runtime, activate: { ...hooks.runtime.activate, process: { ...hooks.runtime.activate.process, argvSha256: 'f'.repeat(64) } } } })})`);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.kind, 'infrastructure');
  assert.equal(mismatch.error.stage, 'identity');

  const cleanup = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [candidate, { ...candidate, scannerId: 'two' }] })}, ${JSON.stringify({ ...hooks, runtime: { ...hooks.runtime, cleanup: [{ ok: false, processRemoved: false }] }, sessionCleanup: { ok: true, removed: true, verified: true } })})`);
  assert.equal(cleanup.ok, false);
  assert.equal(cleanup.error.stage, 'cleanup');
  assert.equal(cleanup.error.code, 'ECLEANUP');
});

test('transient implementation has no direct config writer, scanner config path, nft flush, or caller commands', () => {
  const source = fs.readFileSync(TRANSIENT, 'utf8');
  assert.doesNotMatch(source, /writefile\s*\(|popen\s*\(|system\s*\(|\/opt\/zapret2\/config|nft\s+flush/);
  assert.doesNotMatch(source, /import\s+\{[^}]*set_var|restore_whole_file/);
  assert.match(fs.readFileSync(APPLY, 'utf8'), /export const (?:scanner|transient)_/);
  assert.match(fs.readFileSync(PROFILES_APPLY, 'utf8'), /export const profiles_transient_/);
  assert.match(fs.readFileSync(APPLY, 'utf8'), /flock -n/);
});

test('production transient adapters are real fixed server-owned operations, not unavailable stubs', () => {
  const profiles = fs.readFileSync(PROFILES_APPLY, 'utf8');
  const adapter = fs.readFileSync(RUNTIME_ADAPTER, 'utf8');
  assert.doesNotMatch(profiles, /profiles_transient_(activate|stabilize|cleanup)[\s\S]{0,500}EUNAVAILABLE/);
  assert.match(adapter, /\/opt\/zapret2\/nfq2\/nfqws2/);
  assert.match(adapter, /\/usr\/sbin\/nft/);
  assert.match(adapter, /case \"\$operation\" in/);
  assert.match(adapter, /activate\|stabilize\|cleanup/);
  assert.doesNotMatch(adapter, /eval\s|nft\s+flush\s+ruleset|\$\{[^}]*command|\$\{[^}]*exec|\$\{[^}]*argv/);
});

test('production rejects all injected runtime seams', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencyClosure: DEPENDENCY_CLOSURE };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify(hooks)})`, { Z2M_SCANNER_SERVER_TEST: '0' });
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'input');
  assert.equal(result.error.code, 'EINPUT');
});

test('candidate input rejects raw runtime command, argv, executable, and path fields', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: '5'.repeat(64), command: '/bin/sh' };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify(hooks)})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'input');
  assert.equal(result.error.code, 'EINPUT');
});

test('session snapshot carries restorable artifact references and cleanup order is verified', () => {
  const snapshot = { ...hooks.snapshot,
    runtime: { ...hooks.snapshot.runtime, process: { ...hooks.snapshot.runtime.process, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '3'.repeat(64) } },
    artifacts: { config: '/opt/zapret2/config', firewall: 'zapret2', nfqueue: 300, hostlist: '/tmp/zapret2-manager/scanner/s1/hosts', temporaryRoot: '/tmp/zapret2-manager/scanner/s1' },
    reconciliation: { generation: 4, reference: 'pre-scan:s1' },
  };
  const value = { ...hooks, snapshot, runtime: { ...hooks.runtime, cleanup: [{ ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true, order: ['process', 'firewall', 'nfqueue', 'hostlist', 'temporary-files'] }] } };
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [{ scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST, dependencyClosure: DEPENDENCY_CLOSURE }] })}, ${JSON.stringify(value)})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.attempts[0].cleanup.evidence.order, ['process', 'firewall', 'nfqueue', 'hostlist', 'temporary-files']);
  assert.equal(result.session.snapshot.artifacts.nfqueue, 300);
  assert.equal(result.session.snapshot.reconciliation.reference, 'pre-scan:s1');
  assert.equal(result.session.restored, undefined);
});

test('coordinator does not mutate caller candidate objects while binding session ownership', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const expression = `let candidate = ${JSON.stringify(candidate)}; let before = sprintf('%J', candidate); let result = subject.scanner_session_run(${JSON.stringify({ candidates: [candidate] })}, ${JSON.stringify(hooks)}); print(sprintf('%J', { same: before == sprintf('%J', candidate), result: result }));`;
  const source = `import * as subject from ${JSON.stringify(TRANSIENT)}; ${expression}`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT, env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stderr}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], MODULE_PATTERN)}`);
  assert.equal(JSON.parse(result.stdout).same, true, result.stdout);
});

test('activation failure preserves complete cleanup evidence instead of returning a bare error', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const cleanup = { ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true,
    hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true, evidenceMarker: 'cleanup.v2' };
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [candidate] })}, ${JSON.stringify({
    ...hooks, runtime: { ...hooks.runtime, activate: { ok: false, code: 'EOWNERSHIP', cleanup } }, lockRelease: { ok: true },
  })})`);
  assert.equal(result.ok, false);
  assert.deepEqual(result.cleanup, cleanup);
});

test('stabilization infrastructure failure is cleaned before the session returns', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const cleanup = { ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true,
    hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true, evidenceMarker: 'cleanup.v2' };
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [candidate] })}, ${JSON.stringify({
    ...hooks,
    runtime: { ...hooks.runtime, stabilize: [{ ok: false, code: 'EQUEUE' }], cleanup: [cleanup] }, lockRelease: { ok: true },
  })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'stabilize');
  assert.deepEqual(result.cleanup, { ok: true, cleanup: {
    ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true,
    hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true, evidence: cleanup,
  } });
});

test('compiled preflight must return the exact candidate token stream and digest', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({
    ...hooks, compile: { ...hooks.compile, candidate: '--filter-udp=443', compiledTokens: ['--filter-udp=443'], compiledDigest: 'f'.repeat(64) },
  })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'preflight');
  assert.equal(result.error.code, 'ECONFLICT');
});

test('compiled preflight rejects a seam that omits compiler-owned tokens', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({
    ...hooks, compile: { ...hooks.compile, compiledTokens: undefined },
  })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'preflight');
  assert.equal(result.error.code, 'ECONFLICT');
});

test('compiled preflight rejects an incomplete dependency closure before activation', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: '5'.repeat(64), dependencyClosure: DEPENDENCY_CLOSURE };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({
    ...hooks, compile: { ...hooks.compile, dependencies: { available: true, structurallyCompilable: false, items: [], missing: [{ key: 'blob:x', kind: 'blob', id: 'x', reference: 'x', available: false, reason: 'missing' }] } },
  })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'preflight');
  assert.equal(result.error.code, 'EPREFLIGHT');
});

test('compiled preflight rejects a repeated dependency digest that is not the closure digest', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledCandidate: '--filter-tcp=443', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: '5'.repeat(64), dependencyClosure: DEPENDENCY_CLOSURE };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify(hooks)})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'preflight');
  assert.equal(result.error.code, 'EPREFLIGHT');
});

test('queue ownership mismatch fails closed before candidate cleanup can be claimed', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const activation = { ...hooks.runtime.activate, nfqueue: { registered: true, peer_portid: 99 } };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({ ...hooks, runtime: { ...hooks.runtime, activate: activation } })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'identity');
});

test('firewall ownership mismatch fails closed and refuses owned-only cleanup', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const activation = { ...hooks.runtime.activate, firewall: { table: 'zapret2', owner: 'other/session', ownedRules: ['other-rule'] } };
  const result = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({ ...hooks, runtime: { ...hooks.runtime, activate: activation } })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'identity');
  assert.equal(result.cleanup.ok, false);
});

test('session lock release failure is an infrastructure error with recovery evidence', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a11f88c641d6409c8b02db9f173033440dcb6a08511a9f1b296bd04269ca0550', dependencyDigest: DEPENDENCY_DIGEST };
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [candidate] })}, ${JSON.stringify({
    ...hooks, lockRelease: { ok: false, code: 'ETAMPERED', evidence: { verifiedCleanup: true } }, sessionCleanup: { ok: true, removed: true, verified: true },
  })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'lock');
  assert.equal(result.error.code, 'ELOCKED');
  assert.ok(result.recovery, JSON.stringify(result));
  assert.equal(result.recovery.verifiedCleanup, false);
  assert.deepEqual(result.lockRelease, { ok: false, code: 'ETAMPERED', evidence: { verifiedCleanup: true } });
});

test('snapshot failure retains session cleanup evidence and does not silently release state', () => {
  const result = invoke(`subject.scanner_session_begin(${JSON.stringify({ sessionId: 'snapshot-failure', candidates: [] })}, ${JSON.stringify({
    ...hooks, snapshot: { ok: false, code: 'EIO', evidence: { sessionState: 'locked' } }, lockRelease: { ok: true, evidence: { sessionState: 'removed' } }, sessionCleanup: { ok: true, removed: true, verified: true },
  })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'snapshot');
  assert.ok(result.cleanup, JSON.stringify(result));
  assert.equal(result.cleanup.verifiedCleanup, true);
  assert.equal(result.cleanup.sessionCleanup.ok, true);
});

test('recovery source releases the session lock before adapter session cleanup', () => {
  const source = fs.readFileSync(TRANSIENT, 'utf8');
  assert.match(source, /release_then_session_cleanup/);
  assert.doesNotMatch(source, /profiles_transient_session_cleanup\(session\.sessionId[\s\S]{0,180}profiles_transient_unlock/);
});

test('production firewall cleanup delegates compare-delete to the fixed native owner', () => {
  const source = fs.readFileSync(RUNTIME_ADAPTER, 'utf8');
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /compare_delete/);
  assert.match(source, /ownershipToken/);
  assert.match(source, /expectedChainDigest/);
  assert.doesNotMatch(source, /nft\s+delete\s+chain/);
});
