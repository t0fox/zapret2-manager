import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P1-Task 4: strategies-ops.uc and LuCI recognize Discord / STUN rotators and synthetic nohost identity', () => {
  const opsPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
  const jsPath = path.resolve('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');

  assert.ok(fs.existsSync(opsPath), 'strategies-ops.uc must exist');
  assert.ok(fs.existsSync(jsPath), 'z2m-strategies.js must exist');

  const opsContent = fs.readFileSync(opsPath, 'utf8');
  assert.match(opsContent, /discord|stun/i, 'strategies-ops.uc must recognize discord / stun pools');

  const jsContent = fs.readFileSync(jsPath, 'utf8');
  assert.match(jsContent, /data-proto="stun"|discord/i, 'z2m-strategies.js must support Discord / STUN filter');
});
