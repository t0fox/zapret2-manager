import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

for (const name of ['z2m-overview.js', 'z2m-strategy.js', 'z2m-strategy-page.js']) {
  test(`${name} exposes the internal tab lifecycle`, () => {
    const mod = evaluateLuciModule(`${root}/${name}`);
    for (const key of ['id','title','subtitle','load','render','mount','unmount'])
      assert.ok(mod[key] != null, `${name}: ${key}`);
    for (const key of ['load','render','mount','unmount'])
      assert.equal(typeof mod[key], 'function', `${name}: ${key} is function`);
  });
}

test('overview uses real data, exposes overrides and controls advanced mode', () => {
  const src = source('z2m-overview.js');
  for (const token of ['api.service.status','api.strategy.preview','api.orchestra.runHistory','Проверить ресурс','Точечные правила','Все стратегии','Расширенный режим'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /ui:\s*Object\.assign\([^\n]*advanced/);
  assert.match(src, /shell\.segmented\(/);
  assert.doesNotMatch(src, /type:\s*['"]checkbox['"]/);
  assert.match(src, /value == null \|\| value === '' \? '—'/);
  assert.match(src, /preview\.overrides\s*\?\s*asArray\(preview\.overrides\.rules\)\s*:\s*\[\]/);
  assert.doesNotMatch(src, /metric\([^\n]+\|\| 0/);
  assert.match(src, /z2m-overview-model as OverviewModel/);
  assert.match(src, /OverviewModel\.normalize\(ctx\.data\s*\|\|\s*\{\}\)/);
  for (const label of [
    'Простой', 'Расширенный', 'Как это работает',
    'Отчёт проверки', 'Что стоит сделать'
  ]) assert.match(src, new RegExp(label));
  assert.match(src, /z2m-hero/);
  assert.doesNotMatch(src, /Flowseal ALT11|57\s*\/\s*61|312\s*мс/);
  assert.doesNotMatch(src, /rollback\(\)[\s\S]{0,250}!active/);
});

test('strategy selection is pending until explicit apply and empty runs are errors', () => {
  const src = source('z2m-strategy.js');
  for (const tab of ['list','chain','check','hist']) assert.match(src, new RegExp(`['"]${tab}['"]`));
  assert.match(src, /pendingStrategyId/);
  assert.match(src, /setDraft\(['"]strategy/);
  assert.match(src, /api\.strategy\.apply/);
  assert.match(src, /ctx\.openSemanticDiff/);
  assert.doesNotMatch(src, /ctx\.setConfirmation\(response\)/);
  assert.match(src, /Выбор стратегии не меняет runtime/);
  assert.match(src, /0 targets|не получил целей/);
  assert.match(src, /targetCount[^\n]*=== 0|candidateCount[^\n]*=== 0/);
});

test('advanced Strategy panes are hidden unless the shared advanced mode is enabled', () => {
  const app = source('app.js');
  const strategy = source('z2m-strategy.js');
  assert.match(app, /classList\.toggle\(['"]adv['"],\s*[^\n]*advanced/);
  assert.match(strategy, /z2m-adv-only/);
  assert.match(strategy, /advanced/);
  assert.match(strategy, /state\.subtab\s*=\s*['"]list['"]/);
});

test('advanced Strategy restores profile draft workflows with exact existing API groups', () => {
  const src = source('z2m-strategy.js');
  for (const token of [
    'api.profiles.create','api.profiles.update','api.profiles.clone','api.profiles.delete',
    'api.profiles.validate','api.profiles.importApplied','api.profiles.apply'
  ]) assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  for (const label of [
    'Глобальная часть','Профили','Итоговая команда','Новый профиль','Импортировать применённые',
    'Проверить черновики','Применить черновики','Проверка конфига','Среда','История применений'
  ]) assert.match(src, new RegExp(label));
  assert.match(src, /mode:\s*['"]preview['"]/);
  assert.match(src, /mode:\s*['"]apply['"]/);
  assert.match(src, /payload\.revision\s*=\s*profile\.revision/);
  assert.match(src, /payload\.id\s*=\s*profile\.id/);
  assert.doesNotMatch(src, /JSON\.stringify\(data\.(?:profiles|preflight)|JSON\.stringify\(history/);
});

test('app registers Overview and the composed Strategy page instead of placeholders', () => {
  const app = source('app.js');
  const page = source('z2m-strategy-page.js');
  assert.match(app, /z2m-overview as Overview/);
  assert.match(app, /z2m-strategy-page as Strategy/);
  assert.match(app, /overview:\s*Overview/);
  assert.match(app, /strategy:\s*Strategy/);
  assert.match(page, /z2m-strategy as Strategy/);
  assert.match(page, /z2m-auto as Auto/);
  assert.match(page, /Auto\.load\(ctx\)/);
  assert.match(page, /Auto\.render\(ctx/);
  assert.match(page, /Auto\.unmount\(\)/);
});
