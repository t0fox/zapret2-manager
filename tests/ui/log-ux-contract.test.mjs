import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const page = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js'), 'utf8');
const maintenance = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const maintenanceModel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance-model.js'), 'utf8');
const avatarLog = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

test('Dashboard log window is a bounded semantic event view', () => {
  assert.match(page, /eventsTail, \{ limit: 8 \}/);
  for (const label of ['ОТЛАДКА', 'ИНФО', 'УСПЕХ', 'ПРЕДУПР\.', 'ОШИБКА', 'КРИТИЧНО'])
    assert.match(avatarLog, new RegExp(label));
  assert.match(avatarLog, /raw\.source \|\| raw\.component/);
  assert.match(avatarLog, /class': 'log-source'/);
  assert.match(avatarLog, /class': 'log-message'/);
  assert.match(avatarLog, /slice\(-\(limit \|\| 100\)\)/);
  assert.doesNotMatch(page, /function eventSeverity\s*\(/);
});

test('Dashboard log window exposes loading, empty, error and smart autoscroll states', () => {
  assert.match(page, /Загрузка событий/);
  assert.match(page, /Событий пока нет/);
  assert.match(page, /Не удалось загрузить события/);
  assert.match(page, /runtime\.events\.follow/);
  assert.match(page, /runtime\.events\.unread/);
  assert.match(page, /refreshLogStylesheet/);
  assert.match(page, /data-z2m-revision/);
  assert.match(page, /Перейти к новым событиям/);
  assert.match(page, /scrollHeight/);
  assert.match(css, /grid-template-columns:145px 88px 132px/);
  assert.match(css, /grid-template-columns:minmax\(120px,130px\) minmax\(75px,90px\) minmax\(110px,150px\) minmax\(0,1fr\)!important/);
  assert.match(css, /log-time[^}]*white-space:nowrap/);
  assert.match(css, /log-source[^}]*text-overflow:ellipsis/);
  assert.match(css, /log-message[^}]*overflow-wrap:anywhere/);
  assert.match(css, /severity-badge/);
  assert.match(avatarLog, /log-row log-entry/);
});

test('full event history keeps the same Russian semantic columns', () => {
  assert.match(maintenance, /Загрузка событий/);
  assert.match(maintenance, /Показаны последние 100 событий/);
  assert.match(avatarLog, /eventId/);
  assert.match(avatarLog, /severity-badge/);
  assert.match(maintenanceModel, /source: text\(event\.source \|\| event\.component\)/);
  assert.match(maintenanceModel, /Date\.parse/);
  assert.match(maintenanceModel, /slice\(-Math\.floor\(limit\)\)/);
  assert.match(avatarLog, /function messageLabel/);
  assert.match(avatarLog, /Параметр NFQWS2_ENABLE=/);
  assert.match(avatarLog, /function timestamp/);
  assert.match(maintenance, /AvatarLog\.normalizeRows/);
});
