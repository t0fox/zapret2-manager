import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('System has one canonical lifecycle and three visible pages', () => {
  const navigation = read('z2m-navigation.js');
  const app = read('app.js');
  const system = read('z2m-maintenance.js');

  assert.match(navigation, /id: 'system'[\s\S]*items:\s*\[[\s\S]*id: 'components'[\s\S]*id: 'backups'[\s\S]*id: 'settings'/);
  assert.match(navigation, /zapret:\s*['"]components['"]|autostart:\s*['"]components['"]/);
  assert.match(navigation, /maintenance:\s*['"]components['"]/);
  assert.match(navigation, /LEGACY_PARAMS[\s\S]*autostart[\s\S]*component: 'engine'/);
  assert.match(navigation, /LEGACY_PARAMS[\s\S]*maintenance[\s\S]*\{\}/);
  assert.doesNotMatch(navigation, /\{ id: 'updates'|\{ id: 'engine'/);
  assert.match(app, /system:\s*Maintenance/);
  assert.match(app, /components:\s*Maintenance/);
  assert.match(app, /MODULES\.updates = MODULES\.components/);
  assert.match(app, /MODULES\.engine = MODULES\.components/);
  assert.match(app, /MODULES\.backups = MODULES\.components/);
  assert.match(app, /MODULES\.settings = MODULES\.components/);
  assert.doesNotMatch(app, /updates:\s*Maintenance|zapret:\s*Maintenance|autostart:\s*Maintenance|settings:\s*Maintenance/);
  assert.match(system, /title:\s*_\('Система'\)/);
  assert.match(system, /id: 'system'/);
  assert.doesNotMatch(system, /id: 'z2m-maintenance-pane'[\s\S]*id: 'events'/);
  assert.doesNotMatch(system, /eventsTail|События|Diagnostics export/);
});

test('System loads only the active tab and keeps runtime facts in diagnostics', () => {
  const system = read('z2m-maintenance.js');
  assert.match(system, /activePane|activeTab|ctx\.routeParams\.tab/);
  assert.match(system, /return ['"]components['"]/);
  assert.match(system, /pane === ['"]components['"]|components:\s*\{/);
  assert.match(system, /case ['"]backups['"]|pane === ['"]backups['"]|tab === ['"]backups['"]/);
  assert.match(system, /settings/);
  assert.doesNotMatch(system, /Promise\.allSettled\(\[[\s\S]*eventsTail/);
  assert.doesNotMatch(system, /system\.uptime|system\.memoryAvailable|system\.overlay/);
});

test('System uses shell navigation as the only visible System tab bar', () => {
  const system = read('z2m-maintenance.js');

  assert.doesNotMatch(system, /ctx\.shell\.subTabs\(/);
  assert.match(system, /PANE_META|paneMeta/);
  assert.match(system, /activePane\(ctx\)/);
});

test('Components no longer presents a global product-version update table', () => {
  const model = read('z2m-maintenance-model.js');
  const system = read('z2m-maintenance.js');

  assert.match(model, /UPDATE_STATES/);
  assert.match(model, /normalizeUpdateModel/);
  for (const state of ['CHECKING', 'UP_TO_DATE', 'UPDATE_AVAILABLE', 'UNKNOWN', 'STALE', 'ERROR', 'NOT_INSTALLED'])
    assert.match(model, new RegExp(state), state);
  assert.match(system, /renderComponents/);
  assert.match(system, /z2m-components-model/);
  assert.doesNotMatch(system, /Установленные версии/);
  assert.doesNotMatch(system, /Проверка обновлений недоступна/);
  assert.match(system, /z2m-components-summary|z2m-component-card/);
  assert.doesNotMatch(system, /Доступность обновлений не проверяется этим read-only контрактом/);
  assert.doesNotMatch(system, /installed versions read|Backup scope|Version gate|Integrity/);
  assert.doesNotMatch(system, /Установленные версии|Проверка обновлений недоступна/);
  assert.match(system, /Подробнее/);
});

test('System Updates stays compatible with a stale cached maintenance model module', () => {
  const system = read('z2m-maintenance.js');

  assert.match(system, /ComponentsModel\.normalizePage/);
  assert.match(system, /ctx\.api\.resources\.status\(\)/);
  assert.match(system, /EnginePanel\.load\(ctx\)/);
});

test('System Engine uses the current official RPC contract', () => {
  const api = read('z2m-api.js');
  const panel = read('z2m-engine-panel.js');

  for (const method of ['engine_releases', 'engine_check', 'engine_install', 'engine_update', 'engine_reinstall', 'engine_uninstall'])
    assert.match(api, new RegExp(method), method);
  assert.doesNotMatch(api, /engine_providers|engine_check_updates/);
  assert.match(panel, /engine\.releases\(\)/);
  assert.match(panel, /engine\.check\(/);
  assert.match(panel, /engine\.uninstall/);
  assert.doesNotMatch(panel, /engine\.providers|engine\.checkUpdates/);
});

test('System Engine uses the official bol-van authority without a provider selector', () => {
  const api = read('z2m-api.js');
  const panel = read('z2m-engine-panel.js');
  const rpc = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc'), 'utf8');
  const catalog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh'), 'utf8');
  const acl = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager-engine.json'), 'utf8');
  const makefile = fs.readFileSync(path.join(root, 'zapret2-manager/Makefile'), 'utf8');

  assert.match(catalog, /UPSTREAM\s*=\s*['"]bol-van\/zapret2['"]/);
  assert.match(catalog, /STATE_FILE\s*=\s*['"]\/etc\/zapret2-manager\/engine-state\.json['"]/);
  assert.doesNotMatch(catalog, /engine-provider\.json/);
  assert.match(manager, /engine-catalog\.uc/);
  assert.doesNotMatch(manager, /engine-providers\.uc|engine-provider\.json/);
  assert.match(rpc, /engine_releases|engine_check/);
  assert.doesNotMatch(rpc, /engine_providers|engine_check_updates/);
  assert.match(acl, /engine_releases/);
  assert.match(acl, /engine_update/);
  assert.doesNotMatch(acl, /engine_providers|engine_check_updates|engine_remove/);
  assert.match(makefile, /\/etc\/zapret2-manager\/engine-state\.json/);
  assert.doesNotMatch(makefile, /\/etc\/zapret2-manager\/engine-provider\.json/);
  assert.match(api, /engine_releases|engine_check/);
  assert.doesNotMatch(api, /engine_providers|engine_check_updates/);
  assert.match(panel, /bol-van\/zapret2/);
  assert.match(panel, /engine\.releases\(\)|engine\.check\(/);
  assert.match(panel, /function checkRelease\(ctx, state\)/);
  assert.match(panel, /checkRelease\(ctx, state\)/);
  assert.doesNotMatch(panel, /function check\(ctx, state\)/);
  assert.doesNotMatch(panel, /Remittor|1andrevich|engine\.providers|engine\.checkUpdates|type:\s*['"]radio/);
  assert.match(worker, /bol-van\/zapret2/);
  assert.match(worker, /CONTAINER.*tar\.gz|tar\.gz.*CONTAINER/);
  assert.doesNotMatch(worker, /PROVIDER|remittor|andrevich/);
});

test('Diagnostics is the only canonical Monitoring and Logs viewer', () => {
  const app = read('app.js');
  const navigation = read('z2m-navigation.js');
  const diagnostics = read('z2m-diagnostics-page.js');
  const avatarLog = read('z2m-avatar-log.js');
  assert.match(navigation, /id: 'diagnostics'[\s\S]*id: 'monitor'[\s\S]*id: 'logs'/);
  assert.match(app, /diagnostics:\s*Diagnostics/);
  assert.doesNotMatch(app, /logs:\s*AvatarLog|monitor:\s*Monitor/);
  for (const label of ['Мониторинг', 'Журналы', 'NFQUEUE', 'Scanner', 'DNS', 'Telegram Proxy', 'Overlay', 'diagnosticsExport'])
    assert.match(diagnostics, new RegExp(label, 'i'), label);
  assert.match(diagnostics, /AvatarLog\.load/);
  assert.match(avatarLog, /eventsTail/);
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
