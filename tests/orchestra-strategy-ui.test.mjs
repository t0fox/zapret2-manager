import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const viewRoot = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const overviewPath = `${viewRoot}/z2m-overview.js`;
const strategyPath = `${viewRoot}/z2m-strategy.js`;
const apiPath = `${viewRoot}/z2m-api.js`;
const backendPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile-cli.uc';
const menuPath = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';

test('single-view strategy UI wires explicit global apply and bounded targeted runs', () => {
  const strategy = read(strategyPath);
  const api = read(apiPath);
  assert.match(api, /discord_profile_preview/);
  assert.match(api, /discord_profile_apply/);
  assert.match(api, /discord_profile_rollback/);
  assert.match(api, /orchestra_run_start/);
  assert.match(api, /orchestra_run_status/);
  assert.match(strategy, /pendingStrategyId/);
  assert.match(strategy, /ctx\.store\.setDraft\(['"]strategy['"]/);
  assert.match(strategy, /ctx\.api\.strategy\.apply/);
  assert.match(strategy, /ctx\.api\.strategy\.rollback/);
  assert.match(strategy, /targetType:\s*['"]domain['"]/);
  assert.match(strategy, /totalTimeoutSec:\s*all\s*\?\s*600\s*:\s*90/);
  assert.match(strategy, /Применить/);
  assert.match(strategy, /Проверить ресурс/);
  assert.match(strategy, /0 targets/);
  assert.doesNotMatch(strategy, /autoApply|applyNow:\s*true/);
});

test('Overview stages one override in shared draft state and applies it only explicitly', () => {
  const overview = read(overviewPath);
  assert.match(overview, /pendingOverride/);
  assert.match(overview, /action:\s*['"]override_set['"]/);
  assert.match(overview, /action:\s*['"]override_delete['"]/);
  assert.match(overview, /ctx\.setDraft\(['"]strategy['"]/);
  assert.match(overview, /ctx\.api\.strategy\.apply/);
  assert.match(overview, /applyNow:\s*true/);
  assert.match(overview, /Применить только к ресурсу/);
  assert.match(overview, /Применить изменение/);
  assert.match(overview, /Отменить изменение/);
  assert.match(overview, /Точечные правила/);
  assert.doesNotMatch(overview, /action:\s*['"]override_(?:set|delete)['"][\s\S]{0,180}applyNow:\s*true[\s\S]{0,180}setDraft/);
});

test('override backend persists both operations and applies runtime only when requested', () => {
  const backend = read(backendPath);
  for (const name of ['override_list', 'override_set', 'override_delete', 'reapply_after_override'])
    assert.match(backend, new RegExp(name));
  assert.match(backend, /orchestra-overrides\.json/);
  assert.match(backend, /req\.applyNow\s*!==\s*true/);
  assert.match(backend, /applied:\s*false/);
  assert.match(backend, /idempotencyToken/);
  assert.match(backend, /mv -f/);
});

test('menu exposes one single-view app entry and hidden compatibility routes', () => {
  const menu = JSON.parse(read(menuPath));
  assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/app');
  assert.ok(!menu['admin/services/zapret2-manager/combo-presets']);
  const actionable = Object.values(menu).filter((entry) => entry.action);
  assert.equal(actionable.filter((entry) => entry.hidden !== true).length, 1);
  for (const entry of actionable.filter((item) => item.hidden === true)) {
    assert.deepEqual(entry.depends.acl, ['zapret2-manager']);
    assert.match(entry.action.path, /^zapret2-manager\//);
  }
});
