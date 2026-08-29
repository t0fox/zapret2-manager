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
  assert.match(page, /componentUpdateSummary/);
  assert.match(page, /wrappedNode\('cpu'/);
  assert.match(page, /z2m-overview-update-summary-action/);
  assert.match(css, /z2m-overview-update-summary\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
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

test('P01-V5 Dashboard keeps one detailed status surface and restores Telegram brand visibility', () => {
  const page = read('z2m-overview.js');
  const dashboard = read('z2m-avatar-dashboard.js');
  const css = read('z2m-ui.css');
  assert.doesNotMatch(dashboard, /dashboardSignal|dashboard-signal/);
  assert.match(page, /card-telegram/);
  assert.match(page, /icon: 'service:telegram'/);
  assert.match(css, /status-grid\{grid-template-columns:repeat\(3/);
  assert.match(css, /#card-telegram \.status-card-icon svg\.z2m-icon-brand[\s\S]*fill:currentColor!important[\s\S]*stroke:none!important/);
});
