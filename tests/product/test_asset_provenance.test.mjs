import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P2-Task 2: All runtime Lua assets and provenance manifests exist and are valid', () => {
  const luaRoot = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua');
  assert.ok(fs.existsSync(luaRoot), 'runtime-assets/lua directory must exist');

  const requiredLuaFiles = [
    'zapret-lib.lua',
    'zapret-antidpi.lua',
    'zapret-auto.lua',
    'z2k-detectors.lua',
    'z2k-modern-core.lua',
    'z2k-fooling-ext.lua',
    'z2k-range-rand.lua',
    'z2k-state-persist.lua',
    'z2k-alert.lua',
    'z2k-quic-silence.lua'
  ];

  for (const file of requiredLuaFiles) {
    const filePath = path.join(luaRoot, file);
    assert.ok(fs.existsSync(filePath), `Required Lua asset ${file} must exist`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.length > 50, `Lua asset ${file} must not be empty`);
  }

  // Verify native-preflight.json lists these files
  const manifestPath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const file of requiredLuaFiles) {
    const expectedPath = '/opt/zapret2/lua/' + file;
    assert.ok(manifest.luaFiles.includes(expectedPath), `Manifest must include ${expectedPath}`);
  }
});
