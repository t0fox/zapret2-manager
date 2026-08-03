import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

for (const name of ['z2m-overview.js', 'z2m-strategy.js']) {
  test(`${name} exposes the internal tab lifecycle`, () => {
    const mod = evaluateLuciModule(`${root}/${name}`);
    for (const key of ['id','title','subtitle','load','render','mount','unmount'])
      assert.ok(mod[key] != null, `${name}: ${key}`);
    for (const key of ['load','render','mount','unmount'])
      assert.equal(typeof mod[key], 'function', `${name}: ${key} is function`);
  });
}

test('overview uses real data and exposes service, resource check and overrides', () => {
  const src = source('z2m-overview.js');
  for (const token of ['api.service.status','api.strategy.preview','api.orchestra.runHistory','Проверить ресурс','Точечные правила','Все стратегии'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /value == null \? '—'/);
  assert.doesNotMatch(src, /metric\([^\n]+\|\| 0/);
});

test('strategy selection is pending until explicit apply and empty runs are errors', () => {
  const src = source('z2m-strategy.js');
  for (const tab of ['list','chain','check','hist']) assert.match(src, new RegExp(`['"]${tab}['"]`));
  assert.match(src, /pendingStrategyId/);
  assert.match(src, /setDraft\(['"]strategy/);
  assert.match(src, /api\.strategy\.apply/);
  assert.match(src, /Выбор стратегии не меняет runtime/);
  assert.match(src, /0 targets|не получил целей/);
  assert.match(src, /targetCount[^\n]*=== 0|candidateCount[^\n]*=== 0/);
});

test('app registers overview and strategy modules instead of placeholders', () => {
  const app = source('app.js');
  assert.match(app, /z2m-overview as Overview/);
  assert.match(app, /z2m-strategy as Strategy/);
  assert.match(app, /overview:\s*Overview/);
  assert.match(app, /strategy:\s*Strategy/);
});
