import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const auto = readFileSync(`${root}/z2m-auto.js`, 'utf8');
const runs = readFileSync(`${root}/z2m-runs.js`, 'utf8');
const strategy = readFileSync(`${root}/z2m-strategy.js`, 'utf8');
const page = readFileSync(`${root}/z2m-strategy-page.js`, 'utf8');
const app = readFileSync(`${root}/app.js`, 'utf8');
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8') + readFileSync(`${root}/z2m-components.css`, 'utf8');

test('Auto Strategy is internal to Strategy', () => {
  assert.match(page, /z2m-auto as Auto/);
  assert.match(app, /strategy:\s*Strategy/);
});

test('Auto controls expose the sanctioned lifecycle', () => {
  for (const label of ['Включить','Отключить','Запустить сейчас','Остановить','Восстановить last-good']) assert.match(auto, new RegExp(label));
  assert.match(auto, /expectedRevision:\s*auto\.revision/);
  assert.match(auto, /requestId:\s*requestId\(\)/);
});

test('Auto and run polling are bounded and non-overlapping', () => {
  for (const source of [auto, runs]) {
    assert.match(source, /pollInFlight/);
    assert.match(source, /setTimeout/);
    assert.match(source, /clearTimeout/);
    assert.doesNotMatch(source, /setInterval/);
  }
});

test('strategy selection stays draft-first', () => {
  assert.match(strategy, /pendingStrategyId/);
  assert.match(strategy, /setDraft\(['"]strategy/);
  assert.match(strategy, /Выбор стратегии не меняет runtime/);
});

test('unknown and failure states are not promoted to healthy', () => {
  for (const phase of ['degraded','recovering','cooldown','failed']) assert.match(auto, new RegExp(`['"]${phase}['"]`));
  assert.match(runs, /partial|infrastructure-error|failed/);
});

test('technical data is bounded and raw HTML is forbidden', () => {
  assert.match(auto, /boundedText/);
  assert.match(runs, /boundedText/);
  assert.doesNotMatch(auto + runs + strategy, /innerHTML/);
});

test('strategy apply routes through the global coordinator without confirmation or TTL UI', () => {
  assert.match(strategy, /ctx\.openSemanticDiff/);
  assert.doesNotMatch(strategy, /ctx\.setConfirmation\(response\)/);
  assert.doesNotMatch(app, /rollback_ttl|confirm_alive|confirmationTimer/);
});

test('advanced profile controls use shared advanced mode', () => {
  assert.match(strategy, /z2m-adv-only/);
  assert.match(app, /classList\.toggle\(['"]adv['"]/);
});

test('T4 UI is responsive and local', () => {
  assert.match(css, /@media/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
});
