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
    listeners: {},
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
    addEventListener(type, handler) { node.listeners[type] = handler; }, removeEventListener() {}, focus() {}, select() {}, scrollIntoView() {},
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
  const dataButton = selector.match(/^button\[data-([a-z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/i);
  if (dataButton) {
    const key = `data-${dataButton[1]}`;
    return node.tag === 'button' && node.attrs[key] != null && (!dataButton[2] || node.attrs[key] === dataButton[2]);
  }
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
    domainHub: group, lists: group, dns: group, proxy: group, maintenance: group, monitor: group
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
    status: { value: {
      serviceState: 'running',
      runtime: { process: { found: true }, connectivity: { verified: true } }
    } },
    preview: { value: {
      comboCatalog: { candidates: [{ candidateId: 'real-candidate', name: 'Backend candidate' }] },
      strategyState: {
        active: {
          candidateId: 'real-candidate', name: 'Backend candidate',
          description: 'Returned by backend', source: 'manual',
          appliedAt: '2026-08-04T09:00:00Z', revision: 12
        },
        rollback: { available: true, snapshotId: 'snap-11', label: 'rev11' }
      },
      overrides: { rules: [] }
    } },
    history: { value: { runs: [{
      runId: 'corpus-1', phase: 'completed', targetType: 'corpus',
      targetCount: 61, completedAt: '2026-08-04T09:30:00Z',
      selectedWinner: {
        successCount: 57, medianLatencyMs: 312,
        failedDomains: ['gog.com']
      }
    }] } },
    orchestra: { value: {} },
    serviceDns: { value: { activeCount: 9 } }
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
    hub: { value: {
      ok: true,
      revision: '8',
      precondition: { revision: '8', fileSha256: 'backend-file-sha', catalogDigest: 'catalog-digest-8' },
      catalog: {
        digest: 'catalog-digest-8', version: 'backend-catalog', enabled: ['alpha'],
        packages: [
          { id: 'alpha', name: 'Backend Alpha', category: 'video', domainCount: 2 },
          { id: 'beta', name: 'Backend Beta', category: 'video', domainCount: 1 }
        ],
        categories: ['video']
      },
      userDomains: { include: ['custom.example'], exclude: [], conflicts: [] },
      autohost: { entries: ['seen.example'], counts: { total: 1 }, writable: false },
      sources: {
        items: [{ id: 'ready-1', label: 'Backend ready hosts', revision: '8', updatedAt: '2026-08-04', status: 'valid' }],
        writable: false
      }
    } }
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

function context(data, hooks = {}) {
  const state = store();
  return {
    api: apiTree(), shell, store: state, data, root: makeNode('main'), initial: {},
    navigate() {}, refresh() { return Promise.resolve(); },
    setDraft(scope, value) { state.setDraft(scope, value); },
    clearDraft(scope) { state.clearDraft(scope); }, openSemanticDiff() { hooks.openSemanticDiff?.(); }
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


test('Overview follows the holyversion structure with backend fixture data', () => {
  const mod = evaluateLuciModule(`${root}/z2m-overview.js`, overrides, cache);
  const tree = mod.render(context(healthyData['z2m-overview.js']));
  for (const selector of [
    '.z2m-overview-head', '.z2m-overview-status', '.z2m-hero',
    '.z2m-hero-left', '.z2m-hero-right',
    '.z2m-overview-failures', '.z2m-advice'
  ]) assert.ok(tree.querySelector(selector), selector);
  assert.match(tree.textContent, /Backend candidate/);
  assert.match(tree.textContent, /57 \/ 61/);
  assert.match(tree.textContent, /312 мс/);
});

test('Overview unavailable state does not fabricate strategy or metrics', () => {
  const mod = evaluateLuciModule(`${root}/z2m-overview.js`, overrides, cache);
  const unavailable = {
    status: { error: { code: 'EUNAVAILABLE', message: 'status unavailable' } },
    preview: { error: { code: 'EUNAVAILABLE', message: 'preview unavailable' } },
    history: { error: { code: 'EUNAVAILABLE', message: 'history unavailable' } },
    orchestra: { error: { code: 'EUNAVAILABLE', message: 'orchestra unavailable' } },
    serviceDns: { error: { code: 'EUNAVAILABLE', message: 'dns unavailable' } }
  };
  const tree = mod.render(context(unavailable));
  assert.match(tree.textContent, /Состояние неизвестно/);
  assert.match(tree.textContent, /Состояние неизвестно|Стратегия неизвестна/i);
  assert.doesNotMatch(tree.textContent, /Flowseal ALT11|57 \/ 61|312 мс/);
});

test('Services render harness uses the canonical Domain Hub catalogue', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const ctx = context(healthyData['z2m-services.js']);
  const tree = mod.render(ctx);
  for (const selector of ['.z2m-service-toolbar', '.z2m-service-categories', '.z2m-service-category', '.z2m-service-row'])
    assert.ok(tree.querySelector(selector), selector);
  assert.match(tree.textContent, /Backend Alpha/);
  assert.match(tree.textContent, /1 из 2 включено/);
  assert.doesNotMatch(tree.textContent, /demo|Flowseal ALT11/i);

  const betaRow = tree.querySelectorAll('div').find((node) => /Backend Beta/.test(node.textContent) && node.querySelector('button'));
  const betaSwitch = betaRow && betaRow.querySelectorAll('button').find((node) => node.attrs.role === 'switch');
  assert.ok(betaSwitch && betaSwitch.listeners.click);
  betaSwitch.listeners.click({ type: 'click', preventDefault() {} });
  const draft = ctx.store.get().draft.services;
  assert.ok(draft);
  assert.equal(draft.expectedRevision, '8');
  assert.equal(draft.expectedCatalogDigest, 'catalog-digest-8');
  assert.deepEqual(draft.catalog.enabled, ['alpha', 'beta']);
});

test('Services renders backend reread as the applied Domain Hub baseline', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const data = structuredClone(healthyData['z2m-services.js']);
  data.hub.value.catalog.enabled = ['alpha', 'beta'];
  data.hub.value.revision = '9';
  data.hub.value.precondition.revision = '9';
  const tree = mod.render(context(data));
  assert.match(tree.textContent, /2 из 2 включено/);
  assert.doesNotMatch(tree.textContent, /будет включено|будет выключено/);
});

test('Services category switch uses one native click path', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const tree = mod.render(context(healthyData['z2m-services.js']));
  const categorySwitch = tree.querySelectorAll('button').find((node) => node.attrs.role === 'switch' && node.attrs['aria-label'] === 'Видео');
  assert.ok(categorySwitch);
  assert.equal(categorySwitch.attrs['data-state'], 'mixed');
  categorySwitch.listeners.click({ type: 'click', detail: 1, preventDefault() {} });
  assert.equal(categorySwitch.attrs['data-state'], 'on');
  categorySwitch.listeners.click({ type: 'click', detail: 1, preventDefault() {} });
  assert.equal(categorySwitch.attrs['data-state'], 'off');
});

test('Services fails closed when the Domain Hub envelope is unavailable', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const ctx = context({ hub: { error: { code: 'EUNAVAILABLE', message: 'Domain Hub unavailable' } } });
  const tree = mod.render(ctx);
  assert.match(tree.textContent, /Domain hub недоступен/i);
  assert.match(tree.textContent, /Domain Hub unavailable/);
  assert.equal(tree.querySelectorAll('button').some((node) => node.attrs.role === 'switch'), false);
  assert.equal(ctx.store.get().draft.services, undefined);
});

test('Services canonical subtabs update class and aria-selected state', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const tree = mod.render(context(healthyData['z2m-services.js']));
  const tab = (id) => tree.querySelectorAll('button').find((node) => node.attrs['data-pane'] === id);
  assert.ok(tab('catalog') && tab('domains') && tab('autohost') && tab('sources'));
  assert.equal(tab('catalog').classList.contains('on'), true);
  assert.equal(tab('catalog').attrs['aria-selected'], 'true');
  tab('sources').listeners.click({ type: 'click', preventDefault() {} });
  assert.equal(tab('sources').classList.contains('on'), true);
  assert.equal(tab('sources').attrs['aria-selected'], 'true');
  assert.equal(tab('catalog').classList.contains('on'), false);
  assert.match(tree.textContent, /Backend ready hosts/);
});

test('compatibility redirects are excluded from render ownership', () => {
  const redirects = ['orchestra-strategy.js','orchestra.js','strategies.js','lists.js','dns.js','service-dns.js','proxy.js','monitor.js','maintenance.js'];
  for (const file of redirects) {
    const mod = evaluateLuciModule(`${root}/${file}`, overrides, cache);
    assert.equal(typeof mod.load, 'function');
    assert.equal(typeof mod.render, 'function');
    assert.match(String(mod.load), /location\.replace/);
  }
});

test('render harness exposes the coordinator bar without confirmation controls', () => {
  const bar = shell.renderApplyBar({ hasDraft: () => true }, { enabled: false, reason: 'unsupported' });
  assert.ok(bar.querySelector('#z2m-discard-drafts'));
  assert.ok(bar.querySelector('#z2m-preview-drafts'));
  assert.ok(bar.querySelector('#z2m-apply-drafts'));
  assert.match(bar.textContent, /unsupported/);
  assert.equal(bar.querySelector('#z2m-open-drafts'), null);
});

test('render harness exposes adapter-owned coordinator boundaries', () => {
  const app = evaluateLuciModule(`${root}/app.js`, overrides, cache);
  assert.equal(typeof app.createDnsAdapter, 'function');
  assert.equal(typeof app.createStrategyAdapter, 'function');
  assert.equal(typeof app.createServicesAdapter, 'function');
  assert.equal(typeof app.createDomainHubAdapter, 'function');
  assert.doesNotMatch(app.renderSemanticDiff({ domainHub: { changes: { catalog: { before: ['alpha'], after: ['beta'] } } } }, {}).textContent, /Unsupported scope/);
  assert.match(app.renderSemanticDiff({ lists: { changes: { include: { before: [], after: ['example.org'] } } } }, {}).textContent, /Unsupported scope: lists/);
});
