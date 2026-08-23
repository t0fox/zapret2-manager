import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const INTEGRATION = JSON.parse(fs.readFileSync(path.join(ROOT,
  'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json'), 'utf8'));

test('Task 4: engine-smoke.uc provides bounded Lua-init smoke runner with dummy queue', () => {
  const smokePath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/engine-smoke.uc');
  assert.ok(fs.existsSync(smokePath), 'engine-smoke.uc must exist');

  const content = fs.readFileSync(smokePath, 'utf8');
  assert.match(content, /export const engine_smoke/, 'Must export engine_smoke function');
  assert.match(content, /30999/, 'Must use dummy test queue 30999 (no production mutation)');
  assert.match(content, /--dry-run|--intercept=0/, 'Must run dry or zero-intercept mode');
});

test('required Z2K Lua functions are defined in the package baseline Lua set', () => {
  // Category L: every runtimeCompatibility.requiredFunctions entry must be
  // DEFINED in the materialized Lua baseline. A missing definition means the
  // install-time Lua smoke can never succeed and Z2K cannot reach ready.
  const luaDir = path.join(ROOT,
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua');
  const sources = fs.readdirSync(luaDir)
    .filter(name => name.endsWith('.lua'))
    .map(name => fs.readFileSync(path.join(luaDir, name), 'utf8'));
  const all = sources.join('\n');

  for (const fn of INTEGRATION.runtimeCompatibility.requiredFunctions) {
    const pattern = new RegExp(
      `function\\s+${fn}\\s*\\(|${fn}\\s*=\\s*function`,
      'm');
    assert.match(all, pattern,
      `required Z2K function ${fn} must be defined in the package baseline`);
  }
});
