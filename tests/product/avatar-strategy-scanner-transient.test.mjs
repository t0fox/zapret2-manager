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
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];

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
    firewall: { table: 'zapret2', ownedRules: ['old-rule'] },
  },
  compile: { ok: true, candidate: '--filter-tcp=443', compiledDigest: '4'.repeat(64), dependencyDigest: '5'.repeat(64), dependencies: { available: true }, native: { status: 'verified' } },
  runtime: { activate: { ok: true, identityVerified: true, expectedProcess: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, process: { pid: 11, startTime: 21, exe: '/opt/zapret2/nfq2/nfqws2', argvSha256: '6'.repeat(64), owner: 'scanner/session', generation: 5 }, firewall: { table: 'zapret2', owner: 'scanner/session', ownedRules: ['scanner-rule'] }, nfqueue: { registered: true, peer_portid: 11 } }, stabilize: [{ ok: true, stable: true }], cleanup: [{ ok: true, processRemoved: true, firewallRemoved: true, nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true, ownedOnly: true }] },
};

test('transient Scanner exports typed session and candidate lifecycle entry points', () => {
  const source = fs.readFileSync(TRANSIENT, 'utf8');
  for (const name of ['scanner_session_begin', 'scanner_candidate_activate', 'scanner_candidate_cleanup'])
    assert.match(source, new RegExp(`export const ${name}\\s*=`));
  assert.match(source, /ScannerSession/);
  assert.match(source, /CandidateAttempt/);
  assert.match(source, /CleanupEvidence/);
});

test('transient session snapshots once, stays neutral between candidates, and preserves identity', () => {
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [{ scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: '4'.repeat(64), dependencyDigest: '5'.repeat(64) }] })}, ${JSON.stringify(hooks)})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.snapshotCaptures, 1);
  assert.equal(result.originalRestores, 0);
  assert.equal(result.session.state, 'neutral');
  assert.deepEqual(result.preserved, { config: true, identity: true, runtime: true, firewall: true });
  assert.equal(result.attempts[0].cleanup.ok, true);
});

test('candidate failure is distinct from infrastructure failure and does not stop the session', () => {
  const value = { ...hooks, runtime: { ...hooks.runtime, stabilize: [{ ok: true, stable: false, candidateFailure: 'TIMEOUT' }, { ok: true, stable: false, candidateFailure: 'TIMEOUT' }, { ok: true, stable: false, candidateFailure: 'TIMEOUT' }] } };
  const result = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [{ scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: '4'.repeat(64), dependencyDigest: '5'.repeat(64) }, { scannerId: 'two', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: '4'.repeat(64), dependencyDigest: '5'.repeat(64) }] })}, ${JSON.stringify(value)})`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.attempts[0].failure.kind, 'candidate');
  assert.equal(result.attempts[1].failure.kind, 'candidate');
});

test('dependency, identity, and cleanup failures fail closed with distinct stages', () => {
  const candidate = { scannerId: 'one', protocol: 'tcp', compiledTokens: ['--filter-tcp=443'], compiledDigest: '4'.repeat(64), dependencyDigest: '5'.repeat(64) };
  const unavailable = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({ ...hooks, compile: { ...hooks.compile, dependencies: { available: false } } })})`);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.kind, 'infrastructure');
  assert.equal(unavailable.error.stage, 'preflight');

  const mismatch = invoke(`subject.scanner_candidate_activate(${JSON.stringify(candidate)}, ${JSON.stringify({ ...hooks, runtime: { ...hooks.runtime, activate: { ...hooks.runtime.activate, process: { ...hooks.runtime.activate.process, argvSha256: 'f'.repeat(64) } } } })})`);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.kind, 'infrastructure');
  assert.equal(mismatch.error.stage, 'identity');

  const cleanup = invoke(`subject.scanner_session_run(${JSON.stringify({ candidates: [candidate, { ...candidate, scannerId: 'two' }] })}, ${JSON.stringify({ ...hooks, runtime: { ...hooks.runtime, cleanup: [{ ok: false, processRemoved: false }] } })})`);
  assert.equal(cleanup.ok, false);
  assert.equal(cleanup.error.stage, 'cleanup');
  assert.equal(cleanup.error.code, 'ECLEANUP');
});

test('transient implementation has no direct config writer, scanner config path, nft flush, or caller commands', () => {
  const source = fs.readFileSync(TRANSIENT, 'utf8');
  assert.doesNotMatch(source, /writefile\s*\(|\/opt\/zapret2\/config|nft\s+flush|\b(?:shell|command|executable|argv|args|rawCommand)\b/);
  assert.doesNotMatch(source, /import\s+\{[^}]*set_var|restore_whole_file/);
  assert.match(fs.readFileSync(APPLY, 'utf8'), /export const (?:scanner|transient)_/);
  assert.match(fs.readFileSync(PROFILES_APPLY, 'utf8'), /export const profiles_transient_/);
});
