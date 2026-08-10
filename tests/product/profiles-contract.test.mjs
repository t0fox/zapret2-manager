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

function functionBody(source, name) {
  const declaration = new RegExp(`(?:export const ${name} = function|function ${name})\\([^)]*\\)\\s*\\{`).exec(source);
  assert.ok(declaration, `missing function ${name}`);

  const start = declaration.index + declaration[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i);
  }
  assert.fail(`unterminated function ${name}`);
}

function assertOrdered(body, patterns) {
  let cursor = 0;
  for (const pattern of patterns) {
    const match = pattern.exec(body.slice(cursor));
    assert.ok(match, `${pattern} missing or out of order`);
    cursor += match.index + match[0].length;
  }
}

test('profiles preserve draft ownership and the shared transactional compiler', () => {
  const preview = functionBody(apply, 'profiles_apply_preview');
  const run = functionBody(apply, 'profiles_apply_run');

  assert.match(constants, /draft_state:\s*'\/etc\/zapret2-manager\/state\.json'/);
  assert.match(drafts, /const STATE = PATHS\.draft_state/);
  assert.match(apply, /function pipeline_front\(\)/);
  assert.match(preview, /pipeline_front\(\)/);
  assert.match(run, /pipeline_front\(\)/);
  assert.match(apply, /join\(' --new ', frags\)/);
  assert.match(apply, /set_var_cas/);
});

test('preview is non-mutating and apply reuses the compiler inside the lock', () => {
  const preview = functionBody(apply, 'profiles_apply_preview');
  const run = functionBody(apply, 'profiles_apply_run');

  assert.match(preview, /pipeline_front\(\)/);
  assert.doesNotMatch(preview, /set_var_cas|snapshot_apply|UPSTREAM_INIT|restart|apply_candidate_pipeline/);
  assertOrdered(run, [
    /getenv\('Z2M_CONFIG_LOCKED'\)/,
    /pipeline_front\(\)/,
    /apply_candidate_pipeline\(f\)/,
  ]);
});

test('apply transaction snapshots, writes, restarts, recollects, verifies, and rolls back exactly', () => {
  const transaction = functionBody(apply, 'apply_candidate_pipeline');

  assertOrdered(transaction, [
    /snapshot_apply\(\)/,
    /set_var_cas\(OPT_VAR, dq_escape\(f\.candidate\), snap\.configSha256\)/,
    /run\(UPSTREAM_INIT \+ ' restart'\)/,
    /recollect_status\(\)/,
    /verify_status\(/,
  ]);
  assertOrdered(transaction, [
    /if \(r\.rc != 0 \|\| !verify\.ok\)/,
    /restore_whole_file\(PATHS\.applied_conf, snap\.configBytes\)/,
    /config_sha256\(\) == snap\.configSha256/,
    /read_config_bytes\(\) == snap\.configBytes/,
    /rollbackVerify\.ok/,
  ]);
  assertOrdered(transaction, [
    /if \(r\.rc != 0 \|\| !verify\.ok\)/,
    /return err\('verify'/,
    /event_apply\('info'/,
    /return \{\s*ok: true, mode: 'apply'/,
  ]);
});

test('candidate and expected hash cross the lock boundary unchanged', () => {
  const caller = functionBody(apply, 'locked_candidate_call');
  const receiver = functionBody(apply, 'profiles_apply_candidate');

  assert.match(caller, /\{ candidate: candidate, expectedHash: expectedHash \}/);
  assert.match(receiver, /diff\.candidateSha256 != expectedHash/);
  assert.match(receiver, /apply_candidate_pipeline\(\{ candidate: candidate,/);
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
