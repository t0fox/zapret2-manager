import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reportNavigation } from './navigation-check.mjs';

const appSource = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js', 'utf8');
const navigationSource = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js', 'utf8');

test('navigation duplication checker runs in report mode and protects P01 home route', () => {
  const report = reportNavigation({ appSource, navigationSource });
  assert.equal(report.mode, 'report');
  assert.ok(report.navigation_items.some((item) => item.id === 'dashboard'));
  assert.equal(report.redundant_overview_item, false);
  assert.deepEqual(report.duplicate_route_ids, []);
  assert.deepEqual(report.missing_module_targets, []);
});

test('navigation report identifies duplicate route ids without mutating source', () => {
  const report = reportNavigation({
    appSource: 'var MODULES = { dashboard: Overview, };',
    navigationSource: "{ id: 'dashboard', module: 'overview' },\n{ id: 'dashboard', module: 'overview' }",
  });
  assert.deepEqual(report.duplicate_route_ids, ['dashboard']);
});
