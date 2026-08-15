import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const API = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js';
const BACKEND = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';
const TG_PRODUCT = 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc';

test('TG version UI is truthful about latest-only backend support', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const backend = fs.readFileSync(BACKEND, 'utf8');

  assert.doesNotMatch(ui, /latest-only|Исторический выбор версий недоступен|Источник пакета не выбирается/i);
  assert.match(ui, /Установленная версия/);
  assert.match(ui, /Package version/);
  assert.match(ui, /Последняя доступная версия/);
  assert.match(ui, /status\.packages/);
  assert.match(ui, /provider === provider\.id/);
  assert.match(ui, /Версия/);
  assert.match(ui, /Источник/);
  assert.match(ui, /versions/);
  assert.match(backend, /proxy_provider_versions/);
  assert.match(backend, /sourceId/);
  assert.match(backend, /installable/);
});

test('TG unavailable state names the failed preflight or package check', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /preflight\.available === false/);
  assert.match(ui, /update\.installable === false/);
  assert.match(ui, /Причина недоступности/);
});

test('TG version/source contract is wired through the canonical product API', () => {
  const api = fs.readFileSync(API, 'utf8');
  const product = fs.readFileSync(TG_PRODUCT, 'utf8');
  assert.match(api, /tgProductVersions/);
  assert.match(api, /versions:/);
  assert.match(product, /tg_product_versions/);
  assert.match(product, /tg_product_check_updates/);
  assert.match(product, /sourceId/);
  assert.match(product, /version/);
});
