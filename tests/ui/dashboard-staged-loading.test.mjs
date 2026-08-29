import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Behavioral contract for PERF-1.2:
// the Dashboard must render from the app-shell status_fast result and then
// enrich the page through independent, bounded deferred reads. A slow version
// or diagnostic read must not hold the first meaningful render hostage.

import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const modulePath = path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-loading.js');
const source = fs.readFileSync(modulePath, 'utf8');
const moduleInstance = loadLuCIModule(source,
  'view.zapret2-manager.z2m-overview-loading', { baseclass });

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeApi() {
  const calls = {
    statusFast: 0, preview: 0, events: 0, recommendations: 0,
    tgStatus: 0, proxyHealth: 0, strategy: 0, engine: 0, system: 0, versions: 0, resources: 0
  };
  const gates = {
    statusFast: deferred(), preview: deferred(), events: deferred(),
    recommendations: deferred(), tgStatus: deferred(), proxyHealth: deferred(), strategy: deferred(),
    engine: deferred(), system: deferred(), versions: deferred(), resources: deferred()
  };
  const api = {
    service: { statusFast: () => { calls.statusFast++; return gates.statusFast.promise; } },
    engine: { status: () => { calls.engine++; return gates.engine.promise; } },
    maintenance: {
      status: () => { calls.system++; return gates.system.promise; },
      versions: () => { calls.versions++; return gates.versions.promise; }
    },
    resources: { status: () => { calls.resources++; return gates.resources.promise; } },
    strategy: { preview: () => { calls.preview++; return gates.preview.promise; } },
    monitor: { eventsTail: () => { calls.events++; return gates.events.promise; } },
    strategies: {
      recommendations: () => { calls.recommendations++; return gates.recommendations.promise; },
      get: () => { calls.strategy++; return gates.strategy.promise; }
    },
    tg: { product: { status: () => { calls.tgStatus++; return gates.tgStatus.promise; } } },
    proxy: { health: () => { calls.proxyHealth++; return gates.proxyHealth.promise; } },
    normalizeError: error => ({ message: String(error && error.message || error) })
  };
  return { api, calls, gates };
}

function makeCtx(api, initial, rerender) {
  return {
    api,
    initial: initial || {},
    edit: (fn, value) => fn(JSON.stringify(value || {})),
    rerender: rerender || (() => {})
  };
}

const settledValue = result => result.status === 'fulfilled'
  ? { value: result.value || {} }
  : { error: { message: 'rejected' } };

function makeRuntime() { return { deferred: {}, loadToken: 0 }; }
function flush() { return new Promise(resolve => setTimeout(resolve, 0)); }
function resolveCritical(gates) {
  gates.statusFast.resolve({});
  gates.engine.resolve({});
  gates.system.resolve({});
  gates.versions.resolve({});
  gates.resources.resolve({});
}

test('Dashboard bootstrap reuses the app-shell status and does not wait for deferred reads', async () => {
  const { api, calls, gates } = makeApi();
  const runtime = makeRuntime();
  const scheduled = [];
  const loader = moduleInstance.createLoader({
    runtime, settled: settledValue,
    timer: fn => { scheduled.push(fn); }
  });
  const initial = { runtimeSummary: { state: 'running' }, system: { autostart: { enabled: true } } };
  resolveCritical(gates);
  const data = await loader.load(makeCtx(api, initial));

  assert.deepEqual(data.status.value, initial,
    'first render must be backed by the already-fetched app-shell status');
  assert.equal(calls.statusFast, 0, 'Dashboard must not issue a duplicate status_fast');
  assert.equal(calls.engine + calls.system + calls.versions + calls.resources + calls.preview + calls.events, 0,
    'deferred reads must not start before the bootstrap promise is returned');
  assert.equal(scheduled.length, 1, 'deferred scheduler must be queued after bootstrap');
});

test('Dashboard deferred reads use at most two in-flight RPCs and publish each block independently', async () => {
  const { api, calls, gates } = makeApi();
  const runtime = makeRuntime();
  const loader = moduleInstance.createLoader({ runtime, settled: settledValue, timer: fn => queueMicrotask(fn), timeoutMs: 20 });
  resolveCritical(gates);
  const done = await loader.load(makeCtx(api, {}));
  assert.ok(done.status, 'fallback status read is allowed when no shell status is supplied');
  await flush();

  const firstWave = Object.entries(calls)
    .filter(([key]) => key !== 'statusFast')
    .reduce((sum, [, value]) => sum + value, 0);
  assert.ok(firstWave <= 2, `deferred scheduler exceeded two lanes: ${firstWave}`);

  gates.events.resolve({ events: [{ id: 'e1', message: 'ready' }] });
  await flush();
  assert.deepEqual(runtime.deferred.events.value.events, [{ id: 'e1', message: 'ready' }],
    'events must publish as soon as their own RPC settles');
  assert.ok(runtime.deferred.preview === undefined || runtime.deferred.preview.value === undefined,
    'a slow strategy preview must not gate the event block');
  Object.values(gates).forEach(gate => gate.resolve({}));
  await flush();
});

test('Dashboard Telegram status is an independent deferred block', async () => {
  const { api, calls, gates } = makeApi();
  const runtime = makeRuntime();
  const loader = moduleInstance.createLoader({ runtime, settled: settledValue, timer: fn => queueMicrotask(fn) });
  resolveCritical(gates);
  await loader.load(makeCtx(api, {}));
  await flush();

  // Let the bounded scheduler drain until the Telegram read is admitted.
  for (let i = 0; i < 8 && !calls.tgStatus; i++) {
    gates.preview.resolve({});
    gates.events.resolve({});
    gates.recommendations.resolve({});
    gates.engine.resolve({});
    gates.system.resolve({});
    gates.versions.resolve({});
    gates.resources.resolve({});
    gates.strategy.resolve({});
    await flush();
  }
  assert.equal(calls.tgStatus, 1, 'Telegram status must be scheduled without waiting for a global Promise.all');
  gates.tgStatus.resolve({ status: 'running', readiness: { ready: true } });
  await flush();
  assert.equal(runtime.deferred.tgStatus.value.status, 'running');
});

test('Dashboard timeout is local to each deferred block and stale generations cannot rerender', async () => {
  const { api, calls, gates } = makeApi();
  const runtime = makeRuntime();
  let rerenders = 0;
  const loader = moduleInstance.createLoader({
    runtime, settled: settledValue, timer: fn => queueMicrotask(fn), timeoutMs: 5
  });
  resolveCritical(gates);
  await loader.load(makeCtx(api, {}, () => { rerenders++; }));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(runtime.deferred.events && runtime.deferred.events.error,
    'a hanging events read must leave an explicit local error');
  assert.ok(runtime.deferred.tgStatus && runtime.deferred.tgStatus.error,
    'a hanging Telegram read must leave an explicit local error');

  const before = rerenders;
  runtime.loadToken++;
  await flush();
  assert.equal(rerenders, before, 'stale deferred callbacks must not repaint a newer page generation');
  assert.ok(calls.statusFast >= 1, 'the fallback path remains covered when no shell status exists');
});
