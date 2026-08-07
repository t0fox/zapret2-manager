import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyProbeOutcome,
  readinessResult,
  buildCandidateJournal,
  journalCounts,
  statusLabel
} from './lib/probe-journal.mjs';

test('websocket target timeout is a strategy failure, not probe infrastructure failure', () => {
  assert.deepEqual(classifyProbeOutcome({ probe: 'websocket', rc: 28, marker: 'EWEBSOCKET', dependencyReady: true }), {
    class: 'strategy-failure', status: 'failed', reasonCode: 'TARGET_PROBE_FAILED'
  });
  assert.equal(classifyProbeOutcome({ probe: 'https', rc: 66, marker: 'EPROBEDEPENDENCY', dependencyReady: true }).class, 'infrastructure-error');
});

test('readiness reports every dependency without creating a run', () => {
  const ready = readinessResult({ transport: true, scanner: true, curl: true, catalog: true, targets: [true, true, true] });
  assert.deepEqual(ready, { ok: true, status: 'ready', reasonCode: null, dependencies: 4, targetsReady: 3, createsRun: false });
  const missing = readinessResult({ transport: true, scanner: false, curl: true, catalog: true, targets: [true, true, true] });
  assert.equal(missing.status, 'missing-dependency');
  assert.equal(missing.reasonCode, 'SCANNER_MISSING');
  assert.equal(missing.createsRun, false);
});

test('candidate journal keeps failed and infrastructure rows scoped to one run', () => {
  const rows = buildCandidateJournal({ runId: 'or-a', generation: 4, candidateIds: ['c1', 'c2'], results: [
    { candidateId: 'c1', displayName: 'First', verdict: 'target-fail', attempt: 1, targetId: 'web', durationMs: 1200 },
    { candidateId: 'c2', displayName: 'Second', verdict: 'runner-error', attempt: 1, targetId: 'gateway', durationMs: 800 }
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.status), ['failed', 'infrastructure-error']);
  assert.deepEqual(journalCounts(rows), { tested: 2, total: 2, working: 0, failed: 1, infrastructure: 1, remaining: 0 });
  assert.equal(statusLabel('runner-error'), 'Ошибка инфраструктуры');
  assert.equal(buildCandidateJournal({ runId: 'or-b', generation: 5, candidateIds: ['c1'], results: [] })[0].status, 'pending');
});

test('single-view UI renders journal rows and bounded technical details without ranking locally', () => {
  const runs = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js', 'utf8');
  const services = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js', 'utf8');
  assert.match(runs, /candidateJournal/);
  assert.match(runs, /Проверено/);
  assert.match(runs, /Ошибка инфраструктуры/);
  assert.match(runs, /candidateId/);
  assert.match(runs, /boundedText/);
  assert.match(services, /maxCandidates:\s*4/);
  assert.match(services, /maxAttempts:\s*12/);
  assert.match(services, /totalTimeoutSec:\s*180/);
  assert.doesNotMatch(runs, /ranked\.sort\(/);
});
