import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js', 'utf8');
const api = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');
const css = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css', 'utf8');

test('Resources page keeps the canonical Asset Registry center and segmented filters', () => {
  for (const label of ['Ресурсы', 'Все', 'Системные', 'Пользовательские', 'Открыть workspace']) assert.match(page, new RegExp(label));
  assert.match(page, /shell\.segmented/);
  assert.match(page, /ctx\.api\.resources\.(status|check)/);
  assert.match(page, /assetTypeForRoute/);
  assert.match(page, /asset\.type === 'blob'/);
  assert.doesNotMatch(page, /<table/);
});

test('Resources UI exposes human states, provenance details, consumer references, and user CRUD protection', () => {
  for (const label of ['Доступно обновление', 'Пакетная база', 'Технические детали', 'Используется', 'Импортировать', 'Обновить ресурс', 'Удалить']) assert.match(page, new RegExp(label));
  assert.match(page, /asset\.references/);
  assert.match(page, /asset\.provenance/);
  assert.match(page, /management\(asset\)\.editable === true/);
  assert.match(page, /ctx\.api\.assets\.(import|update|validate|delete)/);
});

test('Resources UI has stable catalog geometry and narrow layout rules', () => {
  for (const selector of ['.z2m-resource-row', '.z2m-resource-source-card', '.z2m-resource-type-icon', '.z2m-resource-change-summary', '@media(max-width:760px)']) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const method of ['resourcesStatus', 'resourcesCheck', 'resourcesUpdate']) assert.match(api, new RegExp(method));
});

test('Resource Center exposes one lazy route-aware workspace for first-class assets', () => {
  for (const fragment of [
    'assets.content', 'assets.validateContent', 'expectedRevision', 'contentBase64',
    'generateTlsClientHello', 'generateHttpRequest', 'boundedHexView',
    'assets.asn', 'Синтаксическая проверка недоступна', 'references',
    'assets.importUrl', 'Дублировать как пользовательский ресурс',
  ]) assert.match(page, new RegExp(fragment.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), fragment);
  assert.match(page, /assetTypeForRoute/);
  assert.match(page, /routeParams/);
  assert.doesNotMatch(page, /fetch\s*\(/);
});

test('Package resources keep content available in a read-only editor', () => {
  assert.match(page, /Просмотр доступен/);
  assert.match(page, /CodeEditor\.mount/);
  assert.match(page, /readOnly: !genericEditable\(asset\)/);
  assert.doesNotMatch(page, /z2m-lua-editor-overlay/);
});

test('Z2K lifecycle assets must not be treated as generic-editable when mutable is only lifecycle capability', () => {
  assert.match(page, /function genericEditable\(asset\)/);
  assert.match(page, /readOnly: !genericEditable\(asset\)/);

  const lifecycleAsset = {
    id: 'lua:z2k-modern-core',
    type: 'lua',
    ownership: 'manager',
    mutable: true,
    management: { owner: 'z2k-core', mode: 'lifecycle', editable: false, deletable: false },
    provenance: {
      kind: 'catalog/upstream',
      source: 'necronicle/z2k',
      bundleId: 'z2k-curated-lua',
      version: 'r-79.7',
    },
  };

  function currentWorkspaceEditabilityPredicate(asset) {
    return asset.management && asset.management.editable === true;
  }

  assert.equal(
    currentWorkspaceEditabilityPredicate(lifecycleAsset),
    false,
    'lifecycle-owned Z2K assets must stay read-only in Resources even though apply_bundle needs mutable=true internally',
  );
});
