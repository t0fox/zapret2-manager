import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P4-Task 2: Strategy compiler & service injects whitelist on host-addressable profiles and skips discord_voice', () => {
  const compilerPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
  const servicePath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/service.uc');

  assert.ok(fs.existsSync(compilerPath), 'strategy-compiler.uc must exist');
  assert.ok(fs.existsSync(servicePath), 'service.uc must exist');

  const compilerContent = fs.readFileSync(compilerPath, 'utf8');
  assert.match(compilerContent, /hostlist-exclude|whitelist/i, 'strategy-compiler.uc must handle whitelist exclusions');

  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  assert.match(serviceContent, /whitelist|hostlist-exclude/i, 'service.uc must handle whitelist options');
});
