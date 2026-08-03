// Single-view render harness. Executes every internal tab render() against a
// minimal DOM and both healthy and unavailable envelopes. Compatibility route
// files are redirects and are intentionally not treated as render owners.

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const MODULES = [
  'z2m-overview.js', 'z2m-strategy-page.js', 'z2m-services.js', 'z2m-lists.js',
  'z2m-dns.js', 'z2m-proxy.js', 'z2m-monitor.js', 'z2m-maintenance.js'
];

function makeNode(tag = 'div', attrs = {}, children = []) {
  const classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
  const node = {
    tag, tagName: String(tag).toUpperCase(), nodeType: 1, attrs: { ...attrs }, children: [],
    style: {}, parentNode: null, value: attrs.value ?? '', checked: attrs.checked != null,
    hidden: attrs.hidden === true, disabled: attrs.disabled != null, _text: '',
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : !!force;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
      contains(name) { return classes.has(name); }
    },
    appendChild(child) {
      if (child == null) return child;
      if (typeof child === 'string' || typeof child === 'number') child = makeText(String(child));
      child.parentNode = node; node.children.push(child); return child;
    },
    removeChild(child) {
      const index = node.children.indexOf(child);
      if (index >= 0) node.children.splice(index, 1);
      child.parentNode = null; return child;
    },
    replaceChildren(...next) {
      node.children.forEach((child) => { if (child && typeof child === 'object') child.parentNode = null; });
      node.children = [];
      next.flat().forEach((child) => node.appendChild(child));
    },
    insertBefore(child, before) {
      if (child == null) return child;
      child.parentNode = node;
      const index = before ? node.children.indexOf(before) : -1;
      if (index < 0) node.children.push(child); else node.children.splice(index, 0, child);
      return child;
    },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, scrollIntoView() {},
    setAttribute(key, value) { node.attrs[key] = value; if (key === 'value') node.value = value; },
    getAttribute(key) { return node.attrs[key]; },
    querySelector(selector) { return find(node, selector, true); },
    querySelectorAll(selector) { return find(node, selector, false); },
    getContext() { return { fillRect() {}, clearRect() {}, drawImage() {}, putImageData() {} }; },
    toDataURL() { return 'data:image/png;base64,'; }
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text || node.children.map((child) => child.textContent || '').join(''); },
    set(value) { node._text = String(value ?? ''); node.children = []; }
  });
  Object.defineProperty(node, 'firstChild', { get() { return node.children[0] || null; } });
  Object.defineProperty(node, 'className', {
    get() { return [...classes].join(' '); },
    set(value) { classes.clear(); String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); }
  });
  const initial = Array.isArray(children) ? children : [children];
  initial.forEach((child) => node.appendChild(child));
  return node;
}
function makeText(text) {
  return { nodeType: 3, textContent: text, parentNode: null };
}
function matches(node, selector) {
  if (!node || node.nodeType !== 1) return false;
  if (selector.startsWith('#')) return node.attrs.id === selector.slice(1);
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  const dataTab = selector.match(/^button\[data-tab(?:=['"]?([^'"\]]+)['"]?)?\]$/);
  if (dataTab) return node.tag === 'button' && node.attrs['data-tab'] != null && (!dataTab[1] || node.attrs['data-tab'] === dataTab[1]);
  return node.tag === selector.toLowerCase();
}
function find(rootNode, selector, first) {
  const found = [];
  function visit(node) {
    for (const child of node.children || []) {
      if (matches(child, selector)) { found.push(child); if (first) return true; }
      if (child && child.children && visit(child) && first) return true;
    }
    return false;
  }
  visit(rootNode);
  return first ? found[0] || null : found;
}
function E(tag, attrs, children) {
  if (attrs == null || Array.isArray(attrs) || typeof attrs !== 'object' || attrs.nodeType) {
    children = attrs; attrs = {};
  }
  return makeNode(tag, attrs, children === undefined ? [] : children);
}

const documentStub = {
  head: makeNode('head'), body: makeNode('body'),
  createElement: (tag) => makeNode(tag), createTextNode: makeText,
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  execCommand: () => true
};
const windowStub = {
  location: { hash: '', hostname: 'router.test', replace() {}, reload() {} },
  isSecureContext: false, addEventListener() {}, removeEventListener() {},
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
};
const overrides = {
  E, document: documentStub, window: windowStub,
  L: { view: { extend: (value) => value }, resource: (value) => value, url: (...parts) => '/' + parts.join('/') },
  rpc: { declare: (spec) => Object.assign(() => Promise.resolve({}), { spec }) }
};
const cache = new Map();
const shell = evaluateLuciModule(`${root}/z2m-shell.js`, overrides, cache);

function apiTree() {
  const callable = () => Promise.resolve({});
  const group = new Proxy({}, { get: () => callable });
  return {
    normalizeError(error) { return { code: error?.code || 'EUNAVAILABLE', message: error?.message || String(error || 'Unavailable') }; },
    service: group, strategy: group, orchestra: group, profiles: group, services: group,
    lists: group, dns: group, proxy: group, maintenance: group, monitor: group
  };
}
function store() {
  let state = { draft: {}, pending: {}, ui: { tab: 'overview', advanced: true } };
  return {
    get: () => state,
    update(patch) { state = { ...state, ...(patch || {}) }; return state; },
    setDraft(scope, value) { state.draft = { ...state.draft, [scope]: value }; },
    clearDraft(scope) { const next = { ...state.draft }; delete next[scope]; state.draft = next; },
    hasDraft: () => Object.keys(state.draft).length > 0
  };
}

const healthyData = {
  'z2m-overview.js': {
    status: { value: { serviceState: 'running', runtime: { process: { found: true } } } },
    preview: { value: { comboCatalog: { candidates: [] }, strategyState: {}, overrides: { rules: [] } } },
    history: { value: { runs: [] } }, orchestra: { value: {} }, serviceDns: { value: {} }
  },
  'z2m-strategy-page.js': {
    strategy: {
      status: { value: { serviceState: 'running' } },
      preview: { value: { comboCatalog: { candidates: [] }, strategyState: {}, overrides: { rules: [] } } },
      history: { value: { runs: [] } }, ratings: { value: {} }, capabilities: { value: {} },
      profiles: { value: { draft: { profiles: [] }, profiles: [] } }, preflight: { value: { ok: true } }
    },
    auto: { value: { ok: true, enabled: false, phase: 'disabled', revision: 1, serviceIds: [], capabilities: {} } }
  },
  'z2m-services.js': {
    catalog: { value: { services: [] } }, status: { value: {} }, health: { value: {} },
    serviceDns: { value: {} }, providers: { value: { providers: [] } }
  },
  'z2m-lists.js': { lists: { value: { lists: {}, conflicts: [] } } },
  'z2m-dns.js': {
    config: { value: {} }, components: { value: {} }, providers: { value: { providers: [] } },
    serviceProviders: { value: { providers: [] } }, serviceStatus: { value: {} }
  },
  'z2m-proxy.js': {
    capabilities: { value: {} }, status: { value: { running: false } }, config: { value: {} },
    link: { value: {} }, health: { value: {} }, logs: { value: { lines: [] } }
  },
  'z2m-monitor.js': { status: { value: {} }, orchestra: { value: {} }, events: { value: { events: [] } } },
  'z2m-maintenance.js': {
    status: { value: {} }, versions: { value: {} }, backups: { value: { backups: [] } }
  }
};

function context(data) {
  const state = store();
  return {
    api: apiTree(), shell, store: state, data, root: makeNode('main'), initial: {},
    navigate() {}, refresh() { return Promise.resolve(); },
    setDraft(scope, value) { state.setDraft(scope, value); },
    clearDraft(scope) { state.clearDraft(scope); }, setConfirmation() { return false; }
  };
}
function assertTree(node, name) {
  assert.ok(node && node.nodeType === 1, `${name}: render did not return an element`);
  assert.ok((node.children || []).length > 0, `${name}: rendered root is empty`);
}

test('single-view render harness: every internal tab renders healthy data', () => {
  for (const file of MODULES) {
    const mod = evaluateLuciModule(`${root}/${file}`, overrides, cache);
    assert.equal(typeof mod.render, 'function', `${file}: render missing`);
    assertTree(mod.render(context(healthyData[file])), file);
  }
});

test('single-view render harness: every internal tab survives unavailable envelopes', () => {
  for (const file of MODULES) {
    const mod = evaluateLuciModule(`${root}/${file}`, overrides, cache);
    const unavailable = Object.fromEntries(Object.keys(healthyData[file]).map((key) => [key, { error: { code: 'EUNAVAILABLE', message: 'Unavailable' } }]));
    assertTree(mod.render(context(unavailable)), file);
  }
});

test('compatibility redirects are excluded from render ownership', () => {
  const redirects = ['orchestra-strategy.js','orchestra.js','strategies.js','lists.js','dns.js','service-dns.js','proxy.js','monitor.js','maintenance.js'];
  for (const file of redirects) {
    const mod = evaluateLuciModule(`${root}/${file}`, overrides, cache);
    assert.equal(typeof mod.render, 'function');
    assert.match(String(mod.render), /location\.replace/);
  }
});
