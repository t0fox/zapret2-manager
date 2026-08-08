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
const servicesModel = evaluateLuciModule(`${root}/z2m-services-model.js`);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function enabledList(value) {
  if (Array.isArray(value)) return value.slice().sort();
  return Object.keys(value || {}).filter((key) => value[key]).sort();
}
function hubSnapshot(enabled, revision, fileSha256) {
  return {
    revision,
    precondition: { revision, fileSha256, catalogDigest: 'catalog-digest-' + revision },
    catalog: {
      digest: 'catalog-digest-' + revision,
      version: 'backend-catalog',
      enabled: enabledList(enabled),
      packages: ['alpha', 'beta', 'gamma'].map((id) => ({ id, name: id, category: 'test' })),
      categories: ['test']
    },
    userDomains: { include: [], exclude: [], conflicts: [] },
    autohost: { entries: [], counts: {}, writable: false },
    sources: { items: [], writable: false }
  };
}
function canonicalPrecondition(value = {}) {
  return {
    revision: value.revision ?? value.ledgerRevision,
    fileSha256: value.fileSha256,
    catalogDigest: value.catalogDigest || 'catalog-digest-' + (value.revision ?? value.ledgerRevision)
  };
}
function canonicalDraft(value, applied) {
  value = clone(value || {});
  if (value.expectedRevision !== undefined) return value;
  const baseline = enabledList(applied?.catalog?.enabled || applied?.enabled || {});
  const selected = value.enabled ? enabledList(value.enabled) : baseline.slice();
  Object.entries(value.changes || {}).forEach(([id, change]) => {
    const after = change && typeof change === 'object' && 'after' in change ? change.after : change;
    const pos = selected.indexOf(id);
    if (after === true && pos < 0) selected.push(id);
    if (after === false && pos >= 0) selected.splice(pos, 1);
  });
  value.expectedRevision = 3;
  value.expectedCatalogDigest = 'catalog-digest-3';
  value.catalog = value.catalog || { enabled: selected.sort() };
  value.lists = value.lists || { include: [], exclude: [] };
  value.autohost = value.autohost || { promote: [], ignore: [], cleanupStale: [] };
  value.sources = value.sources || {};
  if (value.applicable === undefined) value.applicable = !value.blocker;
  return value;
}
function canonicalDrafts(draft, applied = {}) {
  const result = clone(draft || {});
  if (result.domainHub && result.domainHub.__canonicalize === true) {
    delete result.domainHub.__canonicalize;
    result.domainHub = canonicalDraft(result.domainHub, applied.domainHub || {});
  }
  return result;
}
function fakeApi(calls, preview) {
  let readCount = 0;
  return {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error || 'test error') }; },
    domainHub: {
      get: () => {
        calls.push('get');
        readCount += 1;
        return Promise.resolve(hubSnapshot(readCount > 1 ? ['alpha', 'beta', 'gamma'] : ['alpha', 'gamma'], readCount > 1 ? 4 : 3, readCount > 1 ? 'sha-4' : 'sha-3'));
      },
      preview: (payload) => {
        const body = JSON.parse(payload);
        calls.push(['preview', body]);
        if (!preview || preview.ok !== true) return Promise.resolve(preview || {});
        return Promise.resolve(Object.assign({}, preview, { mutated: false, precondition: canonicalPrecondition(preview.precondition) }));
      },
      apply: (payload) => { calls.push(['apply', JSON.parse(payload)]); return Promise.resolve({ ok: true }); }
    }
  };
}
function coordinatorStore(draft, applied) {
  applied = applied || {};
  return storeModule.create({ draft: canonicalDrafts(draft, applied), applied });
}
function noShell() { return { showToast() {} }; }

function catalogScenario(options = {}) {
  const calls = [];
  const snapshots = [];
  const before = hubSnapshot(['alpha', 'gamma'], 3, 'sha-3');
  const after = hubSnapshot(['alpha', 'beta', 'gamma'], 4, 'sha-4');
  let backend = options.initial || before;
  let reads = 0;
  function read(name, value) {
    calls.push(name);
    snapshots.push({ name, state: clone(value) });
    return clone(value);
  }
  const api = {
    normalizeError(error) {
      const value = error?.error && typeof error.error === 'object' ? error.error : error;
      return { code: value?.code || error?.code || 'E_TEST', message: value?.message || error?.message || String(error || 'test error') };
    },
    domainHub: {
      get: () => {
        reads += 1;
        return Promise.resolve(read('get', reads === 1 ? before : backend));
      },
      preview: (payload) => {
        const body = JSON.parse(payload);
        calls.push('preview');
        snapshots.push({ name: 'preview', payload: body, state: clone(backend) });
        const answer = options.preview || { ok: true, mutated: false, precondition: { revision: 3, fileSha256: 'sha-3', catalogDigest: 'catalog-digest-3' } };
        if (answer.ok !== true) return Promise.resolve(answer);
        return Promise.resolve(Object.assign({}, answer, { mutated: false, precondition: canonicalPrecondition(answer.precondition) }));
      },
      apply: (payload) => {
        const body = JSON.parse(payload);
        calls.push('apply');
        snapshots.push({ name: 'apply', payload: body, stateBefore: clone(backend) });
        if (options.apply) return Promise.resolve(options.apply);
        backend = after;
        return Promise.resolve({ ok: true });
      }
    }
  };
  return { api, calls, snapshots, baseline: before, applied: after };
}

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
  assert.match(readFileSync(`${root}/z2m-coordinator.js`, 'utf8'), /verifyApplied/);
  assert.match(app, /DraftModel\.semanticDiff/);
  assert.match(readFileSync(`${root}/z2m-draft-model.js`, 'utf8'), /recordApplyResult/);
  assert.doesNotMatch(app, /confirmationTimer|rollback_ttl|confirm_alive|setInterval/);
  assert.doesNotMatch(shellSource, /renderConfirmBar|z2m-confirm-alive|z2m-rollback-now/);
});

test('coordinator retains failures, blocks unsupported scopes, and resets without RPC mutation', () => {
  assert.match(store, /snapshotDraft/);
  assert.match(store, /coordinator/);
  assert.match(app, /Unsupported scope/);
  assert.match(readFileSync(`${root}/z2m-draft-model.js`, 'utf8'), /failedScopes/);
  assert.match(readFileSync(`${root}/z2m-draft-model.js`, 'utf8'), /clearedScopes/);
  assert.match(app, /resetDraft/);
  assert.match(readFileSync(`${root}/z2m-coordinator.js`, 'utf8'), /preflightDraft[\s\S]*applyDraft/);
  assert.match(readFileSync(`${root}/z2m-coordinator.js`, 'utf8'), /reloadAppliedState[\s\S]*verifyApplied/);
  assert.doesNotMatch(app, /setConfirmation/);
});

test('Services apply preserves the full baseline enabled set', async () => {
  const calls = [];
  const api = fakeApi(calls, { ok: true, precondition: { ledgerRevision: 3, fileSha256: 'sha-3' } });
  const store = coordinatorStore({ domainHub: { __canonicalize: true, changes: { beta: { before: false, after: true } } } }, {
    domainHub: { __canonicalize: true, enabled: { alpha: true, gamma: true } }
  });
  const coordinator = appView.createCoordinator({
    api, store, shell: noShell(),
    adapters: { domainHub: appView.createServicesAdapter(api, { resetDraft() {} }) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  const apply = calls.find((item) => Array.isArray(item) && item[0] === 'apply');
  assert.deepEqual(apply[1].catalog.enabled, ['alpha', 'beta', 'gamma']);
  assert.equal(apply[1].expectedRevision, 3);
  assert.equal(apply[1].expectedCatalogDigest, 'catalog-digest-3');
  assert.match(apply[1].requestId, /^domain-hub-/);
  assert.deepEqual(result.clearedScopes, ['domainHub']);
});

test('successful Services apply rereads backend state, replaces baseline, and clears changed count', async () => {
  const scenario = catalogScenario();
  const store = coordinatorStore({ domainHub: { __canonicalize: true,
    changes: {
      beta: { before: false, after: true },
      gamma: { before: true, after: true }
    },
    enabled: { alpha: true, beta: true, gamma: true },
    precondition: { ledgerRevision: 3, fileSha256: 'sha-3' }
  } }, {
    domainHub: { __canonicalize: true, enabled: { alpha: true, gamma: true } }
  });
  const coordinator = appView.createCoordinator({
    api: scenario.api, store, shell: noShell(),
    adapters: { domainHub: appView.createServicesAdapter(scenario.api, { resetDraft() {} }) }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.deepEqual(scenario.calls, [
    'get', 'preview', 'apply', 'get'
  ]);
  assert.equal(scenario.snapshots[1].name, 'preview');
  assert.deepEqual(scenario.snapshots[1].payload.catalog.enabled, ['alpha', 'beta', 'gamma']);
  assert.deepEqual(scenario.snapshots[1].state, scenario.baseline);
  assert.equal(scenario.snapshots[2].name, 'apply');
  assert.deepEqual(scenario.snapshots[2].payload.catalog.enabled, ['alpha', 'beta', 'gamma']);
  assert.match(scenario.snapshots[2].payload.requestId, /^domain-hub-/);
  assert.deepEqual(scenario.snapshots[2].stateBefore, scenario.baseline);
  assert.deepEqual(store.get().applied.domainHub.catalog.enabled, ['alpha', 'beta', 'gamma']);
  assert.deepEqual(store.get().draft, {});
  assert.deepEqual(result.clearedScopes, ['domainHub']);
  assert.equal(servicesModel.selectors(
    [{ id: 'alpha' }, { id: 'beta' }, { id: 'gamma' }],
    { alpha: true, beta: true, gamma: true }, {}, '', 'all', 'all'
  ).kpis.changed, 0);
});

async function assertServicesPreconditionMismatch(precondition, expectedMessage) {
  const scenario = catalogScenario({ preview: { ok: true, precondition } });
  const store = coordinatorStore({ domainHub: { __canonicalize: true,
    changes: { beta: { before: false, after: true } },
    enabled: { alpha: true, beta: true },
    precondition: { ledgerRevision: 3, fileSha256: 'sha-3' }
  } }, { domainHub: { __canonicalize: true, enabled: { alpha: true } } });
  const coordinator = appView.createCoordinator({
    api: scenario.api, store, shell: noShell(),
    adapters: { domainHub: appView.createServicesAdapter(scenario.api, { resetDraft() {} }) }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.deepEqual(scenario.snapshots[1].payload.catalog.enabled, ['alpha', 'beta']);
  assert.equal(scenario.calls.includes('apply'), false);
  assert.deepEqual(store.get().applied, { domainHub: { __canonicalize: true, enabled: { alpha: true } } });
  assert.deepEqual(Object.keys(store.get().draft), ['domainHub']);
  assert.equal(result.errors[0].code, 'E_PRECONDITION_MISMATCH');
  assert.match(result.errors[0].message, expectedMessage);
}

test('Services preview revision mismatch blocks catalogApply before mutation', async () => {
  await assertServicesPreconditionMismatch(
    { ledgerRevision: 4, fileSha256: 'sha-3' }, /revision/i
  );
});

test('Services preview fileSha256 mismatch blocks catalogApply before mutation', async () => {
  await assertServicesPreconditionMismatch(
    { ledgerRevision: 3, fileSha256: 'sha-other' }, /fileSha256|hash/i
  );
});

test('Services backend failure preserves baseline and retains the exact normalized error', async () => {
  const scenario = catalogScenario({
    apply: { ok: false, error: { code: 'E_CATALOG_CONFLICT', message: 'catalog revision/hash conflict' } }
  });
  const store = coordinatorStore({ domainHub: { __canonicalize: true,
    changes: { beta: { before: false, after: true } },
    enabled: { alpha: true, beta: true },
    precondition: { ledgerRevision: 3, fileSha256: 'sha-3' }
  } }, { domainHub: { __canonicalize: true, enabled: { alpha: true } } });
  const toasts = [];
  const coordinator = appView.createCoordinator({
    api: scenario.api, store, shell: { showToast(message, kind) { toasts.push({ message, kind }); } },
    adapters: { domainHub: appView.createServicesAdapter(scenario.api, { resetDraft() {} }) }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.deepEqual(store.get().applied, { domainHub: { __canonicalize: true, enabled: { alpha: true } } });
  assert.deepEqual(Object.keys(store.get().draft), ['domainHub']);
  assert.deepEqual(result.errors, [{
    scope: 'domainHub', code: 'E_CATALOG_CONFLICT', message: 'catalog revision/hash conflict'
  }]);
  assert.deepEqual(toasts, []);
  assert.equal(scenario.calls.includes('get'), true);
  assert.equal(scenario.calls.includes('get'), true);
  assert.equal(scenario.calls.filter((call) => call === 'get').length, 1);
});

test('invalid source and stale precondition are explicit Services blockers before mutation', async () => {
  for (const failure of [
    { code: 'E_INVALID_SOURCE', message: 'invalid hosts source' },
    { code: 'E_REVISION_CONFLICT', message: 'stale catalog revision' }
  ]) {
    const scenario = catalogScenario({ preview: { ok: false, error: failure } });
    const store = coordinatorStore({ domainHub: { __canonicalize: true,
      changes: { beta: { before: false, after: true } },
      precondition: { ledgerRevision: 3, fileSha256: 'sha-3' }
    } }, { domainHub: { __canonicalize: true, enabled: { alpha: true } } });
    const coordinator = appView.createCoordinator({
      api: scenario.api, store, shell: noShell(),
      adapters: { domainHub: appView.createServicesAdapter(scenario.api, { resetDraft() {} }) }
    });

    const result = await coordinator.applyDrafts(store.snapshotDraft());

    assert.equal(scenario.calls.includes('apply'), false, failure.code);
    assert.deepEqual(store.get().applied, { domainHub: { __canonicalize: true, enabled: { alpha: true } } }, failure.code);
    assert.equal(result.errors[0].code, failure.code);
    assert.equal(result.errors[0].message, failure.message);
  }
});

test('Services malformed precondition blocks catalogApply', async () => {
  const calls = [];
  const api = fakeApi(calls, { ok: true, precondition: { ledgerRevision: 3, fileSha256: '' } });
  const store = coordinatorStore({ domainHub: { __canonicalize: true, changes: { beta: { before: false, after: true } } } });
  const coordinator = appView.createCoordinator({
    api, store, shell: noShell(),
    adapters: { domainHub: appView.createServicesAdapter(api, { resetDraft() {} }) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === 'apply'), false);
  assert.match(result.errors[0].message, /precondition|fileSha256/i);
});

test('malformed preview blocks mutation and preserves the draft', async () => {
  const calls = [];
  const api = fakeApi(calls, {});
  const store = coordinatorStore({ domainHub: { __canonicalize: true, changes: { beta: { before: false, after: true } } } });
  const coordinator = appView.createCoordinator({
    api, store, shell: noShell(),
    adapters: { domainHub: appView.createServicesAdapter(api, { resetDraft() {} }) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === 'apply'), false);
  assert.deepEqual(Object.keys(store.get().draft), ['domainHub']);
  assert.equal(result.failedScopes[0], 'domainHub');
  assert.match(result.errors[0].message, /Предпросмотр|precondition/i);
});

test('blockers run all preflight gates and never mutate; partial results retain exact failures', async () => {
  const calls = [];
  const store = coordinatorStore({
    domainHub: { changes: { beta: { before: false, after: true } } },
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
      domainHub: makeAdapter('domainHub', { ok: true }),
      dns: makeAdapter('dns', Object.assign(new Error('exact backend failure'), { code: 'E_DNS' }))
    }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(calls.slice(0, 4), ['domainHub:read', 'dns:read', 'domainHub:validate', 'dns:validate']);
  assert.ok(calls.indexOf('domainHub:preview') < calls.indexOf('domainHub:apply'));
  assert.ok(calls.indexOf('dns:preview') < calls.indexOf('dns:apply'));
  assert.deepEqual(result.clearedScopes, ['domainHub']);
  assert.deepEqual(result.failedScopes, ['dns']);
  assert.deepEqual(Object.keys(store.get().draft), ['dns']);
  assert.equal(result.errors[0].code, 'E_DNS');
  assert.equal(result.errors[0].message, 'exact backend failure');
});

test('a local blocker prevents every mutation call after complete preflight', async () => {
  const calls = [];
  const store = coordinatorStore({
    domainHub: { changes: { beta: { before: false, after: true } } },
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
    store, shell: noShell(), adapters: { domainHub: adapter('domainHub', false), dns: adapter('dns', true) }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.equal(calls.some((call) => String(call).endsWith(':apply')), false);
  assert.equal(calls.includes('domainHub:preview'), false);
  assert.ok(calls.includes('dns:preview'));
  assert.deepEqual(Object.keys(store.get().draft), ['domainHub', 'dns']);
  assert.equal(result.errors[0].message, 'exact local blocker');
});

test('failed verification leaves the previous applied baseline intact', async () => {
  const calls = [];
  const store = coordinatorStore({ domainHub: { changes: { beta: { before: false, after: true } } } }, {
    domainHub: { enabled: { alpha: true } }
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
    store, shell: noShell(), adapters: { domainHub: adapter }
  });
  const result = await coordinator.applyDrafts(store.snapshotDraft());
  assert.deepEqual(store.get().applied, { domainHub: { enabled: { alpha: true } } });
  assert.deepEqual(Object.keys(store.get().draft), ['domainHub']);
  assert.equal(result.errors[0].code, 'verification-failed');
});

test('unsupported scopes render as semantic diff blockers and pending availability stays disabled', () => {
  const diff = appView.renderSemanticDiff({ unknown: { changes: { value: { before: 1, after: 2 } } } }, {});
  assert.match(diff.textContent, /Unsupported scope: unknown/);
  const coordinator = appView.createCoordinator({ store: coordinatorStore({ domainHub: { changes: { beta: { before: false, after: true } } } }), shell: noShell() });
  assert.deepEqual(coordinator.availability(), {
    enabled: false, reason: 'Unsupported scope: domainHub', blockers: ['Unsupported scope: domainHub']
  });
});

test('failed backend reasons remain visible in availability, bar, and semantic diff', async () => {
  const store = coordinatorStore({ domainHub: { changes: { beta: { before: false, after: true } } } });
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
    store, shell: noShell(), adapters: { domainHub: adapter }
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
  assert.match(diff.textContent, /lists/);
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

test('DNS semantic no-op never reaches set or apply', async () => {
  const calls = [];
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    dns: {
      get: () => Promise.resolve({ revision: 4, applied: [] }),
      validate: () => { calls.push('validate'); return Promise.resolve({ ok: true, valid: true }); },
      set: () => { calls.push('set'); return Promise.resolve({ ok: true }); },
      apply: () => { calls.push('apply'); return Promise.resolve({ ok: true }); }
    }
  };
  const store = coordinatorStore({ dns: { entries: [] } });
  const coordinator = appView.createCoordinator({ api, store, shell: noShell(), adapters: { dns: appView.createDnsAdapter(api) } });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.equal(calls.includes('set'), false);
  assert.equal(calls.includes('apply'), false);
  assert.deepEqual(result.failedScopes, ['dns']);
  assert.match(result.errors[0].message, /изменений|no.?op/i);
});

test('rollback result routes through the originating adapter and carries backend proof', async () => {
  const calls = [];
  const store = coordinatorStore({ dns: { changes: { entries: { before: [], after: [{ domain: 'a.example' }] } } } });
  const adapter = {
    supported: true,
    reloadAppliedState: () => Promise.resolve({ value: {}, revision: 1 }),
    validateDraft: () => Promise.resolve({ ok: true }),
    previewDraft: () => Promise.resolve({ ok: true, precondition: { revision: 1 } }),
    applyDraft: () => Promise.resolve({ ok: true, snapshot: { id: 'dns-snapshot-1' }, revision: 2 }),
    rollbackProof: (answer) => ({ available: true, snapshot: answer.snapshot, revision: answer.revision }),
    verifyApplied: () => true,
    rollbackResult: (rollback) => {
      calls.push(rollback);
      return Promise.resolve({ ok: true, revision: 1 });
    },
    resetDraft() {}
  };
  const coordinator = appView.createCoordinator({
    api: { normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; } },
    store, shell: noShell(), adapters: { dns: adapter }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.deepEqual(result.rollback, {
    scope: 'dns', available: true, snapshot: { id: 'dns-snapshot-1' }, revision: 2
  });
  await coordinator.rollbackResult(result.rollback);
  assert.deepEqual(calls, [result.rollback]);
});

test('successful scope without an adapter rollback contract exposes no generic rollback', async () => {
  const store = coordinatorStore({ domainHub: { changes: { alpha: { before: false, after: true } } } });
  const adapter = {
    supported: true,
    reloadAppliedState: () => Promise.resolve({ value: {}, revision: 1 }),
    validateDraft: () => Promise.resolve({ ok: true }),
    previewDraft: () => Promise.resolve({ ok: true, precondition: { revision: 1 } }),
    applyDraft: () => Promise.resolve({ ok: true, snapshot: { id: 'catalog-snapshot-1' }, revision: 2 }),
    verifyApplied: () => true,
    resetDraft() {}
  };
  const coordinator = appView.createCoordinator({
    api: { normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; } },
    store, shell: noShell(), adapters: { domainHub: adapter }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.equal(result.rollback, undefined);
  assert.equal(typeof coordinator.rollbackResult, 'function');
});

test('registered adapters do not expose a result rollback without a targetable backend contract', () => {
  const api = {
    strategy: { rollback() {} },
    dns: { rollback() {} }
  };

  assert.equal(appView.createDnsAdapter(api).rollbackResult, undefined);
  assert.equal(appView.createStrategyAdapter(api).rollbackResult, undefined);
  assert.doesNotMatch(app, /Api\.strategy\.rollbackManager\(/);
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

test('supported proxy remains visible while legacy lists and service-dns scopes stay explicitly blocked', () => {
  const diff = appView.renderSemanticDiff({
    lists: { changes: { domainInclude: { before: [], after: ['example.com'] } } },
    proxy: { changes: { enabled: { before: false, after: true } } },
    'service-dns': { changes: { alpha: { before: '', after: 'cloudflare' } } }
  }, {});
  assert.match(diff.textContent, /Unsupported scope: lists/);
  assert.doesNotMatch(diff.textContent, /Unsupported scope: proxy/);
  assert.match(diff.textContent, /Telegram Proxy/);
  assert.match(diff.textContent, /DNS сервисов/);
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
  assert.match(diff.textContent, /Точечные правила применяются своим backend-адаптером/);
});

test('proxy links remain masked in the semantic diff', () => {
  const diff = appView.renderSemanticDiff({
    proxy: { changes: { link: { before: 'tg://proxy?secret=old', after: 'tg://proxy?secret=new' } } }
  }, {});
  assert.doesNotMatch(diff.textContent, /tg:\/\/proxy|secret=old|secret=new/);
  assert.match(diff.textContent, /••••••/);
});
