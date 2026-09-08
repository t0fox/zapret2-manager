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
  click() { this.dispatch('click'); }
  focus() { this.focused = true; }
  querySelector(selector) {
    const match = selector.match(/^\[name="([^"]+)"\]$/);
    return match ? this.find((node) => node.getAttribute('name') === match[1]) : null;
  }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) if (child instanceof Node) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
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
  const source = fs.readFileSync(viewPath, 'utf8')
    .replace('return baseclass.extend(', 'globalThis.__module = baseclass.extend(');
  const context = {
    Object, Array, Number, String, Boolean, Math, Date, JSON, URL, Promise, isFinite, console,
    _: (value) => value,
    E,
    baseclass: { extend: (value) => value },
    Icons: { wrappedNode: (name, options) => E('span', { 'data-icon': name, class: options.wrapperClass }) },
    window: { setTimeout },
    sessionStorage: { getItem: () => '[]', setItem: () => {} },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'z2m-scanner.js' });
  return context.__module;
}

function buildHarness(scanner) {
  const container = new Node('main');
  let currentRoot = null;
  const ctx = {
    root: container,
    api: {},
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

function input(harness, name) {
  return harness.container.querySelector(`[name="${name}"]`);
}

function startButton(harness) {
  return harness.root.find((node) => node.tagName === 'BUTTON' && node.textContent === 'Начать сканирование');
}

test('invalid domain focuses the new invalid control after rerender', async () => {
  const scanner = loadScanner();
  const harness = buildHarness(scanner);
  const domain = input(harness, 'detect-domain');
  domain.value = 'not a host';
  domain.dispatch('input');
  startButton(harness).click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rerenderedDomain = input(harness, 'detect-domain');
  assert.notEqual(rerenderedDomain, domain);
  assert.equal(rerenderedDomain.focused, true);
  assert.equal(rerenderedDomain.getAttribute('aria-invalid'), 'true');
  scanner.unmount();
});

test('invalid numeric input focuses the new invalid control after rerender', async () => {
  const scanner = loadScanner();
  const harness = buildHarness(scanner);
  const operation = harness.root.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-operation') === 'classify');
  operation.click();
  const port = input(harness, 'detect-port');
  port.value = '0';
  port.dispatch('input');
  startButton(harness).click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rerenderedPort = input(harness, 'detect-port');
  assert.notEqual(rerenderedPort, port);
  assert.equal(rerenderedPort.focused, true);
  assert.equal(rerenderedPort.getAttribute('aria-invalid'), 'true');
  scanner.unmount();
});

test('typed verdict presentation keeps successful probes green', () => {
  const scanner = loadScanner();
  const harness = buildHarness(scanner);
  const root = scanner.render(harness.ctx, {
    status: { status: 'completed', operation: 'probe' },
    report: { typedDetect: true, operation: 'probe', data: { verdict: 'detected', reason: 'ok' } }
  });
  const card = root.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-card'));
  const kicker = root.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-kicker'));

  assert.match(card.getAttribute('class'), /is-success/);
  assert.equal(kicker.find((node) => node.getAttribute('data-icon'))?.getAttribute('data-icon'), 'circle-check');
  assert.match(kicker.textContent, /Проверка завершена/);
  scanner.unmount();
});

test('typed no-call and negative verdicts are semantic and actionable', () => {
  const scanner = loadScanner();
  const harness = buildHarness(scanner);
  const noCall = scanner.render(harness.ctx, {
    status: { status: 'completed', operation: 'voice' },
    report: { typedDetect: true, operation: 'voice', data: { verdict: 'no_call', reason: 'no active call' } }
  });
  const warningCard = noCall.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-card'));
  const warningKicker = noCall.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-kicker'));
  const warningReason = noCall.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-reason'));

  assert.match(warningCard.getAttribute('class'), /is-warning/);
  assert.doesNotMatch(warningCard.getAttribute('class'), /is-success/);
  assert.equal(warningKicker.find((node) => node.getAttribute('data-icon'))?.getAttribute('data-icon'), 'warning');
  assert.match(warningKicker.textContent, /звонок не обнаружен/i);
  assert.equal(warningReason.textContent, 'Подключитесь к голосовому каналу Discord и повторите проверку.');

  const negative = scanner.render(harness.ctx, {
    status: { status: 'completed', operation: 'probe' },
    report: { typedDetect: true, operation: 'probe', data: { verdict: 'negative', reason: 'blocked' } }
  });
  const errorCard = negative.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-card'));
  const errorKicker = negative.find((node) => (node.getAttribute('class') || '').includes('z2m-scanner-best-kicker'));

  assert.match(errorCard.getAttribute('class'), /is-error/);
  assert.doesNotMatch(errorCard.getAttribute('class'), /is-success/);
  assert.equal(errorKicker.find((node) => node.getAttribute('data-icon'))?.getAttribute('data-icon'), 'circle-alert');
  assert.match(errorKicker.textContent, /Проверка не пройдена/);
  scanner.unmount();
});
