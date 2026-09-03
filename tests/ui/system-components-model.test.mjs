import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const presentationSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');
const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
});
const model = vm.runInNewContext(`(function () { ${source}\n })()`, {
  baseclass: { extend: value => value },
  _ : value => value,
  UpdatePresentation: presentation,
});

const engine = (overrides = {}) => ({
  state: 'installed',
  installed: true,
  installedRelease: 'v1.0.4',
  packageVersion: '1.0.4',
  upstream: 'bol-van/zapret2',
  serviceState: 'running',
  runtimeRunning: true,
  compatible: true,
  autostart: false,
  capabilities: { ready: 3, total: 3 },
  ...overrides,
});

const z2k = (overrides = {}) => ({
  status: 'current',
  runtime: 'r-77.5',
  engineDelta: 'z2k-master @ 8193742',
  lua: { ready: 7, total: 7 },
  compatibility: 'compatible',
  provenance: { repository: 'necronicle/z2k', commit: 'abc123' },
  ...overrides,
});

test('normalizes a ready Engine and Z2K Core into two mandatory components', () => {
  const page = model.normalizePage({
    versions: { manager: { version: '0.1.0-r149' } },
    engine: { status: engine() },
    z2k: z2k(),
  });

  assert.equal(page.manager.version, '0.1.0-r149');
  assert.deepEqual(JSON.parse(JSON.stringify(page.health)), { ready: 2, total: 2, state: 'ready', message: 'Система готова к работе' });
  assert.deepEqual(JSON.parse(JSON.stringify(page.components.map(component => component.id))), ['engine', 'z2k-core']);
  assert.equal(page.components[0].health, 'ready');
  assert.equal(page.components[0].compatibility.state, 'compatible');
  assert.equal(page.components[0].counters.capabilities, '3 / 3');
  assert.equal(page.components[1].health, 'ready');
  assert.equal(page.components[1].counters.lua, '7 / 7');
  assert.equal(page.components[1].details.provenance.repository, 'necronicle/z2k');
});

test('missing Engine is an install state and makes the aggregate unhealthy', () => {
  const page = model.normalizePage({
    versions: { manager: { version: '0.1.0-r149' } },
    engine: { status: engine({ state: 'engine_missing', installed: false, serviceState: 'engine_missing', compatible: false, runtimeRunning: false }) },
    z2k: z2k(),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(page.health)), { ready: 0, total: 2, state: 'missing', message: 'Требуется установка компонентов' });
  assert.equal(page.components[0].health, 'missing');
  assert.equal(page.components[0].actions.primary, 'install');
});

test('clean install truth model: engine not installed, Z2K requires a compatible engine', () => {
  const page = model.normalizePage({
    versions: {},
    engine: { status: {} },
    z2k: {},
  });

  assert.equal(page.health.ready, 0);
  assert.equal(page.health.total, 2);
  assert.equal(page.components[0].health, 'missing');
  assert.equal(page.components[0].label, 'Zapret2 Engine');
  assert.equal(page.components[0].actions.primary, 'install');
  assert.equal(page.components[1].health, 'missing');
  assert.match(page.components[1].summary, /Требуется совместимый/);
  assert.equal(page.components[1].actions.primary, 'details');
});

test('unknown compatibility does not poison independently proven runtime health', () => {
  // Runtime readiness and compatibility are separate facts. Running evidence
  // remains ready even before the compatibility check has been confirmed.
  const page = model.normalizePage({
    engine: { status: engine({ compatible: undefined }) },
    z2k: z2k({ status: 'unknown' }),
  });

  assert.equal(page.components[0].health, 'ready');
  assert.equal(page.components[0].compatibility.state, 'unverified');
  assert.equal(page.components[1].health, 'ready');

  const page2 = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({ status: 'unknown', lua: {} }),
  });
  assert.equal(page2.components[0].health, 'ready');
  assert.equal(page2.components[1].health, 'degraded',
    'unknown Z2K state without local evidence is bounded-degraded, never ready');
  assert.equal(page2.health.ready, 1);
});

test('Z2K becomes ready only with materialized Lua evidence once the engine is ready', () => {
  const partial = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({ lua: { ready: 5, total: 9 } }),
  });
  assert.equal(partial.components[1].health, 'degraded');

  const full = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({}),
  });
  assert.equal(full.components[1].health, 'ready');
  assert.equal(full.health.ready, 2);
});

test('safe updates do not turn a ready system into a failure', () => {
  const page = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({ status: 'update-available', safeUpdate: { count: 5 } }),
  });

  assert.equal(page.health.state, 'ready');
  assert.equal(page.health.ready, 2);
  assert.equal(page.components[1].updateState, 'update-available');
  assert.equal(page.components[1].actions.primary, 'update');
});

test('integration-required is distinct from a safe update and blocks automatic update', () => {
  const page = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({ status: 'rebase-required', rebases: ['z2k-state-persist.lua'] }),
  });

  // rebase-required is NOT positive readiness evidence; with full Lua counters
  // the asset baseline is materialized, so health stays ready while the
  // update channel reports integration-required.
  assert.equal(page.health.state, 'ready');
  assert.equal(page.components[1].health, 'ready');
  assert.equal(page.components[1].updateState, 'rebase-required');
  assert.equal(page.components[1].actions.primary, 'details');
  assert.deepEqual(JSON.parse(JSON.stringify(page.components[1].details.rebases)), ['z2k-state-persist.lua']);
});

test('review-required without blocking evidence is normalized out of the UI state', () => {
  const page = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({
      updateState: 'update-available',
      attentionState: 'review-required',
      canApply: true,
      blockingReviews: [],
      advisoryReviews: [],
    }),
  });

  assert.equal(page.components[1].attentionState, 'none');
  assert.equal(page.components[1].actions.primary, 'update');
});

test('broken Z2K Core asks for recovery rather than deletion', () => {
  const page = model.normalizePage({
    engine: { status: engine() },
    z2k: z2k({ status: 'broken', health: 'broken', compatibility: 'incompatible' }),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(page.health)), { ready: 1, total: 2, state: 'broken', message: 'Требуется восстановление Z2K Core' });
  assert.equal(page.components[1].actions.primary, 'repair');
  assert.equal(page.components[1].actions.delete, undefined);
});
