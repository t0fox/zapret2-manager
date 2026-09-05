import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const UI = fs.readFileSync(`${ROOT}/z2m-proxy-page-core.js`, 'utf8');
const SHELL = fs.readFileSync(`${ROOT}/z2m-shell.js`, 'utf8');
const CSS = fs.readFileSync(`${ROOT}/z2m-components.css`, 'utf8');
const APP = fs.readFileSync(`${ROOT}/app.js`, 'utf8');

test('Telegram lifecycle paints pending state before invoking synchronous RPC', () => {
  const mutation = UI.slice(UI.indexOf('function mutation('), UI.indexOf('\nfunction tgOperationLabel', UI.indexOf('function mutation(')));
  assert.match(mutation, /state\.busy\s*=\s*name/);
  assert.match(mutation, /rerenderProxy\(ctx\)/, 'busy state must repaint before the RPC starts');
  assert.match(mutation, /Promise\.resolve\(\)\.then\(/, 'the RPC must start after the repaint boundary');
  assert.ok(mutation.indexOf('rerenderProxy(ctx)') < mutation.indexOf('run()'),
    'a synchronous run must not happen before the pending UI is painted');

  const lifecycle = UI.slice(UI.indexOf('function lifecycle('), UI.indexOf('\nfunction refreshWithHealth', UI.indexOf('function lifecycle(')));
  assert.doesNotMatch(lifecycle, /method\(\)/, 'lifecycle must pass an operation factory, not invoke it while building the click handler');
  assert.match(UI, /z2m-proxy-lifecycle-feedback/);
  assert.match(UI, /aria-busy/);
  assert.match(UI, /Запускаем Telegram Proxy…/);
});

test('Telegram health check has an explicit pending state and readable outcome', () => {
  assert.match(UI, /tgHealthCheck/);
  assert.match(UI, /Проверяем доступность Telegram…/);
  assert.match(UI, /Подключение подтверждено/);
  assert.match(UI, /Не подтверждено/);
  assert.match(UI, /Проверить снова/);
  assert.match(UI, /aria-live['"]\s*:\s*['"]polite/);
});

test('automatic health completion clears its own pending lifecycle feedback', () => {
  const scheduler = UI.slice(UI.indexOf('function scheduleDeferred('), UI.indexOf('\nfunction load(', UI.indexOf('function scheduleDeferred(')));
  assert.match(scheduler, /var healthWasPending\s*=\s*state\.tgHealthCheck/,
    'automatic health must own an explicit completion guard');
  assert.match(scheduler, /healthWasPending\s*\|\|\s*state\.busy\s*===\s*['"]health['"]/,
    'cleanup must not depend only on the explicit-button busy flag');
});

test('Telegram overview uses one compact three-step health chain', () => {
  assert.match(UI, /z2m-proxy-overview-lede/);
  assert.match(UI, /z2m-proxy-service-facts/);
  assert.match(CSS, /\.z2m-proxy-health-chain\s*\{[^}]*grid-template-columns:repeat\(3,/);
  assert.match(CSS, /\.z2m-proxy-lifecycle-feedback/);
  assert.doesNotMatch(CSS, /\.z2m-proxy-health-chain\s*\{[^}]*repeat\(4,/);
});

test('Telegram health chain uses a CSS arrow escape, not a literal backslash sequence', () => {
  assert.match(CSS, /content:"\\2192"/, 'the separator must render as a Unicode arrow');
  assert.doesNotMatch(CSS, /content:"\\\\2192"/, 'double escaping renders the raw \\2192 text');
});

test('shared button contract supports accessible busy controls', () => {
  assert.match(SHELL, /attrs\s*\|\|\s*\{\}/);
  assert.match(UI, /'aria-busy'/);
});

test('refresh survives a same-live repaint that replaces the module context', () => {
  const refresh = APP.slice(APP.indexOf('refresh: function (next)'), APP.indexOf('invalidateCache:', APP.indexOf('refresh: function (next)')));
  assert.match(refresh, /if \(activeModule !== module \|\| !activeContext \|\| activeContext\.route !== tab\) return Promise\.resolve\(\);/,
    'a repaint may replace ctx, but a live route must still be refreshable');
  assert.doesNotMatch(refresh, /if \(activeContext !== ctx\) return Promise\.resolve\(\);/,
    'strict object identity strands operations after their pending repaint');
});
