import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';

test('typed asset routes use the canonical Asset Registry instead of placeholders', () => {
  const app = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  const assets = fs.readFileSync(`${ROOT}/z2m-assets.js`, 'utf8');

  for (const route of ['ipsets', 'blobs', 'lua', 'hosts']) {
    assert.match(app, new RegExp(`(?:['"]${route}['"]|${route})\\s*:\\s*Assets`), `route ${route} is not backed by Asset Registry`);
  }
  assert.match(assets, /ctx\.route/);
  assert.match(assets, /assetType/);
  assert.match(assets, /type === assetType/);
  assert.match(assets, /refresh\(ctx\.route\)/);
});

test('WARP routes expose complete truthful disabled UI without backend calls', () => {
  const app = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  const warp = fs.readFileSync(`${ROOT}/z2m-warp-page.js`, 'utf8');

  for (const route of ['warp', 'warp-setup', 'warp-in-warp']) {
    assert.match(app, new RegExp(`(?:['"]${route}['"]|${route})\\s*:\\s*Warp`), `route ${route} is not wired`);
  }
  for (const label of ['WARP / MASQUE', 'Настройка WARP', 'WARP-in-WARP', 'Установить', 'Автозапуск', 'Endpoint', 'Компонент не установлен']) {
    assert.match(warp, new RegExp(label, 'i'), `missing WARP UI surface: ${label}`);
  }
  assert.doesNotMatch(warp, /ctx\.api\./, 'disabled WARP UI must not invent RPC calls');
  assert.match(warp, /disabled/);
});
