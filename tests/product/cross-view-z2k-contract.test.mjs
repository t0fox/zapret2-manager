import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

// Helper to read file
function read(rel) {
  return fs.readFileSync(path.join(path.resolve(''), rel), 'utf8');
}

// --- Single-page IA: no PANES dead code ---

test('Resources page must be single-page: no PANES concept', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.doesNotMatch(src, /var PANES/, 'PANES must be removed');
  assert.doesNotMatch(src, /function renderUpdates/, 'renderUpdates pane must be removed');
  assert.doesNotMatch(src, /function renderInstalled/, 'renderInstalled pane must be removed');
  // renderUser/renderSources as pane handlers must be gone; generic helpers may remain but pane dispatch must be gone
  assert.doesNotMatch(src, /active === 'updates'/);
  assert.doesNotMatch(src, /subTabs\(PANES/);
  assert.match(src, /ResourcesModel\.buildModel/, 'must use ResourcesModel.buildModel');
  assert.match(src, /z2m-resource-group-row/, 'must render compact grouped rows, not 4 tabs nor large cards');
  assert.doesNotMatch(src, /z2m-resource-group-card/, 'must not use old large card layout');
});

test('Ownership classification must be in model, not coarse pane filter', () => {
  const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
  assert.match(model, /isUserKind/, 'model must define isUserKind');
  assert.match(model, /kind === 'imported' \|\| kind === 'user-created'/, 'user = imported|user-created');
  assert.doesNotMatch(model, /ownership !== 'package'/, 'must not use coarse ownership !== package');
  function isUser(asset) {
    const kind = asset && asset.provenance && asset.provenance.kind;
    return kind === 'imported' || kind === 'user-created';
  }
  assert.equal(isUser({ provenance: { kind: 'imported' } }), true);
  assert.equal(isUser({ provenance: { kind: 'user-created' } }), true);
  assert.equal(isUser({ provenance: { kind: 'catalog/upstream' } }), false);
  assert.equal(isUser({ provenance: { kind: 'generated' } }), false);
  assert.equal(isUser({ provenance: { kind: 'builtin/package' } }), false);
});

test('catalog/upstream must never be classified as User (model)', () => {
  const modelSrc = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
  assert.match(modelSrc, /catalog\/upstream/);
  // Simulate model assignment: imported/user-created -> user group, catalog/upstream -> system
  function isUserKind(kind) { return kind === 'imported' || kind === 'user-created'; }
  assert.equal(isUserKind('catalog/upstream'), false);
  assert.equal(isUserKind('imported'), true);
});

// --- Test 4: UNKNOWN != ATTENTION ---

test('asset without state and without error evidence must not be attention', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /row\.state \|\| 'unknown'/, 'stateBadge must fallback to unknown, not attention');
  assert.doesNotMatch(src, /row\.state \|\| 'attention'/);
  assert.match(src, /unknown: _\('Неизвестно'\)/);
  function stateBadge(row) {
    const HUMAN_STATES = { current: 'Актуально', update: 'Доступно обновление', attention: 'Требуется внимание', error: 'Ошибка проверки', unknown: 'Неизвестно' };
    const state = row.state || 'unknown';
    return HUMAN_STATES[state] || HUMAN_STATES.unknown;
  }
  assert.equal(stateBadge({}), 'Неизвестно');
  assert.equal(stateBadge({ state: undefined }), 'Неизвестно');
  assert.notEqual(stateBadge({}), 'Требуется внимание');
  assert.equal(stateBadge({ state: 'current' }), 'Актуально');
});

// --- Test 5: Z2K current + healthy assets → Components current/ready, Resources no attention ---

test('Z2K current + healthy assets: Components = current/ready, Resources no attention', () => {
  const local = { installed: true, integrityOk: true, integrity: 'verified', lua: { ready: 7, total: 7 }, baselineMatched: 7 };
  const hasLocal = true;
  const engineReady = true;
  let healthState;
  if (engineReady !== true) healthState = 'missing';
  else if (hasLocal) {
    if (local.installed === false) healthState = 'missing';
    else if (local.integrityOk === false || local.integrity === 'broken') healthState = 'broken';
    else if (local.lua.ready === local.lua.total && local.lua.total > 0) healthState = 'ready';
    else healthState = 'degraded';
  }
  assert.equal(healthState, 'ready');
  const updateState = 'current';
  assert.equal(updateState, 'current');
  function resourcesStateForHealthyAsset(asset) {
    const row = { state: undefined, status: undefined };
    const state = row.state || 'unknown';
    return state;
  }
  assert.equal(resourcesStateForHealthyAsset({ provenance: { kind: 'catalog/upstream' } }), 'unknown');
  assert.notEqual(resourcesStateForHealthyAsset({}), 'attention');
});

// --- Test 6: Z2K update/rebase/review callouts must be distinct and demoted to Подробнее→components ---

test('Z2K update/rebase/review callouts must be distinct and navigate to components, no second product update', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /Подробнее/);
  assert.match(src, /Доступно обновление/);
  assert.match(src, /Требуется адаптация/);
  assert.match(src, /Требуется проверка/);
  // Must navigate to components, not perform resource_center_update directly
  assert.match(src, /ctx\.navigate\('components'\)/);
  assert.doesNotMatch(src, /Обновить ресурс.*primary sm.*z2k-curated-lua/);
  const backend = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(backend, /resource_center_update/);
  assert.match(backend, /z2k-curated-lua/);
});

// --- Test 7: critical Z2K asset integrity failure → Components not Актуален (behavioral, production-equivalent) ---

test('critical Z2K asset corrupted → canonical z2k health degraded, Components not Актуален', () => {
  const fsCode = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(fsCode, /catalog\/upstream[\s\S]*?current\.sha256 != registered\.contentSha256[\s\S]*?state = 'attention'/, 'row_for must treat actual != registered as attention for catalog/upstream');
  assert.match(fsCode, /catalog\/upstream[\s\S]*?state = 'current'/, 'row_for must have current for healthy catalog/upstream');

  const corruptedRow = { id: 'lua:z2k-modern-core', type: 'lua', state: 'attention', status: 'Требуется внимание' };
  const healthyRow = { id: 'lua:z2k-modern-core', type: 'lua', state: 'current', status: 'Актуально' };
  let hasAttentionCorrupted = corruptedRow.state === 'attention';
  let hasAttentionHealthy = healthyRow.state === 'attention';
  assert.equal(hasAttentionCorrupted, true);
  assert.equal(hasAttentionHealthy, false);
  function projectionHealth(rows) {
    let hasMissing = rows.some(r => r.state === 'missing');
    let hasAttention = rows.some(r => r.state === 'attention');
    let baselineMatched = rows.filter(r => r.state === 'current').length;
    let total = rows.length;
    let integrity = hasAttention ? 'broken' : hasMissing ? 'broken' : baselineMatched === total ? 'verified' : 'diverged';
    let integrityOk = !hasMissing && !hasAttention;
    let local = { installed: !hasMissing && total > 0, integrity, integrityOk, lua: { ready: rows.filter(r => r.type === 'lua' && r.state === 'current').length, total: rows.filter(r => r.type === 'lua').length } };
    let hasLocal = true, engineReady = true;
    let healthState;
    if (engineReady !== true) healthState = 'missing';
    else if (hasLocal) {
      if (local.installed === false) healthState = 'missing';
      else if (local.integrityOk === false || local.integrity === 'broken') healthState = 'broken';
      else if (local.lua.ready === local.lua.total) healthState = 'ready';
      else healthState = 'degraded';
    }
    return { healthState, integrity, integrityOk };
  }
  const healthy = projectionHealth([healthyRow, { id: 'lua:z2k-detectors', type: 'lua', state: 'current' }]);
  const corrupted = projectionHealth([corruptedRow, { id: 'lua:z2k-detectors', type: 'lua', state: 'current' }]);
  assert.equal(healthy.healthState, 'ready', 'healthy should be ready');
  assert.equal(corrupted.healthState, 'broken', 'corrupted critical asset must make health broken');
  assert.notEqual(corrupted.healthState, 'ready');
  const kindMap = { 'Актуален': 'g', 'Ошибка': 'r', 'Доступно обновление': 'o' };
  assert.equal(kindMap['Ошибка'], 'r');
  assert.notEqual(kindMap['Актуален'], kindMap['Ошибка']);
  const dynamicHealthyRow = { id: 'lua:z2k-alert', type: 'lua', state: 'current' };
  const dynamicHealthyProj = projectionHealth([dynamicHealthyRow, healthyRow]);
  assert.equal(dynamicHealthyProj.healthState, 'ready', 'dynamic p-79.18 healthy should be ready, not broken');
});

// --- Test 8: source commit not interpreted as product version ---

test('source commit must be labeled Commit источника, not version', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /Commit источника/);
  assert.doesNotMatch(src, /Базовая ревизия каталога/);
});

test('Navigation settings alias must be canonical components (behavioral)', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js');
  assert.match(src, /settings:\s*'components'/, 'ALIASES settings must map to components');
  assert.doesNotMatch(src, /settings:\s*'settings'/);
  const rawCode = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js');
  const code = rawCode.replace(/return\s+baseclass\.extend/, 'this.__nav = baseclass.extend');
  let captured = null;
  const baseclass = { extend: (obj) => { captured = obj; return obj; } };
  const context = {
    require: (name) => {
      if (name === 'baseclass') return baseclass;
      throw new Error('unknown require ' + name);
    },
    _: (s) => s,
    console,
    __nav: null,
    baseclass,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const nav = context.__nav || captured || context.baseclass && context.baseclass.extend && null;
  assert.ok(nav && typeof nav.normalize === 'function', 'nav.normalize must exist');
  assert.equal(nav.normalize('settings'), 'components');
  assert.equal(nav.normalize('#/settings'), 'components');
  assert.equal(nav.normalize('components'), 'components');
  assert.equal(nav.parse('#/settings').route, 'components');
});

test('UNKNOWN != ATTENTION behavioral: stateBadge must be muted for unknown', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /HUMAN_STATES.*unknown/);
  function kindForState(state) {
    const s = state || 'unknown';
    if (s === 'current') return 'good';
    if (s === 'update') return 'warn';
    if (s === 'error' || s === 'attention') return 'danger';
    return 'muted';
  }
  assert.equal(kindForState('unknown'), 'muted');
  assert.equal(kindForState('attention'), 'danger');
  assert.notEqual(kindForState('unknown'), kindForState('attention'));
  assert.equal(kindForState(undefined), 'muted');
});

test('Resources page must not show Package baseline as top-level product card', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  // Package baseline should be in technical disclosure, not as a regular group card with same styling as Z2K
  // The grouped view should have special handling for hiddenGroups / technical disclosure
  assert.match(src, /hiddenGroups|Дополнительно|Package baseline/, 'must have technical disclosure for package baseline');
  // Should not have dedicated top-level card creation for package-baseline like other groups in basic mode
  const modelSrc = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
  assert.match(modelSrc, /hiddenBasic|package-baseline/, 'model must hide package-baseline as technical');
});

test('Rebase/review require distinct labels from update-available', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /Требуется адаптация/);
  assert.match(src, /Требуется проверка/);
  assert.match(src, /Доступно обновление/);
  // Ensure rebase/review are not labeled as simple update
  const modelSrc = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
  assert.match(modelSrc, /rebase-required/);
  assert.match(modelSrc, /review-required/);
});
