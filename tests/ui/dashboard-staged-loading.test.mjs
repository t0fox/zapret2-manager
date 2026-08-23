import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Behavioral contract: dashboard RPC phases must be strictly sequenced.
//   PHASE 1 critical : status_fast | engine | maintenance status | versions
//   PHASE 2 secondary: discord preview, events_tail, recommendations
//   PHASE 3 optional : tg_product_status, proxy_health
//
// A Promise.allSettled([...]) expression CREATES its promises immediately, so
// the previous implementation started secondary fan-out before the critical
// batch resolved вЂ” contributing to clean-install rpcd contention. This test
// controls promise settlement manually and counts calls per phase.
//
// The module is loaded THROUGH the faithful LuCI loader harness so this suite
// also fails if the module ever violates the real loader contract again.

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
  const calls = { critical: 0, preview: 0, events: 0, recommendations: 0, tgStatus: 0, proxyHealth: 0 };
  const gates = {
    critical: deferred(), preview: deferred(), events: deferred(),
    recommendations: deferred(), tgStatus: deferred(), proxyHealth: deferred()
  };
  const api = {
    service: { statusFast: () => { calls.critical++; return gates.critical.promise; } },
    engine: { status: () => { calls.critical++; return gates.critical.promise; } },
    maintenance: { status: () => { calls.critical++; return gates.critical.promise; },
      versions: () => { calls.critical++; return gates.critical.promise; } },
    strategy: { preview: () => { calls.preview++; return gates.preview.promise; } },
    monitor: { eventsTail: () => { calls.events++; return gates.events.promise; } },
    strategies: { recommendations: () => { calls.recommendations++; return gates.recommendations.promise; } },
    tg: { product: { status: () => { calls.tgStatus++; return gates.tgStatus.promise; } } },
    proxy: { health: () => { calls.proxyHealth++; return gates.proxyHealth.promise; } },
    normalizeError: error => ({ message: String(error && error.message || error) })
  };
  return { api, calls, gates };
}

function makeCtx(api) {
  return { api, edit: (fn, value) => fn(JSON.stringify(value || {})), store: null, rerender: () => {} };
}

const settledValue = result => result.status === 'fulfilled'
  ? { value: result.value || {} } : { error: { message: 'rejected' } };

function makeRuntime() {
  return { deferred: {}, loadToken: 0 };
}

function immediate(fn) { queueMicrotask(fn); return undefined; }

test('secondary and optional RPCs never start while the critical batch is unresolved', async () => {
  const { api, calls } = makeApi();
  const loader = moduleInstance.createLoader({
    runtime: makeRuntime(),
    settled: settledValue,
    timer: immediate
  });
  const done = loader.load(makeCtx(api));

  await new Promise(resolve => queueMicrotask(resolve));
  await new Promise(resolve => queueMicrotask(resolve));

  assert.equal(calls.critical, 4, 'phase 1 must issue exactly the four critical calls');
  assert.equal(calls.preview, 0, 'strategy.preview must NOT start before critical settles');
  assert.equal(calls.events, 0, 'events_tail must NOT start before critical settles');
  assert.equal(calls.recommendations, 0, 'recommendations must NOT start before critical settles');
  assert.equal(calls.tgStatus, 0, 'telegram status must NOT start before critical settles');

  // Abandon this load without settling: only counts matter here.
  await Promise.race([done, new Promise(resolve => setTimeout(resolve, 10))]);
});

test('after the critical batch settles, the secondary batch starts; optional waits further', async () => {
  const { api, calls, gates } = makeApi();
  const loader = moduleInstance.createLoader({ runtime: makeRuntime(), settled: settledValue, timer: immediate });
  const done = loader.load(makeCtx(api));
  gates.critical.resolve({});
  await done;
  await Promise.resolve();

  assert.equal(calls.preview, 1, 'secondary preview starts after critical settles');
  assert.equal(calls.events, 1);
  assert.equal(calls.recommendations, 1);
  assert.equal(calls.tgStatus, 0, 'optional telegram still waits for secondary settle');

  gates.preview.resolve({});
  gates.events.resolve({});
  gates.recommendations.resolve({});
  await new Promise(resolve => queueMicrotask(resolve));
  await new Promise(resolve => queueMicrotask(resolve));

  assert.equal(calls.tgStatus, 1, 'optional telegram starts only after secondary settles');
  assert.equal(calls.proxyHealth, 1);
});
