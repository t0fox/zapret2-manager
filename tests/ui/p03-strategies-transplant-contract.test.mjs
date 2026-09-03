import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = (name) => {
  const file = path.join(viewRoot, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

test('P03 uses a frozen donor-derived Strategies surface instead of the old custom catalog', () => {
  const page = read('z2m-strategies.js');
  const owner = read('z2m-strategy-editor.js');
  assert.ok(page, 'P03 donor-derived Strategies module must exist');
  for (const marker of [
    '38ed85ce487c6b3dbdf703a5be197795f7c0cad1',
    'strategy-card', 'strategy-card-header', 'strategy-card-profiles',
    'strategy-card-actions', 'strat-editor-layout',
    'strategy-modal', 'preview-modal', 'strat-bulkbar',
    'ListUI', 'renderStrategyCard', 'renderEditorForm', 'catalog-summary',
    'Обновить стратегии', 'Каталог стратегий', 'Активная стратегия',
    'Рекомендуемые', 'Пользовательские'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `missing donor marker: ${marker}`);
  for (const marker of ['strategy-editor-profile-tabs', 'strategy-editor-visual', 'circularBuilder', 'CodeEditor'])
    assert.match(owner, new RegExp(marker), `missing platform owner marker: ${marker}`);
  assert.doesNotMatch(page, /['"]\/api\//);
  assert.doesNotMatch(page, /fetch\s*\(/);
});

test('P03 page maps supported donor actions to canonical Z2M Strategy RPCs', () => {
  const page = read('z2m-strategies.js');
  const app = read('app.js');
  const route = read('z2m-strategy-page.js');
  for (const marker of ['strategies.list', 'strategies.get', 'strategies.create', 'strategies.update',
    'strategies.delete', 'strategies.duplicate', 'strategies.favorite', 'strategies.preview',
    'strategies.validate', 'strategies.apply']) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(app, /strategies:\s*Strategy/);
  assert.match(route, /z2m-view-strategy/);
  assert.match(route, /primary\.render/);
  assert.match(route, /function primaryModule[\s\S]*return Strategies/);
  assert.doesNotMatch(route, /Scanner\.(load|render|mount|unmount)/);
  assert.doesNotMatch(page, /Avatar Strategy|Canonical Strategy catalog|Available Strategies|Strategy Scanner/);
  assert.doesNotMatch(route, /z2m-strategy-workflow/);
});

test('P03 favorite mutation uses the shared Strategy state revision', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /function stateRevision\(data\)/);
  assert.match(page, /expectedRevision:\s*stateRevision\(state\.data\)/);
  assert.doesNotMatch(page, /favorite:\s*!strategy\.favorite,\s*expectedRevision:\s*strategy\.revision/);
});

test('Strategies closes the adopted healthcheck/autocircular surface through Z2M RPCs', () => {
  const page = read('z2m-strategies.js');
  assert.ok(page, 'P03 donor-derived Strategies module must exist');
  assert.match(page, /healthcheck|autocircular/);
  assert.doesNotMatch(page, /API\.get\(/);
});

test('P03 keeps current card/detail rendering on the active Strategies page', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /renderStrategyCard/);
  assert.match(page, /showDetails|details|strategy-modal/);
  assert.doesNotMatch(page, /renderError[\s\S]{0,500}errors\.join/);
});

test('P03 keeps loading, empty, and backend error states distinct', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /Загрузка стратегий/);
  assert.match(page, /Стратегии не найдены/);
  assert.match(page, /Не удалось загрузить стратегии/);
  assert.match(page, /listEnvelope\.error/);
});

test('P03 backend list path reuses one catalog snapshot and reload stays explicit', () => {
  const catalog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc'), 'utf8');
  const cli = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc'), 'utf8');
  assert.match(catalog, /strategy_catalog_load[\s\S]*if \(loaded != null[\s\S]*return \{ ok: true, catalog: loaded \}/);
  assert.match(catalog, /strategy_catalog_reload[\s\S]*strategy_catalog_resolve\(\{ forceVerify: true \}\)/);
  assert.match(catalog, /DERIVED_CACHE_PREFIX/);
  assert.match(catalog, /cached_catalog\(actualRoot, manifestResult\)/);
  assert.match(catalog, /load_catalog\(root, true\)/);
  assert.match(cli, /function catalog_wire_metadata\(strategy, current, compact\)[\s\S]*if \(compact == true\)[\s\S]*catalogDigest/);
  assert.match(cli, /wire_strategy\(strategy, current, selection, true\)/);
  assert.match(cli, /summary\.argsTruncated\s*=\s*true/);
  assert.match(cli, /function wire_strategy_for_list\(strategy, current, selection\)/);
  const model = fs.readFileSync(path.join(viewRoot, 'z2m-strategies-model.js'), 'utf8');
  const page = fs.readFileSync(path.join(viewRoot, 'z2m-strategies.js'), 'utf8');
  assert.match(model, /argsTruncated:\s*profile\.argsTruncated === true/);
  assert.match(page, /function mergeSelected\(\)[\s\S]*strategies\.get/);
  assert.match(page, /function copyStrategyToClipboard\(id\)[\s\S]*strategies\.get/);
});

test('the single target deploy path requires an explicit reviewed closure', () => {
  const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-target.sh'), 'utf8');
  assert.match(deploy, /MANIFEST/);
  assert.match(deploy, /EXPECTED_COMMIT/);
  assert.match(deploy, /git -C .*diff --quiet/);
  assert.match(deploy, /scp -q -O/);
  assert.match(deploy, /sha256sum/);
  assert.match(deploy, /BACKUP_ROOT/);
});
