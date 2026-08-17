import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P01-V4 Dashboard renders only the concise canonical strategy presentation', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /strategySecondary/);
  assert.doesNotMatch(page, /detail: view\.strategy\.description/);
  assert.doesNotMatch(page, /FULL_STRATEGY_DESCRIPTION_VISIBLE/);
});

test('P01-V4 Dashboard demotes engine version into readable System metadata', () => {
  const page = read('z2m-overview.js');
  const css = read('z2m-ui.css');
  assert.match(page, /ctx\.api\.maintenance\.versions/);
  assert.match(page, /status-card-meta/);
  assert.match(page, /card-zapret-ver/);
  assert.doesNotMatch(page, /id: 'card-zapret-ver', label: 'zapret2'/);
  assert.match(css, /#z2m-view-overview \.status-card-meta\{/);
});

test('P01-V4 Dashboard keeps accepted action and shared journal surfaces unchanged', () => {
  const page = read('z2m-overview.js');
  const dashboard = read('z2m-avatar-dashboard.js');
  assert.match(page, /dash-btn-start/);
  assert.match(page, /dash-btn-stop/);
  assert.match(page, /dash-btn-restart/);
  assert.match(page, /AvatarLog\.renderNormalized/);
  assert.match(dashboard, /Все логи/);
});
