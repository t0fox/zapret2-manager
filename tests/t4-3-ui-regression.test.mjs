import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const runs = readFileSync(`${root}/z2m-runs.js`, 'utf8');
const page = readFileSync(`${root}/z2m-strategy-page.js`, 'utf8');
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8') + '\n' + readFileSync(`${root}/z2m-components.css`, 'utf8');

test('T4.3: active runs are composed into Strategy', () => {
  assert.match(page, /z2m-runs as Runs/);
  assert.match(page, /Runs\.load\(ctx\)/);
  assert.match(page, /Runs\.render\(ctx/);
  assert.match(page, /Runs\.unmount\(\)/);
});

test('T4.3: active operation exposes bounded attempt and timeout evidence', () => {
  assert.match(runs, /attemptsCompleted/);
  assert.match(runs, /attemptsTotal/);
  assert.match(runs, /durationMs/);
  assert.match(runs, /additionalTimeoutSec:\s*900/);
  assert.match(runs, /boundedText/);
});

test('T4.3: run controls remain explicit and state-gated', () => {
  for (const call of ['runContinue','runPause','runResume','runStop','previewBest','applyBest'])
    assert.match(runs, new RegExp(`api\\.orchestra\\.${call}`));
  assert.match(runs, /run\.phase\s*===\s*['"]completed['"]\s*&&\s*serviceReady\(run\)/);
});

test('T4.3: polling is non-overlapping and stops on auth or detach', () => {
  assert.match(runs, /pollInFlight/);
  assert.match(runs, /pollAuthStopped/);
  assert.match(runs, /root\.isConnected\s*===\s*false/);
  assert.match(runs, /clearTimeout/);
  assert.doesNotMatch(runs, /setInterval/);
});

test('T4.3: run UI is responsive, local and does not use raw HTML', () => {
  assert.match(css, /\.z2m-table-wrap/);
  assert.match(css, /@media/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
  assert.doesNotMatch(runs, /innerHTML/);
});
