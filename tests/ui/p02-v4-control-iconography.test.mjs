import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const pagePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-control.js');
const page = fs.readFileSync(pagePath, 'utf8');

test('P02-V4 Control uses one semantic line-icon language', () => {
  assert.match(page, /power: \[/);
  assert.match(page, /play:\s*\[/);
  assert.match(page, /'stop-square': \[/);
  assert.match(page, /'rotate-cw': \[/);
  assert.match(page, /workflow:\s*\[/);
  assert.match(page, /cpu: \[/);
  assert.match(page, /'shield-check': \[/);
  assert.match(page, /'scroll-text': \[/);
  assert.match(page, /'external-link': \[/);
  assert.doesNotMatch(page, /icon\('bolt'\)/);
  assert.doesNotMatch(page, /icon\('log'\)/);
  assert.doesNotMatch(page, /icon\('list'\)/);
});

test('P02-V4 Control maps semantic icons to the accepted targets', () => {
  assert.match(page, /actionIcons = \{ start: 'play', stop: 'stop-square', restart: 'rotate-cw' \}/);
  assert.match(page, /'Управление процессом'\)\]/);
  assert.match(page, /'card-strategy',[\s\S]*'workflow'\)/);
  assert.match(page, /'card-process',[\s\S]*'cpu'\)/);
  assert.match(page, /'card-firewall',[\s\S]*'shield-check'\)/);
  assert.match(page, /'scroll-text'[\s\S]*'Журнал nfqws2'/);
  assert.match(page, /'external-link'[\s\S]*'Все логи'/);
  assert.match(page, /'network'[\s\S]*'Очередь NFQUEUE'/);
  assert.match(page, /'circle-check'/);
  assert.match(page, /'Правила перенаправления'/);
  assert.doesNotMatch(page, /[\u25B6\u25A0\u21BB]/);
});
