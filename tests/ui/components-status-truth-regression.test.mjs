import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadModel() {
  const presentationSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
  const modelSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
  const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
    baseclass: { extend: (value) => value },
    _: (value) => value,
  });
  return vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
    baseclass: { extend: (value) => value },
    _: (value) => value,
    UpdatePresentation: presentation,
  });
}

function installedZ2k() {
  const commit = 'a'.repeat(40);
  const detectDigest = 'b'.repeat(64);
  const bundleDigest = 'c'.repeat(64);
  const identity = 'd'.repeat(64);
  const release = { value: 'p-84.7', confidence: 'confirmed', authority: 'activation-receipt-v3' };
  const closure = {
    available: true,
    resolution: 'complete',
    runtimeBundleDigest: bundleDigest,
    counts: { missing: 0, lua: 12, blobs: 24, hostlists: 6, ipsets: 0 },
  };
  const detect = { arch: 'arm64', architecture: 'arm64', status: 'ready', compatible: true, digest: detectDigest, sourceCommit: commit };
  return {
    updateState: 'current',
    compatibility: 'compatible',
    local: {
      installed: true,
      integrity: 'verified',
      integrityOk: true,
      lua: { ready: 12, total: 12 },
      installedRelease: release,
      commit,
      detect,
      compatibilityIdentity: identity,
      runtimeBundleDigest: bundleDigest,
      dependencyClosure: closure,
    },
    runtimeSummary: {
      health: 'ready',
      installedRelease: release,
      availableRelease: 'p-84.7',
      runtimeBundleDigest: bundleDigest,
      compatibilityIdentity: identity,
      dependencyClosure: closure,
      detect,
      coherence: {
        coherenceStatus: 'aligned',
        compatibilityStatus: 'aligned',
        installedRuntimeRevision: commit,
      },
    },
  };
}

test('stopped Engine does not downgrade an installed and coherent Z2K Core', () => {
  const page = loadModel().normalizePage({
    engine: { status: { installed: true, compatible: true, serviceState: 'stopped', runtimeRunning: false } },
    z2k: installedZ2k(),
  });

  assert.equal(page.components[0].runtimeHealth, 'degraded', 'Engine must honestly remain stopped');
  assert.equal(page.components[1].runtimeHealth, 'ready', 'Z2K Core readiness is composition-based, not process-based');
  assert.equal(page.components[1].detect.status, 'ready');
  assert.equal(page.health.ready, 1);
  assert.equal(page.health.total, 2);
});

test('upstream check result normalizes non-array settlement output before iterating', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(source, /function normalizeSettledResults\(value, expectedLength\)/);
  assert.match(source, /Object\.keys\(value\)/);
  assert.match(source, /var settledResults\s*=\s*normalizeSettledResults\(results, promises\.length\)/);
  assert.match(source, /settledResults\.forEach\(/);
  assert.doesNotMatch(source, /results\.forEach\(/);
});

test('Z2K planner accepts explicit installed evidence for lifecycle-managed Detect and compiler inputs', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
  assert.match(source, /function plan\(value, installedEvidence\)/);
  assert.match(source, /evidence\.detect/);
  assert.match(source, /evidence\.compilerFiles/);
  assert.match(source, /z2k_upstream_plan\s*=\s*function\(remoteManifest, installedEvidence\)/);
});

test('backend Z2K health separates composition readiness from Engine process readiness', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  const summary = source.slice(source.indexOf('function z2k_runtime_summary'), source.indexOf('function z2k_apply_runtime_summary'));
  assert.doesNotMatch(summary, /!engineReady\s*\|\|\s*!closureReady/);
  assert.match(summary, /canApply:\s*engineReady === true/);
});

test('installed Detect is presented as confirmed evidence, not as a running service', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(source, /detectStatus === 'ready' \? _\('Подтверждён'\)/);
  assert.doesNotMatch(source, /detectStatus === 'ready' \? _\('Работает'\)/);
});

test('missing optional discovery evidence is not presented as an unconfirmed Core failure', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(source, /hasDiscovery\s*=\s*typeof discovery\.enabled === 'boolean'/);
  assert.match(source, /if \(hasDiscovery\)[\s\S]*Автообнаружение/);
  assert.doesNotMatch(source, /var discoveryLabel = .*_\('Не подтверждено'\)/);
});
