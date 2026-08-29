import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Behavioral regression: Dashboard active-strategy enrichment.
//
// Production bug 1: z2m-overview-loading exported a plain object
// (`return { createLoader }`) which the real LuCI loader rejects with
//   TypeError: '"view.zapret2-manager.z2m-overview-loading" factory yields
//   invalid constructor'
// -> the whole Dashboard fails to load.
//
// Production bug 2: resolveCanonicalStrategy invoked `ctx.edit(...)`
// although `edit` is an injected loader option and `ctx` (the app context)
// does not guarantee an `edit` member -> TypeError on routers where the
// active strategy path runs.
//
// These tests drive the module THROUGH the faithful LuCI loader harness and
// a context WITHOUT ctx.edit, mirroring production.

import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const modulePath = path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-loading.js');

const source = fs.readFileSync(modulePath, 'utf8');

function loadModule() {
  return loadLuCIModule(source, 'view.zapret2-manager.z2m-overview-loading',
    /'require baseclass'/.test(source) ? { baseclass } : {});
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settledValue = result => result.status === 'fulfilled'
  ? { value: result.value || {} } : { error: { message: 'rejected' } };

const immediate = fn => queueMicrotask(fn);

/* Consumer contract: z2m-overview.js always passes recommendationsRpc. */
const RECOMMENDATIONS_RPC = () => Promise.resolve({});

function makeLoaderOptions(overrides) {
  return Object.assign({
    runtime: makeRuntime(),
    settled: settledValue,
    timer: immediate,
    edit: (fn, value) => fn(JSON.stringify(value || {})),
    recommendationsRpc: RECOMMENDATIONS_RPC
  }, overrides);
}

function makeRuntime() {
  return { deferred: {}, loadToken: 0 };
}

function makeApi(overrides) {
  const calls = { strategiesGet: 0 };
  const gates = { critical: deferred(), strategiesGet: deferred() };
  const api = Object.assign({
    service: { statusFast: () => gates.critical.promise },
    engine: { status: () => gates.critical.promise },
    maintenance: {
      status: () => gates.critical.promise,
      versions: () => gates.critical.promise
    },
    strategy: { preview: () => Promise.resolve({}) },
    monitor: { eventsTail: () => Promise.resolve({}) },
    strategies: {
      get: () => { calls.strategiesGet++; return gates.strategiesGet.promise; },
      recommendations: () => Promise.resolve({})
    },
    normalizeError: error => ({ message: String(error && error.message || error) })
  }, overrides);
  return { api, calls, gates };
}

/* Production-parity context: NO `edit` member. */
function makeCtx(api) {
  return { api, store: null, rerender: () => {} };
}

test('module loads through the real LuCI factory contract', () => {
  assert.equal(typeof loadModule().createLoader, 'function');
});

test('active strategyStatus id resolves via strategies.get through the INJECTED edit', async () => {
  const OverviewLoading = loadModule();
  const editCalls = [];
  const injectedEdit = (fn, value) => {
    editCalls.push(value);
    return fn(JSON.stringify(value || {}));
  };
  const { api, calls, gates } = makeApi();
  const runtime = makeRuntime();
  const loader = OverviewLoading.createLoader(Object.assign(makeLoaderOptions(), { runtime, edit: injectedEdit }));

  const done = loader.load(makeCtx(api));
  gates.critical.resolve({ strategyStatus: { id: 'strat-9' } });
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(calls.strategiesGet, 1, 'strategies.get must be called exactly once');
  const identityCall = editCalls.find(v => v && v.id !== undefined);
  assert.equal(JSON.stringify(identityCall), JSON.stringify({ id: 'strat-9' }),
    'canonical lookup must go through the injected edit wrapper');

  gates.strategiesGet.resolve({ value: { strategy: { id: 'strat-9', name: 'nine' } } });
  const data = await done;
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.ok(runtime.deferred.strategy, 'deferred strategy must be populated');
  assert.equal(runtime.deferred.strategy.error, undefined, 'no error expected on happy path');
  assert.equal(runtime.deferred.strategy.value && runtime.deferred.strategy.value.id, 'strat-9');});

test('missing strategy id skips canonical lookup entirely', async () => {
  const OverviewLoading = loadModule();
  const { api, calls, gates } = makeApi();
  const loader = OverviewLoading.createLoader(makeLoaderOptions());
  const done = loader.load(makeCtx(api));
  gates.critical.resolve({});
  const data = await done;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls.strategiesGet, 0);
  assert.equal(data.strategy, undefined);
});

test('absent strategies.get degrades to null instead of crashing', async () => {
  const OverviewLoading = loadModule();
  const { api, gates } = makeApi({
    strategies: {},
    strategy: { preview: () => Promise.resolve({}) }
  });
  const loader = OverviewLoading.createLoader(makeLoaderOptions());
  const done = loader.load(makeCtx(api));
  gates.critical.resolve({ strategyStatus: { id: 'orphan' } });
  const data = await done;
  assert.equal(data.strategy, undefined,
    'load must resolve without a canonical strategy and without throwing');
});

test('rejected strategies.get surfaces as a local deferred error, load still resolves', async () => {
  const OverviewLoading = loadModule();
  const { api, gates } = makeApi();
  const runtime = makeRuntime();
  const loader = OverviewLoading.createLoader(makeLoaderOptions({ runtime }));
  const done = loader.load(makeCtx(api));
  gates.critical.resolve({ strategyStatus: { id: 'boom' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  gates.strategiesGet.reject(new Error('rpc exploded'));
  const data = await done;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(data.strategy, undefined, 'deferred enrichment must not delay bootstrap data');
  assert.ok(runtime.deferred.strategy && runtime.deferred.strategy.error,
    'strategy error envelope expected after rejection');
  assert.match(String(runtime.deferred.strategy.error.message || ''), /exploded|rejected/i);
});

test('malformed critical envelopes never break phase 1', async () => {
  const OverviewLoading = loadModule();
  for (const malformed of [null, undefined, 42, [], [[[[{ strategyStatus: 7 }]]]]]) {
    const { api, gates } = makeApi();
    const loader = OverviewLoading.createLoader(makeLoaderOptions());
    const done = loader.load(makeCtx(api));
    gates.critical.resolve(malformed);
    const data = await done;
    assert.equal(typeof data, 'object', 'phase 1 data envelope expected');
  }
});

test('missing recommendations RPC option degrades instead of crashing phase 2', async () => {
  const OverviewLoading = loadModule();
  const { api, gates } = makeApi({
    strategies: { get: () => Promise.resolve({}) } /* no recommendations member */
  });
  const loaderOptions = makeLoaderOptions();
  delete loaderOptions.recommendationsRpc;
  const loader = OverviewLoading.createLoader(loaderOptions);
  const done = loader.load(makeCtx(api));
  gates.critical.resolve({});
  const data = await done; /* must not reject with TypeError */
  assert.equal(typeof data, 'object');
});

test('stale load tokens discard late results', async () => {  const OverviewLoading = loadModule();
  const runtime = makeRuntime();
  const first = makeApi();
  const second = makeApi();

  const loaderA = OverviewLoading.createLoader(Object.assign(makeLoaderOptions(), { runtime }));
  const loaderB = OverviewLoading.createLoader(Object.assign(makeLoaderOptions(), { runtime }));

  const doneA = loaderA.load(makeCtx(first.api));
  const doneB = loaderB.load(makeCtx(second.api));

  second.gates.critical.resolve({ strategyStatus: { id: 'fresh' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  second.gates.strategiesGet.resolve({ value: { strategy: { id: 'fresh' } } });
  await doneB;
  first.gates.critical.resolve({ strategyStatus: { id: 'late' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  first.gates.strategiesGet.resolve({});
  const dataA = await doneA;
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(runtime.loadToken, 2, 'fresh load must own the runtime token');
  assert.equal(second.calls.strategiesGet, 1,
    'fresh (non-stale) load still resolves its canonical strategy');
  assert.equal(dataA.strategy && dataA.strategy.value && dataA.strategy.value.id, undefined,
    'stale load result must not leak into shared runtime');
});
