import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function invoke(expression, env = {}) {
  const source = `import * as state from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function storage(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-state-'));
  const strategies = path.join(root, 'strategies');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  const env = {
    Z2M_STRATEGY_ROOT: root,
    Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(runtime, 'strategy-reconciliation.json'),
    Z2M_STRATEGY_LOCK: path.join(runtime, 'strategy-state.lock'),
  };
  try { return callback(env, root, strategies); } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const hash = 'a'.repeat(64);
const userStrategy = () => ({
  id: 'user-one', name: 'User one', is_builtin: false, origin: 'user',
  metadata: { description: 'local' },
  profiles: [
    { id: 'p1', args: '--filter-tcp=443', enabled: true },
    { id: 'p1', args: '--filter-tcp=80', enabled: false },
  ],
});

test('stale Strategy revision is rejected without changing the file', () => storage((env, root, strategies) => {
  const created = invoke(`state.strategy_user_create({strategy:${JSON.stringify(userStrategy())}})`, env);
  assert.equal(created.ok, true);
  assert.equal(created.strategy.revision, 1);

  const first = invoke(`state.strategy_user_update({id:'user-one',expectedRevision:1,strategy:${JSON.stringify({
    ...userStrategy(), name: 'Changed once',
  })}})`, env);
  const stale = invoke(`state.strategy_user_update({id:'user-one',expectedRevision:1,strategy:${JSON.stringify({
    ...userStrategy(), name: 'Stale change',
  })}})`, env);
  assert.equal(first.ok, true);
  assert.equal(stale.error.code, 'ECONFLICT');
  const read = invoke("state.strategy_user_get({id:'user-one'})", env);
  assert.equal(read.strategy.revision, 2);
  assert.equal(read.strategy.name, 'Changed once');
  assert.equal(fs.statSync(path.join(strategies, 'user-one.json')).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(root, 'state.json')), false);
}));

test('user list/get/create/delete use schema 1 and preserve disabled ordered Profiles', () => storage((env, root, strategies) => {
  const created = invoke(`state.strategy_user_create({strategy:${JSON.stringify(userStrategy())}})`, env);
  assert.equal(created.ok, true);
  assert.equal(created.strategy.schema, 1);
  assert.deepEqual(created.strategy.profiles.map(profile => profile.enabled), [true, false]);
  assert.equal(invoke('state.strategy_user_create({strategy:' + JSON.stringify(userStrategy()) + '})', env).error.code, 'ECONFLICT');

  const listed = invoke('state.strategy_user_list()', env);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.strategies.map(strategy => strategy.id), ['user-one']);
  assert.equal(invoke("state.strategy_user_delete({id:'user-one',expectedRevision:1})", env).ok, true);
  assert.equal(invoke("state.strategy_user_get({id:'user-one'})", env).error.code, 'ENOENT');
  assert.equal(fs.existsSync(path.join(strategies, 'user-one.json')), false);
}));

test('builtin and extension identities cannot enter user storage or be mutated', () => storage((env) => {
  const builtin = { id: 'z2k_all_in_one', name: 'All in one', is_builtin: true,
    origin: 'avatar_builtin', profiles: [{ id: 'p1', args: '--filter-tcp=443' }] };
  const extension = { id: 'extension-one', name: 'Extension', is_extension: true,
    origin: 'extension', profiles: [{ id: 'p1', args: '--filter-tcp=443' }] };
  assert.equal(invoke(`state.strategy_user_create({strategy:${JSON.stringify(builtin)}})`, env).error.code, 'ECONFLICT');
  assert.equal(invoke(`state.strategy_user_create({strategy:${JSON.stringify(extension)}})`, env).error.code, 'ECONFLICT');
  assert.equal(invoke(`state.strategy_user_update({id:'z2k_all_in_one',expectedRevision:1,strategy:${JSON.stringify(builtin)}})`, env).error.code, 'EIMMUTABLE');
  assert.equal(invoke("state.strategy_user_delete({id:'z2k_all_in_one',expectedRevision:1})", env).error.code, 'EIMMUTABLE');
}));

test('duplicate proposes and stores a deep-copied user Strategy with pinned ID/name semantics', () => storage((env) => {
  const builtin = { id: 'z2k_all_in_one', name: 'All in one', is_builtin: true,
    origin: 'avatar_builtin', metadata: { label: 'recommended' },
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: true }] };
  const result = invoke(`state.strategy_duplicate({strategy:${JSON.stringify(builtin)}})`, env);
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, 'z2k_all_in_one_copy');
  assert.equal(result.strategy.name, 'All in one (копия)');
  assert.equal(result.strategy.origin, 'user');
  assert.equal(result.strategy.is_builtin, false);
  assert.deepEqual(result.strategy.metadata, builtin.metadata);
  assert.deepEqual(result.strategy.profiles, builtin.profiles);
  assert.equal(invoke("state.strategy_user_get({id:'z2k_all_in_one_copy'})", env).ok, true);
}));

test('favorites preserve requested order, allow builtin IDs, and clean deleted user IDs', () => storage((env) => {
  const created = invoke(`state.strategy_user_create({strategy:${JSON.stringify(userStrategy())}})`, env);
  assert.equal(created.ok, true);
  const favorite = invoke("state.strategy_favorite({expectedRevision:0,id:'user-one',favorite:true})", env);
  assert.equal(favorite.ok, true);
  const builtin = invoke(`state.strategy_favorite({expectedRevision:${favorite.state.revision},id:'z2k_all_in_one',favorite:true})`, env);
  assert.deepEqual(builtin.state.favorites, ['user-one', 'z2k_all_in_one']);
  const removed = invoke(`state.strategy_user_delete({id:'user-one',expectedRevision:1})`, env);
  assert.equal(removed.ok, true);
  assert.deepEqual(invoke(`state.strategy_favorite({expectedRevision:${removed.state.revision},id:null,favorite:false})`, env).state.favorites,
    ['z2k_all_in_one']);
}));

test('selection uses state CAS and persists identity/hash fields only', () => storage((env, root) => {
  const set = invoke(`state.strategy_selection_set({expectedRevision:0,selected:{id:'user-one',origin:'user',revision:3,candidateSha256:'${hash}'}})`, env);
  assert.equal(set.ok, true);
  assert.equal(set.state.revision, 1);
  assert.equal(invoke(`state.strategy_selection_set({expectedRevision:0,selected:{id:'other',origin:'user',revision:1,candidateSha256:'${hash}'}})`, env).error.code, 'ECONFLICT');
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'strategy-state.json'), 'utf8'));
  assert.equal(fs.statSync(path.join(root, 'strategy-state.json')).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(persisted).sort(), ['favorites', 'revision', 'schema', 'selected']);
  assert.deepEqual(Object.keys(persisted.selected).sort(), ['candidateSha256', 'id', 'origin', 'revision']);
  assert.equal(persisted.drift, undefined);
  assert.equal(persisted.runtime, undefined);
  assert.equal(persisted.queue, undefined);
  assert.deepEqual(invoke('state.strategy_selection_get()', env).selected, persisted.selected);
}));

test('delete cleans active selection and reconciliation remains volatile', () => storage((env, root) => {
  assert.equal(invoke(`state.strategy_user_create({strategy:${JSON.stringify(userStrategy())}})`, env).ok, true);
  const selected = invoke(`state.strategy_selection_set({expectedRevision:0,selected:{id:'user-one',origin:'user',revision:1,candidateSha256:'${hash}'}})`, env);
  assert.equal(selected.ok, true);
  assert.equal(invoke("state.strategy_reconcile_record({id:'user-one',hash:'" + hash + "',reason:'drift'})", env).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'strategy-state.json')), true);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_RECONCILIATION), true);
  const record = invoke('state.strategy_reconcile_get()', env);
  assert.deepEqual(record.record, { id: 'user-one', hash, reason: 'drift' });
  assert.equal(invoke('state.strategy_reconcile_clear()', env).ok, true);
  assert.equal(fs.existsSync(env.Z2M_STRATEGY_RECONCILIATION), false);
  assert.equal(invoke(`state.strategy_user_delete({id:'user-one',expectedRevision:1})`, env).ok, true);
  assert.equal(invoke('state.strategy_selection_get()', env).selected, null);
}));

test('schema, bounds, traversal, atomicity, and production path boundaries fail closed', () => storage((env, root, strategies) => {
  for (const strategy of [
    { ...userStrategy(), id: '../escape' },
    { ...userStrategy(), id: 'a/b' },
    { ...userStrategy(), name: '' },
    { ...userStrategy(), profiles: [{ id: 'p1' }] },
  ]) {
    const result = invoke(`state.strategy_user_create({strategy:${JSON.stringify(strategy)}})`, env);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EINPUT');
  }
  fs.writeFileSync(path.join(strategies, 'too-large.json'), 'x'.repeat(521029));
  assert.equal(invoke("state.strategy_user_get({id:'too-large'})", env).error.code, 'EINPUT');
  assert.deepEqual(fs.readdirSync(strategies), ['too-large.json']);

  const source = fs.readFileSync(MODULE, 'utf8');
  assert.match(source, /\/etc\/zapret2-manager\/strategies/);
  assert.match(source, /\/etc\/zapret2-manager\/strategy-state\.json/);
  assert.match(source, /mktemp/);
  assert.match(source, /mv -f/);
  assert.match(source, /0600/);
  assert.match(source, /0700/);
  assert.match(source, /flock/);
  assert.doesNotMatch(source, /profiles-draft/);
  assert.doesNotMatch(source, /\/etc\/zapret2-manager\/state\.json['"`]/);
}));
