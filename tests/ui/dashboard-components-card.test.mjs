import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('Dashboard components card has one compact status surface and one shared context hint', () => {
  const overview = read('z2m-overview.js');
  const dashboard = read('z2m-avatar-dashboard.js');
  const css = read('z2m-ui.css');

  assert.match(overview, /id: 'card-zapret2', label: _\('Компоненты'\)/);
  assert.match(overview, /headerArrow: true/);
  assert.match(overview, /context: componentContext/);
  assert.doesNotMatch(overview, /Сервер подтвердил отсутствие пакета/);

  assert.match(dashboard, /status-card-header-arrow/);
  assert.match(dashboard, /status-card-status/);
  assert.match(dashboard, /status-card-context/);
  assert.match(css, /#card-zapret2[^{]*\.status-card-row-value/);
  assert.match(css, /#card-zapret2[^{]*\.status-card-context/);
});

test('Dashboard component rows keep version evidence below the status chip', () => {
  const dashboard = read('z2m-avatar-dashboard.js');
  const css = read('z2m-ui.css');

  assert.match(dashboard, /status-card-status[^]*item\.value/);
  assert.match(css, /#card-zapret2 \.status-card-row-detail\{grid-column:2/);
  assert.match(css, /#card-zapret2 \.status-card-row-detail\{[^}]*text-align:right/);
  assert.match(css, /#card-zapret2 \.status-card-context\{margin-top:12px;padding-top:0;border-top:0/);
});
