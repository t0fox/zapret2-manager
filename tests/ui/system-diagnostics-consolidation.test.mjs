import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('System has one canonical lifecycle and four product tabs', () => {
  const navigation = read('z2m-navigation.js');
  const app = read('app.js');
  const system = read('z2m-maintenance.js');

  assert.match(navigation, /id: 'system'[\s\S]*items:\s*\[[\s\S]*id: 'updates'[\s\S]*id: 'engine'[\s\S]*id: 'backups'[\s\S]*id: 'settings'/);
  assert.match(navigation, /zapret:\s*['"]engine['"]|autostart:\s*['"]engine['"]/);
  assert.match(navigation, /maintenance:\s*['"]updates['"]/);
  assert.match(navigation, /LEGACY_PARAMS[\s\S]*autostart[\s\S]*tab: 'engine'/);
  assert.match(navigation, /LEGACY_PARAMS[\s\S]*maintenance[\s\S]*tab: 'updates'/);
  assert.match(app, /system:\s*Maintenance/);
  assert.match(app, /MODULES\.updates = MODULES\.system/);
  assert.match(app, /MODULES\.engine = MODULES\.system/);
  assert.match(app, /MODULES\.backups = MODULES\.system/);
  assert.match(app, /MODULES\.settings = MODULES\.system/);
  assert.doesNotMatch(app, /updates:\s*Maintenance|zapret:\s*Maintenance|autostart:\s*Maintenance|settings:\s*Maintenance/);
  assert.match(system, /title:\s*_\('Система'\)/);
  assert.match(system, /id: 'system'/);
  assert.doesNotMatch(system, /id: 'z2m-maintenance-pane'[\s\S]*id: 'events'/);
  assert.doesNotMatch(system, /eventsTail|События|Diagnostics export/);
});

test('System loads only the active tab and keeps runtime facts in diagnostics', () => {
  const system = read('z2m-maintenance.js');
  assert.match(system, /activePane|activeTab|ctx\.routeParams\.tab/);
  assert.match(system, /route === ['"]engine['"]|return ['"]updates['"]|pane === ['"]updates['"]/);
  assert.match(system, /case ['"]engine['"]|pane === ['"]engine['"]|tab === ['"]engine['"]/);
  assert.match(system, /case ['"]backups['"]|pane === ['"]backups['"]|tab === ['"]backups['"]/);
  assert.match(system, /settings/);
  assert.doesNotMatch(system, /Promise\.allSettled\(\[[\s\S]*eventsTail/);
  assert.doesNotMatch(system, /system\.uptime|system\.memoryAvailable|system\.overlay/);
});

test('Diagnostics is the only canonical Monitoring and Logs viewer', () => {
  const app = read('app.js');
  const navigation = read('z2m-navigation.js');
  const diagnostics = read('z2m-diagnostics-page.js');
  assert.match(navigation, /id: 'diagnostics'[\s\S]*id: 'monitor'[\s\S]*id: 'logs'/);
  assert.match(app, /diagnostics:\s*Diagnostics/);
  assert.doesNotMatch(app, /logs:\s*AvatarLog|monitor:\s*Monitor/);
  for (const label of ['Мониторинг', 'Журналы', 'NFQUEUE', 'Scanner', 'DNS', 'Telegram Proxy', 'Overlay', 'diagnosticsExport'])
    assert.match(diagnostics, new RegExp(label, 'i'), label);
  assert.match(diagnostics, /eventsTail/);
  assert.match(diagnostics, /activePane\(ctx\) === ['"]logs['"]/);
  assert.doesNotMatch(read('z2m-maintenance.js'), /eventsTail|События/);
});

test('DNS keeps backend ownership and exposes task-first workflow language', () => {
  const dns = read('z2m-dns.js');
  const api = read('z2m-api.js');
  for (const method of ['product.get', 'product.providers', 'product.status', 'product.preview', 'product.apply'])
    assert.match(dns, new RegExp(method.replace('.', '\\.'), 'i'), method);
  for (const copy of ['Preview', 'Apply', 'Rollback', 'Провайдер'])
    assert.match(dns, new RegExp(copy, 'i'), copy);
  assert.match(dns, /Технические|Дополнительные параметры|Компоненты DNS/i);
  assert.match(api, /dns:\{[\s\S]*product:/);
  assert.doesNotMatch(dns, /raw backend fields|JSON.stringify\(data/);
});

test('Frozen visual references stay out of the consolidation diff', () => {
  for (const file of ['z2m-overview.js', 'z2m-strategy-page.js', 'z2m-proxy-page.js'])
    assert.ok(fs.existsSync(path.join(viewRoot, file)), file);
});
