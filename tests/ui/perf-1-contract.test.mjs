import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const managerRoot = path.join(root, 'zapret2-manager/files');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('PERF-1A EngineGate uses a cheap gate contract, not full engine status', () => {
  const gate = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-gate.js');
  const engineApi = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  const engineRpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc');
  const gateBackend = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-gate.uc');
  const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager-engine.json');

  assert.match(gate, /gateStatus/);
  assert.doesNotMatch(gate, /engine\.status\s*\(/);
  assert.match(engineApi, /engine_gate_status/);
  assert.match(engineRpc, /engine_gate_status/);
  assert.match(gateBackend, /engine_gate_status/);
  assert.doesNotMatch(engineRpc, /action\('gate_status'/);
  assert.match(acl, /engine_gate_status/);
});

test('PERF-1B fast status has bounded runtime schema and avoids heavyweight discovery', () => {
  const fast = read('zapret2-manager/files/usr/libexec/zapret2-manager/status-fast.uc');
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
  const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  const control = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-control.js');
  const strategies = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
  const full = read('zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc');

  assert.match(fast, /serviceState/);
  assert.match(fast, /runtimeSummary/);
  assert.match(fast, /strategyStatus/);
  assert.match(fast, /ownerConflict/);
  assert.doesNotMatch(fast, /apk info|nfqws2 --version|ps w|nft list|sha256sum/);
  assert.match(rpc, /status_fast/);
  assert.match(api, /statusFast/);
  assert.match(control, /service\.statusFast/);
  assert.match(strategies, /service\.statusFast/);
  assert.match(full, /legacy_status_v3/);
});

test('PERF-1C Control resolves active Strategy with one targeted get', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-control.js');
  const resolve = source.slice(source.indexOf('function resolveStrategy'), source.indexOf('function refresh', source.indexOf('function resolveStrategy')));
  assert.match(resolve, /strategies\.get/);
  assert.ok(resolve.indexOf('strategies.get') < resolve.indexOf('strategies.list'), 'legacy list fallback must be unreachable when targeted get exists');
  assert.match(resolve, /if \(ctx\.api\.strategies\.get\)/);
});

test('PERF-1 call-count contracts remove repeated initial RPCs', () => {
  const control = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-control.js');
  const scanner = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-hub.js');
  const load = scanner.slice(scanner.indexOf('load: function'), scanner.indexOf('render: function'));
  const render = scanner.slice(scanner.indexOf('render: function'), scanner.indexOf('unmount: function'));
  assert.equal((load.match(/blockcheckw\.status\(\)/g) || []).length, 1);
  assert.equal((load.match(/blockcheck2\.status\(\)/g) || []).length, 1);
  assert.doesNotMatch(render, /\.status\(\)/);
  assert.equal((control.match(/service\.statusFast \|\| ctx\.api\.service\.status/g) || []).length, 1);
});

function loadTabCache() {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-tab-cache.js');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value },
    Promise,
    Object,
    Array,
    Date
  });
}

function loadNavigationHarness({ cache, moduleHooks }) {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');
  const start = source.indexOf('    function loadTabData(tab, module, force) {');
  const end = source.indexOf('    function updateHeaderStatus(', start);
  assert.ok(start >= 0 && end > start, 'app navigation functions must be present');
  const calls = { render: 0, mount: 0, load: 0, busy: [] };
  const navigationModule = {
    load: moduleHooks && moduleHooks.load || (() => { calls.load += 1; return Promise.resolve({ source: 'loader' }); }),
    render: () => { calls.render += 1; return { node: true }; },
    mount: moduleHooks && moduleHooks.mount || (() => { calls.mount += 1; }),
    unmount: moduleHooks && moduleHooks.unmount || (() => {})
  };
  const context = {
    Promise, Object, Array,
    Navigation: { normalize: (tab) => tab, hash: (tab) => '#' + tab, label: (tab) => tab },
    MODULES: { strategies: navigationModule },
    tabSessionKey: 'session-a',
    syncTabCacheSession: () => {},
    tabCache: cache,
    tabDataCache: {},
    tabLoadPromises: {},
    activationToken: 0,
    activeModule: null,
    activeContext: null,
    store: { get: () => ({ ui: {} }), update: () => {} },
    tabs: { setActive: () => {} },
    buildContext: (tab, currentModule, data) => ({ route: tab, module: currentModule, data }),
    content: { replaceChildren: () => {} },
    appRoot: null,
    updateHeaderStatus: () => {},
    setContentBusy: (busy) => { calls.busy.push(busy); },
    Shell: { showToast: () => {}, renderLoadingState: () => ({}), avatar: { showErrorState: () => {} } },
    Api: { normalizeError: (error) => error },
    setHash: () => {}
  };
  const functions = vm.runInNewContext(`(function () {\n${source.slice(start, end)}\nreturn { activate: activate };\n})()`, context);
  return { activate: functions.activate, calls, module: navigationModule };
}

function loadStrategiesModule() {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    Promise, Object, Array, Date, JSON, String, Number, Boolean, isNaN,
    _: (value) => value,
    baseclass: { extend: (value) => value },
    Nfqws2Ide: {}, Model: {}, HealthcheckModel: {}, Icons: {},
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    document: {}
  });
}

test('PERF-1.1 fresh cached navigation renders and mounts once without loading', async () => {
  const cached = { cached: true };
  const harness = loadNavigationHarness({
    cache: {
      get: () => ({ fresh: true, data: cached }),
      load: (tab, loader) => Promise.resolve(cached)
    }
  });

  await harness.activate('strategies');

  assert.equal(harness.calls.load, 0, 'fresh navigation must not call module.load');
  assert.equal(harness.calls.render, 1, 'fresh navigation must render cached data once');
  assert.equal(harness.calls.mount, 1, 'fresh navigation must mount cached data once');
  assert.deepEqual(harness.calls.busy, [false], 'fresh navigation must finish without entering load busy state');
});

test('PERF-1.1 force refresh bypasses fresh cache and calls loader', async () => {
  const harness = loadNavigationHarness({
    cache: {
      get: () => ({ fresh: true, data: { cached: true } }),
      load: (tab, loader, options) => options.bypass ? loader() : Promise.resolve({ cached: true })
    }
  });

  await harness.activate('strategies', true);

  assert.equal(harness.calls.load, 1, 'force refresh must call module.load');
  assert.equal(harness.calls.render, 1);
  assert.equal(harness.calls.mount, 1);
});

test('PERF-1.1 expired cache calls loader instead of using stale data', async () => {
  const harness = loadNavigationHarness({
    cache: {
      get: () => null,
      load: (tab, loader) => loader()
    }
  });

  await harness.activate('strategies');

  assert.equal(harness.calls.load, 1, 'expired cache must call module.load');
  assert.equal(harness.calls.render, 1);
  assert.equal(harness.calls.mount, 1);
});

test('PERF-1.1 Strategies fresh cache does not repeat mount-side read-only RPCs', async () => {
  const strategies = loadStrategiesModule();
  const calls = { healthcheck: 0, learned: 0, pools: 0, debug: 0 };
  const pending = [];
  const rpc = (key, value) => () => {
    calls[key] += 1;
    const result = Promise.resolve(value);
    pending.push(result);
    return result;
  };
  const ctx = {
    api: {
      healthcheck: { status: rpc('healthcheck', {}) },
      strategies: { state: rpc('learned', {}), pools: rpc('pools', {}), debugGet: rpc('debug', {}) }
    },
    shell: {}, root: { querySelector: () => null }
  };
  const harness = loadNavigationHarness({
    cache: { get: () => ({ fresh: true, data: {} }), load: () => Promise.resolve({}) },
    moduleHooks: { mount: () => strategies.mount(ctx) }
  });

  await harness.activate('strategies');
  await Promise.all(pending);

  assert.deepEqual(calls, { healthcheck: 1, learned: 1, pools: 1, debug: 1 });
});

test('PERF-1.1 keeps inflight dedupe and session invalidation semantics', async () => {
  const module = loadTabCache();
  let resolveOld;
  const cache = module.create({ now: () => 1000, ttls: { strategies: 1000 }, sessionKey: 'session-a' });
  let calls = 0;
  const first = cache.load('strategies', () => {
    calls += 1;
    return new Promise((resolve) => { resolveOld = resolve; });
  });
  assert.equal(first, cache.load('strategies', () => { calls += 1; return Promise.resolve({ wrong: true }); }));
  assert.equal(calls, 1, 'same-session inflight loads must deduplicate');
  cache.setSession('session-b');
  resolveOld({ session: 'old' });
  await first;
  assert.equal(cache.get('strategies'), null, 'stale session response must not repopulate cache');
  assert.deepEqual(await cache.load('strategies', () => Promise.resolve({ session: 'new' })), { session: 'new' });
});

test('PERF-1D fresh TTL cache avoids load and expired cache reloads', async () => {
  const module = loadTabCache();
  let now = 1000;
  const cache = module.create({ now: () => now, ttls: { strategies: 1000 } });
  let calls = 0;
  const loader = () => { calls += 1; return Promise.resolve({ value: calls }); };

  assert.deepEqual(await cache.load('strategies', loader), { value: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(cache.get('strategies'))), { fresh: true, data: { value: 1 }, generation: 1 });
  assert.deepEqual(await cache.load('strategies', loader), { value: 1 });
  assert.equal(calls, 1);
  now += 1001;
  assert.equal(cache.get('strategies'), null);
  assert.deepEqual(await cache.load('strategies', loader), { value: 2 });
  assert.equal(calls, 2);
});

test('PERF-1D invalidation and inflight deduplication are deterministic', async () => {
  const module = loadTabCache();
  const cache = module.create({ now: () => 1000, ttls: { dns: 1000 } });
  let calls = 0;
  let resolve;
  const loader = () => { calls += 1; return new Promise((done) => { resolve = done; }); };
  const first = cache.load('dns', loader);
  const second = cache.load('dns', loader);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve({ value: 'dns' });
  await first;
  cache.invalidate('dns');
  assert.equal(cache.get('dns'), null);
});

test('PERF-1D invalidation cannot cache a stale inflight response', async () => {
  const module = loadTabCache();
  const cache = module.create({ now: () => 1000, ttls: { dns: 1000 } });
  let resolveOld;
  const old = cache.load('dns', () => new Promise((done) => { resolveOld = done; }));
  cache.setSession('next-session');
  resolveOld({ value: 'old-session' });
  await old;
  assert.equal(cache.get('dns'), null);
  assert.deepEqual(await cache.load('dns', () => Promise.resolve({ value: 'new-session' })), { value: 'new-session' });
});

test('PERF-1D app refreshes the cache session key before navigation', () => {
  const app = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');
  assert.match(app, /env\.sessionid \|\| env\.sessionId/);
  assert.match(app, /tabCache\.setSession\(next\)/);
  assert.match(app, /syncTabCacheSession\(\);/);
  assert.match(app, /delete tabLoadPromises\[tab\]/);
  assert.match(app, /tabLoadPromises = \{\};/);
});

test('PERF-1E Scanner Hub uses load data for initial statuses', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-hub.js');
  const render = source.slice(source.indexOf('render: function'), source.indexOf('unmount: function'));
  assert.match(render, /bcwStatus/);
  assert.match(render, /bc2Status/);
  assert.doesNotMatch(render, /blockcheckw.*\.status\s*\(/);
  assert.doesNotMatch(render, /blockcheck2.*\.status\s*\(/);
  assert.match(source, /setTimeout\(pollJobs/);
  assert.match(source, /clearTimeout\(state\.pollTimer/);
});
