import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const syncPath = path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');

function readSync() {
  return fs.readFileSync(syncPath, 'utf8');
}

test('registry activation keeps init Lua load set consistent with selected runtime assets', () => {
  const sync = readSync();
  const activationStart = sync.indexOf('activation() {');
  const activationEnd = sync.indexOf('\n}\n\ncase ', activationStart);
  assert.ok(activationStart >= 0 && activationEnd > activationStart,
    'activation function must be available before mode dispatch');
  const activation = sync.slice(activationStart, activationEnd);

  assert.match(sync, /align_luaopt\s*\(\)/,
    'runtime sync must expose one canonical init LuaOPT reconciler');
  assert.match(activation, /align_luaopt/,
    'registry activation must reconcile LuaOPT before publishing success');
  assert.doesNotMatch(sync,
    /LUAOPT="[^\n"]*z2k-detectors\.lua[^\n"]*"/,
    'LuaOPT must not unconditionally load a release-removed detector');
  assert.match(sync, /append_luaopt_if_present\s+z2k-detectors\.lua/,
    'detector must use the existence-gated LuaOPT helper');
  assert.match(sync,
    /append_luaopt_if_present\(\)\s*\{[\s\S]*?\[\s*-f\s+"\$_path"\s*\]/,
    'optional Lua assets must be appended only when their selected runtime file exists');
});

test('runtime rollback re-aligns init LuaOPT after restoring removed assets', () => {
  const sync = readSync();
  const rollbackStart = sync.indexOf('activation_rollback() {');
  const rollbackEnd = sync.indexOf('\n}\n\nactivation() {', rollbackStart);
  assert.ok(rollbackStart >= 0 && rollbackEnd > rollbackStart,
    'activation rollback function must remain a bounded transaction');
  assert.match(sync.slice(rollbackStart, rollbackEnd), /align_luaopt/,
    'rollback must restore the init load set together with runtime bytes');
});

test('activation and rollback toggle a removed Lua asset in the real init script', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-luaopt-'));
  const manager = path.join(dir, 'manager-assets');
  const runtime = path.join(dir, 'opt', 'zapret2');
  const init = path.join(runtime, 'init.d', 'openwrt', 'zapret2');
  const runtimeLua = path.join(runtime, 'lua');
  fs.mkdirSync(path.dirname(init), { recursive: true });
  fs.mkdirSync(path.join(manager, 'lua'), { recursive: true });
  fs.mkdirSync(runtimeLua, { recursive: true });
  fs.writeFileSync(init, 'LUAOPT="stale --lua-init=@$ZAPRET_BASE/lua/z2k-detectors.lua"\n');
  for (const name of ['zapret-lib.lua', 'zapret-antidpi.lua', 'z2k-detectors.lua']) {
    fs.writeFileSync(path.join(runtimeLua, name), `-- ${name}\n`);
  }
  const selected = path.join(manager, 'lua', 'selected.lua');
  fs.writeFileSync(selected, '-- selected\n');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(selected)).digest('hex');
  const spec = path.join(dir, 'activation.tsv');
  fs.writeFileSync(spec,
    `ASSET|lua:selected|lua|${selected}|/runtime-assets/lua/selected.lua|${sha}|${fs.statSync(selected).size}\n`
    + 'REMOVE|lua:z2k-detectors|lua||/runtime-assets/lua/z2k-detectors.lua||\n');

  const script = path.join(root,
    'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
  const env = {
    ...process.env,
    Z2M_MANAGER_ASSET_ROOT: manager,
    Z2M_RUNTIME_BASE: runtime,
    Z2M_RUNTIME_ACTIVATION_SNAPSHOT: path.join(dir, 'snapshot.tsv'),
    PATH: '/usr/bin:/bin',
  };
  const activated = spawnSync('/bin/sh', [script, '--activate-registry', spec], { env, encoding: 'utf8' });
  assert.equal(activated.status, 0, activated.stderr || activated.stdout);
  const afterActivate = fs.readFileSync(init, 'utf8');
  assert.doesNotMatch(afterActivate, /z2k-detectors\.lua/,
    'init must not load a runtime asset removed by the selected target');

  const rolledBack = spawnSync('/bin/sh', [script, '--rollback-registry'], { env, encoding: 'utf8' });
  assert.equal(rolledBack.status, 0, rolledBack.stderr || rolledBack.stdout);
  const afterRollback = fs.readFileSync(init, 'utf8');
  assert.match(afterRollback, /z2k-detectors\.lua/,
    'rollback must restore the init load set together with the removed file');
});
