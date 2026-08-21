import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const file = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json');

test('engine integration identity is canonical and pins the required upstream split', () => {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(value.schema, 'zapret2-manager.engine-integration.v1');
  assert.equal(value.engineBase.repository, 'bol-van/zapret2');
  assert.equal(value.z2kDelta.repository, 'necronicle/zapret2-z2k');
  assert.equal(value.z2kDelta.branch, 'z2k-master');
  assert.equal(value.audit.runtimeRepository, 'necronicle/z2k');
  assert.equal(value.audit.runtimeBranch, 'z2k-enhanced');
  assert.notEqual(value.audit.avatarCatalogCommit, value.audit.avatarUiDonorCommit);
  assert.deepEqual(value.requiredCapabilities, ['Z2K_TLS_MOD', 'ANTIDPI_REPEATS_LOOP', 'AUTO_FAMILY_SPLIT']);
  assert.equal(value.patchSeries.length, 3);
  for (const patch of value.patchSeries) assert.match(patch.sha256, /^[a-f0-9]{64}$/);
});

test('engine sync checker is machine-readable and has explicit upstream mode', () => {
  const tool = fs.readFileSync(path.join(root, 'tools/check-z2k-engine-sync.mjs'), 'utf8');
  assert.match(tool, /--upstream/);
  assert.match(tool, /command\('git', \['apply'/);
  assert.match(tool, /SYNCED|REBASE_REQUIRED|UPSTREAM_BASE_ADVANCED|Z2K_DELTA_ADVANCED|CONFLICT/);
});

test('engine sync checker really applies the complete patch series to a network-free fixture', () => {
  const tool = path.join(root, 'tools/check-z2k-engine-sync.mjs');
  const fixture = path.join(root, 'tests/fixtures/engine-sync/base');
  const run = spawnSync(process.execPath, [tool, '--source', fixture], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout);
  assert.equal(value.status, 'SYNCED');
  assert.deepEqual(value.application.applied, [
    '001-z2k-tls-mod',
    '002-z2k-antidpi-repeats-loop',
    '003-z2k-auto-family-split'
  ]);
});
