import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('P02 lifecycle actions use the canonical Z2M service RPCs and refresh evidence', () => {
  const page = `${read('z2m-avatar-control.js')}\n${read('z2m-control-model.js')}`;
  for (const marker of [
    'ctx.api.service.start()', 'ctx.api.service.stop()', 'ctx.api.service.restart()',
    'ctx.api.service.status()', 'monitor.eventsTail', 'runtime.status = data.status',
    'runtime.logs = data.logs', 'control-action-result'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(page, /return fetchData\(ctx\)\.then/);
  assert.match(page, /confirmState\(expected, 12, answer\)/);
  assert.match(page, /if \(answer && answer\.ok === false\) throw answer/);
});

test('P02 pending state prevents duplicate mutations and disables every control', () => {
  const page = `${read('z2m-avatar-control.js')}\n${read('z2m-avatar-ui.js')}\n${read('z2m-control-model.js')}`;
  assert.match(page, /runtime\.pending \|\|/);
  assert.match(page, /runtime\.pending = true/);
  assert.match(page, /runtime\.pending = false/);
  assert.match(page, /disabled: (?:disabled|item\.disabled) \? 'disabled'/);
  assert.match(page, /data-control-pending/);
  assert.match(page, /buttons\(current, pending\)/);
});

test('P02 polling has one replaceable interval and unmount cleanup', () => {
  const page = read('z2m-avatar-control.js');
  assert.match(page, /if \(runtime\.timer\) window\.clearInterval\(runtime\.timer\)/);
  assert.equal((page.match(/window\.setInterval/g) || []).length, 1);
  assert.equal((page.match(/window\.clearInterval/g) || []).length, 2);
  assert.match(page, /runtime\.ctx = null/);
  assert.match(page, /runtime\.mountToken \+= 1/);
});

test('P02 route returns to the canonical page and full logs route', () => {
  const app = read('app.js');
  const navigation = read('z2m-navigation.js');
  const control = read('z2m-avatar-control.js');
  assert.match(app, /control:\s*Control/);
  assert.match(navigation, /id: 'control', label: _\('Управление'\)/);
  assert.match(control, /id: 'z2m-view-control'/);
  assert.match(control, /href: '#\/logs'/);
});

test('Lifecycle action buttons unification contract: one renderer, dashboard/control parity, neutral restart, readable disabled states', () => {
  const control = read('z2m-avatar-control.js');
  const dashboard = read('z2m-avatar-dashboard.js');
  const ui = read('z2m-avatar-ui.js');
  const css = read('z2m-ui.css');

  // 1. Single shared renderer in AvatarUI
  assert.match(ui, /function renderLifecycleButton\(options\)/);
  assert.match(ui, /renderLifecycleButton: renderLifecycleButton/);
  assert.match(control, /AvatarUI\.renderLifecycleButton/);
  assert.match(dashboard, /AvatarUI\.renderLifecycleButton/);

  // 2. Both Control and Dashboard share the exact same button DOM structure and classes
  assert.match(ui, /'class': 'btn z2m-btn z2m-lifecycle-btn ' \+ actionClass \+ ' btn-lg'/);
  assert.match(ui, /control-button-icon-slot/);
  assert.match(ui, /control-button-label/);

  // 3. Restart is neutral secondary, NOT primary blue
  assert.match(ui, /restart:\s*'z2m-lifecycle-restart'/);
  assert.doesNotMatch(control, /restart:\s*'btn-primary'/);
  assert.doesNotMatch(dashboard, /restart:\s*'btn-primary'/);
  assert.match(css, /\.z2m-lifecycle-restart[^{]*\{background:var\(--raised\);border:1px solid var\(--border2\);color:var\(--tx\)\}/);

  // 4. Start (green) & Stop (red) semantics
  assert.match(ui, /start:\s*'z2m-lifecycle-start btn-success'/);
  assert.match(ui, /stop:\s*'z2m-lifecycle-stop btn-danger'/);
  assert.match(css, /\.z2m-lifecycle-start[^{]*\{background:var\(--green\);border:1px solid var\(--green\);color:#101817\}/);
  assert.match(css, /\.z2m-lifecycle-stop[^{]*\{background:var\(--red\);border:1px solid var\(--red\);color:#fff\}/);

  // 5. Disabled states have dedicated high-contrast readability (opacity 1 with muted tint)
  assert.match(css, /\.z2m-lifecycle-start\[disabled\][^{]*\{background:rgba\(92,185,139,\.14\)!important;border-color:rgba\(92,185,139,\.28\)!important;color:rgba\(92,185,139,\.55\)!important;cursor:not-allowed;opacity:1!important\}/);
  assert.match(css, /\.z2m-lifecycle-stop\[disabled\][^{]*\{background:rgba\(226,105,90,\.12\)!important;border-color:rgba\(226,105,90,\.24\)!important;color:rgba\(226,105,90,\.55\)!important;cursor:not-allowed;opacity:1!important\}/);
  assert.match(css, /\.z2m-lifecycle-restart\[disabled\][^{]*\{background:rgba\(44,48,53,\.5\)!important;border-color:rgba\(63,68,74,\.5\)!important;color:var\(--tx3\)!important;cursor:not-allowed;opacity:1!important\}/);
});
