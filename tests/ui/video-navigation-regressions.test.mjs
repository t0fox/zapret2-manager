import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const app = readFileSync(`${root}/app.js`, 'utf8');
const strategy = readFileSync(`${root}/z2m-strategy.js`, 'utf8');

test('visited tabs preserve visible data while a single background refresh runs', () => {
  assert.match(app, /var\s+tabDataCache\s*=\s*\{\}/);
  assert.match(app, /var\s+tabLoadPromises\s*=\s*\{\}/);
  assert.match(app, /function\s+loadTabData\s*\(/);
  assert.match(app, /function\s+renderTabData\s*\(/);
  assert.match(app, /if\s*\(!cachedData\s*&&\s*!keepCurrent\)/);
  assert.match(app, /Показано последнее успешное состояние/);
});

test('same-tab navigation and draft cancellation do not reload the document', () => {
  assert.match(app, /if\s*\(activeModule\s*===\s*MODULES\[tab\]\s*&&\s*activeContext\)\s*return\s+Promise\.resolve\(\)/);
  assert.doesNotMatch(app, /window\.location\.reload\s*\(/);
});

test('strategy candidate selection updates locally without a backend refresh', () => {
  assert.match(strategy, /function\s+renderCandidateSelection\s*\(/);
  assert.match(strategy, /select\(ctx,\s*id,\s*renderCandidateSelection\)/);
  const match = strategy.match(/function\s+select\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'select() must exist');
  assert.doesNotMatch(match[1], /ctx\.refresh\s*\(/);
});
