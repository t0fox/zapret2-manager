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

test('global apply bar has exactly three actions and a disabled reason', () => {
  const shell = evaluateLuciModule(`${root}/z2m-shell.js`, { E, _: (value) => value });
  const bar = shell.renderApplyBar({ hasDraft: () => true }, { enabled: false, reason: 'Стратегия: недоступно' });
  const ids = [];
  (function walk(node) {
    if (node.attrs?.id) ids.push(node.attrs.id);
    for (const child of node.children || []) if (child?.attrs) walk(child);
  })(bar);
  assert.deepEqual(ids.filter((id) => ['z2m-discard-drafts', 'z2m-preview-drafts', 'z2m-apply-drafts'].includes(id)), [
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
