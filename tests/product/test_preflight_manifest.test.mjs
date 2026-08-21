import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Task 2: native-preflight.json declares v2 schema with explicit patch capabilities', () => {
  const manifestPath = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json');
  assert.ok(fs.existsSync(manifestPath), 'native-preflight.json must exist');

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.schema, 'zapret2-manager.native-preflight.v2');
  assert.equal(manifest.engineIntegrationIdentity, '/usr/share/zapret2-manager/upstreams/engine-integration.json');
  assert.ok(Array.isArray(manifest.requiredCapabilities), 'requiredCapabilities must be an array');
  assert.ok(manifest.requiredCapabilities.includes('Z2K_TLS_MOD'), 'Must include Z2K_TLS_MOD');
  assert.ok(manifest.requiredCapabilities.includes('ANTIDPI_REPEATS_LOOP'), 'Must include ANTIDPI_REPEATS_LOOP');
  assert.ok(manifest.requiredCapabilities.includes('AUTO_FAMILY_SPLIT'), 'Must include AUTO_FAMILY_SPLIT');

  assert.ok(typeof manifest.capabilities === 'object' && manifest.capabilities !== null, 'capabilities dictionary must exist');
  assert.ok(manifest.capabilities.Z2K_TLS_MOD, 'Z2K_TLS_MOD capability specification must exist');
  assert.ok(Array.isArray(manifest.capabilities.Z2K_TLS_MOD.flags), 'Z2K_TLS_MOD flags must be listed');
  assert.ok(manifest.capabilities.Z2K_TLS_MOD.flags.includes('grease'), 'Z2K_TLS_MOD must include grease flag');
});
