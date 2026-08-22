import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Canonical z2m-compatible-engine identity contract.
//
// There must be EXACTLY ONE authority for the compatible-engine build inputs:
// upstreams/engine-integration.json. Every other surface (patch files on disk,
// native-preflight manifest) must agree with it byte-for-byte, otherwise the
// producer could silently build against a different source than the runtime
// gates expect.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const INTEGRATION = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'upstreams', 'engine-integration.json');
const PREFLIGHT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'native-preflight.json');
const PATCHES = path.join(ROOT, 'patches', 'engine');

const integration = JSON.parse(fs.readFileSync(INTEGRATION, 'utf8'));
const preflight = JSON.parse(fs.readFileSync(PREFLIGHT, 'utf8'));

test('integration manifest declares a complete machine-readable build contract', () => {
  assert.equal(integration.schema, 'zapret2-manager.engine-integration.v1');
  assert.equal(integration.engineBase.repository, 'bol-van/zapret2');
  assert.match(integration.engineBase.commit, /^[0-9a-f]{40}$/, 'base commit must be a full sha');
  assert.ok(Array.isArray(integration.patchSeries) && integration.patchSeries.length === 3,
    'exactly three canonical patches are required');
  const ids = integration.patchSeries.map(p => p.id);
  assert.deepEqual(ids, ['001-z2k-tls-mod', '002-z2k-antidpi-repeats-loop', '003-z2k-auto-family-split']);
  for (const patch of integration.patchSeries) {
    assert.match(patch.sha256, /^[0-9a-f]{64}$/, `patch ${patch.id} digest missing`);
    assert.ok(patch.path.startsWith('patches/engine/'), `patch ${patch.id} path outside canonical dir`);
  }
  assert.deepEqual(integration.requiredCapabilities,
    ['Z2K_TLS_MOD', 'ANTIDPI_REPEATS_LOOP', 'AUTO_FAMILY_SPLIT']);
  assert.ok(Array.isArray(integration.runtimeCompatibility?.requiredFunctions)
    && integration.runtimeCompatibility.requiredFunctions.length >= 4,
    'required Z2K Lua functions must be enumerated');
});

test('patch files on disk match the pinned SHA256 digests', () => {
  for (const patch of integration.patchSeries) {
    const file = path.join(ROOT, patch.path);
    assert.ok(fs.existsSync(file), `${patch.path} missing`);
    const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(digest, patch.sha256, `${patch.id} drifted from the pinned digest`);
  }
});

test('native-preflight manifest agrees with the single integration authority', () => {
  assert.equal(preflight.schema, 'zapret2-manager.native-preflight.v2');
  assert.equal(preflight.engineSourceCommit, integration.engineBase.commit,
    'preflight must reference the same pinned bol-van base commit as the producer');
  assert.deepEqual(preflight.requiredCapabilities, integration.requiredCapabilities);
  assert.deepEqual(preflight.patchSeries.map(name => name.replace(/\.patch$/, '')),
    integration.patchSeries.map(p => p.id));
  assert.equal(preflight.engineIntegrationIdentity,
    '/usr/share/zapret2-manager/upstreams/engine-integration.json');
});
