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

test('critical Home/Strategy/Telegram reads use real bounded request transport', () => {
  assert.match(api, /var Z2K_READ_TIMEOUT_MS = 15000;/,
    'critical reads need a transport timeout independent of rpc.declare options');
  assert.match(api, /function z2kReadRpc\(method, params\)/);
  assert.match(api, /request\.post\(rpc\.getBaseURL\(\), \[message\], \{\s*timeout: Z2K_READ_TIMEOUT_MS/);
  for (const method of [
    'status_fast', 'strategies_catalog_status', 'proxy_status', 'proxy_health', 'events_tail'
  ]) {
    assert.match(api, new RegExp(`${method}`), `critical RPC method is present: ${method}`);
  }
  assert.match(api, /statusFast:z2kRead\.bind\(null, 'status_fast'\)/);
  assert.match(api, /strategiesCatalogStatus:z2kRead\.bind\(null, 'strategies_catalog_status'\)/);
  assert.match(api, /proxyStatus:z2kRead\.bind\(null, 'proxy_status'\)/);
  assert.match(api, /proxyHealth:z2kReadEdit\.bind\(null, 'proxy_health'\)/);
  assert.match(api, /eventsTail:z2kReadEdit\.bind\(null, 'events_tail'\)/);
  assert.doesNotMatch(api, /statusFast:rpc\.declare/);
  assert.doesNotMatch(api, /strategiesCatalogStatus:rpc\.declare/);
  assert.doesNotMatch(api, /proxyHealth:rpc\.declare/);
  assert.doesNotMatch(api, /eventsTail:rpc\.declare/);
});

test('Heavy strategy read RPCs stay bounded beyond the All-in-One compile window', () => {
  const strategyRead = api.slice(api.indexOf('function z2kStrategyRead'), api.indexOf('function z2kStrategyList'));
  assert.match(strategyRead, /timeout:\s*120000/,
    'strategies_get/preview/validate need a bounded 120-second transport window');
});
