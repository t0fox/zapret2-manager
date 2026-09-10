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
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) this.setAttribute(name, value);
    }
  }

  setAttribute(name, value) {
    if (value === null || value === undefined) return;
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
  }

  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) {
    if (child === null || child === undefined) return child;
    if (Array.isArray(child)) { child.forEach((item) => this.appendChild(item)); return child; }
    this.children.push(child);
    return child;
  }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  click() { this.dispatch('click'); }
  focus() { this.focused = true; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get textContent() { return this._text + this.children.map((child) => child instanceof Node ? child.textContent : String(child)).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) if (child instanceof Node) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

function E(tag, attrs, children) {
  const node = new Node(tag, attrs);
  node.appendChild(children);
  return node;
}

function strictE(tag, attrs, children) {
  const node = new Node(tag, attrs);
  if (Array.isArray(children)) node.children.push(...children);
  else node.appendChild(children);
  return node;
}

function loadScanner({ strictChildren = false } = {}) {
  const source = fs.readFileSync(viewPath, 'utf8')
    .replace('return baseclass.extend(', 'globalThis.__module = baseclass.extend(');
  const translate = (value) => value;
  const context = {
    Object, Array, Number, String, Boolean, Math, Date, JSON, URL, Promise, isFinite, console,
    _: translate, E: strictChildren ? strictE : E, Node,
    baseclass: { extend: (value) => value },
    Icons: { wrappedNode: () => null },
    window: { setTimeout },
    sessionStorage: { getItem: () => '[]', setItem: () => {} },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'z2m-scanner.js' });
  return context.__module;
}

function context() {
  return {
    api: {},
    refresh: () => Promise.resolve(),
    shell: {
      button(label, className, handler) {
        const button = E('button', { type: 'button', class: className }, label);
        button.addEventListener('click', handler);
        return button;
      },
      statePanel: () => E('div', {}, 'state')
    }
  };
}

test('Scanner render flattens dynamic field nodes into the search form', () => {
  const scanner = loadScanner({ strictChildren: true });
  const rootNode = scanner.render(context(), { status: { status: 'ready' }, report: null });
  const search = rootNode.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-search-body'));

  assert.equal(search.children.some(Array.isArray), false);
  assert.equal(search.find((node) => node.tagName === 'INPUT' && node.getAttribute('name') === 'detect-domain')?.tagName, 'INPUT');
  assert.equal(search.find((node) => node.tagName === 'INPUT' && node.getAttribute('name') === 'detect-timeoutMs')?.tagName, 'INPUT');

  search.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-operation') === 'classify').click();
  const classifyRoot = scanner.render(context(), { status: { status: 'ready' }, report: null });
  const classifySearch = classifyRoot.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-search-body'));
  assert.equal(classifySearch.children.some(Array.isArray), false);
  assert.equal(classifySearch.find((node) => node.tagName === 'SELECT' && node.getAttribute('name') === 'detect-hello')?.tagName, 'SELECT');
  scanner.unmount();
});

test('invalid Scanner domain focuses the replacement control after rerender', async () => {
  const scanner = loadScanner();
  const ctx = context();
  const rootNode = scanner.render(ctx, { status: { status: 'ready' }, report: null });
  const domain = rootNode.find((node) => node.tagName === 'INPUT' && node.getAttribute('name') === 'detect-domain');
  const start = rootNode.find((node) => node.tagName === 'BUTTON' && node.textContent === 'Запустить измерение');

  domain.value = 'not a host';
  start.click();

  assert.equal(domain.getAttribute('aria-invalid'), 'true');
  assert.equal(domain.getAttribute('aria-describedby'), 'z2m-scanner-field-error');
  const error = rootNode.find((node) => node.getAttribute('id') === 'z2m-scanner-field-error');
  assert.equal(error, null, 'refresh owns rerendering; the live error must be present in the next render');
  const next = scanner.render(ctx, { status: { status: 'ready' }, report: null });
  const nextDomain = next.find((node) => node.tagName === 'INPUT' && node.getAttribute('name') === 'detect-domain');
  const nextError = next.find((node) => node.getAttribute('id') === 'z2m-scanner-field-error');
  assert.equal(nextError.textContent, 'Введите домен или ссылку на сайт.');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(nextDomain.focused, true, 'focus must land on the visible replacement control');
  scanner.unmount();
});

test('typed no-call result uses a non-success presentation', () => {
  const scanner = loadScanner();
  const result = scanner.render(context(), {
    status: { status: 'completed', operation: 'voice' },
    report: { typedDetect: true, operation: 'voice', data: { verdict: 'no_call', reason: 'Начните звонок.' } }
  });
  const card = result.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-card'));
  const kicker = result.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-kicker'));
  assert.match(card.getAttribute('class'), /is-warning/);
  assert.match(kicker.getAttribute('class'), /is-warning/);
  assert.match(kicker.textContent, /Звонок не обнаружен/);
  scanner.unmount();
});

test('Scanner progress and completed results expose one polite status region each', () => {
  const scanner = loadScanner();
  const ctx = context();
  const progress = scanner.render(ctx, { status: { status: 'running', phase: 'probing', operation: 'probe' }, report: null });
  const progressRegion = progress.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-progress-card'));
  assert.equal(progressRegion.getAttribute('role'), 'status');
  assert.equal(progressRegion.getAttribute('aria-live'), null);

  const result = scanner.render(ctx, {
    status: { status: 'completed', operation: 'probe' },
    report: { typedDetect: true, operation: 'probe', data: { verdict: 'detected', reason: 'ok' } }
  });
  const resultRegion = result.find((node) => node.getAttribute('id') === 'z2m-scanner-results');
  assert.equal(resultRegion.getAttribute('role'), 'status');
  assert.equal(resultRegion.getAttribute('aria-live'), null);
  scanner.unmount();
});
