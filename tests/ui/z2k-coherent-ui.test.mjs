import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viewDir = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');
const read = (name) => fs.readFileSync(path.join(viewDir, name), 'utf8');

const coherentRuntime = (overrides = {}) => ({
  health: 'ready',
  installedRelease: 'p-2026.09',
  strategyCount: 42,
  runtimeBundleDigest: 'a'.repeat(64),
  dependencyClosure: { available: true, resolution: 'complete', counts: { missing: 0 } },
  detect: { arch: 'x86_64', status: 'ready', digest: 'b'.repeat(64) },
  compatibilityIdentity: 'c'.repeat(64),
  ...overrides
});

test('Components contract covers healthy, update, broken and missing coherent Z2K states', () => {
  const source = read('z2m-components-model.js');
  for (const state of ['ready', 'update-available', 'broken', 'missing']) assert.match(source, new RegExp(state.replace('-', '\\-')));
  for (const field of ['installedRelease', 'strategyCount', 'runtimeBundleDigest', 'compatibilityIdentity', 'detect', 'arch', 'status']) assert.match(source, new RegExp(field));
  for (const fixture of [coherentRuntime(), coherentRuntime({ updateState: 'update-available', availableRelease: 'p-2026.10' }), coherentRuntime({ health: 'broken' }), coherentRuntime({ health: 'missing' })]) {
    assert.equal(typeof fixture.installedRelease, 'string');
    assert.equal(typeof fixture.strategyCount, 'number');
    assert.equal(typeof fixture.detect.arch, 'string');
  }
});

test('Components and maintenance expose one Z2K Core lifecycle with no independent Z2K refresh', () => {
  const model = read('z2m-components-model.js');
  const maintenance = read('z2m-maintenance.js');
  assert.match(model, /id:\s*'z2k-core'/);
  assert.match(model, /detect/);
  assert.match(maintenance, /Z2K Core/);
  assert.match(maintenance, /resources\.update/);
  assert.doesNotMatch(maintenance, /checkUpdates\(ctx,\s*'z2k'\)/);
});

test('Resources and Assets present Z2K-managed ownership and preserve independent sources', () => {
  const resources = read('z2m-resources-model.js');
  const assets = read('z2m-assets.js');
  assert.match(resources, /Z2K Core/);
  assert.match(assets, /Управляется Z2K Core/);
  assert.match(assets, /lifecycleManaged/);
  assert.match(resources, /Avatar|avatar/i);
  assert.match(resources, /updateCallout/);
  assert.doesNotMatch(assets, /resources\.check\(/);
  assert.match(assets, /strategySources/);
});
