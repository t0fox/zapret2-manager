import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const overview = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js'), 'utf8');
const enginePanel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js'), 'utf8');
const maintenance = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
const engineModel = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-model.js'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js'), 'utf8');

test('lifecycle actions expose truthful pending feedback and use one mutation per action', () => {
  assert.match(overview, /lifecycleAction/);
  assert.match(overview, /Запускается nfqws2/);
  assert.match(overview, /Проверяется процесс и NFQUEUE/);
  assert.match(overview, /ctx\.api\.service\.restart\(\)/);
  assert.doesNotMatch(overview, /ctx\.api\.service\.stop\(\)\.then\(function \(\) \{ return ctx\.api\.service\.start\(\)/);
});

test('lifecycle result is visible and buttons stay locked while the request is pending', () => {
  assert.match(overview, /all lifecycle buttons|lifecyclePending|lifecycleResult/i);
  assert.match(overview, /Не удалось запустить nfqws2/);
  assert.doesNotMatch(overview, /throw \{ message: copy\.failure/);
  assert.match(overview, /disabled.*lifecycle|lifecycle.*disabled/i);
});

test('Dashboard maps machine reason codes to product copy and system facts', () => {
  assert.match(overview, /reasonLabel/);
  assert.doesNotMatch(overview, /format\.text\(summary\.reasonCode\)/);
  assert.match(overview, /ctx\.api\.maintenance\.status\(\)/);
  assert.match(overview, /hostname|memoryAvailable|uptime/i);
});

test('engine normal rows use Russian product labels and state mapping', () => {
  assert.match(engineModel, /stateLabel/);
  assert.match(engineModel, /serviceLabel/);
  assert.match(enginePanel, /Поставщик движка/);
  assert.match(enginePanel, /Проверить обновления/);
  assert.doesNotMatch(enginePanel, /value:status\.state/);
  assert.doesNotMatch(enginePanel, /value:status\.serviceState/);
  assert.doesNotMatch(enginePanel, /Официальные releases/);
  assert.doesNotMatch(enginePanel, /Проверить release/);
});

test('primary navigation has reversible canonical routes and one hash listener', () => {
  for (const route of ['dashboard', 'control', 'services', 'diagnostics', 'updates', 'engine', 'backups'])
    assert.match(navigation, new RegExp("id: '" + route + "'"));
  assert.match(app, /hashHandler = function \(\) \{ activate\(tabFromHash\(\)\); \}/);
  assert.match(app, /window\.removeEventListener\('hashchange', hashHandler\)/);
});

test('page teardown clears Dashboard and maintenance pollers', () => {
  assert.match(overview, /function unmount\(\)[\s\S]*clearTimeout\(runtime\.timer\)/);
  assert.match(enginePanel, /function unmount\(ctx\)[\s\S]*clearInterval\(ctx\.engineState\.timer\)/);
  assert.match(maintenance, /function unmount\(ctx\)[\s\S]*ctx\.engineState[\s\S]*EnginePanel\.unmount/);
});
