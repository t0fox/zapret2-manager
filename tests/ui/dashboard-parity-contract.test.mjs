import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P01 Dashboard follows the current accepted composition and order', () => {
  const page = read('z2m-overview.js');
  const dashboard = read('z2m-avatar-dashboard.js');
  const composition = `${page}\n${dashboard}`;
  const required = [
    'page-header', 'Главная', 'Обзор состояния системы', 'status-grid',
    'card-nfqws', 'nfqws2', 'card-strategy', 'Стратегия',
    'card-autostart', 'Автозапуск', 'card-system', 'Система',
    'zapret2',
    'Быстрые действия', 'dash-btn-start', 'dash-btn-stop',
    'dash-btn-restart', 'Последние события', 'dashboard-logs'
  ];
  for (const marker of required) assert.match(composition, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Dashboard marker: ${marker}`);
  const order = ['AvatarDashboard.render({', 'cards: statusCards(),', 'quickActions: renderQuickActions(),', 'recommendations: renderRecommendations(),', 'recentEvents: renderEvents()'];
  let previous = -1;
  for (const marker of order) {
    const current = page.indexOf(marker, previous + 1);
    assert.ok(current > previous, `Dashboard order marker is missing or misplaced: ${marker}`);
    previous = current;
  }
  assert.doesNotMatch(composition, /z2m-overview-readiness|Проверка DNS-сервисов/);
  assert.doesNotMatch(composition, /dashboard-warnings/);
  assert.doesNotMatch(composition, /warnings\.length \? warnings : null/);
  assert.doesNotMatch(composition, /renderVpnGrid|renderMonitoringGrid|VPN \/ Туннели|Мониторинг DNS|Healthcheck/);
  assert.doesNotMatch(composition, /Что стоит сделать|advicePanel|z2m-advice/);
  assert.match(composition, /page-title/);
  assert.match(composition, /page-description/);
});

test('P01 Dashboard keeps Z2M APIs and the existing resource checker', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /ctx\.api\.service\.start/);
  assert.match(page, /ctx\.api\.service\.stop/);
  assert.match(page, /ctx\.api\.monitor\.eventsTail/);
  assert.match(page, /ctx\.api\.orchestra\.runStart/);
  assert.match(page, /ctx\.api\.orchestra\.runStatus/);
  assert.doesNotMatch(page, /ctx\.api\.dns\.serviceStatus/);
  assert.doesNotMatch(page, /ctx\.api\.tg\.product\.status/);
  assert.doesNotMatch(page, /['"]\/api\//);
  assert.doesNotMatch(page, /fetch\s*\(/);
});

test('P01 Dashboard initial load does not wait for unused Orchestra reads', () => {
  const page = read('z2m-overview.js');
  const load = page.slice(page.indexOf('function load(ctx)'), page.indexOf('\n}\n\nfunction render(ctx)'));
  assert.match(load, /ctx\.api\.service\.status\(\)/);
  assert.match(load, /ctx\.api\.strategy\.preview\(\)/);
  assert.match(load, /ctx\.api\.monitor\.eventsTail/);
  assert.match(load, /ctx\.rerender/);
  assert.match(load, /secondary/);
  assert.doesNotMatch(load, /ctx\.api\.orchestra\.runHistory\(\)/);
  assert.doesNotMatch(load, /ctx\.api\.orchestra\.status\(\)/);
});

test('P01 status cards consume structured status evidence without collapsing to unavailable', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /status\.system/);
  assert.match(page, /status\.runtimeSummary/);
  assert.match(page, /runtimeSummary\.process/);
  assert.match(page, /status\.engine/);
  assert.match(page, /status\.upstream/);
  assert.match(page, /nfqws2Version/);
  assert.doesNotMatch(page, /optionalCardValue\(data\.status, \['autostart'/);
  assert.doesNotMatch(page, /optionalCardValue\(data\.status, \['version'/);
});

test('P01 Dashboard exposes one ordered quick-action set plus event states', () => {
  const page = `${read('z2m-overview.js')}\n${read('z2m-avatar-dashboard.js')}`;
  assert.equal((page.match(/dash-btn-start/g) || []).length, 1);
  assert.equal((page.match(/dash-btn-stop/g) || []).length, 1);
  assert.equal((page.match(/dash-btn-restart/g) || []).length, 1);
  for (const marker of ['Загрузка событий', 'Событий пока нет', 'Не удалось загрузить события', 'Все логи'])
    assert.match(page, new RegExp(marker));
});

test('Home navigation renders Dashboard directly without a redundant Overview tab', () => {
  const navigation = read('z2m-navigation.js');
  const shell = read('z2m-shell.js');
  assert.match(navigation, /hideSecondary\s*:\s*true/);
  assert.match(shell, /activeGroup\.hideSecondary/);
  assert.match(shell, /z2m-secondary-nav/);
});

test('P01 Dashboard mounts its structure before the first status RPC resolves', () => {
  const app = read('app.js');
  assert.match(app, /tab === 'dashboard' \|\| tab === 'control'/);
  assert.match(app, /renderTabData\(tab, module, \{\}, token, force\)/);
});

test('P01 app entrypoint does not gate Dashboard on DNS/TG product status', () => {
  const app = read('app.js');
  const view = app.slice(app.indexOf('return L.view.extend({'));
  const load = view.slice(view.indexOf('  load: function ()'), view.indexOf('\n\n  render: function'));
  assert.doesNotMatch(load, /canonicalAppStatus|Api\.dns\.product\.status|Api\.tg\.product\.status/);
  assert.match(load, /Api\.service\.status\(\)/);
});

test('P01 LuCI shell can read its own luci UCI config without widening writes', () => {
  const acl = fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8');
  assert.match(acl, /"uci":\s*\[\s*"zapret2",\s*"luci"\s*\]/);
  assert.doesNotMatch(acl, /"uci"\s*:\s*\{[^}]*"luci"/);
});

test('P01 Dashboard removes LuCI shell chrome from the donor header and active tab', () => {
  const css = read('z2m-ui.css');
  assert.match(css, /\.z2m-view#z2m-view-overview \.page-header\{[^}]*background-image:none/);
  assert.match(css, /\.z2m-navigation-shell \.z2m-primary-nav button\.on\{[^}]*background:transparent[^}]*box-shadow:none/);
  assert.match(css, /\.z2m-navigation-shell \.z2m-primary-nav\{flex-wrap:wrap;overflow-x:visible\}/);
  assert.match(css, /\.z2m-navigation-shell \.z2m-primary-nav button\{flex:1 1 auto;min-width:0;white-space:normal/);
});
