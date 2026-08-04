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
  assert.deepEqual(apply[1], { enabled: ['alpha', 'beta', 'gamma'], revision: 3, fileSha256: 'sha-3' });
  assert.deepEqual(result.clearedScopes, ['services']);
});

test('Services malformed precondition blocks catalogApply', async () => {
  const calls = [];
  const api = fakeApi(calls, { ok: true, precondition: { ledgerRevision: 3, fileSha256: '' } });
  const store = coordinatorStore({ services: { changes: { beta: { before: false, after: true } } } });
  const coordinator = appView.createCoordinator({
    api, store, shell: noShell(),
    adapters: { services: appView.createServicesAdapter(api, { resetDraft() {} }) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === 'apply'), false);
  assert.match(result.errors[0].message, /precondition|fileSha256/i);
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

test('failed backend reasons remain visible in availability, bar, and semantic diff', async () => {
  const store = coordinatorStore({ services: { changes: { beta: { before: false, after: true } } } });
  const adapter = {
    supported: true,
    reloadAppliedState: () => Promise.resolve({ value: {}, revision: 1 }),
    validateDraft: () => Promise.resolve({ ok: true }),
    previewDraft: () => Promise.reject({ code: 'E_PREVIEW', message: 'backend preview exact reason' }),
    applyDraft: () => Promise.resolve({ ok: true }),
    verifyApplied: () => true,
    resetDraft() {}
  };
  const coordinator = appView.createCoordinator({
    api: { normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; } },
    store, shell: noShell(), adapters: { services: adapter }
  });
  await coordinator.preflightDraft(store.snapshotDraft());
  const availability = coordinator.availability();
  assert.match(availability.reason, /E_PREVIEW.*backend preview exact reason/);
  const shell = evaluateLuciModule(`${root}/z2m-shell.js`, { E, _: (value) => value });
  const bar = shell.renderApplyBar(store, availability);
  assert.match(bar.textContent, /E_PREVIEW.*backend preview exact reason/);
  const diff = appView.renderSemanticDiff(store.snapshotDraft(), {}, coordinator.semanticBlockers());
  assert.match(diff.textContent, /backend preview exact reason/);
});

test('known unsupported scopes render a blocker group in the semantic diff', () => {
  const diff = appView.renderSemanticDiff({ lists: { changes: { mode: { before: 'auto', after: 'strict' } } } }, {});
  assert.match(diff.textContent, /Списки/);
  assert.match(diff.textContent, /Unsupported scope: lists/);
});

test('supported coordinator adapters expose the full contract', () => {
  for (const name of ['createServicesAdapter', 'createDnsAdapter', 'createStrategyAdapter'])
    assert.equal(typeof appView[name], 'function', `${name} must be exported by the root view`);
  const api = { normalizeError(error) { return { code: 'E_TEST', message: String(error || 'test') }; } };
  for (const adapter of [
    appView.createServicesAdapter(api, { resetDraft() {} }),
    appView.createDnsAdapter(api),
    appView.createStrategyAdapter(api)
  ]) {
    for (const method of ['validateDraft', 'previewDraft', 'applyDraft', 'reloadAppliedState'])
      assert.equal(typeof adapter[method], 'function', `${method} must be an adapter method`);
  }
});

test('DNS preflight blocker prevents set/apply mutation', async () => {
  const calls = [];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => Promise.resolve({ revision: 4, applied: [] }),
      validate: (payload) => { calls.push(['validate', JSON.parse(payload)]); return Promise.resolve({ ok: true, valid: false, errors: [{ message: 'exact DNS blocker' }] }); },
      set: (payload) => { calls.push(['set', JSON.parse(payload)]); return Promise.resolve({ ok: true }); },
      apply: (payload) => { calls.push(['apply', JSON.parse(payload)]); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ dns: { entries: [{ domain: 'bad.example', ip: '1.2.3.4', enabled: true }], changes: { entries: { before: [], after: ['bad.example'] } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((item) => item[0] === 'set' || item[0] === 'apply'), false);
  assert.deepEqual(Object.keys(store.get().draft), ['dns']);
  assert.match(result.errors[0].message, /exact DNS blocker/);
});

test('DNS apply uses set then apply and verifies the reread', async () => {
  const calls = [];
  let readCount = 0;
  const entries = [{ domain: 'ok.example', ip: '1.2.3.4', enabled: true }];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => {
        calls.push('get');
        readCount += 1;
        return Promise.resolve({ revision: readCount === 1 ? 4 : 5, applied: readCount === 1 ? [] : entries });
      },
      validate: () => { calls.push('validate'); return Promise.resolve({ ok: true, valid: true }); },
      set: (payload) => { calls.push(['set', JSON.parse(payload)]); return Promise.resolve({ ok: true, revision: 5 }); },
      apply: (payload) => { calls.push(['apply', JSON.parse(payload)]); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ dns: { entries, changes: { entries: { before: [], after: entries } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls.slice(-3), [['set', { entries, revision: 4 }], ['apply', { mode: 'apply' }], 'get']);
  assert.deepEqual(result.clearedScopes, ['dns']);
  assert.deepEqual(Object.keys(store.get().draft), []);
});

test('DNS accepts valid/set success envelopes without ok:true', async () => {
  const calls = [];
  let readCount = 0;
  const entries = [{ domain: 'shape.example', ip: '1.2.3.4', enabled: true }];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => { readCount += 1; return Promise.resolve({ revision: readCount, entries: readCount === 1 ? [] : entries }); },
      validate: (payload) => { calls.push(['validate', JSON.parse(payload)]); return Promise.resolve({ valid: true }); },
      set: (payload) => { calls.push(['set', JSON.parse(payload)]); return Promise.resolve({ revision: 2 }); },
      apply: (payload) => { calls.push(['apply', JSON.parse(payload)]); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ dns: { entries, changes: { entries: { before: [], after: entries } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls.slice(-2), [['set', { entries, revision: 1 }], ['apply', { mode: 'apply' }]]);
  assert.deepEqual(result.clearedScopes, ['dns']);
});

test('DNS explicit set failure blocks dns.apply', async () => {
  const calls = [];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => Promise.resolve({ revision: 1, entries: [] }),
      validate: () => Promise.resolve({ valid: true }),
      set: () => { calls.push('set'); return Promise.resolve({ ok: false, message: 'exact set failure' }); },
      apply: () => { calls.push('apply'); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ dns: { entries: [{ domain: 'set-error.example', ip: '1.2.3.4' }], changes: { entries: { before: [], after: ['set-error.example'] } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls, ['set']);
  assert.match(result.errors[0].message, /exact set failure/);
});

test('DNS explicit validation error blocks mutation even with valid:true', async () => {
  const calls = [];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => Promise.resolve({ revision: 1, entries: [] }),
      validate: () => Promise.resolve({ ok: true, valid: true, error: { message: 'exact resolver error' } }),
      set: () => { calls.push('set'); return Promise.resolve({}); },
      apply: () => { calls.push('apply'); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ dns: { entries: [{ domain: 'error.example', ip: '1.2.3.4' }], changes: { entries: { before: [], after: ['error.example'] } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls, []);
  assert.match(result.errors[0].message, /exact resolver error/);
});

test('DNS verification normalizes manualEntries in the reread envelope', () => {
  const entries = [{ domain: 'manual.example', ip: '1.2.3.4', enabled: true }];
  const adapter = appView.createDnsAdapter({});
  assert.equal(adapter.verifyApplied(
    { entries }, {}, { value: { manualEntries: entries } }
  ), true);
});

test('registered DNS adapter resets the real module state after verified apply', async () => {
  let resetCount = 0;
  let readCount = 0;
  const entries = [{ domain: 'reset.example', ip: '1.2.3.4', enabled: true }];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => { readCount += 1; return Promise.resolve({ revision: readCount, entries: readCount === 1 ? [] : entries }); },
      validate: () => Promise.resolve({ valid: true }),
      set: () => Promise.resolve({}),
      apply: () => Promise.resolve({ ok: true })
    }
  };
  const module = { resetDraft() { resetCount += 1; } };
  const store = coordinatorStore({ dns: { entries, changes: { entries: { before: [], after: entries } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api, module) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(result.clearedScopes, ['dns']);
  assert.equal(resetCount, 1);
});

test('strategy preflight blocker prevents profiles apply for an inapplicable candidate', async () => {
  const calls = [];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    strategy: {
      preview: () => Promise.resolve({ revision: 8, comboCatalog: { candidates: [{ candidateId: 'blocked', applicable: false, validationMessage: 'exact candidate blocker' }] }, strategyState: {} })
    },
    profiles: {
      list: () => Promise.resolve({ revision: 8, profiles: [] }),
      apply: (payload) => { calls.push(['apply', JSON.parse(payload)]); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ strategy: { candidateId: 'blocked', changes: { candidateId: { before: 'old', after: 'blocked' } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { strategy: appView.createStrategyAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.length, 0);
  assert.deepEqual(Object.keys(store.get().draft), ['strategy']);
  assert.match(result.errors[0].message, /exact candidate blocker/);
});

test('profile drafts block when candidateId is missing or absent from the catalog', async () => {
  for (const value of [
    { profiles: true, changes: { profiles: { before: false, after: true } } },
    { candidateId: 'missing', profiles: true, changes: { profiles: { before: false, after: true } } }
  ]) {
    const calls = [];
    const api = {
      normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
      strategy: { preview: () => Promise.resolve({ revision: 8, comboCatalog: { candidates: [] }, strategyState: {} }) },
      profiles: {
        list: () => Promise.resolve({ revision: 8, profiles: [] }),
        apply: (payload) => { calls.push(JSON.parse(payload)); return Promise.resolve({ ok: true }); }
      }
    };
    const store = coordinatorStore({ strategy: value });
    const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { strategy: appView.createStrategyAdapter(api) } });
    const result = await coordinator.applyDrafts(store.snapshotDraft());
    assert.deepEqual(calls, []);
    assert.match(result.errors[0].message, /candidate|стратег/i);
  }
});

test('applicable candidate permits the existing profile preview/apply pipeline', async () => {
  const calls = [];
  let profileReads = 0;
  const candidate = { candidateId: 'good', applicable: true, digest: 'digest-good' };
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    strategy: { preview: () => Promise.resolve({ revision: 8, comboCatalog: { candidates: [candidate] }, strategyState: { active: candidate } }) },
    profiles: {
      list: () => { profileReads += 1; return Promise.resolve({ revision: 8, profiles: [], draft: { profiles: profileReads === 1 ? [{ id: 'p1' }] : [] } }); },
      apply: (payload) => { calls.push(JSON.parse(payload)); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ strategy: { candidateId: 'good', profiles: true, changes: { profiles: { before: false, after: true } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { strategy: appView.createStrategyAdapter(api) } });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls, [{ mode: 'preview' }, { mode: 'apply' }], JSON.stringify(result));
  assert.deepEqual(result.clearedScopes, ['strategy']);
});

test('proxy and lists scopes remain explicitly blocked by semantic diff', () => {
  const diff = appView.renderSemanticDiff({
    lists: { changes: { domainInclude: { before: [], after: ['example.com'] } } },
    proxy: { changes: { enabled: { before: false, after: true } } },
    'service-dns': { changes: { alpha: { before: '', after: 'cloudflare' } } }
  }, {});
  assert.match(diff.textContent, /Unsupported scope: lists/);
  assert.match(diff.textContent, /Unsupported scope: proxy/);
  assert.match(diff.textContent, /Unsupported scope: service-dns/);
});

test('point override remains visible with an exact coordinator blocker', async () => {
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    strategy: { preview: () => Promise.resolve({ revision: 1, comboCatalog: { candidates: [] }, strategyState: {} }) },
    profiles: { list: () => Promise.resolve({ revision: 1, profiles: [] }) }
  };
  const store = coordinatorStore({ strategy: { override: { action: 'override_set' }, changes: { override: { before: null, after: 'change' } } } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { strategy: appView.createStrategyAdapter(api) } });
  await coordinator.preflightDraft(store.snapshotDraft());
  const diff = appView.renderSemanticDiff(store.snapshotDraft(), {}, coordinator.semanticBlockers());
  assert.match(diff.textContent, /Точечные правила не поддерживаются/);
});

test('proxy links remain masked in the semantic diff', () => {
  const diff = appView.renderSemanticDiff({
    proxy: { changes: { link: { before: 'tg://proxy?secret=old', after: 'tg://proxy?secret=new' } } }
  }, {});
  assert.doesNotMatch(diff.textContent, /tg:\/\/proxy|secret=old|secret=new/);
  assert.match(diff.textContent, /••••••/);
});
