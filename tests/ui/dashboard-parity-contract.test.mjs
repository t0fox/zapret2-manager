import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P01 Dashboard follows the frozen donor composition and order', () => {
  const page = read('z2m-overview.js');
  const required = [
    'page-header', 'Главная', 'Обзор состояния системы', 'status-grid',
    'card-nfqws', 'nfqws2', 'card-strategy', 'Стратегия',
    'card-autostart', 'Автозапуск', 'card-system', 'Система',
    'card-zapret-ver', 'zapret2', 'vpn-grid', 'monitoring-grid',
    'Быстрые действия', 'dash-btn-start', 'dash-btn-stop',
    'dash-btn-restart', 'Последние события', 'dashboard-logs'
  ];
  for (const marker of required) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing Dashboard marker: ${marker}`);
  const order = ['pageHead,', '      renderStatusGrid(),', '      renderVpnGrid(),', '      renderMonitoringGrid()', '    renderQuickActions(),', '    renderEvents(),'];
  let previous = -1;
  for (const marker of order) {
    const current = page.indexOf(marker, previous + 1);
    assert.ok(current > previous, `Dashboard order marker is missing or misplaced: ${marker}`);
    previous = current;
  }
  assert.doesNotMatch(page, /z2m-overview-readiness|Проверка DNS-сервисов/);
  assert.doesNotMatch(page, /dashboard-warnings/);
  assert.doesNotMatch(page, /warnings\.length \? warnings : null/);
});

test('P01 Dashboard keeps Z2M APIs and the existing resource checker', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /ctx\.api\.service\.start/);
  assert.match(page, /ctx\.api\.service\.stop/);
  assert.match(page, /ctx\.api\.monitor\.eventsTail/);
  assert.match(page, /ctx\.api\.orchestra\.runStart/);
  assert.match(page, /ctx\.api\.orchestra\.runStatus/);
  assert.doesNotMatch(page, /['"]\/api\//);
  assert.doesNotMatch(page, /fetch\s*\(/);
});

test('P01 Dashboard exposes one ordered quick-action set plus event states', () => {
  const page = read('z2m-overview.js');
  assert.equal((page.match(/dash-btn-start/g) || []).length, 1);
  assert.equal((page.match(/dash-btn-stop/g) || []).length, 1);
  assert.equal((page.match(/dash-btn-restart/g) || []).length, 1);
  for (const marker of ['Загрузка логов', 'Событий пока нет', 'Не удалось загрузить события', 'Все логи'])
    assert.match(page, new RegExp(marker));
});

test('Home navigation renders Dashboard directly without a redundant Overview tab', () => {
  const navigation = read('z2m-navigation.js');
  const shell = read('z2m-shell.js');
  assert.match(navigation, /hideSecondary\s*:\s*true/);
  assert.match(shell, /activeGroup\.hideSecondary/);
  assert.match(shell, /z2m-secondary-nav/);
});
