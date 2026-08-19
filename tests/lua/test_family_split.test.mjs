import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P1-Task 1: zapret-auto.lua implements family_split in standard_hostkey', () => {
  const luaPath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-auto.lua');
  assert.ok(fs.existsSync(luaPath), 'zapret-auto.lua must exist');

  const content = fs.readFileSync(luaPath, 'utf8');
  assert.match(content, /family_split/, 'standard_hostkey must reference family_split');
  assert.match(content, /hostkey \.\. "\|6"/, 'IPv6 hostkey must append |6');
  assert.match(content, /hostkey \.\. "\|4"/, 'IPv4 hostkey must append |4');
  assert.match(content, /desync\.arg\.family_split ~= "0"/, 'family_split must default to ON unless =0');
});
