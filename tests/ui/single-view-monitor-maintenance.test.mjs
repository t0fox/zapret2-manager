import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

for (const name of ['z2m-monitor.js', 'z2m-maintenance.js']) {
  test(`${name} exposes the internal tab lifecycle`, () => {
    const mod = evaluateLuciModule(`${root}/${name}`);
    for (const key of ['id','title','subtitle','load','render','mount','unmount']) assert.ok(mod[key] != null, `${name}: ${key}`);
    for (const key of ['load','render','mount','unmount']) assert.equal(typeof mod[key], 'function');
  });
}

test('monitor polls only while mounted and capability-gates events_tail', () => {
  const src = source('z2m-monitor.js');
  assert.match(src, /api\.monitor\.status/);
  assert.match(src, /api\.monitor\.eventsTail/);
  assert.match(src, /setInterval/);
  assert.match(src, /clearInterval/);
  assert.match(src, /function\s+unmount[\s\S]*clearInterval/);
  assert.match(src, /События недоступны: установленный backend не предоставляет events_tail\./);
  assert.match(src, /eventsUnsupported/);
  assert.doesNotMatch(src, /\|\|\s*0/);
});

test('maintenance preserves every backup workflow and visible preview host', () => {
  const src = source('z2m-maintenance.js');
  for (const token of [
    'api.maintenance.versions','api.maintenance.status','api.maintenance.backupList',
    'api.maintenance.backupCreate','api.maintenance.backupPreview','api.maintenance.backupRestore',
    'api.maintenance.backupDelete','api.maintenance.eventsTail','api.maintenance.diagnosticsExport'
  ]) assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  for (const scope of ['engineConfig','ourState','lists','profiles']) assert.match(src, new RegExp(scope));
  assert.match(src, /id:\s*['"]z2m-backup-preview['"]/);
  assert.match(src, /ctx\.root\.replaceChildren/);
  assert.match(src, /window\.confirm/);
  assert.doesNotMatch(src, /\.cbi-map/);
});

test('app registers monitor and maintenance modules', () => {
  const app = source('app.js');
  assert.match(app, /z2m-monitor as Monitor/);
  assert.match(app, /z2m-maintenance as Maintenance/);
  assert.match(app, /monitor:\s*Monitor/);
  assert.match(app, /maintenance:\s*Maintenance/);
});
