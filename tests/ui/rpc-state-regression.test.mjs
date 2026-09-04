import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const api = fs.readFileSync(`${ROOT}/z2m-api.js`, 'utf8');
const loading = fs.readFileSync(`${ROOT}/z2m-overview-loading.js`, 'utf8');
const overview = fs.readFileSync(`${ROOT}/z2m-overview.js`, 'utf8');

test('Home allows slow but bounded read-only RPC responses from embedded routers', () => {
  assert.match(loading, /var LOAD_TIMEOUT_MS = 15000;/,
    'Home must leave enough bounded time for valid status/catalog/Telegram responses');
});

test('Home keeps canonical active strategy when optional preview fails', () => {
  assert.match(overview, /var strategy = activeName !== null[\s\S]*?envelopeError\('preview'\)/,
    'canonical status_fast strategy must take precedence over preview errors');
});

test('Home read-only RPCs have explicit bounded timeouts for router-side collectors', () => {
  for (const method of [
    'discord_profile_preview', 'strategies_recommendations', 'tg_product_status',
    'events_tail', 'maintenance_status', 'proxy_status', 'proxy_health'
  ]) {
    const declaration = api.match(new RegExp(`method:'${method}'[^}]*}`));
    assert.ok(declaration, `RPC declaration is present for ${method}`);
    assert.match(declaration[0], /timeout: 60/, `${method} must remain bounded at 60 seconds`);
  }
});

test('Heavy strategy read RPCs stay bounded beyond the All-in-One compile window', () => {
  const strategyRead = api.slice(api.indexOf('function z2kStrategyRead'), api.indexOf('function z2kStrategyList'));
  assert.match(strategyRead, /timeout:\s*120000/,
    'strategies_get/preview/validate need a bounded 120-second transport window');
});
