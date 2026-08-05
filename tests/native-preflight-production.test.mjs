import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const preflight = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc',
  'utf8'
);
const cli = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-cli.uc',
  'utf8'
);

test('native preflight requires pinned engine and Lua evidence', () => {
  assert.match(preflight, /native-preflight\.json/);
  assert.match(preflight, /sha256sum/);
  assert.match(preflight, /expectedNfqws2Sha256/);
  assert.match(preflight, /expectedLuaBundleSha256/);
  assert.match(preflight, /--dry-run/);
  assert.match(preflight, /--intercept=0/);
});

test('native preflight reports all required coverage dimensions', () => {
  for (const field of [
    'cliSyntax', 'luaLoad', 'luaCompatibility', 'functionExistence',
    'blobExistence', 'runtimeArguments', 'executionPlan'
  ]) assert.match(preflight, new RegExp(`${field}:`));
  assert.match(preflight, /status:\s*complete \? 'verified' : 'partial'/);
});

test('production apply uses the independent native verifier inside the lock', () => {
  assert.match(cli, /import \{ native_preflight \} from '.\/native-preflight\.uc'/);
  assert.match(cli, /native_preflight\(preview\.candidate\)/);
  assert.match(cli, /full_native_verified\(native\)[\s\S]*profiles_apply_run\(\)/);
});
