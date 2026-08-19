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
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
const CATALOG = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];
const CLOSURE = { available: true, structurallyCompilable: true, items: [], missing: [] };
const DEPENDENCY_DIGEST = '5bc433818fda74ede1980fff9b730a2d75b61a3abf773912a1c891127f460dfa';

function invoke(source, env) {
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT, env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

test('save-generated persists a server-owned Strategy and returns the existing handoff identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-handoff-'));
  const strategies = path.join(root, 'strategies');
  fs.mkdirSync(strategies, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  const env = {
    Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_STATE_ROOT: path.join(root, 'scanner'),
    Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_LOCK: path.join(root, 'strategy.lock'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG,
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
  };
  try {
    const request = { target: 'example.com', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: null };
    const plan = { schema: 1, request, targetProfile: {}, catalogDigest: 'c'.repeat(64), compilerDigest: 'd'.repeat(64), candidates: [{
      scannerId: 'generated:gen-one', identityKind: 'generated', strategyId: null, strategyRevision: null,
      saveRequired: true, compiledTokens: ['--filter-tcp=443'], compiledDigest: 'a'.repeat(64),
      dependencyClosure: CLOSURE, dependencyDigest: DEPENDENCY_DIGEST,
    }] };
    const source = `
      import * as state from ${JSON.stringify(STATE)};
      import * as cli from ${JSON.stringify(CLI)};
      let created = state.scanner_state_create(${JSON.stringify(request)}, ${JSON.stringify(plan)});
      created.id = 'scan-handoff'; created.status = 'completed'; created.phase = 'completed';
      created.recovery = { state: 'verified' }; created.finishedAt = time();
      let row = { candidateId: 'generated:gen-one', ordinal: 1, identityKind: 'generated', strategyId: null,
        strategyRevision: null, saveRequired: true, source: 'generator', compiledTokens: ['--filter-tcp=443'],
        dependencyClosure: ${JSON.stringify(CLOSURE)}, compiledDigest: '${'a'.repeat(64)}', dependencyDigest: '${DEPENDENCY_DIGEST}',
        candidateCatalogDigest: '${'c'.repeat(64)}', candidateCompilerDigest: '${'d'.repeat(64)}', verdict: 'working', success: true, score: 2000,
        reason: null, evidence: { infrastructure: false, baselineSuppressed: false, failureClass: null },
        planDigest: created.planDigest };
      row.evidenceIdentity = state.scanner_state_digest({ candidateId: row.candidateId, ordinal: row.ordinal,
        planDigest: row.planDigest, verdict: row.verdict, success: row.success, score: row.score,
        reason: row.reason, evidence: row.evidence });
      created.results = [row]; created.progress = 1; created.total = 1;
      let stored = state.scanner_state_save(created);
      let answer = stored.ok ? cli.scanner_cli_dispatch('save-generated', { scanId: 'scan-handoff', candidateId: 'generated:gen-one' }) : stored;
      print(sprintf('%J', answer));`;
    const answer = invoke(source, env);
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.equal(answer.validated, true);
    assert.equal(answer.strategy.origin, 'user');
    assert.equal(answer.strategy.is_builtin, false);
    assert.equal(answer.strategy.profiles[0].args, '--filter-tcp=443');
    assert.equal(answer.strategy.metadata.source, 'scanner');
    assert.equal(answer.strategy.metadata.scanId, 'scan-handoff');
    assert.equal(answer.strategy.metadata.candidateId, 'generated:gen-one');
    assert.equal(answer.strategy.metadata.compilerDigest, 'd'.repeat(64));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
