import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js';
const NAVIGATION = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js';
const MANIFEST = 'docs/05-parity/2026-08-15-full-avatar-ui-parity-manifest.yaml';

test('legacy baseline is exactly the nine-tab Z2M navigation', () => {
  const inventory = fs.readFileSync(MANIFEST, 'utf8');
  const ids = [
    'overview', 'strategy', 'services', 'blockcheck', 'assets',
    'dns', 'proxy', 'monitor', 'maintenance',
  ];
  assert.ok(inventory.includes('legacy_baseline:'), 'inventory must preserve the legacy baseline');
  assert.deepEqual(ids.filter((id) => inventory.includes(`{ id: ${id},`)), ids);
  assert.match(inventory, /legacy_baseline:[\s\S]*tabs:/);
});

test('future navigation contract is Avatar-derived and has no old duplicate tabs', () => {
  assert.equal(fs.existsSync(NAVIGATION), true, 'z2m-navigation.js must define the future model');
  const navigation = fs.readFileSync(NAVIGATION, 'utf8');
  const app = fs.readFileSync(APP, 'utf8');

  assert.match(navigation, /home|Главная/);
  assert.match(navigation, /dpi|Обход DPI/);
  assert.match(navigation, /routing|VPN и маршрутизация/);
  assert.match(navigation, /children|subtabs/);
  assert.doesNotMatch(navigation, /sidebar/i);
  assert.doesNotMatch(app, /var TAB_IDS = \[/);
  assert.doesNotMatch(app, /var TAB_LABELS = \{/);
  assert.match(app, /z2m-navigation as Navigation/);
  assert.match(app, /Shell\.primaryNavigation\(Navigation/);
  assert.match(app, /Navigation\.normalize\(window\.location\.hash\)/);
});

test('every canonical navigation route has a concrete UI module', () => {
  const app = fs.readFileSync(APP, 'utf8');
  const routes = [
    'dashboard', 'control', 'strategies', 'scan', 'unified-routing', 'warp',
    'warp-setup', 'warp-in-warp', 'telegram-tunnel', 'lists', 'hostlists',
    'ipsets', 'blobs', 'lua', 'hosts', 'dns-routing', 'diagnostics',
    'blockcheck', 'logs', 'monitor', 'updates', 'zapret', 'autostart', 'settings'
  ];
  const moduleSection = app.slice(app.indexOf('var MODULES = {'), app.indexOf('var PENDING_MODULE = {'));
  for (const route of routes) assert.match(moduleSection, new RegExp(`(?:['"]${route}['"]|${route})\\s*:`), `route ${route} still falls through to placeholder UI`);
  assert.doesNotMatch(app, /MODULES\[route\]\s*=\s*PENDING_MODULE/);
});
