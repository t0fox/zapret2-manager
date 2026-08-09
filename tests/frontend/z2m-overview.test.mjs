import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-page-overview.js', import.meta.url);

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.children = Array.isArray(children) ? children : [children];
    this.disabled = false;
  }
  setAttribute(name, value) { this.attrs[name] = value; }
}
function E(tag, attrs, children) { return new Node(tag, attrs, children); }
function text(node) {
  if (node === null || node === undefined) return '';
  if (!(node instanceof Node)) return String(node);
  return node.children.map(text).join(' ');
}

async function loadModule() {
  const source = await readFile(modulePath, 'utf8');
  const context = vm.createContext({ baseclass: { extend: value => value }, E, _: value => value, console, Promise });
  return new vm.Script(`(function () { ${source}\n})()`, { filename: modulePath.pathname }).runInContext(context);
}

function settled(value) { return Promise.resolve({ value }); }
function context(overrides = {}) {
  let snapshot = { toasts: [], operations: [] };
  const calls = [];
  const ctx = {
    api: {
      settle: promise => promise,
      capabilities: () => ({ routing: false, masque: false }),
      service: {
        status: () => settled({ serviceState: 'running', activeStrategy: 'youtube-main', uptime: 3600 }),
        start: () => { calls.push('start'); return Promise.resolve({ ok: true, state: 'running' }); },
        stop: () => { calls.push('stop'); return Promise.resolve({ ok: true, state: 'stopped' }); },
        restart: () => { calls.push('restart'); return Promise.resolve({ ok: true, state: 'running' }); }
      },
      dns: { get: () => settled({ mode: 'doh', primary: 'cloudflare', health: 'healthy' }) },
      proxy: { status: () => settled({ provider: 'go', installed: true, running: true, health: 'healthy' }) },
      jobs: { list: () => settled({ jobs: [{ id: 'job-1', kind: 'dns_apply', state: 'running', phase: 'verifying' }] }) },
      maintenance: { eventsTail: () => settled({ events: [{ level: 'warning', message: 'DNS fallback используется' }] }) }
    },
    state: {
      normalizeError: error => ({ code: error.code || 'EUNKNOWN', message: error.message || String(error), details: null }),
      operationFrom: (kind, title, response) => ({ kind, title, state: response.state || 'running', phase: response.phase || null })
    },
    store: {
      get: () => snapshot,
      update: patch => { snapshot = { ...snapshot, ...patch }; }
    },
    ui: {
      badge: (state, label) => E('span', { class: `badge ${state}` }, label),
      card: (title, body, options = {}) => E('section', { class: `card ${options.kind || ''}` }, [title].concat(Array.isArray(body) ? body : [body], [options.badge || ''])),
      button: (label, options = {}) => E('button', { class: options.kind || '', click: options.onClick }, label),
      errorPanel: error => E('div', { class: 'error' }, error.message),
      emptyState: (title, message) => E('div', { class: 'empty' }, [title, message]),
      setBusy() {}
    },
    refresh: () => { calls.push('refresh'); return Promise.resolve(); },
    ...overrides
  };
  return { ctx, calls, getSnapshot: () => snapshot };
}

test('loads dashboard sources independently through settled results', async () => {
  const Overview = await loadModule();
  const { ctx } = context();
  const data = await Overview.load(ctx);

  assert.equal(data.service.value.serviceState, 'running');
  assert.equal(data.dns.value.primary, 'cloudflare');
  assert.equal(data.proxy.value.provider, 'go');
  assert.equal(data.jobs.value.jobs.length, 1);
  assert.equal(data.events.value.events.length, 1);
});

test('renders all approved dashboard cards and honest unavailable integrations', async () => {
  const Overview = await loadModule();
  const { ctx } = context();
  ctx.data = await Overview.load(ctx);
  const rendered = text(Overview.render(ctx));

  for (const title of ['Zapret2', 'Маршрутизация', 'WARP / MASQUE', 'DNS', 'Telegram Proxy', 'Задачи', 'Предупреждения', 'Последние события']) {
    assert.match(rendered, new RegExp(title));
  }
  assert.match(rendered, /Требуется backend contract/);
  assert.match(rendered, /youtube-main/);
  assert.match(rendered, /cloudflare/);
});

test('keeps a failed subsystem isolated from healthy cards', async () => {
  const Overview = await loadModule();
  const { ctx } = context();
  ctx.api.dns.get = () => Promise.resolve({ error: new Error('dns unavailable') });
  ctx.data = await Overview.load(ctx);
  const rendered = text(Overview.render(ctx));

  assert.match(rendered, /dns unavailable/);
  assert.match(rendered, /Zapret2/);
  assert.match(rendered, /Telegram Proxy/);
});

test('service quick action records operation and success toast then refreshes', async () => {
  const Overview = await loadModule();
  const { ctx, calls, getSnapshot } = context();
  await Overview.runServiceAction(ctx, 'restart');

  assert.deepEqual(calls, ['restart', 'refresh']);
  assert.equal(getSnapshot().operations.length, 0);
  assert.equal(getSnapshot().toasts.at(-1).kind, 'success');
  assert.match(getSnapshot().toasts.at(-1).message, /перезапущен/i);
});

test('service quick action reports normalized errors and clears operation', async () => {
  const Overview = await loadModule();
  const { ctx, getSnapshot } = context();
  ctx.api.service.stop = () => Promise.reject(Object.assign(new Error('conflict'), { code: 'ECONFLICT' }));

  await Overview.runServiceAction(ctx, 'stop');

  assert.equal(getSnapshot().operations.length, 0);
  assert.equal(getSnapshot().toasts.at(-1).kind, 'error');
  assert.equal(getSnapshot().toasts.at(-1).code, 'ECONFLICT');
});
