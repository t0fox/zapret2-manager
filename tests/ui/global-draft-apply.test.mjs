import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const app = readFileSync(`${root}/app.js`, 'utf8');
const shellSource = readFileSync(`${root}/z2m-shell.js`, 'utf8');
const store = readFileSync(`${root}/z2m-store.js`, 'utf8');

function makeNode(tag, attrs = {}, children = []) {
  const node = {
    tag,
    attrs,
    children: [],
    disabled: attrs.disabled != null,
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) { if (child != null) node.children.push(child); return child; },
    querySelector(selector) {
      if (selector.startsWith('#')) return find(node, (item) => item.attrs?.id === selector.slice(1));
      return find(node, (item) => item.tag === selector);
    },
    addEventListener() {}
  };
  Object.defineProperty(node, 'textContent', {
    get: () => node.children.map((child) => child?.textContent ?? child ?? '').join(''),
    set: () => {}
  });
  for (const child of (Array.isArray(children) ? children : [children])) {
    if (child != null) node.appendChild(typeof child === 'object' ? child : { textContent: String(child), attrs: {} });
  }
  return node;
}
function find(node, predicate) {
  for (const child of node.children || []) {
    if (predicate(child)) return child;
    const nested = find(child, predicate);
    if (nested) return nested;
  }
  return null;
}
function E(tag, attrs, children) { return makeNode(tag, attrs || {}, children); }

const appView = evaluateLuciModule(`${root}/app.js`, {
  E, _: (value) => value,
  L: { view: { extend: (value) => value }, resource: (value) => value },
  document: { head: makeNode('head'), getElementById: () => null, createElement: (tag) => makeNode(tag) },
  window: { location: { hash: '', hostname: 'test' }, addEventListener() {}, removeEventListener() {} }
}, new Map());
const storeModule = evaluateLuciModule(`${root}/z2m-store.js`);

function fakeApi(calls, preview) {
  let readCount = 0;
  return {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error || 'test error') }; },
    services: {
      catalogStatus: () => {
        calls.push('status');
        readCount += 1;
        return Promise.resolve({ ledger: { revision: 3, enabled: readCount > 1 ? ['alpha', 'beta', 'gamma'] : ['alpha', 'gamma'] } });
      },
      catalogList: () => { calls.push('list'); return Promise.resolve({ services: [] }); },
      catalogPreview: (payload) => { calls.push(['preview', JSON.parse(payload)]); return Promise.resolve(preview); },
      catalogApply: (payload) => { calls.push(['apply', JSON.parse(payload)]); return Promise.resolve({ ok: true }); }
    }
  };
}
function coordinatorStore(draft, applied) {
  return storeModule.create({ draft, applied: applied || {} });
}
function noShell() { return { showToast() {} }; }

test('global apply bar has exactly three actions and a disabled reason', () => {
  const shell = evaluateLuciModule(`${root}/z2m-shell.js`, { E, _: (value) => value });
  const bar = shell.renderApplyBar({ hasDraft: () => true }, { enabled: false, reason: 'Стратегия: недоступно' });
  const buttons = [];
  (function walk(node) {
    if (node.tag === 'button') buttons.push(node.attrs?.id);
    for (const child of node.children || []) if (child?.attrs) walk(child);
  })(bar);
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons, [
    'z2m-discard-drafts', 'z2m-preview-drafts', 'z2m-apply-drafts'
  ]);
  assert.match(bar.textContent, /Стратегия: недоступно/);
});

test('coordinator is backend-authoritative and has no legacy confirmation workflow', () => {
  for (const name of ['preflightDraft', 'applyDrafts', 'handleApplyResult', 'openSemanticDiff'])
    assert.match(app, new RegExp(`function\\s+${name}\\s*\\(`));
  assert.match(app, /ADAPTERS|adapters/);
  assert.match(app, /reloadAppliedState/);
  assert.match(app, /verify/);
  assert.match(app, /DraftModel\.semanticDiff/);
  assert.match(app, /DraftModel\.recordApplyResult/);
  assert.doesNotMatch(app, /confirmationTimer|rollback_ttl|confirm_alive|setInterval/);
  assert.doesNotMatch(shellSource, /renderConfirmBar|z2m-confirm-alive|z2m-rollback-now/);
});

test('coordinator retains failures, blocks unsupported scopes, and resets without RPC mutation', () => {
  assert.match(store, /snapshotDraft/);
  assert.match(store, /coordinator/);
  assert.match(app, /Unsupported scope/);
  assert.match(app, /failedScopes/);
  assert.match(app, /clearedScopes/);
  assert.match(app, /resetDraft/);
  assert.match(app, /preflight[\s\S]*applyDraft/);
  assert.match(app, /reloadAppliedState[\s\S]*verify/);
  assert.doesNotMatch(app, /setConfirmation/);
});

test('Services apply preserves the full baseline enabled set', async () => {
  const calls = [];
  const api = fakeApi(calls, { ok: true, precondition: { ledgerRevision: 3, fileSha256: 'sha-3' } });
  const store = coordinatorStore({ services: { changes: { beta: { before: false, after: true } } } }, {
    services: { enabled: { alpha: true, gamma: true } }
  });
  const coordinator = appView.createCoordinator({
    api, store, shell: noShell(),
    adapters: { services: appView.createServicesAdapter(api, { resetDraft() {} }) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  const apply = calls.find((item) => Array.isArray(item) && item[0] === 'apply');
  assert.deepEqual(apply[1].enabled, ['alpha', 'beta', 'gamma']);
  assert.deepEqual(result.clearedScopes, ['services']);
});

test('malformed preview blocks mutation and preserves the draft', async () => {
  const calls = [];
  const api = fakeApi(calls, {});
  const store = coordinatorStore({ services: { changes: { beta: { before: false, after: true } } } });
  const coordinator = appView.createCoordinator({
    api, store, shell: noShell(),
    adapters: { services: appView.createServicesAdapter(api, { resetDraft() {} }) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === 'apply'), false);
  assert.deepEqual(Object.keys(store.get().draft), ['services']);
  assert.equal(result.failedScopes[0], 'services');
  assert.match(result.errors[0].message, /Предпросмотр|precondition/i);
});

test('blockers run all preflight gates and never mutate; partial results retain exact failures', async () => {
  const calls = [];
  const store = coordinatorStore({
    services: { changes: { beta: { before: false, after: true } } },
    dns: { changes: { mode: { before: 'auto', after: 'strict' } } }
  });
  const makeAdapter = (scope, applyResult) => ({
    supported: true,
    reloadAppliedState: () => { calls.push(`${scope}:read`); return Promise.resolve({ value: {}, revision: 1 }); },
    validateDraft: () => { calls.push(`${scope}:validate`); return Promise.resolve({ ok: true }); },
    previewDraft: () => { calls.push(`${scope}:preview`); return Promise.resolve({ ok: true, precondition: { revision: 1, fileSha256: 'sha-1' } }); },
    applyDraft: () => { calls.push(`${scope}:apply`); return applyResult instanceof Error ? Promise.reject(applyResult) : Promise.resolve(applyResult); },
    verifyApplied: () => true,
    resetDraft() {}
  });
  const coordinator = appView.createCoordinator({
    api: { normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; } },
    store, shell: noShell(),
    adapters: {
      services: makeAdapter('services', { ok: true }),
      dns: makeAdapter('dns', Object.assign(new Error('exact backend failure'), { code: 'E_DNS' }))
    }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls.slice(0, 4), ['services:read', 'dns:read', 'services:validate', 'dns:validate']);
  assert.ok(calls.indexOf('services:preview') < calls.indexOf('services:apply'));
  assert.ok(calls.indexOf('dns:preview') < calls.indexOf('dns:apply'));
  assert.deepEqual(result.clearedScopes, ['services']);
  assert.deepEqual(result.failedScopes, ['dns']);
  assert.deepEqual(Object.keys(store.get().draft), ['dns']);
  assert.equal(result.errors[0].code, 'E_DNS');
  assert.equal(result.errors[0].message, 'exact backend failure');
});

test('a local blocker prevents every mutation call after complete preflight', async () => {
  const calls = [];
  const store = coordinatorStore({
    services: { changes: { beta: { before: false, after: true } } },
    dns: { changes: { mode: { before: 'auto', after: 'strict' } } }
  });
  const adapter = (scope, valid) => ({
    supported: true,
    reloadAppliedState: () => { calls.push(`${scope}:read`); return Promise.resolve({ value: {}, revision: 1 }); },
    validateDraft: () => { calls.push(`${scope}:validate`); return Promise.resolve(valid ? { ok: true } : { ok: false, message: 'exact local blocker' }); },
    previewDraft: () => { calls.push(`${scope}:preview`); return Promise.resolve({ ok: true, precondition: { revision: 1 } }); },
    applyDraft: () => { calls.push(`${scope}:apply`); return Promise.resolve({ ok: true }); },
    verifyApplied: () => true,
    resetDraft() {}
  });
  const coordinator = appView.createCoordinator({
    api: { normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; } },
    store, shell: noShell(), adapters: { services: adapter('services', false), dns: adapter('dns', true) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((call) => String(call).endsWith(':apply')), false);
  assert.ok(calls.includes('services:preview'));
  assert.ok(calls.includes('dns:preview'));
  assert.deepEqual(Object.keys(store.get().draft), ['services', 'dns']);
  assert.equal(result.errors[0].message, 'exact local blocker');
});

test('failed verification leaves the previous applied baseline intact', async () => {
  const calls = [];
  const store = coordinatorStore({ services: { changes: { beta: { before: false, after: true } } } }, {
    services: { enabled: { alpha: true } }
  });
  const adapter = {
    supported: true,
    reloadAppliedState: () => { calls.push('read'); return Promise.resolve({ value: { enabled: { beta: true } }, revision: 1 }); },
    validateDraft: () => Promise.resolve({ ok: true }),
    previewDraft: () => Promise.resolve({ ok: true, precondition: { revision: 1, fileSha256: 'sha-1' } }),
    applyDraft: () => Promise.resolve({ ok: true }),
    verifyApplied: () => false,
    resetDraft() {}
  };
  const coordinator = appView.createCoordinator({
    api: { normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; } },
    store, shell: noShell(), adapters: { services: adapter }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(store.get().applied, { services: { enabled: { alpha: true } } });
  assert.deepEqual(Object.keys(store.get().draft), ['services']);
  assert.equal(result.errors[0].code, 'verification-failed');
});

test('unsupported scopes render as semantic diff blockers and pending availability stays disabled', () => {
  const diff = appView.renderSemanticDiff({ unknown: { changes: { value: { before: 1, after: 2 } } } }, {});
  assert.match(diff.textContent, /Unsupported scope: unknown/);
  const coordinator = appView.createCoordinator({ store: coordinatorStore({ services: { changes: { beta: { before: false, after: true } } } }), shell: noShell() });
  assert.deepEqual(coordinator.availability(), {
    enabled: false, reason: 'Ожидается предварительная проверка.', blockers: []
  });
});
