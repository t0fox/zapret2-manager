import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-page-proxy.js', import.meta.url);

class Node {
  constructor(tag, attrs = {}, children = []) { this.tag = tag; this.attrs = attrs || {}; this.children = Array.isArray(children) ? children : [children]; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
}
function E(tag, attrs, children) { return new Node(tag, attrs, children); }
function text(node) { return node instanceof Node ? node.children.map(text).join(' ') : node == null ? '' : String(node); }

async function loadModule() {
  const source = await readFile(modulePath, 'utf8');
  const context = vm.createContext({ baseclass: { extend: value => value }, E, _: value => value, navigator: { clipboard: { writeText: () => Promise.resolve() } }, Promise, console });
  return new vm.Script(`(function () { ${source}\n})()`, { filename: modulePath.pathname }).runInContext(context);
}

function settled(value) { return Promise.resolve({ value }); }
function makeContext() {
  const calls = [];
  let snapshot = { toasts: [], operations: [] };
  let modal = null;
  const proxy = {
    capabilities: () => settled({ supported: true, controls: ['start', 'stop', 'restart', 'autostart', 'rotate'] }),
    status: () => settled({ provider: 'go', installed: true, running: true, health: 'healthy', uptime: 120, listeners: [{ host: '0.0.0.0', port: 443, ready: true }] }),
    configGet: () => settled({ revision: 4, config: { host: '0.0.0.0', port: 443, autostart: true, secret: 'raw-secret' } }),
    health: () => settled({ outbound: true, dcConnectivity: true, latencyMs: 22 }),
    logsTail: () => settled({ lines: ['proxy started', 'secret=must-not-render'] }),
    linkInfo: payload => { calls.push(['linkInfo', payload]); return Promise.resolve({ available: true, link: 'tg://proxy?server=router&secret=abc' }); },
    configValidate: payload => { calls.push(['validate', payload]); return Promise.resolve({ ok: true }); },
    configPreview: payload => { calls.push(['preview', payload]); return Promise.resolve({ ok: true, verified: true, changes: [{ field: 'port', before: 443, after: 8443 }] }); },
    configApply: payload => { calls.push(['apply', payload]); return Promise.resolve({ ok: true }); },
    start: () => { calls.push(['start']); return Promise.resolve({ ok: true }); },
    stop: () => { calls.push(['stop']); return Promise.resolve({ ok: true }); },
    restart: () => { calls.push(['restart']); return Promise.resolve({ ok: true }); },
    autostartSet: payload => { calls.push(['autostart', payload]); return Promise.resolve({ ok: true }); },
    secretRotate: () => { calls.push(['rotate']); return Promise.resolve({ ok: true }); },
    quickInstall: () => { calls.push(['quickInstall']); return Promise.resolve({ ok: true }); }
  };
  const provider = {
    catalog: () => settled({ providers: [{ id: 'go', name: 'Go' }, { id: 'rust', name: 'Rust' }] }),
    status: () => settled({ installed: ['go'], active: 'go' }),
    preflight: () => settled({ ok: true }),
    checkUpdates: payload => { calls.push(['checkUpdates', payload]); return Promise.resolve({ ok: true }); },
    install: payload => { calls.push(['install', payload]); return Promise.resolve({ ok: true }); },
    remove: payload => { calls.push(['remove', payload]); return Promise.resolve({ ok: true }); },
    purge: payload => { calls.push(['purge', payload]); return Promise.resolve({ ok: true }); }
  };
  const ui = {
    badge: (state, label) => E('span', {}, [state, label]),
    card: (title, body, options = {}) => E('section', {}, [title].concat(Array.isArray(body) ? body : [body], [options.badge || ''])),
    button: (label, options = {}) => E('button', { click: options.onClick, class: options.kind || '' }, label),
    terminal: value => E('pre', {}, value),
    errorPanel: error => E('div', {}, error.message),
    emptyState: (title, message) => E('div', {}, [title, message]),
    setBusy() {},
    modal: options => { modal = options; return E('div', {}, [options.title, options.body || '', options.confirmLabel || '']); }
  };
  const ctx = {
    api: { settle: promise => promise, proxy, proxyProvider: provider },
    state: {
      normalizeError: error => ({ code: error.code || 'EUNKNOWN', message: error.message || String(error), details: null }),
      redact: value => JSON.parse(JSON.stringify(value, (key, item) => /secret|token|link/i.test(key) ? '••••••' : item)),
      operationFrom: (kind, title, value) => ({ kind, title, ...value })
    },
    store: { get: () => snapshot, update: patch => { snapshot = { ...snapshot, ...patch }; } },
    ui,
    data: {},
    root: new Node('main'),
    refresh: () => Promise.resolve()
  };
  return { ctx, calls, getModal: () => modal, getSnapshot: () => snapshot };
}

test('loads existing proxy and provider capabilities independently', async () => {
  const Proxy = await loadModule();
  const { ctx } = makeContext();
  const data = await Proxy.load(ctx);
  for (const key of ['capabilities', 'status', 'config', 'health', 'logs', 'providerCatalog', 'providerStatus', 'providerPreflight']) assert.equal(typeof data[key], 'object', key);
});

test('initial render hides secret values and client link', async () => {
  const Proxy = await loadModule();
  const { ctx } = makeContext();
  ctx.data = await Proxy.load(ctx);
  const rendered = text(Proxy.render(ctx));
  for (const label of ['Статус', 'Конфигурация', 'Доступ клиента', 'Сервис', 'Обслуживание', 'Логи']) assert.match(rendered, new RegExp(label));
  assert.doesNotMatch(rendered, /raw-secret|tg:\/\/proxy|must-not-render/);
  assert.match(rendered, /Скрыта до подтверждения/);
});

test('reveal calls backend only after explicit custom modal confirmation', async () => {
  const Proxy = await loadModule();
  const { ctx, calls, getModal } = makeContext();
  Proxy.requestReveal(ctx);
  assert.equal(calls.length, 0);
  assert.equal(getModal().danger, false);
  await getModal().onConfirm();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['linkInfo', { reveal: true, confirm: 'REVEAL' }]]);
});

test('configuration follows validate preview apply order', async () => {
  const Proxy = await loadModule();
  const { ctx, calls } = makeContext();
  const draft = { expectedRevision: 4, settings: { port: 8443 } };
  await Proxy.applyConfig(ctx, draft);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['validate', draft], ['preview', draft], ['apply', draft]]);
});

test('rotate remove and purge require danger modal', async () => {
  const Proxy = await loadModule();
  for (const [action, expected] of [['rotate', 'rotate'], ['remove', 'remove'], ['purge', 'purge']]) {
    const { ctx, calls, getModal } = makeContext();
    Proxy.requestDanger(ctx, action, 'go');
    assert.equal(calls.length, 0);
    assert.equal(getModal().danger, true);
    await getModal().onConfirm();
    assert.equal(calls[0][0], expected);
  }
});
