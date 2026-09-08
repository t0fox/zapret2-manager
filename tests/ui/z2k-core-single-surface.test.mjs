import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const viewDir = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const presentationSource = fs.readFileSync(path.join(viewDir, 'z2m-update-presentation.js'), 'utf8');
const modelSource = fs.readFileSync(path.join(viewDir, 'z2m-components-model.js'), 'utf8');

const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
});
const model = vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
  UpdatePresentation: presentation,
});

const digest = (char) => char.repeat(64);
const sourceCommit = 'a'.repeat(40);

function engine(overrides = {}) {
  return {
    status: {
      installed: true,
      serviceState: 'running',
      runtimeRunning: true,
      compatible: true,
      ...overrides,
    },
  };
}

function coherentZ2k(overrides = {}) {
  return {
    updateState: 'current',
    local: {
      installed: true,
      integrity: 'verified',
      integrityOk: true,
      lua: { ready: 13, total: 13 },
      installedRelease: { value: 'p-2026.09', confidence: 'confirmed', authority: 'activation-receipt-v3' },
    },
    discovery: { enabled: true, running: true },
    runtimeSummary: {
      health: 'ready',
      installedRelease: 'p-2026.09',
      strategies: 42,
      sourceCommit,
      runtimeBundleDigest: digest('b'),
      compilerInputsDigest: digest('c'),
      catalogDigest: digest('d'),
      detect: { architecture: 'x86_64', digest: digest('e'), sourceCommit },
      compatibilityIdentity: digest('f'),
      dependencyClosure: {
        available: true,
        resolution: 'complete',
        runtimeBundleDigest: digest('b'),
        counts: { lua: 13, blobs: 21, hostlists: 6, missing: 0 },
      },
      coherence: { coherenceStatus: 'aligned', compatibilityStatus: 'aligned' },
    },
    ...overrides,
  };
}

function canonicalBackendZ2k(overrides = {}) {
  return coherentZ2k({
    runtimeSummary: {
      ...coherentZ2k().runtimeSummary,
      coherence: { coherenceStatus: 'aligned', compatibilityStatus: 'aligned' },
    },
    ...overrides,
  });
}

function coreFor(z2k, engineOverrides) {
  return model.normalizePage({ engine: engine(engineOverrides), z2k }).components[1];
}

test('Z2K Core exposes one canonical projection with user facts separated from technical evidence', () => {
  const core = coreFor(canonicalBackendZ2k());

  assert.equal(core.state, 'ready');
  assert.deepEqual(JSON.parse(JSON.stringify(core.facts)), {
    strategies: { label: 'Стратегии', count: 42 },
    detect: { status: 'ready', arch: 'x86_64' },
    runtime: { luaReady: 13, luaTotal: 13, listsReady: 6, blobsReady: 21 },
    discovery: { enabled: true, running: true },
    compatibility: { synchronized: true },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(core.technical)), {
    sourceCommit,
    manifestSeq: null,
    manifestSha256: null,
    runtimeBundleDigest: digest('b'),
    compilerInputsDigest: digest('c'),
    catalogDigest: digest('d'),
    compatibilityIdentity: digest('f'),
    detectSha256: digest('e'),
    dependencyClosure: { available: true, resolution: 'complete', runtimeBundleDigest: digest('b'), counts: { lua: 13, blobs: 21, hostlists: 6, missing: 0 } },
    provenance: {},
  });
  assert.equal(core.facts.technical, undefined, 'technical evidence must not leak into user facts');
});

test('canonical receipt authorities remain ready only with confirmed release evidence', () => {
  for (const authority of ['activation-receipt-v3', 'activation-receipt-v2', 'activation-receipt']) {
    const fixture = canonicalBackendZ2k();
    fixture.local.installedRelease = { value: 'p-2026.09', confidence: 'confirmed', authority };
    assert.equal(coreFor(fixture).state, 'ready', authority);
  }

  const unconfirmed = canonicalBackendZ2k();
  unconfirmed.local.installedRelease = { value: 'p-2026.09', confidence: 'inferred', authority: 'activation-receipt-v3' };
  assert.equal(coreFor(unconfirmed).state, 'degraded');
});

test('Z2K Core exposes distinct lifecycle states without turning update or operation facts into health', () => {
  const cases = [
    ['missing', canonicalBackendZ2k(), { installed: false, serviceState: 'engine_missing', runtimeRunning: false }],
    ['ready', canonicalBackendZ2k(), undefined],
    ['update-available', canonicalBackendZ2k({ updateState: 'update-available', safeUpdate: { count: 1 } }), undefined],
    ['degraded', canonicalBackendZ2k({ runtimeSummary: { ...canonicalBackendZ2k().runtimeSummary, detect: { architecture: 'x86_64', digest: digest('e'), sourceCommit: 'c'.repeat(40) } } }), undefined],
    ['broken', canonicalBackendZ2k({ runtimeSummary: { ...canonicalBackendZ2k().runtimeSummary, health: 'broken' } }), undefined],
    ['working', canonicalBackendZ2k({ operation: { state: 'working', action: 'upgrade', operationId: 'op-1' } }), undefined],
    ['rollback-result', canonicalBackendZ2k({ operationResult: { state: 'rollback-result', ok: false, error: { code: 'EPOSTFLIGHT' }, rollback: { ok: true, state: 'completed' } } }), undefined],
  ];

  for (const [expected, input, engineOverrides] of cases) {
    assert.equal(coreFor(input, engineOverrides).state, expected, `expected canonical state ${expected}`);
  }
});

test('Z2K Core never claims Работает when receipt, runtime, or Detect coherence is false', () => {
  const variants = [
    canonicalBackendZ2k({ local: { ...canonicalBackendZ2k().local, installedRelease: { value: null, confidence: 'unknown', authority: null } } }),
    canonicalBackendZ2k({ runtimeSummary: { ...canonicalBackendZ2k().runtimeSummary, health: 'ready', coherence: { coherenceStatus: 'diverged', compatibilityStatus: 'diverged' } } }),
    canonicalBackendZ2k({ runtimeSummary: { ...canonicalBackendZ2k().runtimeSummary, detect: { architecture: 'x86_64', digest: null, sourceCommit } } }),
  ];

  for (const input of variants) {
    const core = coreFor(input);
    assert.notEqual(core.state, 'ready');
    assert.notEqual(core.health, 'ready');
    assert.notEqual(core.summary, 'Работает');
  }
});
