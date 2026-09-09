import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const presentationSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');

function load(sourceText, globals = {}) {
  return vm.runInNewContext(`(function () { ${sourceText}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
    ...globals,
  });
}

const presentation = load(presentationSource);
const model = load(source, { UpdatePresentation: presentation });
const sourceCommit = 'a'.repeat(40);
const runtimeBundleDigest = 'b'.repeat(64);
const detectDigest = 'c'.repeat(64);
const compatibilityIdentity = 'd'.repeat(64);

test('preserves ready Detect evidence when backend keeps coherence beside runtimeSummary', () => {
  const page = model.normalizePage({
    engine: {
      status: {
        installed: true,
        serviceState: 'running',
        runtimeRunning: true,
      },
    },
    z2k: {
      local: {
        installed: true,
        integrity: 'verified',
        integrityOk: true,
        lua: { ready: 12, total: 12 },
        installedRelease: { value: 'p-82.18', confidence: 'confirmed', authority: 'activation-receipt-v3' },
        compatibilityIdentity,
      },
      compatibilityIdentity,
      coherence: {
        coherenceStatus: 'aligned',
        compatibilityStatus: 'aligned',
      },
      runtimeSummary: {
        health: 'ready',
        installedRelease: { value: 'p-82.18', confidence: 'confirmed', authority: 'activation-receipt-v3' },
        sourceCommit,
        runtimeBundleDigest,
        detect: { arch: 'arm64', digest: detectDigest, sourceCommit, status: 'ready', compatible: true },
        dependencyClosure: {
          available: true,
          resolution: 'complete',
          runtimeBundleDigest,
          counts: { lua: 12, blobs: 21, hostlists: 6, missing: 0 },
        },
      },
      discovery: { enabled: true, running: false },
    },
  });

  const core = page.components.find(component => component.id === 'z2k-core');
  assert.equal(core.health, 'ready');
  assert.equal(core.detect.status, 'ready');
  assert.equal(core.detect.compatible, true);
  assert.equal(core.facts.detect.status, 'ready');
});
