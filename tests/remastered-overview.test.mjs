import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const app = readFileSync(`${root}/app.js`, 'utf8');
const overview = readFileSync(`${root}/z2m-overview.js`, 'utf8');
const overviewModel = readFileSync(`${root}/z2m-overview-model.js`, 'utf8');
const auto = readFileSync(`${root}/z2m-auto.js`, 'utf8');
const runs = readFileSync(`${root}/z2m-runs.js`, 'utf8');
const page = readFileSync(`${root}/z2m-strategy-page.js`, 'utf8');

test('single-view registry exposes the approved eight internal destinations', () => {
  for (const tab of ['overview','strategy','services','lists','dns','proxy','monitor','maintenance'])
    assert.match(app, new RegExp(`['"]${tab}['"]`));
  assert.equal((app.match(/L\.view\.extend/g) || []).length, 1);
});

test('Overview reads backend status, strategy, run history and service DNS without mutations in load', () => {
  const load = overview.slice(overview.indexOf('function load('), overview.indexOf('\nfunction render('));
  for (const call of ['api.service.status','api.strategy.preview','api.orchestra.runHistory','api.orchestra.status','api.dns.serviceStatus'])
    assert.match(load, new RegExp(call.replaceAll('.', '\\.')));
  assert.doesNotMatch(load, /\.apply\(|\.start\(|\.stop\(/);
});

test('Overview preserves unknown and missing backend values instead of inventing health', () => {
  assert.match(overview, /value == null \|\| value === '' \? '—'/);
  assert.match(overview, /Backend не сообщил/);
  assert.doesNotMatch(overview, /metric\([^\n]+\|\|\s*0/);
});

test('Overview exposes runtime status, active strategy and explicit service actions', () => {
  assert.match(overviewModel, /Обход работает|Обход остановлен/);
  assert.match(overview, /активная стратегия/i);
  assert.match(overview, /api\.service\.start/);
  assert.match(overview, /api\.service\.stop/);
  assert.match(overview, /Подобрать лучшую стратегию/);
});

test('Overview stages point overrides and blocks them from the unsupported coordinator path', () => {
  assert.match(overview, /pendingOverride/);
  assert.match(overview, /action:\s*['"]override_set['"]/);
  assert.match(overview, /action:\s*['"]override_delete['"]/);
  assert.match(overview, /Применить изменение/);
  assert.match(overview, /Точечные правила нельзя применить через общий координатор/);
  assert.match(overview, /ctx\.openSemanticDiff/);
  assert.doesNotMatch(overview, /applyNow:\s*true/);
});

test('Auto Strategy preserves recovery, cooldown and unknown phase truth', () => {
  for (const phase of ['healthy','degraded','scanning','applying','verifying','recovering','cooldown','failed'])
    assert.match(auto, new RegExp(`['"]${phase}['"]`));
  assert.match(auto, /unknown|Неизвестное состояние/i);
  assert.match(auto, /lastGood[^\n]*available/);
});

test('active and historical work is composed into Strategy without raw hashes', () => {
  assert.match(page, /z2m-auto as Auto/);
  assert.match(page, /z2m-runs as Runs/);
  assert.match(runs, /selectedRunId/);
  assert.match(runs, /activeRun/);
  assert.doesNotMatch(overview + auto + runs, /innerHTML/);
});

test('Overview remains read-only until an explicit user action', () => {
  assert.match(overview, /shell\.button/);
  assert.match(overview, /ctx\.navigate\(['"]strategy['"]\)/);
  assert.match(overview, /Расширенный режим/);
  assert.doesNotMatch(overview, /autoApply|onload[^\n]*apply/i);
});
