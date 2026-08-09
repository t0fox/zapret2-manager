import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-page-dns.js', import.meta.url);

class Node {
  constructor(tag, attrs = {}, children = []) { this.tag = tag; this.attrs = attrs || {}; this.children = Array.isArray(children) ? children : [children]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  replaceChildren(...children) { this.children = children; }
}
function E(tag, attrs, children) { return new Node(tag, attrs, children); }
function text(node) { return node instanceof Node ? node.children.map(text).join(' ') : node == null ? '' : String(node); }

async function loadModule() {
  const source = await readFile(modulePath, 'utf8');
  const context = vm.createContext({ baseclass: { extend: value => value }, E, _: value => value, document: { hidden: false }, setTimeout, clearTimeout, Promise, console });
  return new vm.Script(`(function () { ${source}\n})()`, { filename: modulePath.pathname }).runInContext(context);
}

function settled(value) { return Promise.resolve({ value }); }
function makeContext() {
  const calls = [];
  let snapshot = { toasts: [], operations: [] };
  let modal = null;
  const ui = {
    badge: (state, label) => E('span', {}, [state, label]),
    card: (title, body, options = {}) => E('section', {}, [title].concat(Array.isArray(body) ? body : [body], [options.badge || ''])),
    button: (label, options = {}) => E('button', { click: options.onClick, class: options.kind || '' }, label),
    errorPanel: error => E('div', {}, error.message),
    emptyState: (title, message) => E('div', {}, [title, message]),
    terminal: value => E('pre', {}, value),
    setBusy() {},
    modal: options => { modal = options; return E('div', {}, [options.title, options.body || '', options.confirmLabel || '']); }
  };
  const dns = {
    get: () => settled({ mode: 'doh', primary: 'cloudflare', fallback: 'quad9', revision: 7, rollbackAvailable: true, health: 'healthy' }),
    components: () => settled({ components: [{ id: 'https-dns-proxy', available: true }, { id: 'stubby', available: false, reason: 'not installed' }] }),
    providers: () => settled({ providers: [{ id: 'cloudflare', modes: ['doh'], available: true }, { id: 'quad9', modes: ['doh', 'dot'], available: true }] }),
    globalGet: () => settled({ intercept: true, mode: 'managed' }),
    serviceProviders: () => settled({ providers: [{ id: 'system' }, { id: 'cloudflare' }] }),
    serviceStatus: () => settled({ routes: [{ serviceId: 'youtube', providerId: 'cloudflare', state: 'healthy' }] }),
    servicePreview: () => settled({ changes: [] }),
    validate: payload => { calls.push(['validate', payload]); return Promise.resolve({ ok: true, warnings: [] }); },
    apply: payload => { calls.push(['apply', payload]); return Promise.resolve({ ok: true, stage: 'verified' }); },
    check: payload => { calls.push(['check', payload]); return Promise.resolve({ ok: true, results: [{ domain: 'example.com', latencyMs: 18 }] }); },
    diagnose: payload => { calls.push(['diagnose', payload]); return Promise.resolve({ ok: true, components: [] }); },
    rollback: () => { calls.push(['rollback']); return Promise.resolve({ ok: true }); },
    serviceApplyAsync: payload => { calls.push(['serviceApplyAsync', payload]); return Promise.resolve({ ok: true, operationId: 'dns-op-1', state: 'running', phase: 'rendering' }); },
    serviceApplyStatus: payload => { calls.push(['serviceApplyStatus', payload]); return Promise.resolve({ ok: true, operationId: 'dns-op-1', state: 'succeeded', phase: 'committing' }); }
  };
  const ctx = {
    api: { settle: promise => promise, dns },
    state: { normalizeError: error => ({ code: error.code || 'EUNKNOWN', message: error.message || String(error), details: null }), operationFrom: (kind, title, value) => ({ kind, title, ...value }) },
    store: { get: () => snapshot, update: patch => { snapshot = { ...snapshot, ...patch }; } },
    ui,
    data: {},
    root: new Node('main'),
    refresh: () => Promise.resolve()
  };
  return { ctx, calls, getModal: () => modal, getSnapshot: () => snapshot };
}

test('loads every existing DNS capability independently', async () => {
  const Dns = await loadModule();
  const { ctx } = makeContext();
  const data = await Dns.load(ctx);
  for (const key of ['current', 'components', 'providers', 'global', 'serviceProviders', 'serviceStatus', 'servicePreview']) {
    assert.equal(typeof data[key], 'object', key);
  }
});

test('renders approved DNS layout using only backend fields', async () => {
  const Dns = await loadModule();
  const { ctx } = makeContext();
  ctx.data = await Dns.load(ctx);
  const rendered = text(Dns.render(ctx));
  for (const label of ['Текущее состояние', 'Режим / провайдер', 'Доступность компонентов', 'Конфигурация', 'Проверка / диагностика', 'Предпросмотр', 'Применение / откат']) {
    assert.match(rendered, new RegExp(label));
  }
  assert.match(rendered, /cloudflare/);
  assert.match(rendered, /stubby/);
  assert.doesNotMatch(rendered, /sing-box|mihomo|Amnezia/i);
});

test('validate and preview occur before apply', async () => {
  const Dns = await loadModule();
  const { ctx, calls } = makeContext();
  const draft = { mode: 'dot', primary: 'quad9', expectedRevision: 7 };
  await Dns.applyDraft(ctx, draft);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['validate', draft],
    ['apply', { mode: 'preview' }],
    ['apply', { mode: 'apply' }]
  ]);
});

test('async service DNS operation polls backend status and never invents progress', async () => {
  const Dns = await loadModule();
  const { ctx, calls, getSnapshot } = makeContext();
  await Dns.applyServiceDns(ctx, { routes: [{ serviceId: 'youtube', providerId: 'cloudflare' }] });
  assert.deepEqual(calls.map(call => call[0]), ['serviceApplyAsync', 'serviceApplyStatus']);
  assert.equal(getSnapshot().operations.length, 0);
  assert.equal(JSON.stringify(getSnapshot()).includes('%'), false);
});

test('rollback requires custom danger modal before calling backend', async () => {
  const Dns = await loadModule();
  const { ctx, calls, getModal } = makeContext();
  Dns.requestRollback(ctx);
  assert.equal(calls.length, 0);
  assert.equal(getModal().danger, true);
  assert.match(getModal().title, /Откат DNS/);
  await getModal().onConfirm();
  assert.deepEqual(calls, [['rollback']]);
});
