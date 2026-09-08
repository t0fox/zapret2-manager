import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VIEW = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const scannerSource = fs.readFileSync(path.join(VIEW, 'z2m-scanner.js'), 'utf8');
const productSource = fs.readFileSync(path.join(VIEW, 'z2m-scanner-product.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function unrefSetTimeout(callback, delay) {
  const timer = setTimeout(callback, delay);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

function node(tag, attrs, children) {
  if (typeof attrs === 'string' || Array.isArray(attrs)) {
    children = attrs;
    attrs = {};
  }
  const listeners = {};
  return {
    tag,
    attrs: attrs || {},
    children: Array.isArray(children) ? children.filter(Boolean) : children == null ? [] : [children],
    value: attrs && attrs.value != null ? attrs.value : '',
    addEventListener(type, callback) { listeners[type] = callback; },
    appendChild(child) { if (child != null) this.children.push(child); },
    replaceChildren(...values) { this.children = values.filter(Boolean); },
    listeners
  };
}

function findNode(value, predicate) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value) && predicate(value)) return value;
  const children = Array.isArray(value) ? value : value.children;
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function makeStorage() {
  return { getItem: () => '[]', setItem() {}, removeItem() {} };
}

function makeScenario() {
  const probeGate = deferred();
  const calls = { probe: 0, rerender: 0, refresh: 0 };
  const api = {
    z2kDetectStatus: () => Promise.resolve({ ok: true, coherent: true, installed: { version: '2.0' }, service: { running: true } }),
    z2kDetectProbe: () => { calls.probe++; return probeGate.promise; },
    normalizeError: (error) => ({ message: String(error && error.message || error) })
  };
  let product;
  const ctx = {
    api,
    data: { status: { status: 'ready' } },
    routeParams: { tab: 'search' },
    refresh() { calls.refresh++; return Promise.resolve(); },
    rerender() { calls.rerender++; product.render(ctx); return Promise.resolve(); },
    shell: {
      button(label, className, callback) {
        const button = node('button', { label, className });
        button.callback = callback;
        return button;
      },
      statePanel() { return node('state-panel'); }
    }
  };
  const scanner = loadLuCIModule(scannerSource, 'view.zapret2-manager.z2m-scanner', {
    baseclass,
    'view.zapret2-manager.z2m-icons': { wrappedNode: () => node('icon') }
  }, {
    globals: { E: node, sessionStorage: makeStorage() },
    window: { setTimeout: unrefSetTimeout, clearTimeout: clearTimeout }
  });
  product = loadLuCIModule(productSource, 'view.zapret2-manager.z2m-scanner-product', {
    baseclass,
    'view.zapret2-manager.z2m-icons': { wrappedNode: () => node('icon') },
    'view.zapret2-manager.z2m-scanner': scanner
  }, {
    globals: { E: node, sessionStorage: makeStorage() },
    window: { setTimeout: unrefSetTimeout, clearTimeout: clearTimeout }
  });
  return { ctx, product, calls, probeGate };
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

test('Scanner product same-tab rerender preserves the child generation for typed Detect start', async () => {
  const { ctx, product, calls, probeGate } = makeScenario();
  const root = product.render(ctx);
  const start = findNode(root, (value) => value.tag === 'button' && value.attrs.label === 'Начать сканирование');
  assert.ok(start, 'product render must expose the Scanner start action');

  start.callback();
  await flush();

  assert.equal(calls.rerender, 1, 'starting a scan must trigger the parent same-route rerender');
  assert.equal(calls.probe, 1, 'same-tab rerender must not discard the typed probe invocation');

  ctx.routeParams = { tab: 'history' };
  product.render(ctx);
  probeGate.resolve({ ok: true, data: { stdout: '{"verdict":"clear"}' } });
  await flush();
  assert.equal(calls.refresh, 0, 'real tab change must unmount the old child and discard its completion');
  product.unmount();
});
