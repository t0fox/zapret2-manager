import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const page = fs.readFileSync(path.join(viewRoot, 'z2m-avatar-control.js'), 'utf8');
const ui = fs.readFileSync(path.join(viewRoot, 'z2m-avatar-ui.js'), 'utf8');
const icons = fs.readFileSync(path.join(viewRoot, 'z2m-icons.js'), 'utf8');

function hasIconKey(name) {
  return new RegExp(`(?:^|\\n)\\s*(?:['"]${name}['"]|${name})\\s*:`).test(icons);
}

test('P02-V4 Control uses one semantic line-icon language', () => {
  const combined = page + '\n' + ui;
  assert.match(combined, /z2m-icons as Icons/);
  assert.match(combined, /Icons\.node\(/);
  assert.doesNotMatch(page, /function svgNode|var paths = \{/);
  for (const name of ['power', 'play', 'stop-square', 'rotate-cw', 'workflow', 'cpu', 'shield-check', 'scroll-text', 'external-link']) {
    assert.equal(hasIconKey(name), true, `missing shared icon glyph: ${name}`);
  }
  assert.doesNotMatch(page, /icon\('bolt'\)/);
  assert.doesNotMatch(page, /icon\('log'\)/);
  assert.doesNotMatch(page, /icon\('list'\)/);
});

test('P02-V4 Control maps semantic icons to the accepted targets', () => {
  const combined = page + '\n' + ui;
  assert.match(combined, /actionIcons = \{ start: 'play', stop: 'stop-square', restart: 'rotate-cw' \}/);
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
