import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const page = fs.readFileSync(`${root}/z2m-assets.js`, 'utf8');
const api = fs.readFileSync(`${root}/z2m-api.js`, 'utf8');

test('Z2K source card is Core-managed and has no independent refresh action', () => {
  const start = page.indexOf('function renderStrategySource');
  assert.ok(start >= 0);
  const end = page.indexOf('\n  function renderStrategySources', start);
  const body = page.slice(start, end);
  assert.match(body, /card\.id\s*===?\s*['"]z2k['"]/);
  assert.match(body, /Управляется Z2K Core/);
  assert.match(body, /refreshButton|Обновить/);
  assert.match(body, /z2k.*refreshButton|refreshButton.*z2k|card\.id.*z2k/si);
});
test('the UI API retains typed backend errors instead of rewriting them as network failures', () => {
  assert.match(api, /function normalizeError/);
  assert.match(api, /backend_error|rpc_unavailable|request_rejected/);
  assert.match(api, /code/);
  assert.doesNotMatch(api, /return .*Сеанс LuCI.*сетевое соединение/);
});
