import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLANNER = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc'), 'utf8');
const CATALOG = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc'), 'utf8');
const SCANNER_JS = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js'), 'utf8');

// BUG1 regression: standard exploration budget is 60, never 80.
// materialization capacity (80) is a global maximum for FULL; it must not
// leak into the STANDARD exploration budget.
test('MODE_BUDGETS contract: quick 30/10, standard 60/20, full 80/20', () => {
  const budgets = PLANNER.match(/const\s+MODE_BUDGETS\s*=\s*\{[\s\S]*?\};/);
  assert.ok(budgets, 'MODE_BUDGETS declared in planner');
  const b = budgets[0];
  assert.match(b, /quick:\s*\{\s*exploration:\s*30,\s*verification:\s*10/);
  assert.match(b, /standard:\s*\{\s*exploration:\s*60,\s*verification:\s*20/);
  assert.match(b, /full:\s*\{\s*exploration:\s*80,\s*verification:\s*20/);
});

test('planner caps plan candidates by mode explorationBudget (select_diverse)', () => {
  assert.match(PLANNER, /let\s+explorationBudget\s*=\s*\(MODE_BUDGETS\[value\.mode\]\s*\|\|\s*MODE_BUDGETS\.standard\)\.exploration/);
  assert.match(PLANNER, /if\s*\(length\(candidates\)\s*>\s*explorationBudget\)\s*candidates\s*=\s*select_diverse\(candidates,\s*explorationBudget\)/);
});

test('worker record.total == length(plan.candidates) (never a hardcoded budget)', () => {
  assert.match(WORKER, /total:\s*length\(plan\.candidates\)/);
});

test('standard total != 80: exploration budget for standard stays 60', () => {
  // Guard against someone "unifying" budgets to the FULL maximum.
  const b = PLANNER.match(/standard:\s*\{\s*exploration:\s*(\d+)/);
  assert.ok(b, 'standard budget present');
  assert.notEqual(Number(b[1]), 80, 'standard exploration budget must not equal full max 80');
  assert.equal(Number(b[1]), 60);
});

test('catalog materialization capacity stays >= 80 (FULL requirement)', () => {
  const bound = CATALOG.match(/length\(ids\)\s*>\s*(\d+)\)\s*\n?\s*return error_result\('EINPUT',\s*'catalog materialization ids are bounded'/);
  assert.ok(bound, 'materialize bound present');
  assert.ok(Number(bound[1]) >= 80, 'materialize capacity must stay >= 80, got ' + bound[1]);
});

test('UI MODE_BUDGETS mirrors planner (quick 30, standard 60, full 80)', () => {
  assert.match(SCANNER_JS, /MODE_BUDGETS\s*=\s*\{\s*quick:\s*30,\s*standard:\s*60,\s*full:\s*80\s*\}/);
});

// BUG2 regression: accepted cancel must end cancelled, never error.
test('worker: never-created table is verified absence, not cleanup failure', () => {
  assert.match(WORKER, /everCreated/);
  assert.match(WORKER, /tableCreated:\s*false,\s*tableCleanupRequired:\s*false/);
});

test('worker: cancelled with proven session cleanup cannot degrade to error', () => {
  assert.match(WORKER, /cancelled_with_verified_cleanup/);
  assert.match(WORKER, /transition == 'cancelled' && object\(cleanup\) && cleanup\.ok === true && cleanup\.verifiedCleanup === true/);
});

test('UI: cancelled renders neutral stopped state, not red error panel', () => {
  assert.match(SCANNER_JS, /scannerStoppedPanel/);
  assert.match(SCANNER_JS, /Проверка остановлена/);
  assert.match(SCANNER_JS, /status\.status === 'cancelled' && !terminalResult && !state\.error \? scannerStoppedPanel/);
});

// Hover regression: Chromium forwards :hover from <label> to its labeled
// control (the FIRST button of the group), so segmented buttons must never
// be wrapped in a label, and the alien LuCI hover ring must be overridden.
test('UI: segmented fields are not <label> (no label→button hover forwarding)', () => {
  const seg = SCANNER_JS.match(/function segmentedField\(label, node, iconName\) \{\n([^\n]*)/);
  assert.ok(seg, 'segmentedField defined');
  assert.match(seg[1], /E\('div'/, 'segmentedField must render div, got: ' + seg[1]);
  assert.doesNotMatch(seg[1], /E\('label'/);
});

test('CSS: segmented button hover is neutral, alien ring overridden', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css'), 'utf8');
  // LuCI cascade.css sets button:hover border-color with !important — ours must too.
  assert.match(CSS, /\.z2m-app \.z2m-scanner-segmented button:hover\{border-color:transparent!important;box-shadow:none;outline:none/);
});
