import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P01-V3 Dashboard uses the Control SVG and action geometry contract', () => {
  const dashboard = read('z2m-avatar-dashboard.js');
  const css = read('z2m-ui.css');
  assert.match(dashboard, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg'/);
  assert.doesNotMatch(dashboard, /E\('svg'/);
  for (const marker of ['control-button-icon-slot', 'control-button-label', "'play'", "'stop-square'", "'rotate-cw'"]) {
    assert.match(dashboard, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing icon/action marker: ${marker}`);
  }
  assert.match(css, /#z2m-view-overview \.actions-row \.btn-lg\{[^}]*height:40px/);
  assert.match(css, /#z2m-view-overview \.control-button-icon-slot\{[^}]*width:var\(--icon-md\)/);
  assert.match(css, /#z2m-view-overview \.control-button-label\{/);
});

test('P01-V3 Dashboard resolves human strategy metadata without exposing raw IDs', () => {
  const page = read('z2m-overview.js');
  const model = read('z2m-overview-model.js');
  assert.match(page, /ctx\.api\.strategies\.get/);
  assert.match(page, /data\.strategy = \{ value: strategy \}/);
  assert.match(model, /canonicalStrategy = payload\(data\.strategy\)/);
  assert.match(page, /format\.text\(view\.strategy\.name\)/);
  assert.doesNotMatch(page, /format\.text\(view\.strategy\.name \|\| view\.strategy\.id\)/);
  assert.match(page, /Процесс не запущен/);
  assert.match(page, /auto\.enabled \? _\('Включён'\)/);
  assert.match(page, /value: _\('OpenWrt'\), kind: ''/);
});

test('P01-V3 Dashboard keeps resource checking transient and separates apply', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /ctx\.api\.orchestra\.runStart/);
  assert.match(page, /ctx\.api\.orchestra\.runStatus/);
  assert.match(page, /resource-check-primary/);
  assert.match(page, /resource-check-action/);
  assert.match(page, /resource-check-note/);
  assert.match(page, /stageOverrideSet/);
  assert.doesNotMatch(page, /checkResource[\s\S]{0,1200}service\.(start|stop|restart)/);
});

test('P01-V3 Dashboard keeps the shared bounded journal and avoids a second poller', () => {
  const page = read('z2m-overview.js');
  assert.match(page, /AvatarLog\.normalizeRows\(envelope, 8\)/);
  assert.match(page, /AvatarLog\.renderNormalized\(rows/);
  assert.equal((page.match(/window\.setInterval/g) || []).length, 0);
  assert.match(page, /p01v3-dashboard-20260817/);
});
