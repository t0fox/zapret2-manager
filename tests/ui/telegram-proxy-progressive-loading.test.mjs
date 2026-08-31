import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = fs.readFileSync(`${ROOT}/z2m-proxy-page-core.js`, 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeModule() {
  return loadLuCIModule(source, 'view.zapret2-manager.z2m-proxy-page-core', {
    baseclass,
    'view.zapret2-manager.z2m-proxy-model': {},
    'view.zapret2-manager.z2m-qr': {},
    'view.zapret2-manager.z2m-product-ux-model': {},
    'view.zapret2-manager.z2m-avatar-log': {}
  });
}

function makeApi() {
  const names = ['tgStatus', 'capabilities', 'config', 'operation', 'status', 'catalog', 'versions', 'events', 'health'];
  const calls = Object.fromEntries(names.map(name => [name, 0]));
  const gates = Object.fromEntries(names.map(name => [name, deferred()]));
  const read = name => () => { calls[name]++; return gates[name].promise; };
  return {
    calls,
    gates,
    api: {
      tg: { product: {
        status: read('tgStatus'), catalog: read('catalog'), versions: read('versions'),
        operationStatus: read('operation')
      } },
      proxy: {
        capabilities: read('capabilities'), configGet: read('config'), status: read('status'),
        health: read('health')
      },
      monitor: { eventsTail: read('events') },
      normalizeError: error => ({ message: String(error && error.message || error) })
    }
  };
}

function ctxFor(api, rerender) {
  return { api, rerender: rerender || (() => {}) };
}

function flush() { return new Promise(resolve => setTimeout(resolve, 0)); }

test('Telegram Proxy first render is local-only and does not launch an upstream health probe', () => {
  const loadStart = source.indexOf('function load(ctx)');
  const loadEnd = source.indexOf('\nfunction appliedConfig', loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.match(load, /tg\.product\.status\(\)/, 'canonical local TG status must be part of the bootstrap');
  assert.doesNotMatch(load, /edit\(ctx\.api\.proxy\.health,\s*\{\}\)/,
    'proxy.health({}) must not block the first Telegram Proxy render');
  assert.match(load, /scheduleDeferred|deferred|scheduler/i,
    'catalog, versions, and journal must be deferred behind the local bootstrap');
});

test('Telegram Proxy overview verifies upstream after the local first paint', async () => {
  const module = makeModule();
  const { api, calls, gates } = makeApi();
  const done = module.load(ctxFor(api));
  gates.tgStatus.resolve({ status: 'running', health: { route: {} } });
  gates.capabilities.resolve({ supported: true });
  gates.config.resolve({ applied: {}, appliedRevision: 1 });
  gates.operation.resolve({});
  await done;
  assert.equal(calls.health, 0, 'health must remain out of the blocking first paint');
  await flush();
  gates.status.resolve({});
  gates.catalog.resolve({});
  gates.versions.resolve({});
  gates.events.resolve({});
  for (let i = 0; i < 10 && calls.health === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.health, 1, 'overview reopen must schedule an upstream verification');

  Object.values(gates).forEach(gate => gate.resolve({}));
  await new Promise(resolve => setTimeout(resolve, 30));
});

test('Telegram Proxy has generation guards and keeps the explicit health action available', () => {
  assert.match(source, /loadToken|generation|requestGeneration/i,
    'late deferred results must be ignored after unmount or refresh');
  assert.match(source, /function .*health|proxy\.health|tg\.product\.health/,
    'the explicit health action must remain available');
  assert.match(source, /Проверить снова/);
});

test('Telegram Proxy loader returns after local core and admits deferred reads two at a time', async () => {
  const module = makeModule();
  const { api, calls, gates } = makeApi();
  const rerenders = [];
  const done = module.load(ctxFor(api, () => rerenders.push(true)));
  gates.tgStatus.resolve({ status: 'running', health: { route: {} } });
  gates.capabilities.resolve({ supported: true });
  gates.config.resolve({ applied: {}, appliedRevision: 1 });
  gates.operation.resolve({});
  const data = await done;

  assert.equal(calls.tgStatus, 1);
  assert.equal(calls.capabilities, 1);
  assert.equal(calls.config, 1);
  assert.equal(calls.operation, 1);
  assert.equal(calls.health, 0, 'ordinary open must not start the upstream health probe');
  assert.equal(calls.status + calls.catalog + calls.versions + calls.events, 0,
    'deferred reads start after core data is returned');
  await flush();
  assert.ok(calls.status + calls.catalog + calls.versions + calls.events <= 2,
    'page-local scheduler must cap deferred concurrency at two');
  assert.equal(data.providerStatus.value.status, 'running');

  Object.values(gates).forEach(gate => gate.resolve({}));
  await new Promise(resolve => setTimeout(resolve, 30));
});

test('Telegram Proxy ignores deferred results after unmount', async () => {
  const module = makeModule();
  const { api, gates } = makeApi();
  let rerenders = 0;
  const done = module.load(ctxFor(api, () => { rerenders++; }));
  gates.tgStatus.resolve({ status: 'running', health: { route: {} } });
  gates.capabilities.resolve({ supported: true });
  gates.config.resolve({ applied: {}, appliedRevision: 1 });
  gates.operation.resolve({});
  await done;
  await flush();
  module.mount();
  module.unmount();
  Object.values(gates).forEach(gate => gate.resolve({ late: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(rerenders, 0, 'unmounted page must not repaint from late RPC results');
});

test('Telegram Proxy cached revisit rehydrates deferred metadata for the new page generation', async () => {
  const module = makeModule();
  const { api, calls, gates } = makeApi();
  const first = module.load(ctxFor(api));
  gates.tgStatus.resolve({ status: 'running' });
  gates.capabilities.resolve({ supported: true });
  gates.config.resolve({ applied: {}, appliedRevision: 1 });
  gates.operation.resolve({});
  await first;
  await flush();

  module.mount(ctxFor(api));
  module.unmount();
  module.mount(ctxFor(api));
  await flush();

  assert.equal(calls.status, 2, 'cached revisit must start a fresh deferred status read');
  assert.equal(calls.catalog, 2, 'cached revisit must start a fresh deferred catalog read');
  Object.values(gates).forEach(gate => gate.resolve({}));
  await new Promise(resolve => setTimeout(resolve, 30));
});
