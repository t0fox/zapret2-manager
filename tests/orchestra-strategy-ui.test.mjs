import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const uiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra-strategy.js';
const backendPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile-cli.uc';
const menuPath = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';

test('strategy-first UI wires explicit apply, targeted runs, overrides and advanced route', () => {
  const ui = read(uiPath);
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
  assert.match(ui, /zapret2-manager\/orchestra/);
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

test('menu routes product root to new page and removes combo presets', () => {
  const menu = JSON.parse(read(menuPath));
  assert.equal(menu['admin/services/zapret2-manager'].action.path, 'zapret2-manager/orchestra-strategy');
  assert.equal(menu['admin/services/zapret2-manager/orchestra'].action.path, 'zapret2-manager/orchestra-strategy');
  assert.ok(!menu['admin/services/zapret2-manager/combo-presets']);
  assert.equal(menu['admin/services/zapret2-manager/advanced'].action.path, 'zapret2-manager/orchestra');
});
