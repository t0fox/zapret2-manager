import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apply = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc', 'utf8');
const profiles = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-apply.uc', 'utf8');
const cli = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/profiles-cli.uc', 'utf8');
const service = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service.uc', 'utf8');

function executableSource(source) {
  return source.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
}

function forbidUnsafeRuntime(source) {
  assert.doesNotMatch(executableSource(source), /\bnft\s+flush\b|\/etc\/init\.d\/firewall\s+restart|fw4\s+restart/);
}

test('production apply holds the config lock across preflight, mutation, restart, verification and rollback', () => {
  assert.match(cli, /CONFIG_LOCK\s*=\s*['"]\/opt\/zapret2\/config\.lock['"]/);
  assert.match(cli, /Z2M_CONFIG_LOCKED=1/);
  assert.match(cli, /flock\s+-x[\s\S]*profiles-cli\.uc[\s\S]*apply/);
  assert.match(cli, /profiles_apply_preview\(\)[\s\S]*profiles_apply_run\(\)/);
});

test('writer fails closed without flock and has no marker fallback', () => {
  assert.match(apply, /function have_flock\(/);
  assert.match(apply, /if \(!have_flock\(\)\) return null/);
  assert.doesNotMatch(apply, /\.writing|MARKER|marker fallback/i);
});

test('writer uses restrictive collision-resistant same-directory temp files and durable atomic rename', () => {
  assert.match(apply, /umask 077/);
  assert.match(apply, /mktemp[\s\S]*XXXXXX/);
  assert.match(apply, /\[ ! -L/);
  assert.match(apply, /sync -f/);
  assert.match(apply, /mv -f/);
  assert.match(apply, /readfile\(path\)[\s\S]*== content/);
});

test('apply performs a whole-config CAS before the sole sanctioned write', () => {
  assert.match(apply, /export const set_var_cas/);
  assert.match(apply, /expected_sha/);
  assert.match(apply, /ECONFLICT/);
  assert.match(profiles, /set_var_cas\(OPT_VAR,[\s\S]*configSha256/);
});

test('rollback restores exact snapshot bytes through apply.uc and verifies restored runtime', () => {
  assert.match(profiles, /restore_whole_file\(PATHS\.applied_conf/);
  assert.match(profiles, /rollbackVerify/);
  assert.match(profiles, /configRestored/);
  assert.doesNotMatch(executableSource(profiles), /service\.uc rollback/);
  assert.match(service, /restore_whole_file\(PATHS\.applied_conf/);
  assert.doesNotMatch(service, /cp -f[^\n]*PATHS\.applied_conf/);
});

test('upstream zapret2 remains the only runtime and firewall owner', () => {
  assert.match(profiles, /\/etc\/init\.d\/zapret2/);
  forbidUnsafeRuntime(apply);
  forbidUnsafeRuntime(profiles);
  forbidUnsafeRuntime(service);
});
