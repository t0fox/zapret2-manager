import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Task 4: engine-smoke.uc provides bounded Lua-init smoke runner with dummy queue', () => {
  const smokePath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/engine-smoke.uc');
  assert.ok(fs.existsSync(smokePath), 'engine-smoke.uc must exist');

  const content = fs.readFileSync(smokePath, 'utf8');
  assert.match(content, /export const engine_smoke/, 'Must export engine_smoke function');
  assert.match(content, /30999/, 'Must use dummy test queue 30999 (no production mutation)');
  assert.match(content, /--dry-run|--intercept=0/, 'Must run dry or zero-intercept mode');
});
