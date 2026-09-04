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
const applyCli = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply-cli.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const statusCompatTest = read('tests/native/status-compat.test.mjs');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');

function codeMask(source) {
  let masked = '', state = 'code', escaped = false, regexClass = false, quote = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (state === 'line') {
      if (char === '\n') { state = 'code'; masked += '\n'; } else masked += ' ';
    } else if (state === 'block') {
      if (char === '*' && next === '/') { masked += '  '; i++; state = 'code'; }
      else masked += char === '\n' ? '\n' : ' ';
    } else if (state === 'quote') {
      masked += char === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) state = 'code';
    } else if (state === 'regex') {
      masked += char === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '[') regexClass = true;
      else if (char === ']') regexClass = false;
      else if (char === '/' && !regexClass) state = 'code';
    } else if (char === '/' && next === '/') { masked += '  '; i++; state = 'line'; }
    else if (char === '/' && next === '*') { masked += '  '; i++; state = 'block'; }
    else if (char === '"' || char === "'" || char === '`') { masked += ' '; state = 'quote'; quote = char; }
    else if (char === '/' && /[=(,:;!&|?{}\[]/.test(source.slice(0, i).trimEnd().at(-1) ?? '=')) {
      masked += ' '; state = 'regex'; regexClass = false;
    } else masked += char;
  }
  return masked;
}

function functionRange(source, name) {
  const declaration = new RegExp(`(?:export const ${name} = function|function ${name})\\([^)]*\\)\\s*\\{`).exec(source);
  assert.ok(declaration, `missing function ${name}`);

  const start = declaration.index + declaration[0].length;
  const masked = codeMask(source);
  let depth = 1;
  for (let i = start; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return { start, end: i };
  }
  assert.fail(`unterminated function ${name}`);
}

function functionBody(source, name) {
  const { start, end } = functionRange(source, name);
  return source.slice(start, end);
}

function functionCode(source, name) {
  const { start, end } = functionRange(source, name);
  return codeMask(source).slice(start, end);
}

test('function extraction ignores lexical braces', () => {
  const fixture = `function target() {
    let a = "}"; // }
    let b = /[{}]/; /* { } */
    return { ok: true };
  }
  function next() { return false; }`;

  assert.match(functionBody(fixture, 'target'), /return \{ ok: true \};/);
  assert.doesNotMatch(functionBody(fixture, 'target'), /function next/);
});

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

test('locked Strategy candidate adapter preserves the server-owned projection boundary', () => {
  assert.match(applyCli, /profiles_projection_boundary/);
  assert.match(applyCli, /boundary\.present \? boundary\.projection : null/);
});

test('draft mutations enforce the production single-profile structural validator before save', () => {
  const create = functionBody(drafts, 'profiles_create');
  const update = functionBody(drafts, 'profiles_update');

  assert.match(drafts, /function validate_single_fragment\(optText\)/);
  assertOrdered(create, [/validate_single_fragment\(/, /alloc_id\(/, /save_state\(/]);
  assertOrdered(update, [/validate_single_fragment\(/, /cur\.opt = newOpt/, /save_state\(/]);
});

test('delete requires and checks the expected profile revision before mutation', () => {
  const remove = functionBody(drafts, 'profiles_delete');

  assertOrdered(remove, [/type\(input\.revision\) != 'int'/, /input\.revision != cur\.revision/, /let kept = \[\]/, /save_state\(/]);
});

test('preview is non-mutating and apply reuses the compiler inside the lock', () => {
  const preview = functionBody(apply, 'profiles_apply_preview');
  const run = functionBody(apply, 'profiles_apply_run');

  assert.match(preview, /pipeline_front\(\)/);
  const previewCode = functionCode(apply, 'profiles_apply_preview');
  const calls = [...previewCode.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
    .map(match => match[1]).filter(name => name !== 'if');
  assert.deepEqual([...new Set(calls)].sort(), ['apply_decision', 'pipeline_front']);
  assertOrdered(run, [
    /getenv\('Z2M_CONFIG_LOCKED'\)/,
    /pipeline_front\(\)/,
    /apply_candidate_pipeline\(f\)/,
  ]);
});

test('apply transaction snapshots, writes, restarts, recollects, verifies, and rolls back exactly', () => {
  const transaction = functionBody(apply, 'apply_candidate_pipeline');

  // Real-router failure evidence: spawning `/usr/bin/ucode status-collector.uc`
  // dies at parse time ("Exports may only appear at top level of a module"),
  // so the recollected status never appeared and every apply failed
  // verification. Recollection must run the collector in-process.
  assert.doesNotMatch(apply, /popen\('\/usr\/bin\/ucode '\s*\+\s*PATHS\.collector/);
  assert.match(apply, /import \{ collect_observations, collect \} from/);
  // verification must tolerate the fw-rule application race after restart
  // with a bounded condition poll; readiness on the first probe must not pay
  // an unconditional fixed sleep.
  const verifyFn = functionBody(apply, 'transaction_verify');
  assert.match(verifyFn, /deadline/);
  assert.match(verifyFn, /run\('sleep 0\.1'\)/);
  assert.doesNotMatch(verifyFn, /run\('sleep 2'\)/);
  assertOrdered(transaction, [
    /snapshot_apply\(\)/,
    /set_vars?_cas\(/,
    /upstream_action\('restart'\)/,
    /transaction_verify\(0,/,
  ]);
  assertOrdered(transaction, [
    /profiles_rollback_decision\(r\.rc, verify\.ok, false, -1, false\)/,
    /if \(rollbackDecision\.rollbackRequired\)/,
    /restore_whole_file\(PATHS\.applied_conf, snap\.configBytes\)/,
    /config_sha256\(\) == snap\.configSha256/,
    /read_config_bytes\(\) == snap\.configBytes/,
    /profiles_rollback_decision\(r\.rc, verify\.ok, configRestored, rr\.rc, rollbackVerify\.ok\)\.rollbackOk/,
  ]);
  assertOrdered(transaction, [
    /if \(rollbackDecision\.rollbackRequired\)/,
    /return err\('verify'/,
    /event_apply\('info'/,
    /return \{\s*ok: true, mode: 'apply'/,
  ]);
});

test('applied identity is committed only after verified apply and after verified rollback restore', () => {
  const snapshot = functionBody(apply, 'snapshot_apply');
  const transaction = functionBody(apply, 'apply_candidate_pipeline');
  const applyWriter = read('zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc');

  assert.doesNotMatch(snapshot, /applied\.sha256/,
    'snapshot must not claim the pre-CAS state as successfully applied');
  assertOrdered(transaction, [
    /(?:set_var_cas\(OPT_VAR, dq_escape\(f\.candidate\), snap\.configSha256\)|set_vars_cas\(vars_map, snap\.configSha256\))/,
    /upstream_action\('restart'\)/,
    /transaction_verify\(0,/,
    /commit_applied_identity/,
  ]);
  assertOrdered(transaction, [
    /restore_whole_file\(PATHS\.applied_conf, snap\.configBytes\)/,
    /rollbackVerify\.ok/,
    /commit_applied_identity/,
  ]);
  assert.match(applyWriter, /export const commit_applied_identity/);
  assert.match(applyWriter, /Z2M_APPLIED_IDENTITY/);
});

test('recent apply cache verifies current config and runtime before returning idempotent success', () => {
  const transaction = functionBody(apply, 'apply_candidate_pipeline');

  assert.match(transaction, /read_var\(OPT_VAR\) == f\.candidate/);
  assert.match(transaction, /verify_status\(recollect_status\(\), parse_queue\(\)/);
  assertOrdered(transaction, [/candidateSha256 == f\.diff\.candidateSha256/, /read_var\(OPT_VAR\) == f\.candidate/, /idempotent: true/]);
});

test('profile temporary files are created collision-resistant with private permissions', () => {
  const tmpfile = functionBody(rpc, 'profiles_tmpfile');
  const transport = functionBody(rpc, 'profiles_edit_action');

  assert.match(rpc, /function profiles_tmpfile\(\)/);
  assert.match(rpc, /mktemp \/tmp\/z2m-profiles-edit\.XXXXXX/);
  assertOrdered(tmpfile, [/if \(rc != 0 \|\| index\(tmp, '\/tmp\/z2m-profiles-edit\.'\) != 0\)/, /unlink\(tmp\)/, /return null/]);
  assert.match(transport, /profiles_tmpfile\(\)/);
  assert.doesNotMatch(transport, /z2m-profiles-edit\.' \+ time\(\)/);
});

test('candidate and expected hash cross the lock boundary unchanged', () => {
  const caller = functionBody(apply, 'locked_candidate_call');
  const receiver = functionBody(apply, 'profiles_apply_candidate');

  assert.match(caller, /\{ candidate: candidate, expectedHash: expectedHash \}/);
  assert.match(receiver, /diff\.candidateSha256 != expectedHash/);
  assert.match(receiver, /apply_candidate_pipeline\(\{ candidate: candidate,/);
});

test('profiles list exposes the exact applied option hash for post-apply verification', () => {
  const profiles = read('zapret2-manager/files/usr/libexec/zapret2-manager/profiles.uc');
  assert.match(profiles, /source\.optSha256 = sha256_text\(opt\)/);
  assert.match(profiles, /mktemp \/tmp\/z2m-profiles-sha\.XXXXXX/);
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
