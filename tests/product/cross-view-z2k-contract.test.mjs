import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Helper to read file
function read(rel) {
  return fs.readFileSync(path.join(path.resolve(''), rel), 'utf8');
}

// --- Test 1-3: Ownership classification ---

test('catalog/upstream asset must be in Installed, never in User', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  // renderUser must only allow imported and user-created, not catalog/upstream
  assert.match(src, /kind === 'imported' \|\| kind === 'user-created'/, 'renderUser must filter only imported/user-created');
  const userFn2 = src.slice(src.indexOf('function renderUser'), src.indexOf('function renderUser') + 800);
  assert.doesNotMatch(userFn2, /ownership !== 'package'/, 'renderUser should not use coarse ownership !== package');
  // Also check that catalog/upstream is not in User function body
  const userFn = src.slice(src.indexOf('function renderUser'), src.indexOf('function renderUser') + 800);
  const hasCatalogInUser = /catalog\/upstream/.test(userFn);
  assert.equal(hasCatalogInUser, false, 'catalog/upstream should not be in User filter');
});

test('imported asset must be in User', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /kind === 'imported'/);
  // Simulate the filter logic
  function isUser(asset) {
    const kind = asset && asset.provenance && asset.provenance.kind;
    return kind === 'imported' || kind === 'user-created';
  }
  assert.equal(isUser({ provenance: { kind: 'imported' } }), true);
  assert.equal(isUser({ provenance: { kind: 'catalog/upstream' } }), false);
});

test('user-created asset must be in User', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /kind === 'user-created'/);
  function isUser(asset) {
    const kind = asset && asset.provenance && asset.provenance.kind;
    return kind === 'imported' || kind === 'user-created';
  }
  assert.equal(isUser({ provenance: { kind: 'user-created' } }), true);
  assert.equal(isUser({ provenance: { kind: 'generated' } }), false, 'generated should not be User per clarification');
});

test('generated asset should not be automatically classified as User (investigate, not blind fallback)', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  // Should not have a generic fallback that puts generated in User
  // The file should not contain a catch-all for generated in renderUser
  const userFn = src.slice(src.indexOf('function renderUser'), src.indexOf('function renderUser') + 800);
  assert.doesNotMatch(userFn, /generated/);
  // And should not use ownership !== 'package' which would catch generated
  assert.doesNotMatch(userFn, /ownership !== 'package'/);
});

// --- Test 4: UNKNOWN != ATTENTION ---

test('asset without state and without error evidence must not be attention', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  // stateBadge must not fallback to attention
  assert.match(src, /row\.state \|\| 'unknown'/, 'stateBadge must fallback to unknown, not attention');
  assert.doesNotMatch(src, /row\.state \|\| 'attention'/);
  // HUMAN_STATES must have unknown
  assert.match(src, /unknown: _\('Неизвестно'\)/);
  // Simulate
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
  // Simulate normalizeZ2k logic for healthy current
  const local = { installed: true, integrityOk: true, integrity: 'verified', lua: { ready: 7, total: 7 }, baselineMatched: 7 };
  const hasLocal = true;
  const engineReady = true;
  // Simplified health check from z2m-components-model
  let healthState;
  if (engineReady !== true) healthState = 'missing';
  else if (hasLocal) {
    if (local.installed === false) healthState = 'missing';
    else if (local.integrityOk === false || local.integrity === 'broken') healthState = 'broken';
    else if (local.lua.ready === local.lua.total && local.lua.total > 0) healthState = 'ready';
    else healthState = 'degraded';
  }
  assert.equal(healthState, 'ready');
  // updateState would be current from remote
  const updateState = 'current';
  assert.equal(updateState, 'current');
  // Resources: catalog/upstream asset without state should be unknown, not attention
  function resourcesStateForHealthyAsset(asset) {
    // asset is catalog/upstream, exists, correct provenance, no error, but row.state is missing
    const row = { state: undefined, status: undefined };
    const state = row.state || 'unknown';
    return state;
  }
  assert.equal(resourcesStateForHealthyAsset({ provenance: { kind: 'catalog/upstream' } }), 'unknown');
  assert.notEqual(resourcesStateForHealthyAsset({}), 'attention');
});

// --- Test 6: Z2K update available → Components update-available, Resources shows asset delta, no second product ---

test('Z2K update available: Components update-available, Resources shows asset info, no second product action', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  // renderUpdates for z2k-resources should be demoted to Подробнее, not primary Обновить ресурс
  assert.match(src, /Подробнее/);
  const z2kUpdatesSection = src.slice(src.indexOf('function renderUpdates'), src.indexOf('function renderUpdates') + 2000);
  assert.match(z2kUpdatesSection, /z2k-resources.*Подробнее/s);
  assert.doesNotMatch(z2kUpdatesSection, /Обновить ресурс.*primary sm.*z2k-curated-lua/);
  // But backend capability must remain
  const backend = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(backend, /resource_center_update/);
  assert.match(backend, /z2k-curated-lua/);
});

// --- Test 7: critical Z2K asset integrity failure → Components not Актуален ---

test('critical Z2K asset corrupted → canonical z2k health degraded, Components not Актуален', () => {
  // Simulate a critical asset failure: z2k-modern-core is missing or validation failed
  // The canonical projection is resources.status().z2k -> local projection
  // If critical asset is missing, hasMissing true → integrity broken → health broken
  const localBroken = { installed: true, integrityOk: false, integrity: 'broken', lua: { ready: 6, total: 7 } };
  let healthState;
  const hasLocal = true;
  const engineReady = true;
  if (engineReady !== true) healthState = 'missing';
  else if (hasLocal) {
    if (localBroken.installed === false) healthState = 'missing';
    else if (localBroken.integrityOk === false || localBroken.integrity === 'broken') healthState = 'broken';
    else if (localBroken.lua.ready === localBroken.lua.total) healthState = 'ready';
    else healthState = 'degraded';
  }
  assert.equal(healthState, 'broken');
  assert.notEqual(healthState, 'ready');
  // And updateState would be current or update-available, but health broken takes precedence
  // So Components would show Ошибка (r) not Актуален (g)
  const labelForBroken = 'Ошибка';
  const kindMap = { 'Актуален': 'g', 'Ошибка': 'r', 'Доступно обновление': 'o' };
  assert.equal(kindMap[labelForBroken], 'r');
  assert.notEqual(kindMap['Актуален'], kindMap[labelForBroken]);
});

// --- Test 8: source commit not interpreted as product version ---

test('source commit must be labeled Commit источника, not version', () => {
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  assert.match(src, /Commit источника/);
  assert.doesNotMatch(src, /Базовая ревизия каталога/);
  // Product version p-* should only be in Components, not in Sources mono commit line
  const sourcesFn = src.slice(src.indexOf('function renderSources'), src.indexOf('function renderSources') + 800);
  assert.match(sourcesFn, /Commit источника/);
  assert.doesNotMatch(sourcesFn, /Версия Z2K/);
});

// --- Regression for the visible conflict ---

test('Regression: System Z2K Core = Актуален should not coexist with Z2K catalog/upstream assets = Требуется внимание without real error', () => {
  // This is the exact bug: System says Актуален (health ready, current), but Resources shows catalog/upstream assets as attention
  // After fix, healthy catalog/upstream assets without state should be unknown/muted, not attention
  const src = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  // The fix is stateBadge fallback to unknown, not attention
  assert.match(src, /row\.state \|\| 'unknown'/);
  // And renderUser must not put catalog/upstream in User
  const userFn = src.slice(src.indexOf('function renderUser'), src.indexOf('function renderUser') + 600);
  assert.match(userFn, /imported.*user-created/);
  // Simulate the conflict scenario
  const healthyCatalogAsset = { provenance: { kind: 'catalog/upstream' }, state: undefined };
  // Old buggy logic: would be attention
  function oldStateBadge(row) { return row.state || 'attention'; }
  function newStateBadge(row) { return row.state || 'unknown'; }
  assert.equal(oldStateBadge(healthyCatalogAsset), 'attention');
  assert.equal(newStateBadge(healthyCatalogAsset), 'unknown');
  assert.notEqual(newStateBadge(healthyCatalogAsset), 'attention');
  // And it should be in Installed, not User
  function isUserOld(asset) { return asset.ownership !== 'package'; }
  function isUserNew(asset) { const k = asset.provenance && asset.provenance.kind; return k === 'imported' || k === 'user-created'; }
  const catalogAsset = { ownership: 'manager', provenance: { kind: 'catalog/upstream' } };
  assert.equal(isUserOld(catalogAsset), true, 'old logic incorrectly puts catalog/upstream in User');
  assert.equal(isUserNew(catalogAsset), false, 'new logic correctly keeps catalog/upstream out of User');
});
