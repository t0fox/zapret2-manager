import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Task 5: Engine package upgrade/rollback invariants and single-writer control', () => {
  const preflightUc = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc');
  const manifestJson = path.resolve('zapret2-manager/files/usr/share/zapret2-manager/native-preflight.json');
  const smokeUc = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/engine-smoke.uc');
  const makefile = path.resolve('zapret2-manager/Makefile');

  assert.ok(fs.existsSync(preflightUc), 'native-preflight.uc must exist');
  assert.ok(fs.existsSync(manifestJson), 'native-preflight.json must exist');
  assert.ok(fs.existsSync(smokeUc), 'engine-smoke.uc must exist');
  assert.ok(fs.existsSync(makefile), 'Makefile must exist');

  // Verify single-writer ownership: zapret2-manager package manages control plane
  const makeContent = fs.readFileSync(makefile, 'utf8');
  assert.match(makeContent, /PKG_NAME:=zapret2-manager/, 'Package name must be zapret2-manager');
  assert.match(makeContent, /z2m-core-helper/, 'Build must compile z2m-core-helper');

  // Verify manifest invariants: static engine evidence only.
  const manifest = JSON.parse(fs.readFileSync(manifestJson, 'utf8'));
  assert.equal(manifest.schema, 'zapret2-manager.native-preflight.v4');
  assert.equal(manifest.minNfqws2CompatVer, 1);
  assert.ok(!('luaFiles' in manifest),
    'dynamic runtime Lua membership must not be duplicated in the static manifest');
  assert.ok(!('requiredCapabilities' in manifest),
    'retired native capability list must not re-enter package truth');
});
