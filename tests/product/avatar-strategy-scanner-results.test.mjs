import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc');
const SCANNER_CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
const STALE_DUPLICATE = path.join(ROOT, 'files/usr/libexec/zapret2-manager/scanner-results.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const LIBRARY_ARGS = process.env.UCODE_LIBRARY_PATH ? ['-L', process.env.UCODE_LIBRARY_PATH] : [];
const DIGEST = 'a'.repeat(64);

function invoke(expression, env = {}) {
  const source = `import * as subject from ${JSON.stringify(RESULTS)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

function invokeModule(module, expression, env = {}, prelude = '') {
  const source = `${prelude} import * as subject from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

function candidate(id, overrides = {}) {
  return {
    scannerId: id, identityKind: 'catalog', strategyId: id, strategyRevision: 0,
    source: 'catalog', sourcePath: 'advanced/tcp.txt', protocol: 'tcp',
    compiledTokens: ['--filter-tcp=443'], compiledDigest: DIGEST,
    dependencyClosure: { available: true, items: [], missing: [], structurallyCompilable: true },
    dependencyDigest: DIGEST, catalogDigest: DIGEST, compilerDigest: DIGEST,
    ordinal: 1, sourceOrdinal: 1, sectionOrdinal: 1, effectiveOrdinal: 1,
    complexity: [1, 0, 0], recommended: false, fullPreset: true, saveRequired: false,
    ...overrides,
  };
}

function row(candidateId, ordinal, verdict, score, metrics, overrides = {}) {
  return {
    candidateId, ordinal, verdict, success: verdict === 'working', score,
    reason: verdict === 'failed' ? 'candidate_blocked' : null,
    evidence: {
      infrastructure: verdict === 'infrastructure', baselineSuppressed: false,
      failureClass: verdict === 'failed' ? 'candidate_blocked' : verdict === 'infrastructure' ? 'probe_dependency_failure' : null,
      metrics,
    },
    planDigest: DIGEST, evidenceIdentity: DIGEST, ...overrides,
  };
}

test('canonical package source is present and stale duplicate is not authoritative', () => {
  assert.equal(fs.existsSync(RESULTS), true);
  assert.ok(fs.statSync(RESULTS).size > 0, 'canonical scanner-results module must not be empty');
  assert.equal(fs.existsSync(STALE_DUPLICATE), false, 'stale root duplicate must not shadow package source');
});

test('canonical result model preserves identity, evidence, score, and result classes', () => {
  const source = fs.readFileSync(RESULTS, 'utf8');
  for (const name of ['scanner_rank_results', 'scanner_report_build', 'scanner_best_reference', 'scanner_save_generated_validate'])
    assert.match(source, new RegExp(`export const ${name}\\s*=`));

  const rows = [
    row('alpha', 1, 'working', 1, { protocol: 'tcp', successRate: 1, averageKbps: 400, averageLatencyMs: 100, perProbe: [{ host: 'a', latencyMs: 100 }] }),
    row('beta', 2, 'working', 999999, { protocol: 'tcp', successRate: 1, averageKbps: 800, averageLatencyMs: 100, perProbe: [{ host: 'b', latencyMs: 100 }] }),
    row('failed', 3, 'failed', 0, { protocol: 'tcp', successRate: 0, averageKbps: 0, averageLatencyMs: 0, perProbe: [] }),
    row('infra', 4, 'infrastructure', null, { protocol: 'tcp' }),
  ];
  const ranked = invoke(`subject.scanner_rank_results(${JSON.stringify(rows)})`);
  assert.equal(ranked.ok, true, JSON.stringify(ranked));
  assert.deepEqual(ranked.ranked.map(item => item.candidateId), ['beta', 'alpha']);
  assert.deepEqual(ranked.failed.map(item => item.candidateId), ['failed']);
  assert.deepEqual(ranked.infrastructure.map(item => item.candidateId), ['infra']);
  assert.equal(ranked.ranked[0].score, 8000);
  assert.equal(ranked.ranked[0].evidence.metrics.averageKbps, 800);
  assert.equal(ranked.ranked[0].evidence.metrics.perProbe[0].host, 'b');
});

test('UDP scoring uses pinned STUN characterization and adversarial input order', () => {
  const rows = [
    row('slow', 2, 'working', 0, { protocol: 'udp', stunLatencyMs: 250, latencyMs: 250, attempts: 2, mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 1, finishedAt: 251 }),
    row('fast', 1, 'working', 12345, { protocol: 'udp', stunLatencyMs: 50, latencyMs: 50, attempts: 2, mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 1, finishedAt: 51 }),
  ];
  const ranked = invoke(`subject.scanner_rank_results(${JSON.stringify(rows)})`);
  assert.equal(ranked.ok, true, JSON.stringify(ranked));
  assert.deepEqual(ranked.ranked.map(item => item.candidateId), ['fast', 'slow']);
  assert.equal(ranked.ranked[0].score, 20);
  assert.equal(ranked.ranked[1].score, 4);
});

test('malformed and duplicate persisted results are rejected fail-closed', () => {
  const malformed = invoke(`subject.scanner_rank_results(${JSON.stringify([{ candidateId: 'x', ordinal: 1, verdict: 'working', success: false }])})`);
  assert.equal(malformed.ok, false, JSON.stringify(malformed));
  const duplicate = [row('same', 1, 'failed', 0, { protocol: 'tcp' }), row('same', 1, 'failed', 0, { protocol: 'tcp' })];
  const rejected = invoke(`subject.scanner_rank_results(${JSON.stringify(duplicate)})`);
  assert.equal(rejected.ok, false, JSON.stringify(rejected));
  assert.match(rejected.error.code, /^E/);
});

test('report contains baseline, tested/total, success rate, elapsed, and server best reference', () => {
  const catalog = candidate('beta', { ordinal: 2 });
  const state = {
    id: 'scan-1', status: 'completed', startedAt: 100, finishedAt: 145,
    baseline: { protocol: 'tcp', baselineOpen: false, byAddressFamily: { ipv4: { status: 'blocked' } } },
    planAuthority: { candidates: [candidate('alpha'), catalog, candidate('infra', { ordinal: 3,
      identityKind: 'generated', strategyId: null, strategyRevision: null, saveRequired: true,
    })] },
    results: [
      row('alpha', 1, 'failed', 0, { protocol: 'tcp', successRate: 0, averageKbps: 0, averageLatencyMs: 0, perProbe: [] }),
      row('beta', 2, 'working', 1, { protocol: 'tcp', successRate: 1, averageKbps: 200, averageLatencyMs: 100, perProbe: [] }),
      row('infra', 3, 'infrastructure', null, { protocol: 'tcp' }),
    ],
  };
  const report = invoke(`subject.scanner_report_build(${JSON.stringify(state)})`);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.report.tested, 2);
  assert.equal(report.report.total, 3);
  assert.equal(report.report.successRate, 0.5);
  assert.equal(report.report.elapsedMs, 45);
  assert.deepEqual(report.report.baseline, state.baseline);
  assert.equal(report.report.bestReference.strategyId, 'beta');
  assert.equal(report.report.working[0].evidence.metrics.averageKbps, 200);
});

test('existing catalog handoff returns stable identity and generated save reconstructs server-owned payload', () => {
  const generated = candidate('generated:gen-one', {
    identityKind: 'generated', strategyId: null, strategyRevision: null,
    source: 'generator', sourcePath: 'generator', saveRequired: true,
    compiledTokens: ['--filter-tcp=443', '--lua-desync=multisplit:pos=1'],
  });
  const state = { id: 'scan-2', catalogDigest: DIGEST, compilerDigest: DIGEST, planAuthority: { candidates: [generated] } };
  const saved = invoke(`subject.scanner_save_generated_validate({scanId:'scan-2',candidateId:'generated:gen-one',args:['--forged'],compilerDigest:'${'f'.repeat(64)}'}, ${JSON.stringify(state)})`);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.payload.saveRequired, true);
  assert.deepEqual(saved.payload.strategy.profiles[0].args, '--filter-tcp=443 --lua-desync=multisplit:pos=1');
  assert.equal(saved.payload.strategy.profiles[0].args.includes('forged'), false);
  assert.equal(saved.payload.provenance.sourcePath, 'generator');
  const catalog = candidate('catalog-one', { strategyId: 'catalog-one' });
  const rankedCatalog = { ranked: [row('catalog-one', 1, 'working', 1,
    { protocol: 'tcp', successRate: 1, averageKbps: 100, averageLatencyMs: 100, perProbe: [] })] };
  const existing = invoke(`subject.scanner_best_reference(${JSON.stringify(rankedCatalog)}, ${JSON.stringify([catalog])})`);
  assert.equal(existing.strategyId, 'catalog-one');
  const forbidden = invoke(`subject.scanner_save_generated_validate({scanId:'scan-2',candidateId:'catalog-one'}, ${JSON.stringify({ ...state, planAuthority:{ candidates:[catalog] } })})`);
  assert.equal(forbidden.ok, false, JSON.stringify(forbidden));
});

test('CLI Save creates a normal Strategy through the existing create seam from stable identity only', () => {
  const stateRoot = path.join('/tmp', `z2m-scanner-cli-${process.pid}`);
  const generated = candidate('generated:cli-one', {
    identityKind: 'generated', strategyId: null, strategyRevision: null,
    source: 'generator', sourcePath: 'generator', saveRequired: true,
  });
  const state = {
    schema: 1, id: 'scan-cli', revision: 0, request: { target: 'kernel.org', protocol: 'tcp', mode: 'quick' },
    requestDigest: DIGEST, catalogDigest: DIGEST, compilerDigest: DIGEST, planDigest: DIGEST,
    status: 'completed', phase: 'completed', progress: 1, total: 1,
    cursor: { nextCandidate: 1 }, currentCandidate: null, counts: { working: 1, failed: 0, infrastructure: 0 },
    results: [], baseline: null, baselineIdentity: null, baselineExecutorCalls: 1, error: null,
    recovery: { state: 'not_required' }, cancellationRequested: false, worker: null,
    heartbeatAt: 1, startedAt: 1, finishedAt: 2, events: [], planAuthority: { candidates: [generated] },
  };
  const expression = `(function(){ let saved = state.scanner_state_save(${JSON.stringify(state)}); return {saved:saved.ok, result:subject.scanner_cli_dispatch('save-generated',{payload:{scanId:'scan-cli',candidateId:'generated:cli-one',compilerDigest:'${'f'.repeat(64)}',strategy:{id:'forged'}}},{strategyCreate:function(strategy){return {ok:true,strategy:{id:'saved-user',revision:1,name:strategy.name,origin:'user',is_builtin:false,profiles:strategy.profiles}};}})}; })()`;
  const result = invokeModule(SCANNER_CLI, expression, {
    Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_STATE_ROOT: stateRoot,
  }, `import * as state from ${JSON.stringify(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc'))};`);
  assert.equal(result.saved, true, JSON.stringify(result));
  assert.equal(result.result.saved, true, JSON.stringify(result));
  assert.equal(result.result.strategy.id, 'saved-user');
  assert.equal(result.result.preview.strategy_id, 'saved-user');
  fs.rmSync(stateRoot, { recursive: true, force: true });
});
