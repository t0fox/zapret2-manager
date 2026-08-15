import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';

test('M6 routing has a canonical LuCI API surface and app route', () => {
  const api = fs.readFileSync(`${ROOT}/z2m-api.js`, 'utf8');
  const app = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  const page = fs.readFileSync(`${ROOT}/z2m-unified-routing.js`, 'utf8');

  for (const method of ['route_list', 'route_get', 'route_create', 'route_update', 'route_preview', 'route_validate', 'route_apply', 'route_status', 'route_remove', 'route_reconcile']) {
    assert.match(api, new RegExp(`method:'${method}'`), `missing canonical RPC ${method}`);
    assert.match(page, new RegExp(`routing\\.[a-zA-Z]+`), `page does not use routing API for ${method}`);
  }
  assert.match(api, /routing:\{/);
  assert.match(app, /z2m-unified-routing as UnifiedRouting/);
  assert.match(app, /'unified-routing': UnifiedRouting/);
  assert.doesNotMatch(app, /'unified-routing',[^\]]*PENDING_MODULE/);
});

test('M6 routing UI exposes lifecycle and ownership states without a second DNS writer', () => {
  const page = fs.readFileSync(`${ROOT}/z2m-unified-routing.js`, 'utf8');
  for (const label of ['Preview', 'Validate', 'Apply', 'Status', 'Remove', 'Reconcile']) {
    assert.match(page, new RegExp(label, 'i'), `missing ${label} interaction`);
  }
  assert.match(page, /service_dns/);
  assert.match(page, /delegated|owner|владелец/i);
  assert.doesNotMatch(page, /dns_product_apply|service_dns_apply\s*\(/);
});
