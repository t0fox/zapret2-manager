import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const base = '../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';

class Node {
  constructor(tag, attrs = {}, children = []) { this.tag = tag; this.attrs = attrs || {}; this.children = Array.isArray(children) ? children : [children]; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
}
function E(tag, attrs, children) { return new Node(tag, attrs, children); }
function text(node) { return node instanceof Node ? node.children.map(text).join(' ') : node == null ? '' : String(node); }

async function load(name, document = { hidden: false, addEventListener() {}, removeEventListener() {} }) {
  const url = new URL(base + name, import.meta.url);
  const source = await readFile(url, 'utf8');
  const context = vm.createContext({ baseclass: { extend: value => value }, E, _: value => value, document, setTimeout, clearTimeout, Promise, console });
  return new vm.Script(`(function () { ${source}\n})()`, { filename: url.pathname }).runInContext(context);
}

function settled(value) { return Promise.resolve({ value }); }
function common() {
  let snapshot = { toasts: [], operations: [] };
  let modal = null;
  const calls = [];
  const ui = {
    badge: (state, label) => E('span', {}, [state, label]),
    card: (title, body, options = {}) => E('section', {}, [title].concat(Array.isArray(body) ? body : [body], [options.badge || ''])),
    button: (label, options = {}) => E('button', { click: options.onClick, class: options.kind || '' }, label),
    terminal: value => E('pre', {}, value),
    errorPanel: error => E('div', {}, error.message),
    emptyState: (title, message) => E('div', {}, [title, message]),
    modal: options => { modal = options; return E('div', {}, [options.title, options.body || '', options.confirmLabel || '']); }
  };
  return {
    calls, ui,
    state: { normalizeError: error => ({ code: error.code || 'EUNKNOWN', message: error.message || String(error), details: null }), redact: value => value },
    store: { get: () => snapshot, update: patch => { snapshot = { ...snapshot, ...patch }; } },
    root: new Node('main'), refresh: () => Promise.resolve(),
    getModal: () => modal, getSnapshot: () => snapshot
  };
}

test('monitoring renders operational detail rather than overview duplication', async () => {
  const Monitoring = await load('z2m-page-monitoring.js');
  const c = common();
  const ctx = {
    ...c,
    api: {
      settle: promise => promise,
      monitor: {
        snapshot: () => settled({ processes: [{ pid: 12, owner: 'runtime/nfqws2' }], subsystems: [{ id: 'dns', state: 'healthy' }], health: { state: 'degraded' } }),
        status: () => settled({ serviceState: 'running' }),
        eventsTail: () => settled({ events: [{ level: 'error', message: 'probe failed' }] })
      },
      jobs: { list: () => settled({ jobs: [{ id: 'job-1', kind: 'health', state: 'running' }] }) },
      dns: { get: () => settled({ state: 'healthy' }) },
      proxy: { status: () => settled({ state: 'running' }) }
    }
  };
  ctx.data = await Monitoring.load(ctx);
  const rendered = text(Monitoring.render(ctx));
  for (const section of ['Runtime', 'Процессы', 'Активные задачи', 'Подсистемы', 'Health matrix', 'События', 'Последние ошибки']) assert.match(rendered, new RegExp(section));
  assert.match(rendered, /runtime\/nfqws2/);
  assert.match(rendered, /probe failed/);
});

test('monitoring mount and unmount own visibility listener lifecycle', async () => {
  const events = [];
  const document = { hidden: false, addEventListener: name => events.push(['add', name]), removeEventListener: name => events.push(['remove', name]) };
  const Monitoring = await load('z2m-page-monitoring.js', document);
  Monitoring.mount({ refresh: () => Promise.resolve() });
  Monitoring.unmount({});
  assert.deepEqual(events, [['add', 'visibilitychange'], ['remove', 'visibilitychange']]);
});

test('maintenance renders versions backups diagnostics and events', async () => {
  const Maintenance = await load('z2m-page-maintenance.js');
  const c = common();
  const ctx = {
    ...c,
    api: {
      settle: promise => promise,
      maintenance: {
        versions: () => settled({ manager: '1.0.0', engine: '0.9.6' }),
        status: () => settled({ state: 'ready' }),
        backupList: () => settled({ backups: [{ id: 'backup-1', createdAt: '2026-08-10T12:00:00Z' }] }),
        eventsTail: () => settled({ events: [{ message: 'backup created' }] })
      }
    }
  };
  ctx.data = await Maintenance.load(ctx);
  const rendered = text(Maintenance.render(ctx));
  for (const section of ['Версии', 'Состояние обслуживания', 'Резервные копии', 'Экспорт диагностики', 'События']) assert.match(rendered, new RegExp(section));
  assert.match(rendered, /backup-1/);
});

test('restore requires preview and custom confirmation before mutation', async () => {
  const Maintenance = await load('z2m-page-maintenance.js');
  const c = common();
  const ctx = {
    ...c,
    api: { maintenance: {
      backupPreview: payload => { c.calls.push(['preview', payload]); return Promise.resolve({ ok: true, diff: [{ path: '/etc/zapret2/config', action: 'replace' }], warnings: ['restart required'] }); },
      backupRestore: payload => { c.calls.push(['restore', payload]); return Promise.resolve({ ok: true, result: 'restored' }); }
    } }
  };
  await Maintenance.requestRestore(ctx, 'backup-1');
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [['preview', { id: 'backup-1' }]]);
  assert.equal(c.getModal().danger, true);
  assert.match(text(c.getModal().body), /\/etc\/zapret2\/config/);
  assert.equal(c.calls.some(call => call[0] === 'restore'), false);
  await c.getModal().onConfirm();
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [['preview', { id: 'backup-1' }], ['restore', { id: 'backup-1' }]]);
});

test('backup delete requires custom danger confirmation', async () => {
  const Maintenance = await load('z2m-page-maintenance.js');
  const c = common();
  const ctx = { ...c, api: { maintenance: { backupDelete: payload => { c.calls.push(['delete', payload]); return Promise.resolve({ ok: true }); } } } };
  Maintenance.requestDelete(ctx, 'backup-1');
  assert.equal(c.calls.length, 0);
  assert.equal(c.getModal().danger, true);
  await c.getModal().onConfirm();
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [['delete', { id: 'backup-1' }]]);
});
