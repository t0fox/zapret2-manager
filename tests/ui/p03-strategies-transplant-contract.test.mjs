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
  assert.ok(page, 'P03 donor-derived Strategies module must exist');
  for (const marker of [
    '38ed85ce487c6b3dbdf703a5be197795f7c0cad1',
    'strategy-card', 'strategy-card-header', 'strategy-card-profiles',
    'strategy-card-actions', 'strat-editor-layout', 'profile-editor-item',
    'strategy-modal', 'preview-modal', 'strat-bulkbar',
    'ListUI', 'renderStrategyCard', 'renderEditorForm', 'catalog-summary',
    'Обновить стратегии', 'Каталог стратегий', 'Активная стратегия',
    'Рекомендуемые', 'Пользовательские'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `missing donor marker: ${marker}`);
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
  assert.doesNotMatch(page, /Avatar Strategy|Canonical Strategy catalog|Strategy Catalog|Available Strategies|Strategy Scanner/);
  assert.doesNotMatch(route, /z2m-strategy-workflow/);
});

test('P03 documents donor-only healthcheck/autocircular scope instead of faking it', () => {
  const page = read('z2m-strategies.js');
  const audit = fs.existsSync(path.join(root, 'docs/05-parity/avatar-strategies-transplant-audit.md'))
    ? fs.readFileSync(path.join(root, 'docs/05-parity/avatar-strategies-transplant-audit.md'), 'utf8') : '';
  assert.ok(page, 'P03 donor-derived Strategies module must exist');
  assert.match(`${page}\n${audit}`, /BACKEND_NOT_READY|INTENTIONAL_Z2M_DIFFERENCE/);
  assert.doesNotMatch(page, /healthcheck\/status|autocircular|API\.get\(/);
});

test('P03 fixes the DOM-node string coercion regression at its source', () => {
  const legacy = read('z2m-strategy.js');
  assert.match(legacy, /return errors\.length \? E\('div'/);
  assert.doesNotMatch(legacy, /return errors;\s*\}/);
  assert.doesNotMatch(legacy, /renderError[\s\S]{0,500}errors\.join/);
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
  assert.match(catalog, /strategy_catalog_load[\s\S]*if \(loaded != null[\s\S]*return \{ ok: true, catalog: loaded \}/);
  assert.match(catalog, /strategy_catalog_reload[\s\S]*let result = load_catalog\(root\)/);
});

test('P03 static deploy does not reload the target auth daemon', () => {
  const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-strategies-parity-target.sh'), 'utf8');
  assert.match(deploy, /38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.doesNotMatch(deploy, /rpcd\s+reload/);
});
