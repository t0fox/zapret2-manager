import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-overview-model.js`);

test('missing evidence stays unavailable instead of becoming a fake success', () => {
  const view = model.normalize({});
  assert.equal(view.health.verified, false);
  assert.equal(view.health.kind, 'o');
  assert.equal(view.strategy.name, null);
  assert.equal(view.corpus.opened, null);
  assert.equal(view.corpus.total, null);
  assert.equal(view.corpus.medianLatencyMs, null);
  assert.deepEqual(view.corpus.failedDomains, []);
  assert.equal(view.rollback.available, false);
  assert.doesNotMatch(view.advice.map((item) => item.title).join(' '), /\b61\b/);
});

test('a running process without explicit connectivity is not healthy', () => {
  assert.deepEqual(model.runtimeHealth({
    serviceState: 'running', runtime: { process: { found: true } }
  }), {
    label: 'Служба запущена',
    detail: 'Связность ещё не подтверждена backend',
    kind: 'o', verified: false
  });
});

test('explicit backend verification may produce a healthy verdict', () => {
  const health = model.runtimeHealth({
    serviceState: 'running',
    runtime: { process: { found: true }, connectivity: { verified: true } }
  });
  assert.equal(health.label, 'Обход работает');
  assert.equal(health.kind, 'g');
  assert.equal(health.verified, true);
});

test('latest completed corpus run ignores active and stale snapshots', () => {
  const completed = {
    runId: 'done-2', phase: 'completed', targetType: 'corpus',
    completedAt: '2026-08-04T09:00:00Z'
  };
  assert.deepEqual(model.latestCompletedRun({ runs: [
    { runId: 'active', phase: 'testing', targetType: 'corpus', startedAt: '2026-08-04T10:00:00Z' },
    { runId: 'stale', phase: 'stale', targetType: 'corpus', completedAt: '2026-08-04T09:30:00Z' },
    completed,
    { runId: 'old', phase: 'completed', targetType: 'corpus', completedAt: '2026-08-03T09:00:00Z' }
  ] }), completed);
});

test('corpus metrics use only explicit winner evidence', () => {
  assert.deepEqual(model.corpusMetrics({
    phase: 'completed', targetType: 'corpus', targetCount: 61,
    selectedWinner: {
      successCount: 57, medianLatencyMs: 312,
      failedDomains: ['gog.com', 'ok.ru']
    }
  }), {
    opened: 57, total: 61, medianLatencyMs: 312,
    failedDomains: ['gog.com', 'ok.ru'], percent: 93
  });
});

test('rollback requires explicit availability and snapshot identity', () => {
  assert.equal(model.rollbackInfo({
    strategyState: { active: { candidateId: 'x' } }
  }, {}).available, false);
  assert.deepEqual(model.rollbackInfo({
    strategyState: {
      rollback: { available: true, snapshotId: 'snap-12', label: 'rev12' }
    }
  }, {}), {
    available: true, snapshotId: 'snap-12', label: 'rev12'
  });
});
