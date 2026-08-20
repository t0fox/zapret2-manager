import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const viewRoot = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('Product IA exposes the approved six groups and canonical page routes', () => {
  const navigation = read('z2m-navigation.js');
  for (const label of ['Главная', 'Обход DPI', 'Прокси и маршрутизация', 'Списки и данные', 'Диагностика', 'Система'])
    assert.match(navigation, new RegExp(label));
  for (const route of ['dashboard', 'control', 'strategies', 'scan', 'warp', 'telegram-tunnel', 'services', 'resources', 'dns-routing', 'monitor', 'logs', 'zapret', 'updates', 'settings'])
    assert.match(navigation, new RegExp(`id: ['"]${route}['"]`), route);
  assert.match(navigation, /function parse|routeParams|parameters/i);
  assert.match(navigation, /hostlists|ipsets|blobs|lua|hosts/);
  assert.match(navigation, /autostart/);
});

test('Legacy routes resolve to one canonical lifecycle without changing frozen page ownership', () => {
  const navigation = read('z2m-navigation.js');
  const app = read('app.js');
  assert.match(navigation, /assets\s*:\s*['"]resources['"]/);
  assert.match(navigation, /services\s*:\s*['"]services['"]/);
  assert.match(navigation, /autostart.*zapret|zapret.*autostart/i);
  assert.match(app, /ScannerProduct/);
  assert.match(app, /scan:\s*ScannerProduct/);
  assert.match(app, /strategies:\s*Strategy/);
  assert.match(app, /'dns-routing':\s*Dns/);
  assert.match(app, /'telegram-tunnel':\s*Proxy/);
});

test('The canonical Scanner page has Search, Diagnostics, and History tabs', () => {
  const product = read('z2m-scanner-product.js');
  assert.match(product, /z2m-scanner-product/);
  for (const tab of ['search', 'diagnostics', 'history']) assert.match(product, new RegExp(tab));
  assert.match(product, /z2m-scanner\.js|Scanner/);
  assert.match(product, /z2m-blockcheck-page\.js|BlockCheck/);
  assert.doesNotMatch(product, /scanner-chooser-card|selectEngine|Чем сканировать/);
  assert.match(product, /load:/);
  assert.match(product, /render:/);
  assert.match(product, /mount:/);
  assert.match(product, /unmount:/);
});

test('Diagnostic engine controls remain in the diagnostic module and visual-frozen modules stay owned', () => {
  const diagnostics = read('z2m-blockcheck-page.js');
  const app = read('app.js');
  for (const control of ['blockcheckw', 'blockcheck2', 'setBcwMode', 'setBc2Mode']) assert.match(diagnostics, new RegExp(control));
  assert.match(app, /'dns-routing':\s*Dns/);
  assert.match(app, /'telegram-tunnel':\s*Proxy/);
  assert.match(app, /strategies:\s*Strategy/);
  assert.doesNotMatch(read('z2m-warp-page.js'), /api\.warp|warp_start|warp_enable/);
});
