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
    catalog: { value: {
      ok: true, catalogVersion: 'backend-catalog',
      services: [
        { id: 'alpha', name: 'Backend Alpha', category: 'video', domainCount: 2 },
        { id: 'beta', name: 'Backend Beta', category: 'video', domainCount: 1 }
      ],
      categories: [{ id: 'video', label: 'Video services' }],
      modes: [{ id: 'services' }, { id: 'hosts' }],
      sources: [{ id: 'ready-1', label: 'Backend ready hosts', revision: 8,
        date: '2026-08-04', validationStatus: 'valid' }]
    } },
    status: { value: { ok: true, activeMode: 'services', ledger: {
      revision: 8, enabled: ['alpha'], updatedAt: '2026-08-04T10:00:00Z',
      precondition: { ledgerRevision: 8, fileSha256: 'backend-file-sha' }
    }, ownedDomains: 2 } },
    health: { value: { ok: true, matrix: { status: 'completed' } } },
    preflight: { value: { ok: true, ready: true } }
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
  assert.match(tree.textContent, /Не определена/);
  assert.doesNotMatch(tree.textContent, /Flowseal ALT11|57 \/ 61|312 мс/);
});

test('Services render harness uses backend catalogue data in both modes', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const servicesContext = context(healthyData['z2m-services.js']);
  const servicesTree = mod.render(servicesContext);
  for (const selector of ['.z2m-services-modes', '.z2m-services-kpis', '.z2m-service-category', '.z2m-service-row'])
    assert.ok(servicesTree.querySelector(selector), selector);
  assert.match(servicesTree.textContent, /Backend Alpha/);
  assert.match(servicesTree.textContent, /1 из 2 включено/);
  assert.match(servicesTree.textContent, /Backend ready hosts|Готовый hosts/);
  assert.doesNotMatch(servicesTree.textContent, /demo|Flowseal ALT11/i);

  const betaRow = servicesTree.querySelectorAll('div').find((node) => node.attrs['data-service-id'] === 'beta');
  const betaSwitch = betaRow && betaRow.querySelector('button');
  assert.ok(betaSwitch && betaSwitch.listeners.click);
  betaSwitch.listeners.click({ type: 'click', preventDefault() {} });
  assert.ok(servicesContext.store.get().draft.services);
  assert.equal(servicesContext.store.get().draft.services.mode, 'services');
  const hostsModeButton = servicesTree.querySelectorAll('button').find((node) => node.attrs['data-mode'] === 'hosts');
  assert.ok(hostsModeButton && hostsModeButton.listeners.click);
  hostsModeButton.listeners.click({ type: 'click', preventDefault() {} });
  assert.ok(servicesContext.store.get().draft.services.modeDrafts.services);

  const retainedApply = servicesTree.querySelectorAll('button').find((node) => node.textContent === 'Применить');
  assert.ok(retainedApply && retainedApply.disabled === false);
  let coordinatorOpens = 0;
  const aliasContext = context(healthyData['z2m-services.js'], { openSemanticDiff() { coordinatorOpens += 1; } });
  mod.resetDraft();
  const aliasTree = mod.render(aliasContext);
  const aliasRow = aliasTree.querySelectorAll('div').find((node) => node.attrs['data-service-id'] === 'beta');
  aliasRow.querySelector('button').listeners.click({ type: 'click', preventDefault() {} });
  const aliasHosts = aliasTree.querySelectorAll('button').find((node) => node.attrs['data-mode'] === 'hosts');
  aliasHosts.listeners.click({ type: 'click', preventDefault() {} });
  aliasTree.querySelectorAll('button').find((node) => node.textContent === 'Применить').listeners.click({ type: 'click' });
  assert.equal(coordinatorOpens, 1);

  const hostsData = structuredClone(healthyData['z2m-services.js']);
  hostsData.status.value = { ...hostsData.status.value, activeMode: 'hosts' };
  mod.resetDraft();
  const hostsTree = mod.render(context(hostsData));
  assert.ok(hostsTree.querySelector('.z2m-hosts-mode'));
  assert.match(hostsTree.textContent, /Backend ready hosts/);
  assert.match(hostsTree.textContent, /ready-1/);
  assert.match(hostsTree.textContent, /ревизия: 8/);
});

test('Services switches use one native click path for click and keyboard activation', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const tree = mod.render(context(healthyData['z2m-services.js']));
  const categoryButton = () => tree.querySelectorAll('button').find((node) => node.attrs['data-state'] != null);
  const nativeKeyboardClick = (key) => {
    const button = categoryButton();
    button.listeners.keydown?.({ type: 'keydown', key, preventDefault() {} });
    button.listeners.click({ type: 'click', detail: 0, preventDefault() {} });
  };
  assert.equal(categoryButton().attrs['data-state'], 'mixed');
  nativeKeyboardClick('Enter');
  assert.equal(categoryButton().attrs['data-state'], 'on');
  nativeKeyboardClick(' ');
  assert.equal(categoryButton().attrs['data-state'], 'off');
  categoryButton().listeners.click({ type: 'click', detail: 1, preventDefault() {} });
  assert.equal(categoryButton().attrs['data-state'], 'on');
});

test('Services fails closed when status precondition is unavailable', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const unavailable = structuredClone(healthyData['z2m-services.js']);
  delete unavailable.status.value.ledger.precondition;
  const ctx = context(unavailable);
  const tree = mod.render(ctx);
  assert.match(tree.textContent, /предусловия каталога недоступны/i);
  const switches = tree.querySelectorAll('button').filter((node) => node.attrs.role === 'switch');
  assert.ok(switches.length > 0);
  assert.ok(switches.every((node) => node.disabled === true));
  const bulk = tree.querySelectorAll('button').filter((node) => /Включить все|Выключить все/.test(node.textContent));
  assert.ok(bulk.length === 2 && bulk.every((node) => node.disabled === true));
  switches[0].listeners.click({ type: 'click', preventDefault() {} });
  assert.equal(ctx.store.get().draft.services, undefined);
});

test('Services mode tabs refresh on class and aria-selected state', () => {
  const mod = evaluateLuciModule(`${root}/z2m-services.js`, overrides, cache);
  mod.resetDraft();
  const tree = mod.render(context(healthyData['z2m-services.js']));
  const mode = (id) => tree.querySelectorAll('button').find((node) => node.attrs['data-mode'] === id);
  assert.equal(mode('services').classList.contains('on'), true);
  assert.equal(mode('services').attrs['aria-selected'], 'true');
  mode('hosts').listeners.click({ type: 'click', preventDefault() {} });
  assert.equal(mode('hosts').classList.contains('on'), true);
  assert.equal(mode('hosts').attrs['aria-selected'], 'true');
  assert.equal(mode('services').classList.contains('on'), false);
  assert.equal(mode('services').attrs['aria-selected'], 'false');
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
  assert.match(app.renderSemanticDiff({ proxy: { changes: { enabled: { before: false, after: true } } } }, {}).textContent, /Unsupported scope: proxy/);
});
