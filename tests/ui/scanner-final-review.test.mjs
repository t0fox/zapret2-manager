import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viewPath = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager', 'z2m-scanner.js');

class Node {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.focused = false;
    this._text = '';
    Object.entries(attrs).forEach(([name, value]) => {
      if (value !== null && value !== undefined) this.setAttribute(name, value);
    });
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
  }

  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) {
    if (child === null || child === undefined) return child;
    if (Array.isArray(child)) child.forEach((item) => this.appendChild(item));
    else this.children.push(child);
    return child;
  }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) if (child instanceof Node) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
  querySelector(selector) {
    const match = selector.match(/^\[name="([^"]+)"\]$/);
    return match ? this.find((node) => node.getAttribute('name') === match[1]) : null;
  }
  get textContent() { return this._text + this.children.map((child) => child instanceof Node ? child.textContent : String(child)).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
}

function E(tag, attrs, children) {
  const node = new Node(tag, attrs || {});
  node.appendChild(children);
  return node;
}

function loadScanner() {
  const schedule = (handler, delay) => {
    const timer = setTimeout(handler, delay);
    timer.unref?.();
    return timer;
  };
  const source = fs.readFileSync(viewPath, 'utf8')
    .replace('return baseclass.extend(', 'globalThis.__module = baseclass.extend(');
  const context = {
    Object, Array, Number, String, Boolean, Math, Date, JSON, URL, Promise, isFinite, console,
    _: (value) => value, E,
    baseclass: { extend: (value) => value },
    Icons: { wrappedNode: () => E('span') },
    window: { setTimeout: schedule },
    sessionStorage: { getItem: () => '[]', setItem: () => {} },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'z2m-scanner.js' });
  return context.__module;
}

function buildHarness(scanner, calls) {
  const container = new Node('main');
  let currentRoot = null;
  const ctx = {
    root: container,
    api: {
      z2kDetectStatus: () => Promise.resolve({ ok: true, coherent: true }),
      z2kDetectClassify: (...args) => {
        calls.push(args);
        return Promise.resolve({ ok: true, data: { stdout: '{"verdict":"clear"}' } });
      }
    },
    refresh: () => {
      currentRoot = scanner.render(ctx, { status: { status: 'ready' }, report: null });
      container.replaceChildren(currentRoot);
      return Promise.resolve();
    },
    shell: {
      button(label, className, handler) {
        const button = E('button', { type: 'button', class: className }, label);
        button.addEventListener('click', handler);
        return button;
      },
      statePanel: () => E('div', {}, 'state')
    }
  };
  currentRoot = scanner.render(ctx, { status: { status: 'ready' }, report: null });
  container.replaceChildren(currentRoot);
  return { ctx, container, get root() { return currentRoot; } };
}

function selectOperation(harness, operation) {
  harness.root.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-operation') === operation).dispatch('click');
}

async function submitClassifyHost(host) {
  const scanner = loadScanner();
  const calls = [];
  const harness = buildHarness(scanner, calls);
  scanner.mount(harness.ctx);
  selectOperation(harness, 'classify');
  const hostInput = harness.container.querySelector('[name="detect-host"]');
  hostInput.value = host;
  hostInput.dispatch('input');
  harness.root.find((node) => node.tagName === 'BUTTON' && node.textContent === 'Начать сканирование').dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const currentHost = harness.container.querySelector('[name="detect-host"]');
  scanner.unmount();
  return { calls, hostInput: currentHost };
}

test('classify renders the native hello enum and preserves its both default', () => {
  const scanner = loadScanner();
  const calls = [];
  const harness = buildHarness(scanner, calls);
  selectOperation(harness, 'classify');

  const hello = harness.container.querySelector('[name="detect-hello"]');
  assert.deepEqual(hello.children.map((option) => option.getAttribute('value')), ['modern', 'legacy', 'both']);
  assert.equal(scanner.detectDefaults('classify').hello, 'both');
});

test('classify accepts valid IPv4, IPv6, and single-label DNS hosts through UI validation', async () => {
  for (const host of ['192.0.2.1', '2001:db8::1', 'router']) {
    const result = await submitClassifyHost(host);
    assert.equal(result.hostInput.getAttribute('aria-invalid'), 'false', host);
    assert.equal(result.calls[0][0], host, host);
  }
});

test('classify still rejects invalid host input through UI validation', async () => {
  const result = await submitClassifyHost('not a host');
  assert.equal(result.hostInput.getAttribute('aria-invalid'), 'true');
  assert.equal(result.calls.length, 0);
});

test('classify rejects malformed dotted-numeric IPv4 hosts instead of treating them as DNS', async () => {
  for (const host of ['999.999.999.999', '256.0.0.1']) {
    const result = await submitClassifyHost(host);
    assert.equal(result.hostInput.getAttribute('aria-invalid'), 'true', host);
    assert.equal(result.calls.length, 0, host);
  }
});
