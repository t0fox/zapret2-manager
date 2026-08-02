import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const viewPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-v2.js';
const cssPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-v2.css';
const menuPath = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';

function source(path) {
  return readFileSync(path, 'utf8');
}

test('Orchestra V2 preserves the existing backend contract', () => {
  const js = source(viewPath);
  for (const method of [
    'status',
    'orchestra_capabilities',
    'orchestra_auto_status',
    'orchestra_run_status',
    'orchestra_run_history',
    'orchestra_auto_enable',
    'orchestra_auto_disable',
    'orchestra_auto_run',
    'orchestra_auto_stop',
    'orchestra_auto_restore'
  ]) assert.match(js, new RegExp(`method: ['"]${method}['"]`));
});

test('Overview and Auto Strategy are explicit compact routes', () => {
  const js = source(viewPath);
  assert.match(js, /data-route[^\n]*overview|route[^\n]*overview/i);
  assert.match(js, /data-route[^\n]*auto|route[^\n]*auto/i);
  assert.match(js, /Состояние системы/);
  assert.match(js, /Автоматический подбор/);
  assert.match(js, /Текущая конфигурация/);
});

test('Auto Strategy keeps controls focused and the service selector collapsed', () => {
  const js = source(viewPath);
  assert.match(js, /<details|E\(['"]details['"]/);
  assert.match(js, /Выбранные сервисы/);
  assert.match(js, /Изменить выбор/);
  assert.doesNotMatch(js, /open:\s*true|['"]open['"]\s*:\s*['"]open['"]/);
  assert.match(js, /primary-action/);
});

test('Tested-strategy journal remains visible for failed and timed-out candidates', () => {
  const js = source(viewPath);
  assert.match(js, /Проверенные стратегии/);
  assert.match(js, /Не прошла/);
  assert.match(js, /Таймаут/);
  assert.match(js, /Ошибка инфраструктуры/);
  assert.doesNotMatch(js, /filter\([^\n]*(confirmed|working|winner)/i);
});

test('Technical identifiers are isolated in a collapsed disclosure', () => {
  const js = source(viewPath);
  assert.match(js, /Технические сведения/);
  assert.match(js, /technical-details/);
  assert.match(js, /runId/);
  assert.match(js, /generation/);
  assert.match(js, /candidateId/);
  assert.doesNotMatch(js, /\[object HTMLDivElement\]|\[object Object\]/);
});

test('Styles are scoped and responsive without micro-column layouts', () => {
  const css = source(cssPath);
  assert.match(css, /\.z2m-orchestra-v2/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media[^\{]*max-width:\s*760px/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /repeat\((?:[5-9]|\d{2,}),/);
});

test('LuCI root and Orchestra menu entries use the new view', () => {
  const menu = JSON.parse(source(menuPath));
  assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/orchestra-v2');
  assert.equal(menu['admin/services/zapret2-manager/orchestra'].action.path, 'zapret2-manager/orchestra-v2');
});
