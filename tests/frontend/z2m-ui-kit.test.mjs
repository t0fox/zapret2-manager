import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui-kit.js', import.meta.url);
const cssPath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-terminal.css', import.meta.url);

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.children = Array.isArray(children) ? children : [children];
    this.disabled = !!this.attrs.disabled;
    this.className = this.attrs.class || '';
    this.removed = false;
  }
  querySelectorAll(tag) {
    const found = [];
    if (this.tag === tag) found.push(this);
    this.children.forEach(child => {
      if (child instanceof Node) found.push(...child.querySelectorAll(tag));
    });
    return found;
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  remove() { this.removed = true; }
}

function E(tag, attrs, children) { return new Node(tag, attrs, children); }
function text(node) {
  if (node === null || node === undefined) return '';
  if (!(node instanceof Node)) return String(node);
  return node.children.map(text).join(' ');
}

async function loadModule() {
  const source = await readFile(modulePath, 'utf8');
  const context = vm.createContext({
    baseclass: { extend: value => value },
    _: value => value,
    E,
    document: { head: new Node('head'), getElementById: () => null, createElement: tag => new Node(tag) },
    window: {},
    setTimeout,
    clearTimeout,
    console
  });
  return new vm.Script(`(function () { ${source}\n})()`, { filename: modulePath.pathname }).runInContext(context);
}

test('badge maps backend states to semantic visual kinds', async () => {
  const UI = await loadModule();
  assert.match(UI.badge('running', 'Работает').className, /is-ok/);
  assert.match(UI.badge('degraded', 'Проблемы').className, /is-warn/);
  assert.match(UI.badge('failed', 'Ошибка').className, /is-error/);
  assert.match(UI.badge('stopped', 'Остановлен').className, /is-muted/);
});

test('errorPanel renders actionable structured error without exposing secret details', async () => {
  const UI = await loadModule();
  const panel = UI.errorPanel({
    code: 'EAUTH',
    message: 'Не удалось подключиться',
    action: 'Проверьте конфигурацию.',
    details: { token: 'secret-value', port: 443 }
  });
  const rendered = text(panel);

  assert.match(rendered, /Не удалось подключиться/);
  assert.match(rendered, /EAUTH/);
  assert.match(rendered, /Проверьте конфигурацию/);
  assert.match(rendered, /443/);
  assert.doesNotMatch(rendered, /secret-value/);
});

test('danger modal provides explicit cancel and confirm controls', async () => {
  const UI = await loadModule();
  const modal = UI.modal({ title: 'Удалить стратегию', danger: true, confirmLabel: 'Удалить' });
  const buttons = modal.querySelectorAll('button');

  assert.equal(buttons.length, 2);
  assert.match(text(modal), /Отмена/);
  assert.match(text(modal), /Удалить/);
  assert.match(buttons[1].className, /is-danger/);
});

test('modal closes itself after cancel or successful confirmation', async () => {
  const UI = await loadModule();
  const cancelled = UI.modal({ title: 'Удалить' });
  await cancelled.querySelectorAll('button')[0].attrs.click();
  assert.equal(cancelled.removed, true);

  const confirmed = UI.modal({ title: 'Удалить', onConfirm: () => Promise.resolve('ok') });
  await confirmed.querySelectorAll('button')[1].attrs.click();
  assert.equal(confirmed.removed, true);
});

test('operationCenter displays real phase and events without invented percentage', async () => {
  const UI = await loadModule();
  const center = UI.operationCenter([{
    operationId: 'run-1',
    title: 'Подбор стратегии',
    state: 'running',
    phase: 'probing',
    events: [{ message: 'Проверка youtube.com' }]
  }]);
  const rendered = text(center);

  assert.match(rendered, /Подбор стратегии/);
  assert.match(rendered, /probing/);
  assert.match(rendered, /Проверка youtube.com/);
  assert.doesNotMatch(rendered, /\d+%/);
});

test('setBusy disables controls and restores their label', async () => {
  const UI = await loadModule();
  const button = UI.button('Применить', { kind: 'primary' });
  UI.setBusy(button, true, 'Применение');
  assert.equal(button.disabled, true);
  assert.match(text(button), /Применение/);
  UI.setBusy(button, false);
  assert.equal(button.disabled, false);
  assert.match(text(button), /Применить/);
});

test('terminal CSS defines core components and reduced-motion behavior', async () => {
  const css = await readFile(cssPath, 'utf8');
  for (const selector of ['.z2m-app', '.z2m-sidebar', '.z2m-page', '.z2m-card', '.z2m-badge', '.z2m-skeleton', '.z2m-toast-center', '.z2m-operation-center', '.z2m-modal', '.z2m-terminal', '.z2m-refreshing']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  }
  assert.match(css, /JetBrains Mono/);
  assert.match(css, /Unbounded/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
