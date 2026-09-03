import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const componentsCssPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css');
const componentsModelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const presentationPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const componentsCss = fs.readFileSync(componentsCssPath, 'utf8');
const componentsModelSource = fs.readFileSync(componentsModelPath, 'utf8');
const presentationSource = fs.readFileSync(presentationPath, 'utf8');

function vnode(tag, attrs, children) {
  const list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  return { tag, attrs: attrs || {}, children: list };
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(textOf).join('');
}

function findAll(node, predicate) {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(item => findAll(item, predicate));
  if (typeof node !== 'object') return [];
  return (predicate(node) ? [node] : []).concat(findAll(node.children || [], predicate));
}

function classHas(node, className) {
  return !!(node && node.attrs && String(node.attrs.class || '').split(/\s+/).includes(className));
}

function loadComponentsModel() {
  const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
  }, { filename: presentationPath });
  return vm.runInNewContext(`(function () { ${componentsModelSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
    UpdatePresentation: presentation,
  }, { filename: componentsModelPath });
}

function loadMaintenance() {
  const marker = '\nreturn baseclass.extend({';
  const index = maintenanceSource.lastIndexOf(marker);
  assert.ok(index >= 0, 'maintenance module return marker must exist');
  const prefix = maintenanceSource.slice(0, index);
  return vm.runInNewContext(`(function () {\n${prefix}\nreturn { renderComponents, state };\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: { load: () => Promise.resolve([{}, {}]), render: () => vnode('div', {}, ''), mount() {}, unmount() {} },
    ComponentsModel: loadComponentsModel(),
    UpdatePresentation: { describe: value => ({ label: String(value), kind: '' }) },
    window: { setTimeout, clearTimeout },
    Promise,
    setTimeout,
    clearTimeout,
    console,
    Object,
    Array,
    Number,
    String,
    Math,
    JSON,
    Date,
  }, { filename: maintenancePath });
}

const digest = 'a'.repeat(64);
const closure = {
  schema: 'z2m.z2k-dependency-closure.v1',
  available: true,
  resolution: 'complete',
  counts: { lua: 2, blobs: 4, hostlists: 3, ipsets: 1, dynamic: 1, runtime: 1, builtins: 1, missing: 0 },
  runtimeBundleDigest: digest,
};

function rawZ2k(overrides = {}) {
  return {
    updateState: 'current',
    checkedAt: 100,
    local: {
      installed: true,
      integrity: 'verified',
      integrityOk: true,
      lua: { ready: 7, total: 7 },
      installedRelease: { value: null, confidence: 'unknown', authority: null },
      dependencyClosure: closure,
      runtimeBundleDigest: digest,
      strategyCount: 8,
      provenance: { source: 'necronicle/z2k', sourceCommit: 'p-79.18' },
    },
    manifest: { current: 'r-80.3' },
    ...overrides,
  };
}

function makeContext(z2k) {
  const engine = {
    installed: true,
    installedRelease: 'v1.0.4',
    serviceState: 'running',
    runtimeRunning: true,
    compatible: true,
    upstream: 'bol-van/zapret2',
    available: { version: 'v1.0.4' },
  };
  return {
    route: 'components',
    root: { replaceChildren() {} },
    store: { get: () => ({ ui: {} }), update() {} },
    shell: {
      button: (label, kind, click, disabled) => vnode('button', { label, kind, click, disabled }, label),
      panel: (title, body) => vnode('section', { class: 'z2m-panel' }, [title, body]),
      statePanel: options => vnode('div', { class: 'z2m-state-panel' }, options && options.message || ''),
      switchControl: () => vnode('input', {}, ''),
      format: { timestamp: value => value ? `ts:${value}` : '' },
      showToast() {},
      openModal() {},
      closeModal() {},
    },
    api: {
      normalizeError: error => error && error.message ? error : { message: String(error || 'unknown') },
      service: { restart: () => Promise.resolve({ ok: true }) },
      engine: { uninstall: () => Promise.resolve({ ok: true }) },
      resources: { status: () => Promise.resolve({ ok: true }), check: () => Promise.resolve({ ok: true }), update: () => Promise.resolve({ ok: true }) },
      tg: { product: { status: () => Promise.resolve({ ok: true, status: 'not-installed', readiness: { installed: false } }) } },
    },
    data: {
      components: {
        versions: { value: {} },
        engine: { value: [{}, engine] },
        resources: { value: { checkedAt: 100, z2k } },
        telegram: { value: { ok: true, status: 'not-installed', readiness: { installed: false } } },
      },
    },
    refresh: () => Promise.resolve(),
  };
}

test('Z2K model normalizes the canonical compiled dependency closure by typed resource class', () => {
  const model = loadComponentsModel();
  const component = model.normalizeZ2k(rawZ2k(), true);

  assert.deepEqual(JSON.parse(JSON.stringify(component.compiledDependencySummary)), {
    available: true,
    resolution: 'complete',
    strategies: 8,
    lua: 2,
    blobs: 4,
    hostlists: 3,
    ipsets: 1,
    dynamic: 1,
    runtime: 1,
    builtins: 1,
    missing: 0,
    runtimeBundleDigest: digest,
  });
});

test('Z2K model falls back to local strategy count when the remote projection is explicitly null', () => {
  const model = loadComponentsModel();
  const component = model.normalizeZ2k(rawZ2k({
    strategyCount: null,
    plan: { strategyCount: null },
  }), true);

  assert.equal(component.compiledDependencySummary.strategies, 8);
});

test('Components renders Compiled Strategy Catalog with fail-closed identity and typed counts', () => {
  const { renderComponents, state } = loadMaintenance();
  const ctx = makeContext(rawZ2k());
  state.z2kExpanded = true;
  const rendered = renderComponents(ctx, ctx.data);
  const compiled = findAll(rendered, node => classHas(node, 'z2m-z2k-compiled-dependencies'))[0];

  assert.ok(compiled, 'compiled dependency summary must be rendered');
  assert.match(textOf(compiled), /Compiled Strategy Catalog/);
  assert.match(textOf(compiled), /Strategies8/);
  assert.match(textOf(compiled), /Lua2/);
  assert.match(textOf(compiled), /Blobs4/);
  assert.match(textOf(compiled), /Hostlists3/);
  assert.match(textOf(compiled), /IP sets1/);
  assert.match(textOf(compiled), /runtimeBundleDigest/);
  assert.match(componentsCss, /z2m-z2k-compiled-dependencies .*repeat\(5/);
  assert.match(componentsCss, /compiled-dependencies-details .*overflow-wrap:break-word/);
});

test('Components never labels an unavailable compiled closure as ready', () => {
  const { renderComponents, state } = loadMaintenance();
  const unavailable = rawZ2k({
    local: { ...rawZ2k().local, dependencyClosure: { ...closure, available: false, counts: { ...closure.counts, missing: 1 } }, runtimeBundleDigest: digest },
  });
  const ctx = makeContext(unavailable);
  state.z2kExpanded = true;
  const rendered = renderComponents(ctx, ctx.data);
  const compiled = findAll(rendered, node => classHas(node, 'z2m-z2k-compiled-dependencies'))[0];

  assert.ok(compiled);
  assert.match(textOf(compiled), /Недоступно/);
  assert.match(textOf(compiled), /Runtime dependency closure неполон/);
  assert.doesNotMatch(textOf(compiled), /Готово/);
});
