import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('maintenance must use scoped componentOperation, not single componentBusy boolean', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /componentOperation\s*:\s*null/, 'must have componentOperation: null');
  assert.match(src, /componentBusy.*componentOperation|componentOperation.*componentBusy/, 'componentBusy must be derived from componentOperation');
  assert.doesNotMatch(src, /componentBusy\s*:\s*false\s*,\s*\n.*componentBusy.*true.*componentBusy.*false/s, 'must not use old boolean toggle pattern for busy');
});

test('checkUpdates must set kind check scope all and clear via finally', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /checkUpdates[\s\S]*componentOperation\s*=\s*\{\s*kind:\s*["']check["']/);
  assert.match(src, /checkUpdates[\s\S]*scope\s*(\|\||:|,)(\s*['"]all['"]|\s*scope)/);
  // Must clear before refresh boundary, not in finally after
  const checkBody = src.slice(src.indexOf('function checkUpdates'), src.indexOf('function checkUpdates') + 3500);
  const clearIdx = checkBody.indexOf('componentOperation = null');
  const refreshIdx = checkBody.indexOf('return refresh(ctx)');
  assert.ok(clearIdx >= 0 && refreshIdx >= 0 && clearIdx < refreshIdx, 'must clear operation BEFORE refresh');
});

test('updateZ2K must set kind update scope z2k and not affect Engine', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /updateZ2K[\s\S]*componentOperation\s*=\s*\{\s*kind:\s*["']update["']/);
  assert.match(src, /updateZ2K[\s\S]*scope:\s*["']z2k["']/);
  // Engine must not show fake update when Z2K is updating
  assert.doesNotMatch(src, /renderEngineCard[\s\S]*componentOperation.*all.*update/i);
});

test('check lifecycle must show checking text, not updating', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(src, /Проверка обновлений|Проверяем доступные версии/);
  // Check should not display "Обновление…" for a check
  const checkSection = src.slice(src.indexOf('function checkUpdates'));
  assert.doesNotMatch(checkSection, /phase:\s*['"]Обновление/);
  assert.match(checkSection, /Проверка/);
});

test('Z2K update must show only Z2K busy, not Engine', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  // renderEngineCard should check scope
  assert.match(src, /renderEngineCard[\s\S]*componentOperation.*scope.*z2k|isBusy.*scope/i);
  // renderZ2KCard should also check scope
  assert.match(src, /renderZ2KCard[\s\S]*componentOperation/);
});

test('every operation must clear via finally or both then/catch', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const checkFn = src.slice(src.indexOf('function checkUpdates'), src.indexOf('function checkUpdates') + 3500);
  const updateFn = src.slice(src.indexOf('function updateZ2K'), src.indexOf('function updateZ2K') + 2000);
  const refreshFn = src.slice(src.indexOf('function refreshState'), src.indexOf('function refreshState') + 1500);
  for (const [name, fn] of [['checkUpdates', checkFn], ['updateZ2K', updateFn], ['refreshState', refreshFn]]) {
    assert.match(fn, /componentOperation\s*=\s*null/, `${name} must clear operation`);
  }
});

// --- Per-card scope contract (regression: bare bind passed event as scope) ---
test('per-card scope: no bare checkUpdates.bind(null, ctx) anywhere', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.doesNotMatch(src, /checkUpdates\.bind\(null,\s*ctx\s*\)/,
    'bare bind makes event object the scope arg -> promises=0 instant no-op');
});

test('engine card binds scope engine; z2k card binds z2k; hero all', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const eng = src.slice(src.indexOf('function renderEngineCard'), src.indexOf('function renderZ2KCard'));
  assert.ok(/checkUpdates\.bind\(null,\s*ctx,\s*'engine'\)/.test(eng), 'engine card must pass explicit engine scope');
  assert.ok(!/checkUpdates\.bind\(null,\s*ctx,\s*'z2k'\)/.test(eng), 'engine card must not use z2k scope');
  const z2k = src.slice(src.indexOf('function renderZ2KCard'), src.indexOf('function renderOptionalCard'));
  assert.ok(/checkUpdates\.bind\(null,\s*ctx,\s*'z2k'\)/.test(z2k), 'z2k card must pass explicit z2k scope');
  assert.ok(!/checkUpdates\.bind\(null,\s*ctx,\s*'engine'\)/.test(z2k), 'z2k card must not use engine scope');
  assert.match(src, /checkUpdates\.bind\(null,\s*ctx,\s*'all'\)/);
});

test('scope drives backend calls: engine->fresh check/gateStatus, z2k->resources.check', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const fn = src.slice(src.indexOf('function checkUpdates'), src.indexOf('function updateZ2K'));
  assert.match(fn, /scope === 'z2k'\)\s*addCheck\('z2k',\s*checkedResult\(ctx\.api\.resources\.check\(/);
  assert.match(fn, /scope === 'engine'\)\s*\{\s*addCheck\('engine',\s*checkedResult\(ctx\.api\.engine\.check\(\{\s*forceRefresh:\s*true/);
  assert.match(fn, /if \(ctx\.api\.engine\.gateStatus\)\s*addCheck\('engine-gate',\s*checkedResult\(ctx\.api\.engine\.gateStatus/);
  // bounded lifecycle guard present
  assert.match(fn, /Promise\.race\(\[Promise\.allSettled\(promises\)/);
});
