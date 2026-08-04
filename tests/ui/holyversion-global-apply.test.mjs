import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const appSource = fs.readFileSync(`${root}/app.js`, 'utf8');
const draftSource = fs.readFileSync(`${root}/z2m-draft-model.js`, 'utf8');

function node(tag, attrs = {}, children = []) {
  return {
    tag, attrs, children: Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean),
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...next) { this.children = next.filter(Boolean); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute() {}
  };
}
function E(tag, attrs, children) { return node(tag, attrs || {}, children); }

const app = evaluateLuciModule(`${root}/app.js`, {
  E,
  _: (value) => value,
  L: { view: { extend: (value) => value }, resource: (value) => value },
  document: { head: node('head'), getElementById: () => null, createElement: (tag) => node(tag) },
  window: { location: { hash: '', hostname: 'test' }, addEventListener() {}, removeEventListener() {} }
}, new Map());
const storeModule = evaluateLuciModule(`${root}/z2m-store.js`);

function draft(scope, revision = 1) {
  return {
    [scope]: {
      expectedRevision: revision,
      applicable: true,
      changes: { value: { label: scope, before: 0, after: 1 } }
    }
  };
}
function merge(...values) { return Object.assign({}, ...values); }
function shell() { return { showToast() {} }; }
function api() {
  return {
    normalizeError(error) {
      const value = error?.error && typeof error.error === 'object' ? error.error : error;
      return { code: value?.code || 'E_TEST', message: value?.message || String(value || 'error') };
    }
  };
}
function adapter(scope, calls, options = {}) {
  return {
    supported: true,
    reloadAppliedState() {
      calls.push(`reload:${scope}`);
      return Promise.resolve({ value: { revision: 1, value: options.after ?? 0 }, revision: 1 });
    },
    validateDraft() {
      calls.push(`validate:${scope}`);
      return Promise.resolve({ ok: true });
    },
    previewDraft() {
      calls.push(`preview:${scope}`);
      return Promise.resolve({ ok: true, precondition: { revision: 1 } });
    },
    applyDraft() {
      calls.push(`apply:${scope}`);
      if (options.failApply) return Promise.reject({ code: 'E_APPLY', message: `${scope} failed` });
      return Promise.resolve({ ok: true, verified: true });
    },
    verifyApplied() {
      calls.push(`verify:${scope}`);
      return options.verify !== false;
    },
    resetDraft() { calls.push(`reset:${scope}`); }
  };
}

test('global coordinator declares the canonical four-scope apply order', () => {
  assert.match(appSource, /APPLY_SCOPE_ORDER\s*=\s*\['strategy','domainHub','dns','proxy'\]/);
  assert.match(appSource, /domainHub:\s*Services\.createAdapter/);
  assert.match(appSource, /proxy:\s*Proxy\.createAdapter/);
  assert.match(draftSource, /'domainHub'/);
});

test('all reload validate and preview calls finish before first mutation', async () => {
  const calls = [];
  const scopes = ['proxy', 'dns', 'domainHub', 'strategy'];
  const drafts = scopes.reduce((result, scope) => merge(result, draft(scope)), {});
  const store = storeModule.create({ draft: drafts, applied: {} });
  const adapters = Object.fromEntries(scopes.map((scope) => [scope, adapter(scope, calls)]));
  const coordinator = app.createCoordinator({ api: api(), store, shell: shell(), adapters });

  await coordinator.applyDrafts(store.snapshotDraft());

  const firstApply = calls.findIndex((value) => value.startsWith('apply:'));
  const lastPreview = Math.max(...calls.map((value, index) => value.startsWith('preview:') ? index : -1));
  assert.ok(firstApply > lastPreview);
  assert.deepEqual(calls.filter((value) => value.startsWith('apply:')), [
    'apply:strategy', 'apply:domainHub', 'apply:dns', 'apply:proxy'
  ]);
});

test('partial failure clears only verified successes and retains exact failure', async () => {
  const calls = [];
  const drafts = merge(draft('domainHub'), draft('dns'));
  const store = storeModule.create({ draft: drafts, applied: {} });
  const coordinator = app.createCoordinator({
    api: api(), store, shell: shell(),
    adapters: {
      domainHub: adapter('domainHub', calls),
      dns: adapter('dns', calls, { failApply: true })
    }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.deepEqual(result.clearedScopes, ['domainHub']);
  assert.deepEqual(result.failedScopes, ['dns']);
  assert.equal(store.get().draft.domainHub, undefined);
  assert.ok(store.get().draft.dns);
  assert.equal(result.errors[0].code, 'E_APPLY');
  assert.match(result.errors[0].message, /dns failed/);
});

test('unsupported scope blocks every mutation', async () => {
  const calls = [];
  const drafts = merge(draft('domainHub'), draft('unknown'));
  const store = storeModule.create({ draft: drafts, applied: {} });
  const coordinator = app.createCoordinator({
    api: api(), store, shell: shell(),
    adapters: { domainHub: adapter('domainHub', calls) }
  });

  const result = await coordinator.applyDrafts(store.snapshotDraft());

  assert.equal(calls.some((value) => value.startsWith('apply:')), false);
  assert.deepEqual(result.failedScopes.sort(), ['domainHub', 'unknown']);
  assert.ok(store.get().draft.domainHub);
  assert.ok(store.get().draft.unknown);
});

test('manual rollback is available only from explicit backend proof', () => {
  assert.match(appSource, /rollback\.available\s*===\s*true|available:\s*true/);
  assert.doesNotMatch(appSource, /countdown|rollback_ttl|confirmationTimer/);
});
