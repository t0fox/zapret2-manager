import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const BACKEND = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';

test('TG version UI is truthful about latest-only backend support', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const backend = fs.readFileSync(BACKEND, 'utf8');

  assert.doesNotMatch(ui, /Только latest compatible/);
  assert.doesNotMatch(ui, /Только из доверенного APK feed/);
  assert.match(ui, /Установленная версия/);
  assert.match(ui, /Package version/);
  assert.match(ui, /Последняя доступная версия/);
  assert.match(ui, /status\.packages/);
  assert.match(ui, /provider === provider\.id/);
  assert.match(ui, /Исторический выбор версий недоступен/);
  assert.match(ui, /Источник пакета не выбирается/);
  assert.match(backend, /latestOnly:\s*true/);
});

test('TG unavailable state names the failed preflight or package check', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /preflight\.available === false/);
  assert.match(ui, /update\.installable === false/);
  assert.match(ui, /Причина недоступности/);
});
