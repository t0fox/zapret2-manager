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
const strategiesPreviewPage = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
const strategiesPreviewCss = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css');
const pageAdapter = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js');
const auto = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-auto.js');
const runs = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js');
const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-model.js');
const workflow = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow.js');
const workflowCore = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-workflow-core.js');
const profilesWorkflow = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-profiles-workflow.js');

test('Strategy API declares the canonical catalog, editor, preview, apply, and import RPCs', () => {
  for (const method of [
    'strategies_create', 'strategies_update',
    'strategies_delete', 'strategies_duplicate', 'strategies_favorite',
    'strategies_catalog_reload', 'strategies_import_profiles',
  ]) assert.match(api, new RegExp(`method:'${method}'`), method);
  assert.match(api, /strategiesCatalogStatus:z2kRead\.bind\(null, 'strategies_catalog_status'\)/,
    'strategies_catalog_status must use the shared bounded read transport');
  assert.match(api, /z2kStrategyList/);
  for (const method of ['strategies_get', 'strategies_preview', 'strategies_validate'])
    assert.match(api, new RegExp(`'${method}'`), method);
  assert.match(api, /z2kLongMutation\('strategies_apply'/);
  for (const method of [
    'strategiesCreate', 'strategiesUpdate', 'strategiesDelete',
    'strategiesDuplicate', 'strategiesFavorite', 'strategiesImportProfiles',
  ]) assert.match(api, new RegExp(`\\b${method}:rpc\\.declare`), method);
  assert.match(api, /strategiesGet:z2kStrategyRead\.bind\(null, 'strategies_get'\)/);
  assert.match(api, /strategiesPreview:z2kStrategyRead\.bind\(null, 'strategies_preview'\)/);
  assert.match(api, /strategiesValidate:z2kStrategyRead\.bind\(null, 'strategies_validate'\)/);
  assert.match(api, /strategiesApply:z2kStrategyApply/);
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

test('Preview dialog keeps the command primary and exposes bounded accessible status sections', () => {
  assert.match(strategiesPreviewPage, /function previewCommandSection\(answer, output, pending, commandId\)/);
  assert.match(strategiesPreviewPage, /function previewCommandOverview\(answer\)/);
  assert.match(strategiesPreviewPage, /strategy-preview-command-overview/);
  assert.match(strategiesPreviewPage, /Полная команда nfqws2/);
  assert.match(strategiesPreviewPage, /<details class="strategy-preview-raw" open><summary>Полная команда nfqws2<\/summary>/);
  assert.match(strategiesPreviewPage, /object\(answer && answer\.presentation\)\.mode === 'compact'/);
  assert.match(strategiesPreviewPage, /aria-busy="true"/);
  assert.match(strategiesPreviewPage, /Проверить стратегию/);
  assert.match(strategiesPreviewPage, /class="strategy-preview-status-grid"/);
  assert.match(strategiesPreviewPage, /strategy-preview-inline-spinner/);
  assert.match(strategiesPreviewPage, /Исходные аргументы/);
  assert.match(strategiesPreviewPage, /strategy-preview-technical-grid/);
  assert.match(strategiesPreviewPage, /strategy-preview-technical-raw/);
  assert.match(strategiesPreviewPage, /footer\.id = 'preview-footer'/);
  assert.match(strategiesPreviewPage, /var footer = modal && modal\.querySelector\('#preview-footer'\)/);
  assert.match(strategiesPreviewPage, /footer\.innerHTML =/);
  const previewStart = strategiesPreviewCss.indexOf('#z2m-view-strategy #preview-modal');
  const previewEnd = strategiesPreviewCss.indexOf('/* Focused visual review pass', previewStart);
  const previewCss = strategiesPreviewCss.slice(previewStart, previewEnd < 0 ? undefined : previewEnd);
  assert.match(previewCss, /#z2m-view-strategy #preview-modal \.modal-content\{[^}]*overflow:hidden/);
  assert.match(previewCss, /\.strategy-preview-command\{[^}]*max-height:min\(42vh,390px\)/);
  assert.match(previewCss, /\.strategy-preview-status-grid\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(previewCss, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(previewCss, /@keyframes z2m-preview-spin/);
  assert.match(previewCss, /\.strategy-preview-list ul\{[^}]*max-height:132px/);
  assert.match(previewCss, /\.strategy-preview-list li\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(previewCss, /\.strategy-preview-footer\{[^}]*position:static/);
  assert.doesNotMatch(previewCss, /\.strategy-preview-footer\{[^}]*margin:14px -18px -18px/);
  assert.doesNotMatch(previewCss, /transition:all/);
});

test('server validation response refreshes the Preview status projection', () => {
  assert.match(strategiesPreviewPage, /function previewDetails\(answer, strategy, validationPending\)/);
  assert.match(strategiesPreviewPage, /validationPending \? 'checking'/);
  assert.match(strategiesPreviewPage, /previewDetails\(answer, state\.preview\.strategy, state\.preview\.pending && state\.preview\.operation === 'validate'\)/);
  assert.match(strategiesPreviewPage, /function mergePreviewValidation\(/);
  assert.match(strategiesPreviewPage, /preview\.answer = mergePreviewValidation\(preview\.answer, answer\)/);
});

test('successful Strategy Apply adopts the fresh backend selection before rebuilding the list', () => {
  const refreshStart = strategiesPreviewPage.indexOf('function refreshData(full)');
  const refreshEnd = strategiesPreviewPage.indexOf('function formatCatalogDuration', refreshStart);
  const refreshSource = strategiesPreviewPage.slice(refreshStart, refreshEnd);
  assert.notEqual(refreshStart, -1, 'refreshData must exist');
  assert.match(refreshSource, /var freshSelection = identity\(data\)\.selectedId;[\s\S]*state\.selectedId\s*=\s*freshSelection/);
});

test('background status refresh adopts a delayed post-Apply selection into the list projection', () => {
  const refreshStart = strategiesPreviewPage.indexOf('function refreshData(full)');
  const refreshEnd = strategiesPreviewPage.indexOf('function formatCatalogDuration', refreshStart);
  const refreshSource = strategiesPreviewPage.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /var freshStatus = \{ value: results\[0\]\.value \|\| \{\} \};[\s\S]*retainConfirmedApplyIdentity\(\{ status: freshStatus \}\)[\s\S]*state\.data\.status = freshStatus[\s\S]*var freshSelection = identity\(state\.data\)\.selectedId[\s\S]*state\.selectedId\s*=\s*freshSelection/);
  assert.match(refreshSource, /state\.rows\s*=\s*buildRows\(state\.data\)/);
});

test('catalog Strategy Apply uses the bounded long-running transport', () => {
  assert.match(api, /function z2kStrategyApply\(value\)/);
  assert.match(api, /z2kLongMutation\('strategies_apply', \{ edit: value \}\)/);
});

test('effective command and status drift are rendered from backend responses without client compilation', () => {
  assert.match(page, /effectiveCommand/);
  assert.match(page, /effectiveArgv/);
  assert.match(page, /active|selected/);
  assert.match(page, /drift/);
  assert.doesNotMatch(page, /NFQWS2_OPT|join\(['"] --new ['"]|strategyArgs\s*=\s*.*join/);
});

test('Strategy page adapter keeps the canonical Strategies lifecycle reachable', () => {
	assert.match(pageAdapter, /z2m-strategies as Strategies/);
	assert.match(pageAdapter, /var mode = 'manual'/);
	assert.doesNotMatch(pageAdapter, /EngineGate|Auto\.load|Runs\.load/);
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
    Strategies: module('strategies'),
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

function vmNode() {
  return {
    children: [],
    firstChild: null,
    appendChild(child) { this.children.push(child); this.firstChild = this.children[0] || null; return child; },
    insertBefore(child) { this.children.unshift(child); this.firstChild = this.children[0] || null; return child; },
    replaceChildren(...children) { this.children = children.flat().filter(Boolean); this.firstChild = this.children[0] || null; },
    addEventListener() {},
    querySelectorAll() { return []; },
    getAttribute() { return null; },
  };
}

function loadLuCIModule(source, dependencies, calls) {
  return vm.runInNewContext(`(function () {${source}\n})()`, {
    ...dependencies,
    baseclass: { extend: value => value },
    E: (...args) => vmNode(),
    _: value => value,
    calls,
  });
}

function loadRecursiveStrategyPage(calls) {
  const strategyModel = {
    normalizeCatalog: () => ({ candidates: [], applicableIds: [] }),
    normalizeCorpus: () => ({ valid: false, count: 0 }),
    normalizeRun: () => ({ active: false, complete: false, candidates: [], infrastructureFailures: [], raw: {} }),
    progress: () => ({ testedDomains: 0, totalDomains: 0, percent: 0, complete: false }),
    startGate: () => ({ allowed: false, reason: 'test' }),
  };
  const profileWorkflow = loadLuCIModule(profilesWorkflow, {}, calls);
  const strategy = loadLuCIModule(page, { profilesWorkflow: profileWorkflow }, calls);
  const originalRenderCompatibility = strategy.renderCompatibility;
  strategy.renderCompatibility = function (ctx, profileData) {
    calls.profileRenderer += 1;
    return originalRenderCompatibility(ctx, profileData);
  };
  const originalStrategyRender = strategy.render;
  strategy.render = function (ctx) {
    calls.strategyRenderer += 1;
    return originalStrategyRender(ctx);
  };

  const core = loadLuCIModule(workflowCore, { Strategy: strategy, StrategyModel: strategyModel }, calls);
  const workflowModule = loadLuCIModule(workflow, { Core: core }, calls);
  const lifecycle = name => ({
    load: () => { calls.push(`${name}.load`); return Promise.resolve({}); },
    render: () => { calls.push(`${name}.render`); return vmNode(); },
    mount: () => calls.push(`${name}.mount`),
    unmount: () => calls.push(`${name}.unmount`),
  });
  const pageModule = loadLuCIModule(pageAdapter, {
    EngineGate: { wrap: value => value },
    Strategy: strategy,
    Workflow: workflowModule,
    Auto: lifecycle('auto'),
    Runs: lifecycle('runs'),
  }, calls);
  return { pageModule, strategy };
}

function recursivePageContext(advanced, calls) {
  const shell = {
    format: { text: value => value === null || value === undefined || value === '' ? null : String(value), timestamp: () => '' },
    panel: () => vmNode(),
    statePanel: () => vmNode(),
    chip: () => vmNode(),
    button: label => { calls.editorButtons.push(label); return vmNode(); },
    subTabs: (tabs, active, onSelect) => {
      calls.tabGroups.push({ tabs, active, onSelect });
      return vmNode();
    },
    showToast() {},
    openModal() {},
    closeModal() {},
  };
  const rpc = () => Promise.resolve({});
  const api = {
    normalizeError: error => error,
    strategies: {
      list: () => Promise.resolve({ strategies: [{ id: 'strategy-one', name: 'Strategy One', origin: 'avatar_builtin', is_builtin: true, revision: 0, availability: 'available', profiles: [{ id: 'profile-one', name: 'Profile One', args: '--test' }] }], state: { revision: 1, favorites: [] } }),
      catalogStatus: () => Promise.resolve({ digest: 'catalog-test' }),
      get: () => Promise.resolve({ strategy: { id: 'strategy-one', name: 'Strategy One', origin: 'avatar_builtin', is_builtin: true, revision: 0, availability: 'available', profiles: [{ id: 'profile-one', name: 'Profile One', args: '--test' }] } }),
    },
    strategy: { preview: rpc },
    orchestra: {
      catalog: rpc, corpus: rpc, runStatus: rpc, runHistory: rpc, probePreflight: rpc,
    },
    profiles: {
      list: () => Promise.resolve({ profiles: [{ id: 'profile-one', name: 'Profile One', opt: '--test' }] }),
    },
    service: { status: () => Promise.resolve({ strategyStatus: { id: 'strategy-one', drift: false, availability: 'available', revision: 0 } }) },
  };
  return {
    store: { get: () => ({ ui: { advanced }, draft: {}, pending: {} }) },
    api,
    shell,
    refresh: () => Promise.resolve(),
    setDraft() {},
  };
}

test('Strategy page adapter loads and renders the canonical Strategies module for every UI mode', async () => {
  const calls = [];
  const pageModule = loadPageWithStubs(calls);
  const data = await pageModule.load(pageContext(true));
  assert.equal(data.mode, 'manual');
  assert.deepEqual(calls, ['strategies.load']);
  assert.ok(pageModule.render({ ...pageContext(true), data }));
  assert.deepEqual(calls, ['strategies.load', 'strategies.render']);
});

test('Advanced orchestration remains outside the canonical Strategies adapter', () => {
  assert.doesNotMatch(pageAdapter, /ctx\.api\.orchestra|Auto\.load|Runs\.load/);
  assert.match(auto, /ctx\.api\.orchestra\.(autoEnable|autoDisable|autoRun|autoStop|autoRestore)/);
  assert.match(runs, /ctx\.api\.orchestra\.(previewBest|applyBest)/);
});

test('canonical Strategies page exposes the advanced Compatibility renderer behind the UI flag', () => {
  assert.match(page, /function renderProfilesPane\(/);
  assert.match(page, /var advanced = !!\(ctx\.store\.get\(\)\.ui && ctx\.store\.get\(\)\.ui\.advanced\)/);
  assert.match(page, /compatibility: advanced \? renderProfilesPane/);
  assert.match(page, /state\.subtab/);
  assert.match(page, /id: 'compatibility'/);
});

test('Compatibility tab selection is stored in the canonical Strategy page state', () => {
  assert.match(page, /subtab: 'list'/);
  assert.match(page, /state\.subtab = id/);
  assert.match(page, /paneHost\.replaceChildren\(panes\[id\] \|\| panes\.list\)/);
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
