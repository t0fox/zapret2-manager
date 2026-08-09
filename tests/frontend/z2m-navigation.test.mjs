import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const appPath = new URL('../../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js', import.meta.url);

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.children = Array.isArray(children) ? children : [children];
    this.className = this.attrs.class || '';
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return []; }
  setAttribute(name, value) { this.attrs[name] = value; }
  classList = { add() {}, remove() {}, toggle() {} };
}

function E(tag, attrs, children) { return new Node(tag, attrs, children); }

function page(id, title) {
  return { id, title, load: () => Promise.resolve({}), render: () => E('section', {}, title) };
}

async function loadApp(hash = '#/overview') {
  const source = await readFile(appPath, 'utf8');
  const window = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {}
  };
  const modules = {
    Overview: page('overview', 'Обзор'),
    Dns: page('dns', 'DNS'),
    Proxy: page('proxy', 'Telegram Proxy'),
    Monitoring: page('monitoring', 'Мониторинг'),
    Maintenance: page('maintenance', 'Обслуживание')
  };
  const context = vm.createContext({
    view: { extend: value => value },
    Api: { capabilities: () => ({}), service: { status: () => Promise.resolve({}) } },
    State: { createStore: initial => ({ get: () => initial, update() {}, subscribe: () => () => {} }) },
    UI: { injectCss() {}, skeleton: () => E('div', {}, 'loading'), toastCenter: () => E('aside'), operationCenter: () => E('aside') },
    Placeholder: { create: (id, title) => Object.assign(page(id, title), { contractRequired: true }) },
    ...modules,
    E,
    _: value => value,
    window,
    document: { hidden: false },
    Promise,
    console
  });
  const app = new vm.Script(`(function () { ${source}\n})()`, { filename: appPath.pathname }).runInContext(context);
  return app;
}

test('exports the approved task-oriented navigation in exact order', async () => {
  const app = await loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(app.navigation.map(item => item.id))), [
    'overview', 'strategies', 'selection', 'diagnostics', 'lists',
    'routing', 'masque', 'dns', 'proxy', 'monitoring', 'maintenance'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.navigation.map(item => item.group))), [
    'ОБЗОР', 'ОБХОД DPI', 'ОБХОД DPI', 'ОБХОД DPI', 'ДАННЫЕ',
    'МАРШРУТИЗАЦИЯ', 'WARP / MASQUE', 'DNS', 'TELEGRAM PROXY', 'МОНИТОРИНГ', 'ОБСЛУЖИВАНИЕ'
  ]);
});

test('does not expose excluded backend or desktop product names', async () => {
  const app = await loadApp();
  const labels = app.navigation.map(item => `${item.group} ${item.title}`).join(' ');
  for (const excluded of ['orchestra', 'AmneziaWG', 'sing-box', 'mihomo', 'Opera Proxy', 'WARP-in-WARP']) {
    assert.doesNotMatch(labels, new RegExp(excluded, 'i'));
  }
});

test('normalizes unknown hashes to overview', async () => {
  const app = await loadApp('#/not-a-page');
  assert.equal(app.pageFromHash(), 'overview');
});

test('future pages describe required contracts without rendering fake controls', async () => {
  const app = await loadApp();
  for (const id of ['strategies', 'selection', 'diagnostics', 'lists', 'routing', 'masque']) {
    const module = app.pages[id];
    assert.equal(module.contractRequired, true, id);
    const rendered = module.render({});
    assert.equal(rendered.tag, 'section');
  }
});
