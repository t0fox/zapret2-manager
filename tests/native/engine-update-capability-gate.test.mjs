import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const catalog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh'), 'utf8');

test('vanilla bol-van release is integration-required, not installable for Z2M', () => {
  assert.match(catalog, /artifactKind/);
  assert.match(catalog, /EENGINE_INTEGRATION_REQUIRED/);
  assert.match(catalog, /compatible:\s*false/);
  assert.match(catalog, /integration-required/);
});

test('engine worker rejects candidates without the Z2M-compatible artifact kind', () => {
  assert.match(worker, /artifactKind/);
  assert.match(worker, /z2m-compatible-engine/);
  assert.match(worker, /EENGINE_INTEGRATION_REQUIRED/);
});
