import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const uiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js';
const legacyUiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy-legacy.js';
const backendPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile-cli.uc';
const menuPath = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';

test('strategy-first UI wires explicit apply, targeted runs, overrides and advanced mode', () => {
  const ui = read(uiPath) + '\n' + read(legacyUiPath);
  assert.match(ui, /discord_profile_preview/);
  assert.match(ui, /discord_profile_apply/);
  assert.match(ui, /discord_profile_rollback/);
  assert.match(ui, /orchestra_run_start/);
  assert.match(ui, /orchestra_run_status/);
  assert.match(ui, /preview\.overrides/);
  assert.match(ui, /action:\s*'override_set'/);
  assert.match(ui, /action:\s*'override_delete'/);
  assert.match(ui, /applyNow:\s*true/);
  assert.match(ui, /pendingStrategyId/);
  assert.match(ui, /Применить глобально/);
  assert.match(ui, /Применить только к ресурсу/);
  assert.match(ui, /z2m-page/);
  assert.match(ui, /z2m-segmented/);
  assert.match(ui, /Простой режим/);
  assert.match(ui, /Расширенный режим/);
  assert.match(ui, /zapret2-manager\/advanced/);
  assert.doesNotMatch(ui, /autoApply/);
});

test('combo backend persists and applies override operations', () => {
  const backend = read(backendPath);
  for (const name of ['override_list', 'override_set', 'override_delete', 'reapply_after_override'])
    assert.match(backend, new RegExp(name));
  assert.match(backend, /orchestra-overrides\.json/);
  assert.match(backend, /idempotencyToken/);
  assert.match(backend, /mv -f/);
});

test('menu exposes seven product pages and keeps advanced Orchestra hidden', () => {
  const menu = JSON.parse(read(menuPath));
  assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/orchestra-strategy');
  assert.equal(menu['admin/services/zapret2-manager/orchestra'].action.path, 'zapret2-manager/orchestra-strategy');
  assert.ok(!menu['admin/services/zapret2-manager/combo-presets']);

  const advanced = menu['admin/services/zapret2-manager/advanced'];
  assert.equal(advanced.action.path, 'zapret2-manager/orchestra');
  assert.equal(advanced.hidden, true);

  const visible = Object.values(menu).filter((entry) => entry.hidden !== true && entry.action);
  assert.deepEqual(visible.map((entry) => entry.title), [
    'Zapret 2 Manager',
    'Orchestra',
    'Профили',
    'Списки',
    'DNS',
    'Мониторинг',
    'TG PROXY',
    'Обслуживание'
  ]);
});
