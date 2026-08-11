import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const page = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js');
const pageAdapter = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js');
const auto = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-auto.js');
const runs = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js');
const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-model.js');
const workflow = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow.js');
const workflowCore = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow-core.js');
const profilesWorkflow = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-profiles-workflow.js');

test('Strategy API declares the canonical catalog, editor, preview, apply, and import RPCs', () => {
  for (const method of [
    'strategies_list', 'strategies_get', 'strategies_create', 'strategies_update',
    'strategies_delete', 'strategies_duplicate', 'strategies_favorite',
    'strategies_preview', 'strategies_validate', 'strategies_apply',
    'strategies_catalog_status', 'strategies_catalog_reload', 'strategies_import_profiles',
  ]) assert.match(api, new RegExp(`method:'${method}'`), method);
  for (const method of [
    'strategiesGet', 'strategiesCreate', 'strategiesUpdate', 'strategiesDelete',
    'strategiesDuplicate', 'strategiesFavorite', 'strategiesPreview',
    'strategiesValidate', 'strategiesApply', 'strategiesImportProfiles',
  ]) assert.match(api, new RegExp(`\\b${method}:rpc\\.declare`), method);
  assert.match(api, /strategies:\{[\s\S]*strategiesList/);
});

test('canonical page consumes Strategy list/detail/status data instead of Discord or Orchestra authority', () => {
  assert.match(page, /ctx\.api\.strategies\.list/);
  assert.match(page, /ctx\.api\.strategies\.get/);
  assert.match(page, /ctx\.api\.service\.status/);
  assert.doesNotMatch(page, /ctx\.api\.strategy\.preview\(\)/);
  assert.doesNotMatch(page, /ctx\.api\.orchestra\.catalog\(\)/);
  assert.doesNotMatch(page, /join\(['"] --new ['"]|NFQWS2_OPT/);
});

test('catalog editor covers search, filters, metadata, availability, favorites, and builtin/user controls', () => {
  for (const token of ['search', 'filter', 'metadata', 'availability', 'favorite', 'is_builtin', 'origin', 'builtin'])
    assert.match(page, new RegExp(token, 'i'), token);
  for (const helper of ['normalizeStrategy', 'strategyList', 'strategyProfiles', 'strategyInput'])
    assert.match(page, new RegExp(`function ${helper}\\(`), helper);
});

test('Strategy Profiles preserve order and default omitted enabled values to true', () => {
  assert.match(page, /enabled\s*!==\s*false/);
  assert.match(page, /profiles\.map/);
  assert.match(page, /profile\.args|profile\.opt/);
  assert.doesNotMatch(page, /join\(['"] --new ['"]|profiles\.map\([^)]*['"] --new ['"]\)/);
});

test('user Strategy CRUD and duplicate actions use server RPC contracts', () => {
  for (const action of ['duplicate', 'create', 'update', 'delete'])
    assert.match(page, new RegExp(`ctx\\.api\\.strategies\\.${action}`), action);
  assert.match(page, /expectedRevision|revision/);
  assert.match(page, /is_builtin\s*!==\s*true|is_builtin === true/);
});

test('inline Preview and optional Validate send strategy_data while persisted Apply sends identity', () => {
  assert.match(page, /function previewStrategy\(/);
  assert.match(page, /ctx\.api\.strategies\.preview/);
  assert.match(page, /ctx\.api\.strategies\.validate/);
  assert.match(page, /strategy_data/);
  assert.match(page, /validate/);
  assert.match(page, /function applyStrategy\(/);
  assert.match(page, /strategy_id/);
  assert.match(page, /catalog_digest/);
  assert.match(page, /expectedRevision|revision/);
});

test('effective command and status drift are rendered from backend responses without client compilation', () => {
  assert.match(page, /effectiveCommand/);
  assert.match(page, /effectiveArgv/);
  assert.match(page, /active|selected/);
  assert.match(page, /drift/);
  assert.doesNotMatch(page, /NFQWS2_OPT|join\(['"] --new ['"]|strategyArgs\s*=\s*.*join/);
});

test('Advanced Orchestra workflow is explicitly separated and existing page lifecycle remains reachable', () => {
  assert.match(pageAdapter, /mode === 'workflow'/);
  assert.match(pageAdapter, /advanced\(/);
  assert.match(pageAdapter, /primary\.load|primary\.render|primary\.mount/);
  for (const method of ['load', 'render', 'mount', 'unmount'])
    assert.match(page, new RegExp(`${method}:|function ${method}\\(`), method);
  assert.match(workflow, /Advanced|Расширенн/);
  assert.match(workflowCore, /Advanced|Расширенн/);
  assert.match(model, /tabs/);
});

test('Profile compatibility workflow remains navigable without becoming the canonical compiler', () => {
  for (const helper of ['renderProfilesPane', 'previewProfiles', 'applyProfiles', 'reorderProfiles'])
    assert.match(page, new RegExp(`function ${helper}\\(`), helper);
  assert.match(page, /Compatibility|Совместим/);
  assert.match(page, /state\.subtab|subTabs/);
  assert.match(profilesWorkflow, /createState|buildReorderRequest|applyAndReread/);
});

function loadPageWithStubs(calls) {
  const module = (name, renderValue) => ({
    load: () => { calls.push(`${name}.load`); return Promise.resolve({}); },
    render: () => { calls.push(`${name}.render`); return renderValue || { appendChild() {} }; },
    mount: () => calls.push(`${name}.mount`),
    unmount: () => calls.push(`${name}.unmount`),
  });
  const context = {
    baseclass: { extend: value => value },
    EngineGate: { wrap: value => value },
    Strategy: module('strategy'), Workflow: module('workflow'),
    Auto: module('auto'), Runs: module('runs'),
    E: () => ({ appendChild() {} }),
    _: value => value,
  };
  return vm.runInNewContext(`(function () {${pageAdapter}\n})()`, context);
}

function pageContext(advanced) {
  return {
    store: { get: () => ({ ui: { advanced } }) },
    api: { normalizeError: error => error },
    shell: {},
  };
}

test('normal Strategy load/render excludes Orchestra Auto and Runs while Advanced includes both', async () => {
  const normalCalls = [];
  const normalPage = loadPageWithStubs(normalCalls);
  const normalData = await normalPage.load(pageContext(false));
  assert.equal(normalData.mode, 'manual');
  assert.deepEqual(normalCalls, ['strategy.load']);
  const normalRoot = normalPage.render({ ...pageContext(false), data: normalData });
  assert.ok(normalRoot);
  assert.deepEqual(normalCalls, ['strategy.load', 'strategy.render']);

  const advancedCalls = [];
  const advancedPage = loadPageWithStubs(advancedCalls);
  const advancedData = await advancedPage.load(pageContext(true));
  assert.equal(advancedData.mode, 'workflow');
  assert.deepEqual(advancedCalls, ['workflow.load', 'auto.load', 'runs.load']);
  advancedPage.render({ ...pageContext(true), data: advancedData });
  assert.deepEqual(advancedCalls, ['workflow.load', 'auto.load', 'runs.load', 'workflow.render', 'auto.render', 'runs.render']);
});

test('Advanced modules retain Orchestra mutation authority only behind the page boundary', () => {
  assert.match(pageAdapter, /var isAdvanced = advanced\(ctx\)/);
  assert.match(pageAdapter, /if\s*\(isAdvanced\)[\s\S]*Auto\.load/);
  assert.match(pageAdapter, /if\s*\(isAdvanced\)[\s\S]*Runs\.load/);
  assert.match(auto, /ctx\.api\.orchestra\.(autoEnable|autoDisable|autoRun|autoStop|autoRestore)/);
  assert.match(runs, /ctx\.api\.orchestra\.(previewBest|applyBest)/);
});

test('actual Advanced workflow reaches Compatibility through the existing Profile renderer while normal mode cannot invoke it', () => {
  assert.match(workflowCore, /Strategy\.renderCompatibility\(ctx/);
  assert.match(workflowCore, /id:\s*'compatibility'[\s\S]*Compatibility \/ Profiles/);
  assert.match(workflowCore, /profiles:\s*settled\(results\[6\]/);
  assert.match(pageAdapter, /if\s*\(data\.mode === 'workflow'\)/);
  assert.doesNotMatch(pageAdapter, /Strategy\.renderCompatibility/);
});

test('Compatibility Apply is enabled only after acknowledged valid Preview and stays recoverable', () => {
  assert.match(profilesWorkflow, /function canApply\(/);
  assert.match(page, /profilesWorkflow\.canApply\(profilesState\)/);
  assert.match(page, /profileApplyButton\.disabled\s*=\s*!profilesWorkflow\.canApply\(profilesState\)/);
  assert.doesNotMatch(page, /shell\.button\(_\('Apply compatibility set'\)[\s\S]*\}, true\)/);
  assert.match(page, /manualRecovery|rollbackOk|rolledBack/);
});

test('direct strategyStatus identity, drift, and revision are consumed behaviorally', () => {
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { activeIdentity, activeDrift, stateRevision, strategyAvailability, normalizeStrategy };\n})()`, {
    _: value => value,
  });
  const status = { strategyStatus: { id: 'user-one', name: 'User one', drift: true, availability: 'drifted', revision: 7 } };
  assert.equal(helpers.activeIdentity(status).id, 'user-one');
  assert.equal(helpers.activeDrift(status), true);
  assert.equal(helpers.stateRevision(status), null);
  assert.equal(helpers.strategyAvailability(status.strategyStatus), false);
});

test('catalog Strategies normalize to revision zero and persisted Apply sends revision zero plus catalog digest', async () => {
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { normalizeStrategy, applyStrategy };\n})()`, {
    _: value => value,
  });
  const strategy = helpers.normalizeStrategy({ id: 'z2k_all_in_one', origin: 'avatar_builtin', is_builtin: true, profiles: [] });
  assert.equal(strategy.revision, 0);
  let request;
  const result = helpers.applyStrategy({
    data: { catalog: { value: { aggregateDigest: 'a'.repeat(64) } } },
    api: { strategies: { apply: value => { request = JSON.parse(value); return request; } } },
  }, strategy);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    strategy_id: 'z2k_all_in_one', revision: 0, catalog_digest: 'a'.repeat(64),
  });
  assert.deepEqual(request, JSON.parse(JSON.stringify(result)));
});

test('favorites use authoritative state revision and returned ordered state, never revision zero', () => {
  assert.match(page, /function favoriteState\(/);
  assert.match(page, /state\.favoriteState\s*=\s*(?:favoriteState|persistedFavorites)/);
  assert.match(page, /expectedRevision:\s*revision/);
  const revisionStart = page.indexOf('function stateRevision(');
  const revisionEnd = page.indexOf('\nfunction catalogDigest', revisionStart);
  assert.doesNotMatch(page.slice(revisionStart, revisionEnd), /\|\|\s*0/);
  assert.match(page, /rememberFavoriteState\(answer\)/);
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { favoriteState, stateRevision };\n})()`, {
    _: value => value,
  });
  const data = { list: { value: { state: { favorites: ['first', 'second'], revision: 11 } } }, status: { value: { strategyStatus: { revision: 88 } } } };
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.favoriteState(data))), { favorites: ['first', 'second'], revision: 11 });
  assert.equal(helpers.favoriteState({ status: { value: { strategyStatus: { revision: 12 } } } }), null);
  assert.equal(helpers.stateRevision({ strategyStatus: { revision: 11 } }), null);
});

test('favorite toggle uses durable list state revision for catalog and user identities and adopts response state', async () => {
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { favoriteState, toggleFavorite };\n})()`, {
    _: value => value,
  });
  const payloads = [];
  const ctx = {
    api: {
      normalizeError: value => value,
      strategies: { favorite: value => { payloads.push(JSON.parse(value)); return { ok: true, state: { favorites: ['catalog-one', 'user-one'], revision: 19 } }; } },
    },
    refresh: () => Promise.resolve(),
    shell: { showToast() {} },
  };
  const data = { list: { value: { state: { favorites: ['catalog-one'], revision: 18 } } } };
  await helpers.toggleFavorite(ctx, data, { id: 'catalog-one' });
  const refreshed = { list: { value: { state: { favorites: ['catalog-one'], revision: 19 } } } };
  await helpers.toggleFavorite(ctx, refreshed, { id: 'user-one' });
  assert.deepEqual(payloads, [
    { expectedRevision: 18, id: 'catalog-one', favorite: false },
    { expectedRevision: 19, id: 'user-one', favorite: true },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.favoriteState({}))), {
    favorites: ['catalog-one', 'user-one'], revision: 19,
  });
});

test('stale favorite mutation fails closed without inventing a new state revision', async () => {
  assert.match(page, /operation === 'favorite'[\s\S]*state\.favoriteState = null[\s\S]*refresh\(ctx\)/);
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { favoriteState, toggleFavorite };\n})()`, {
    _: value => value,
  });
  let request;
  const ctx = {
    api: {
      normalizeError: value => value,
      strategies: { favorite: value => { request = JSON.parse(value); return { ok: false, error: { code: 'ECONFLICT' } }; } },
    },
    refresh: () => Promise.resolve(),
    shell: { showToast() {} },
  };
  const result = await helpers.toggleFavorite(ctx, { list: { value: { state: { favorites: ['user-one'], revision: 17 } } } }, { id: 'user-one' });
  assert.equal(result, null);
  assert.deepEqual(request, { expectedRevision: 17, id: 'user-one', favorite: false });
  assert.equal(helpers.favoriteState({}), null);
});

test('new Strategy editor can add a Profile and preserves zero-enabled Preview versus server rejection', () => {
  assert.match(page, /function addProfile\(/);
  assert.match(page, /Add Profile|Добавить профиль/);
  assert.match(page, /strategy\.profiles\.length\s*===\s*0/);
  assert.doesNotMatch(page, /!strategy\.profiles\.length\)\s*\{/);
  assert.match(page, /enabledProfiles|enabled !== false/);
  assert.match(page, /ctx\.api\.strategies\.validate/);
});

test('Available filtering requires explicit backend availability and unknown catalog entries remain searchable only', () => {
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { strategyAvailability, normalizeStrategy };\n})()`, {
    _: value => value,
  });
  assert.equal(helpers.strategyAvailability(helpers.normalizeStrategy({ id: 'unknown' })), undefined);
  assert.equal(helpers.strategyAvailability(helpers.normalizeStrategy({ id: 'yes', availability: 'available' })), true);
  assert.equal(helpers.strategyAvailability(helpers.normalizeStrategy({ id: 'no', availability: 'drifted' })), false);
  assert.match(page, /state\.filter === 'available' && strategyAvailability\(strategy\) !== true/);
});

test('top-level catalog metadata is mapped into display/search text', () => {
  const prefix = page.slice(0, page.lastIndexOf('return baseclass.extend({'));
  const helpers = vm.runInNewContext(`(function () {${prefix}\nreturn { normalizeStrategy, metadataText };\n})()`, {
    _: value => value,
  });
  const strategy = helpers.normalizeStrategy({ id: 'catalog-one', description: 'TLS preset', author: 'Avatar', protocol: 'tcp', provenance: 'manifest' });
  const metadata = helpers.metadataText(strategy);
  for (const value of ['TLS preset', 'Avatar', 'tcp', 'manifest']) assert.match(metadata, new RegExp(value));
  assert.match(page, /metadataText\(strategy\)/);
});
