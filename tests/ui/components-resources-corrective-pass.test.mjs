import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const assets = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8');
const maintenance = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const componentsCss = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css'), 'utf8');
const uiCss = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const candidates = ['\n  function ', '\nfunction ']
    .map(prefix => source.indexOf(prefix, start + 10))
    .filter(index => index >= 0);
  const next = candidates.length ? Math.min(...candidates) : -1;
  return source.slice(start, next < 0 ? source.length : next);
}

test('Resources header does not repeat counts that already live in the filters', () => {
  assert.doesNotMatch(assets, /var summaryMeta/);
  assert.doesNotMatch(assets, /summaryMeta/);
  assert.match(assets, /var summary = model\.summary/);
  assert.doesNotMatch(assets, /summaryForRoute/);
  assert.match(assets, /ResourcesModel\.resourceCountText\(managedCount\)/);
});

test('Z2K strategy source is managed by Core while Avatar retains independent controls', () => {
  const source = sliceFunction(assets, 'renderStrategySource');
  assert.match(source, /card\.id === 'z2k'/);
  assert.match(source, /Управляется Z2K Core/);
  assert.doesNotMatch(source, /sourceSetEnabled/);
  assert.match(source, /managed\s*\? \[E\('span'/);
  assert.match(source, /ctx\.shell\.button\(_\('Обновить'/);
});

test('Resources bulk refresh uses independent candidates instead of the combined catalog transaction', () => {
  const sources = sliceFunction(assets, 'renderStrategySources');
  assert.match(sources, /ResourcesModel\.bulkRefreshCandidates/);
  assert.match(sources, /sourceRefresh\(card\.id\)/);
  assert.doesNotMatch(sources, /catalogRefreshStart/);
});

test('Resources renders light semantic sections for source, managed, and user entities', () => {
  assert.match(assets, /function renderGroupSection\(group\)/);
  assert.match(assets, /sectionKind = isStrategySource \? 'source' : group\.id === 'user' \? 'user' : 'managed'/);
  assert.match(assets, /'class': 'z2m-resource-section z2m-resource-section--' \+ sectionKind/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--source/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--managed/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--user/);
  assert.match(assets, /groupsToShow\.map\(renderGroupSection\)/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section\{/);
});

test('Empty user resources show a neutral empty state with Add, not an актуально badge', () => {
  const start = assets.indexOf("if (group.id === 'user' && assets.length === 0)");
  assert.ok(start >= 0, 'empty user branch exists');
  const end = assets.indexOf('\n    var titleRow', start);
  const branch = assets.slice(start, end < 0 ? start + 1000 : end);
  assert.doesNotMatch(branch, /\bbadge\b/);
  assert.match(branch, /openImport/);
});

test('Components hero has one primary status plus readiness, indicators, and freshness/actions', () => {
  const hero = sliceFunction(maintenance, 'renderHero');
  assert.doesNotMatch(hero, /heroMessage/);
  assert.match(hero, /z2m-components-hero-ready/);
  assert.match(hero, /z2m-components-hero-dots/);
  assert.match(hero, /z2m-components-hero-meta/);
});

test('Component facts use compact label/value rows instead of a sparse four-corner grid', () => {
  assert.match(componentsCss, /\.z2m-component-card-meta\{display:grid;gap:0;/);
  assert.match(componentsCss, /\.z2m-component-meta-row\{display:grid;grid-template-columns:minmax\(120px/);
});

test('Reinstall stays secondary while an actionable update remains primary', () => {
  const card = sliceFunction(maintenance, 'renderZ2KCard');
  assert.match(card, /updateActionClass/);
  assert.match(card, /updateActionClass = updateActionLabel\.indexOf\(_\('Переустановить'\)\) === 0 \? 'sm' : 'primary sm'/);
  assert.match(card, /shell\.button\(updateActionLabel, updateActionClass/);
});

test('Components does not expose a second normal-flow Z2K management dashboard', () => {
  assert.doesNotMatch(maintenance, /УПРАВЛЕНИЕ РЕСУРСАМИ/);
  assert.equal((maintenance.match(/z2m-component-card--z2k/g) || []).length, 1);
  assert.match(maintenance, /Автообнаружение/);
  assert.match(maintenance, /Совместимость/);
});

test('Optional cards keep natural heights without a hidden advanced mode', () => {
  assert.match(componentsCss, /\.z2m-components-section--optional \.z2m-components-grid\{align-items:start\}/);
  assert.doesNotMatch(maintenance, /z2m-components-advanced-row|Расширенный режим/);
  assert.doesNotMatch(maintenance, /z2m-components-section--advanced/);
});

test('Resource groups regain restrained visual grouping without a global style override', () => {
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--source/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--managed/);
  assert.match(uiCss, /#z2m-view-assets \.z2m-resource-section--user/);
  assert.doesNotMatch(uiCss, /(^|\n)\s*\[hidden\]\s*\{/);
});
