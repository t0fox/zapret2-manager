import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-strategy-model.js`);

const candidates = [
  {
    id: 'safe-a', name: 'Стратегия A', description: 'Основная стратегия',
    applicable: true, digest: 'a'.repeat(64), argv: '--lua-desync=fake'
  },
  {
    id: 'safe-b', name: 'Стратегия B', description: 'Резервная стратегия',
    applicable: true, digest: 'b'.repeat(64), argv: '--lua-desync=multisplit'
  },
  {
    id: 'blocked', name: 'Недоступная', applicable: false,
    validationMessage: 'Не поддерживается на этом устройстве'
  }
];
const domains = Array.from({ length: 61 }, (_, index) => `service-${index + 1}.example`);
const catalog = model.normalizeCatalog({
  version: 'catalog-1', digest: 'c'.repeat(64), candidates
}, {});
const corpus = model.normalizeCorpus({
  version: 'corpus-61-v1', digest: 'd'.repeat(64), count: 61, domains
});

function completeRun(overrides = {}) {
  return {
    runId: 'run-1', phase: 'completed', targetType: 'corpus',
    totalDomains: 61, testedDomains: 61,
    candidateIds: ['safe-a', 'safe-b'],
    rankedResults: [
      { candidateId: 'safe-a', rank: 1, status: 'working', successCount: 61, targetCount: 61 },
      { candidateId: 'safe-b', rank: 2, status: 'failed', successCount: 50, targetCount: 61,
        failureReason: '11 доменов не прошли' }
    ],
    selectedWinner: { candidateId: 'safe-a', successCount: 61, targetCount: 61 },
    ...overrides
  };
}

test('strategy view exposes five contract tabs and one primary action', () => {
  const view = model.view({ catalog, corpus, run: completeRun() });
  assert.deepEqual(view.tabs, ['strategies', 'progress', 'diagnostics', 'journal', 'settings']);
  assert.equal(view.primaryActions.length, 1);
});

test('basic presentation excludes technical ids and argv', () => {
  const view = model.view({ catalog, corpus, run: completeRun() });
  assert.equal(view.basicText.includes('safe-a'), false);
  assert.equal(view.basicText.includes('--lua-desync'), false);
  assert.equal(view.technical.some((row) => row.id === 'safe-a'), true);
});

test('full corpus request pins exact candidates and corpus identity', () => {
  const result = model.buildFullCorpusRequest(catalog, corpus, {
    acknowledged: true,
    requestId: 'strategy-run-1',
    attempts: 2,
    perAttemptTimeoutSec: 20,
    totalTimeoutSec: 7200
  });
  assert.equal(result.ok, true);
  assert.equal(result.edit.mode, 'full-corpus');
  assert.deepEqual(result.edit.candidateIds, ['safe-a', 'safe-b']);
  assert.equal(result.edit.corpusVersion, 'corpus-61-v1');
  assert.equal(result.edit.corpusDigest, 'd'.repeat(64));
  assert.equal(result.edit.attempts, 2);
});

test('start requires acknowledgement, valid corpus and no active run', () => {
  assert.deepEqual(model.startGate({ catalog, corpus, acknowledged: false }), {
    allowed: false, reason: 'acknowledgement-required'
  });
  assert.deepEqual(model.startGate({ catalog, corpus, acknowledged: true, activeRun: { active: true } }), {
    allowed: false, reason: 'active-run'
  });
  assert.equal(model.startGate({ catalog, corpus, acknowledged: true }).allowed, true);
});

test('progress is complete only after all 61 domains', () => {
  const partial = model.normalizeRun(completeRun({ testedDomains: 60 }), catalog, corpus);
  const complete = model.normalizeRun(completeRun(), catalog, corpus);
  assert.equal(model.progress(partial, corpus).totalDomains, 61);
  assert.equal(model.progress(partial, corpus).complete, false);
  assert.equal(complete.complete, complete.testedDomains === 61);
});

test('pending compact rows and failed candidates remain visible', () => {
  const run = model.normalizeRun({
    runId: 'run-2', phase: 'running', totalDomains: 61, testedDomains: 12,
    candidateIds: ['safe-a', 'safe-b'],
    candidateJournal: [
      { candidateId: 'safe-a', status: 'testing' },
      { candidateId: 'safe-b', status: 'failed', failureReason: 'timeout' }
    ]
  }, catalog, corpus);
  assert.equal(run.candidates.find((row) => row.id === 'safe-a').testing, true);
  assert.equal(run.candidates.find((row) => row.id === 'safe-b').failed, true);
  assert.equal(run.strategyFailures.length, 1);
});

test('infrastructure failures remain separate from strategy failures', () => {
  const run = model.normalizeRun({
    runId: 'run-3', phase: 'infrastructure-error',
    candidateJournal: [
      { candidateId: 'safe-a', status: 'runner-error', reason: 'dns unavailable' },
      { candidateId: 'safe-b', status: 'failed', reason: 'strategy mismatch' }
    ]
  }, catalog, corpus);
  assert.equal(run.infrastructureFailures.length, 1);
  assert.equal(run.strategyFailures.length, 1);
});

test('winner enters the global semantic draft only after complete run', () => {
  const complete = model.normalizeRun(completeRun(), catalog, corpus);
  const staged = model.stageWinner(complete, catalog, 'safe-b');
  assert.equal(staged.ok, true);
  assert.equal(staged.draft.candidateId, 'safe-a');
  assert.equal(staged.draft.appliedCandidateId, 'safe-b');
  assert.equal(staged.draft.sourceRunId, 'run-1');

  const partial = model.normalizeRun(completeRun({ testedDomains: 60 }), catalog, corpus);
  assert.deepEqual(model.stageWinner(partial, catalog, 'safe-b'), {
    ok: false, reason: 'incomplete-run'
  });
});

test('terminal missing-run snapshots remain historical instead of active', () => {
  const run = model.normalizeRun({
    runId: 'gone', phase: 'stale', testedDomains: 20, totalDomains: 61,
    error: { code: 'ENOENT', message: 'run not found' }
  }, catalog, corpus);
  assert.equal(run.active, false);
  assert.equal(run.terminal, true);
  assert.equal(run.complete, false);
});
