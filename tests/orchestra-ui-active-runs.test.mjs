import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const runsPath = `${root}/z2m-runs.js`;
const pagePath = `${root}/z2m-strategy-page.js`;

test('run controller is composed into the Strategy page', () => {
  assert.equal(fs.existsSync(runsPath), true);
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /z2m-runs as Runs/);
  assert.match(page, /Runs\.load\(ctx\)/);
  assert.match(page, /Runs\.render\(ctx/);
  assert.match(page, /Runs\.unmount\(\)/);
});

test('external active run and history are discovered during read-only load', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  const start = ui.indexOf('function load(');
  const end = ui.indexOf('\nfunction refreshHistory(', start);
  const load = ui.slice(start, end);
  assert.match(load, /api\.orchestra\.runStatus/);
  assert.match(load, /api\.orchestra\.runHistory/);
  assert.doesNotMatch(load, /runStart|runContinue|runPause|runResume|runStop|applyBest/);
});

test('run envelopes are normalized and invalid responses remain visible', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /function normalizeRunResponse/);
  assert.match(ui, /invalid-run-response/);
  assert.match(ui, /Не удалось загрузить результаты запуска/);
  assert.match(ui, /structuredError/);
});

test('active detail, history selection and upsert are keyed by run id', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /selectedRunId/);
  assert.match(ui, /selectedByUser/);
  assert.match(ui, /row\.runId\s*!==\s*summary\.runId/);
  assert.match(ui, /rows\.unshift\(summary\)/);
});

test('candidate journal renders bounded technical details without local ranking', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /candidateJournal/);
  assert.match(ui, /Проверено/);
  assert.match(ui, /Ошибка инфраструктуры/);
  assert.match(ui, /candidateId/);
  assert.match(ui, /boundedText/);
  assert.doesNotMatch(ui, /\.sort\s*\([^)]*score|ranked\.sort/);
});

test('target progress renders tested totals and winner or no-winner state', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /targetProgress/);
  assert.match(ui, /testedCandidateIds/);
  assert.match(ui, /tested\s*\+\s*['"] \/ ['"]\s*\+\s*total/);
  assert.match(ui, /winner|no-winner/);
});

test('continue sends only run id and bounded additional timeout', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /api\.orchestra\.runContinue/);
  assert.match(ui, /runId:\s*run\.runId/);
  assert.match(ui, /additionalTimeoutSec:\s*900/);
  const continueBlock = ui.slice(ui.indexOf('function continueRun('), ui.indexOf('\nfunction pauseRun('));
  assert.doesNotMatch(continueBlock, /candidateId|profile|configuration/);
});

test('pause resume stop and service apply are capability and state gated', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /api\.orchestra\.runPause/);
  assert.match(ui, /api\.orchestra\.runResume/);
  assert.match(ui, /api\.orchestra\.runStop/);
  assert.match(ui, /api\.orchestra\.previewBest/);
  assert.match(ui, /api\.orchestra\.applyBest/);
  assert.match(ui, /run\.phase\s*===\s*['"]completed['"]\s*&&\s*serviceReady\(run\)/);
});

test('polling is non-overlapping, timeout-aware and uses bounded backoff', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /pollInFlight/);
  assert.match(ui, /if\s*\(state\.pollInFlight\)\s*return/);
  assert.match(ui, /setTimeout/);
  assert.doesNotMatch(ui, /setInterval/);
  assert.match(ui, /5000\s*:\s*state\.pollFailures\s*===\s*2\s*\?\s*10000\s*:\s*30000/);
  assert.match(ui, /последнее успешное состояние|last successful state/i);
});

test('successful polling resets delay, auth errors stop retries and terminal state refreshes history once', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /state\.pollFailures\s*=\s*0/);
  assert.match(ui, /state\.pollDelay\s*=\s*2000/);
  assert.match(ui, /authError/);
  assert.match(ui, /pollAuthStopped\s*=\s*true/);
  assert.match(ui, /Сессия истекла/);
  assert.match(ui, /terminalRun/);
  assert.match(ui, /refreshHistory/);
  assert.match(ui, /terminalHistoryRefreshed/);
});

test('unmount clears timer and prevents detached polling', () => {
  const ui = fs.readFileSync(runsPath, 'utf8');
  assert.match(ui, /function unmount/);
  assert.match(ui, /clearTimeout/);
  assert.match(ui, /disposed\s*=\s*true/);
  assert.match(ui, /root\.isConnected\s*===\s*false/);
});
