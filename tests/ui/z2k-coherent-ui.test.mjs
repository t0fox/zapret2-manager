import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viewDir = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');

function loadLuCI(name, globals = {}) {
  const source = fs.readFileSync(path.join(viewDir, name), 'utf8')
    .replace('return baseclass.extend(', 'globalThis.__module = baseclass.extend(');
  const context = {
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    Date,
    JSON,
    isFinite,
    console,
    baseclass: { extend: (value) => value },
    UpdatePresentation: {
      normalize: (value) => ['current', 'update-available', 'broken', 'missing', 'unknown', 'review-required', 'rebase-required', 'integration-required'].includes(String(value)) ? String(value) : 'unknown',
      describe: (value) => ({ state: value, label: String(value) })
    },
    globalThis: null,
    ...globals
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: name });
  return context.__module;
}

const componentsModel = loadLuCI('z2m-components-model.js');
const resourcesModel = loadLuCI('z2m-resources-model.js');
const runtimeDigest = 'a'.repeat(64);
const detectDigest = 'b'.repeat(64);
const compatibilityIdentity = 'c'.repeat(64);
const sourceCommit = 'd'.repeat(40);

function engine(status = {}) {
  return {
    status: {
      installed: true,
      serviceState: 'running',
      runtimeRunning: true,
      ...status
    }
  };
}

function coherentRuntime(overrides = {}) {
  return {
    health: 'ready',
    installedRelease: { value: 'p-2026.09', confidence: 'confirmed', authority: 'activation-receipt' },
    strategies: 42,
    sourceCommit,
    runtimeBundleDigest: runtimeDigest,
    dependencyClosure: {
      available: true,
      resolution: 'complete',
      runtimeBundleDigest: runtimeDigest,
      counts: { missing: 0 }
    },
    detect: { arch: 'x86_64', digest: detectDigest, sourceCommit },
    compatibilityIdentity,
    coherence: { coherenceStatus: 'aligned', compatibilityStatus: 'aligned', installedRuntimeRevision: sourceCommit },
    ...overrides
  };
}

function pageFor(runtimeSummary, z2k = {}) {
  return componentsModel.normalizePage({
    engine: engine(),
    z2k: {
      runtimeSummary,
      local: {
        installed: true,
        integrityOk: true,
        lua: { ready: 7, total: 7 },
        installedRelease: runtimeSummary.installedRelease
      },
      ...z2k
    }
  });
}

test('healthy coherent Core derives ready compatible Detect state from the canonical runtime contract', () => {
  const page = pageFor(coherentRuntime());
  const core = page.components.find((item) => item.id === 'z2k-core');

  assert.equal(core.health, 'ready');
  assert.equal(core.installedRelease.value, 'p-2026.09');
  assert.equal(core.counters.strategies, '42');
  assert.equal(core.detect.architecture, 'x86_64');
  assert.equal(core.detect.status, 'ready');
  assert.equal(core.detect.compatible, true);
  assert.equal(core.compatibilityIdentity, compatibilityIdentity);
  assert.equal(page.health.state, 'ready');
});

test('update state remains coherent and exposes the synchronized Core target', () => {
  const page = pageFor(coherentRuntime({ updateState: 'update-available', availableRelease: 'p-2026.10' }), { canApply: true });
  const core = page.components.find((item) => item.id === 'z2k-core');

  assert.equal(core.health, 'ready');
  assert.equal(core.updateState, 'update-available');
  assert.equal(core.availableRelease, 'p-2026.10');
  assert.equal(core.canApply, true);
  assert.equal(core.detect.status, 'ready');
  assert.equal(core.detect.compatible, true);
});

test('broken runtime stays broken even when Detect identity is present', () => {
  const page = pageFor(coherentRuntime({ health: 'broken' }));
  const core = page.components.find((item) => item.id === 'z2k-core');

  assert.equal(core.health, 'broken');
  assert.notEqual(core.detect.compatible, true);
  assert.equal(page.health.state, 'broken');
});

test('missing runtime fails closed and never fabricates a compatible Detect state', () => {
  const page = componentsModel.normalizePage({
    engine: engine({ installed: false, serviceState: 'engine_missing' }),
    z2k: { runtimeSummary: coherentRuntime() }
  });
  const core = page.components.find((item) => item.id === 'z2k-core');

  assert.equal(core.health, 'missing');
  assert.notEqual(core.detect.compatible, true);
  assert.equal(core.requiresEngine, true);
  assert.equal(page.health.state, 'missing');
});

test('stale or incoherent Detect evidence degrades the Core instead of claiming ready', () => {
  const page = pageFor(coherentRuntime({
    coherence: { coherenceStatus: 'diverged', compatibilityStatus: 'diverged', installedRuntimeRevision: sourceCommit }
  }));
  const core = page.components.find((item) => item.id === 'z2k-core');

  assert.equal(core.health, 'degraded');
  assert.equal(core.detect.status, 'unknown');
  assert.equal(core.detect.compatible, false);
  assert.notEqual(page.health.state, 'ready');
});

test('Resources marks Z2K as Core-managed while Avatar keeps an independent source state', () => {
  const model = resourcesModel.buildModel({
    z2k: { updateState: 'update-available', runtimeSummary: coherentRuntime({ updateState: 'update-available' }) },
    sources: [
      { id: 'z2k-resources', label: 'Z2K', repository: 'necronicle/z2k', kind: 'catalog/upstream' },
      { id: 'avatar-strategy-catalog', label: 'Avatar', repository: 'avatarDD/zapret-gui', kind: 'catalog/upstream' }
    ],
    installed: [
      { id: 'z2k-runtime', source: 'z2k-resources', provenance: { kind: 'catalog/upstream' } },
      { id: 'avatar-catalog', source: 'avatar-strategy-catalog', provenance: { kind: 'catalog/upstream' } }
    ]
  }, { assets: [] }, {});
  const z2kGroup = model.groups.find((group) => group.id === 'z2k-resources');
  const avatar = resourcesModel.buildStrategySourceCards({ sources: { avatar: { enabled: true, state: 'current', currentSnapshotId: 'avatar-1' }, z2k: { enabled: true, state: 'current', currentSnapshotId: 'z2k-1' } } }).find((card) => card.id === 'avatar');

  assert.equal(z2kGroup.consumer, 'Z2K Core');
  assert.equal(model.updateCallout, null);
  assert.equal(avatar.state, 'current');
  assert.equal(avatar.enabled, true);
});

test('Components and maintenance expose one Z2K Core lifecycle with no independent refresh', () => {
  const model = fs.readFileSync(path.join(viewDir, 'z2m-components-model.js'), 'utf8');
  const maintenance = fs.readFileSync(path.join(viewDir, 'z2m-maintenance.js'), 'utf8');
  assert.match(model, /id:\s*'z2k-core'/);
  assert.match(maintenance, /Z2K Core/);
  assert.doesNotMatch(maintenance, /checkUpdates\(ctx,\s*'z2k'\)/);
});
