import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-cli.uc',
  'utf8'
);

test('production mutations fail closed when flock is unavailable', () => {
  assert.match(source, /if \(is_mutating\(mode\)[\s\S]*!have_flock\(\)[\s\S]*ELOCK/);
  assert.doesNotMatch(source, /fall through to direct run/);
  assert.doesNotMatch(source, /marker is the fallback serializer/);
});

test('profiles apply requires complete verified native and Lua coverage', () => {
  for (const field of [
    'cliSyntax',
    'luaLoad',
    'luaCompatibility',
    'functionExistence',
    'blobExistence',
    'runtimeArguments',
    'executionPlan'
  ]) assert.match(source, new RegExp(`coverage\\.${field} == 'passed'`));

  assert.match(source, /let native = [\s\S]*native_preflight\(preview\.candidate\)/);
  assert.match(source, /!full_native_verified\(native\)/);
  assert.match(source, /profiles_apply_preview\(\)[\s\S]*profiles_apply_run\(\)/);
});
