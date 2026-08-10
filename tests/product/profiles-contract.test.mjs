import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => readFileSync(path.join(ROOT, relativePath), 'utf8');

const constants = read('zapret2-manager/files/usr/libexec/zapret2-manager/constants.uc');
const drafts = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-draft.uc');
const apply = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const statusCompatTest = read('tests/native/status-compat.test.mjs');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');

test('profiles preserve draft ownership and the shared transactional compiler', () => {
  assert.match(constants, /draft_state:\s*'\/etc\/zapret2-manager\/state\.json'/);
  assert.match(drafts, /const STATE = PATHS\.draft_state/);
  assert.match(apply, /function pipeline_front\(\)/);
  assert.match(apply, /profiles_apply_preview[\s\S]*pipeline_front\(\)/);
  assert.match(apply, /profiles_apply_run[\s\S]*pipeline_front\(\)/);
  assert.match(apply, /join\(' --new ', frags\)/);
  assert.match(apply, /set_var_cas/);
});

test('profiles RPC keeps direct envelopes and JSON-file transport', () => {
  assert.match(rpc, /profiles_(list|create|update|clone|delete|validate|import_applied|apply)_method/);
  assert.match(rpc, /writefile\(tmp, edit\)/);
  assert.doesNotMatch(rpc, /manager-state\.json/);
});

test('profile reorder is exposed through RPC, ACL, and LuCI API', () => {
  const signature = rpc.slice(rpc.indexOf('\t\tprofiles_list:'), rpc.indexOf('\t\tjob_get:'));

  assert.match(rpc, /profiles_reorder_method/);
  assert.match(rpc, /profiles_edit_action\('reorder', req\)/);
  assert.match(signature, /profiles_reorder:\s*\{ args: \{ edit: 'string' \}/);
  assert.match(acl, /"profiles_reorder"/);
  assert.match(api, /profilesReorder:rpc\.declare\(\{object:'zapret2-manager',method:'profiles_reorder',params:\['edit'\],reject:true\}\)/);
  assert.match(api, /profiles:\{[^}]*reorder:calls\.profilesReorder/);
});

test('profiles retain exact existing RPC method names', () => {
  const expected = [
    'profiles_list',
    'profiles_create',
    'profiles_update',
    'profiles_clone',
    'profiles_delete',
    'profiles_reorder',
    'profiles_validate',
    'profiles_import_applied',
    'profiles_apply',
  ];
  const registration = rpc.slice(rpc.indexOf('\t\tprofiles_list:'), rpc.indexOf('\t\tjob_get:'));
  const actual = [...registration.matchAll(/^\s*(profiles_[a-z_]+):/gm)].map(match => match[1]);

  assert.deepEqual(actual, expected);
  for (const method of expected) assert.match(api, new RegExp(`method:'${method}'`), method);
});

test('profiles status compatibility remains schema 3', () => {
  assert.match(statusCompatTest, /assert\.match\(compat, \/schema:\\s\*3\//);
});
