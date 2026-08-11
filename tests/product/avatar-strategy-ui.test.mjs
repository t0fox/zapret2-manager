import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const page = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js');
const pageAdapter = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-page.js');
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
