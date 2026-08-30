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
const shell = process.platform === 'win32'
  ? (process.env.Z2M_TEST_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
  : '/bin/sh';

function shellPath(value) {
  if (process.platform !== 'win32') return value;
  return value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

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
  assert.match(sync, /resolver_luaopt\s*\(\)/,
    'LuaOPT must be derived from resolver output');
  assert.match(sync, /LUA_INIT/,
    'activation must consume explicit ordered Lua records');
  assert.doesNotMatch(sync, /append_luaopt_if_present|CORE_LUA/,
    'runtime sync must not contain a hand-maintained Lua list or presence fallback');
});

test('runtime rollback re-aligns init LuaOPT after restoring removed assets', () => {
  const sync = readSync();
  const rollbackStart = sync.indexOf('activation_rollback() {');
  const rollbackEnd = sync.indexOf('\n}\n\nactivation() {', rollbackStart);
  assert.ok(rollbackStart >= 0 && rollbackEnd > rollbackStart,
    'activation rollback function must remain a bounded transaction');
  assert.match(sync.slice(rollbackStart, rollbackEnd), /activation_restore/,
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
    'SNAPSHOT|snapshot|composition|membership\n'
    + 'LUA_INIT|lua:selected|lifecycle-managed|lua|files/lua/selected.lua|/runtime-assets/lua/selected.lua|' + sha + '|0\n'
    + `ASSET|lua:selected|lifecycle-managed|lua|${shellPath(selected)}|/runtime-assets/lua/selected.lua|${sha}|${fs.statSync(selected).size}\n`
    + 'REMOVE|lua:z2k-detectors|lifecycle-managed|lua||/runtime-assets/lua/z2k-detectors.lua||\n');

  const script = path.join(root,
    'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
  const env = {
    ...process.env,
    Z2M_MANAGER_ASSET_ROOT: shellPath(manager),
    Z2M_RUNTIME_BASE: shellPath(runtime),
    Z2M_RUNTIME_ACTIVATION_SNAPSHOT: shellPath(path.join(dir, 'snapshot.tsv')),
    PATH: '/usr/bin:/bin',
  };
  const activated = spawnSync(shell, [shellPath(script), '--activate-registry', shellPath(spec)], { env, encoding: 'utf8' });
  assert.equal(activated.status, 0, JSON.stringify({ status: activated.status, error: activated.error && String(activated.error), stderr: activated.stderr, stdout: activated.stdout }));
  const afterActivate = fs.readFileSync(init, 'utf8');
  assert.doesNotMatch(afterActivate, /z2k-detectors\.lua/,
    'init must not load a runtime asset removed by the selected target');

  const rolledBack = spawnSync(shell, [shellPath(script), '--rollback-registry'], { env, encoding: 'utf8' });
  assert.equal(rolledBack.status, 0, rolledBack.stderr || rolledBack.stdout);
  const afterRollback = fs.readFileSync(init, 'utf8');
  assert.match(afterRollback, /z2k-detectors\.lua/,
    'rollback must restore the init load set together with the removed file');
});

test('resolved materialization enforces package-static and lifecycle-managed source ownership', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ownership-'));
  const packageRoot = path.join(dir, 'package-root');
  const manager = path.join(dir, 'manager-assets');
  const runtime = path.join(dir, 'opt', 'zapret2');
  fs.mkdirSync(path.join(packageRoot, 'runtime-assets', 'lua'), { recursive: true });
  fs.mkdirSync(path.join(manager, 'lua'), { recursive: true });
  fs.mkdirSync(path.join(runtime, 'lua'), { recursive: true });
  const packageSource = path.join(packageRoot, 'runtime-assets', 'lua', 'package.lua');
  fs.writeFileSync(packageSource, '-- package\n');
  const packageSha = crypto.createHash('sha256').update(fs.readFileSync(packageSource)).digest('hex');
  const spec = path.join(dir, 'activation.tsv');
  fs.writeFileSync(spec,
    'SNAPSHOT|snapshot|composition|membership\n'
    + `ASSET|lua:package|package-static|lua|${shellPath(packageSource)}|/runtime-assets/lua/package.lua|${packageSha}|${fs.statSync(packageSource).size}\n`);
  const env = {
    ...process.env,
    Z2M_RUNTIME_PACKAGE_ROOT: shellPath(packageRoot),
    Z2M_MANAGER_ASSET_ROOT: shellPath(manager),
    Z2M_RUNTIME_BASE: shellPath(runtime),
    Z2M_RUNTIME_ACTIVATION_SNAPSHOT: shellPath(path.join(dir, 'snapshot.tsv')),
    PATH: '/usr/bin:/bin',
  };
  const script = path.join(root,
    'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
  const activated = spawnSync(shell, [shellPath(script), '--activate-registry', shellPath(spec)], { env, encoding: 'utf8' });
  assert.equal(activated.status, 0, JSON.stringify({ status: activated.status, error: activated.error && String(activated.error), stderr: activated.stderr, stdout: activated.stdout }));
  assert.equal(fs.readFileSync(path.join(runtime, 'lua', 'package.lua'), 'utf8'), '-- package\n');

  const invalid = path.join(dir, 'invalid.tsv');
  fs.writeFileSync(invalid,
    'SNAPSHOT|snapshot|composition|membership\n'
    + `ASSET|lua:package|package-static|lua|${shellPath(manager)}/lua/package.lua|/runtime-assets/lua/package.lua|${packageSha}|${fs.statSync(packageSource).size}\n`);
  const rejected = spawnSync(shell, [shellPath(script), '--activate-registry', shellPath(invalid)], { env, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0, 'package-static must not consume a manager-owned source');
});
