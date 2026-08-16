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
  assert.match(page, /if \(packet\.answer && packet\.answer\.ok === false\) throw packet\.answer/);
});

test('P02 pending state prevents duplicate mutations and disables every control', () => {
  const page = `${read('z2m-avatar-control.js')}\n${read('z2m-control-model.js')}`;
  assert.match(page, /runtime\.pending \|\|/);
  assert.match(page, /runtime\.pending = true/);
  assert.match(page, /runtime\.pending = false/);
  assert.match(page, /disabled: item\.disabled \? 'disabled'/);
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
