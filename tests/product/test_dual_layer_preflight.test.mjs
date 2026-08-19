import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Task 3: native-preflight.uc implements dual-layer capability gating', () => {
  const preflightPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc');
  assert.ok(fs.existsSync(preflightPath), 'native-preflight.uc must exist');

  const content = fs.readFileSync(preflightPath, 'utf8');

  // Schema v2 support
  assert.match(content, /zapret2-manager\.native-preflight\.v2/, 'Must support schema v2');

  // Capability checking logic
  assert.match(content, /engineCapabilities/, 'Coverage must include engineCapabilities');
  assert.match(content, /Z2K_TLS_MOD|EENGINE_CAPABILITY_MISSING/, 'Must check for Z2K_TLS_MOD and report capability missing');
});
