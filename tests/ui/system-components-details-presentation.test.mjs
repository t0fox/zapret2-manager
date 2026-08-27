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

function buttonsOf(node) {
  return findAll(node, item => item.tag === 'button').map(item => item.attrs.label || textOf(item));
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
  const returnMarker = '\nreturn baseclass.extend({';
  const returnIndex = maintenanceSource.lastIndexOf(returnMarker);
  assert.ok(returnIndex >= 0, 'maintenance module return marker must exist');
  const prefix = maintenanceSource.slice(0, returnIndex);
  const enginePanelCalls = [];
  const internals = vm.runInNewContext(`(function () {\n${prefix}\nreturn { renderComponents, state, toggleEngine, toggleZ2K };\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: {
      load: () => Promise.resolve([{}, {}]),
      render: () => { enginePanelCalls.push(true); return vnode('div', { class: 'embedded-engine-panel' }, 'duplicate'); },
      mount() {},
      unmount() {},
    },
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
  return { internals, enginePanelCalls };
}

function engineStatus(overrides = {}) {
  return {
    installed: true,
    installedRelease: 'v1.0.4',
    serviceState: 'running',
    runtimeRunning: true,
    compatible: true,
    upstream: 'bol-van/zapret2',
    available: { version: 'v1.0.4' },
    ...overrides,
  };
}

function z2kRaw(overrides = {}) {
  return {
    updateState: 'current',
    checkedAt: 100,
    local: {
      installed: true,
      integrity: 'verified',
      integrityOk: true,
      lua: { ready: 7, total: 7 },
      installedRelease: { value: null, confidence: 'unknown', authority: null },
      provenance: { source: 'necronicle/z2k', sourceCommit: 'p-79.18' },
    },
    manifest: { current: 'r-80.3' },
    ...overrides,
  };
}

function makeContext(engine, z2k) {
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
      resources: { status: () => Promise.resolve({ ok: true }), check: () => Promise.resolve({ ok: true }) },
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
  };
}

test('Engine details are a single Components-owned presentation without embedded EnginePanel', () => {
  const { internals, enginePanelCalls } = loadMaintenance();
  const ctx = makeContext(engineStatus({ updateState: 'update-available', available: { version: 'v1.0.5' } }), z2kRaw());
  internals.state.engineExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const detailPanels = findAll(rendered, node => classHas(node, 'z2m-component-details'));
  const updateSections = findAll(rendered, node => classHas(node, 'z2m-component-updates'));
  const dangerZones = findAll(rendered, node => classHas(node, 'z2m-component-danger-zone'));

  assert.equal(enginePanelCalls.length, 0, 'Components must not mount the standalone EnginePanel');
  assert.equal(detailPanels.length, 1, 'expanded Engine must have exactly one full-width details panel');
  assert.equal(updateSections.length, 1, 'Engine updates must be an explicit section');
  assert.equal(dangerZones.length, 1, 'Engine delete must live in a dedicated Danger Zone');
  assert.ok(buttonsOf(dangerZones[0]).includes('Удалить движок'));
  assert.ok(buttonsOf(detailPanels[0]).includes('Обновить'));
});

test('Engine current state keeps re-check visible and does not duplicate management facts', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw());
  internals.state.engineExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];
  const text = textOf(details);

  assert.ok(buttonsOf(details).includes('Проверить обновления'));
  assert.equal((text.match(/Состояние движка/g) || []).length, 0, 'old nested EnginePanel heading must be absent');
  assert.equal((text.match(/Источник/g) || []).length, 1, 'source belongs to the single primary header/facts presentation');
});

test('Z2K details use a standalone review callout and never invent an update action', () => {
  const { internals } = loadMaintenance();
  const review = z2kRaw({
    updateState: 'review-required',
    availableRelease: 'r-80.1',
    reviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{
      path: 'files/z2k-config-validator.sh',
      message: 'Наблюдаемый upstream-файл изменился; требуется semantic review.',
    }],
  });
  const ctx = makeContext(engineStatus(), review);
  internals.state.z2kExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];
  const callouts = findAll(details, node => classHas(node, 'z2m-component-review-callout'));

  assert.equal(callouts.length, 1, 'review reason must be a standalone callout');
  assert.match(textOf(callouts[0]), /Наблюдаемый upstream-файл изменился/);
  assert.match(textOf(details), /r-80\.1/);
  assert.ok(buttonsOf(details).includes('Проверить обновления'));
  assert.ok(!buttonsOf(details).includes('Обновить'), 'blocking review must not show a fake update action');
});

test('Z2K available release gets an update action only when the model says it is applicable', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({ updateState: 'update-available', availableRelease: 'r-80.4' }));
  internals.state.z2kExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];

  assert.match(textOf(details), /r-80\.4/);
  assert.ok(buttonsOf(details).includes('Обновить'));
});

test('Only one mandatory details panel is open at a time', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw());
  internals.state.z2kExpanded = true;

  internals.toggleEngine(ctx);

  assert.equal(internals.state.engineExpanded, true);
  assert.equal(internals.state.z2kExpanded, false);
});

test('Release identity distinguishes unknown healthy assets from missing assets', () => {
  const { internals } = loadMaintenance();
  const unknown = internals.renderComponents(ctxFor(internals, z2kRaw()), ctxFor(internals, z2kRaw()).data);
  const missingContext = ctxFor(internals, z2kRaw({
    updateState: 'unknown',
    local: { installed: false, integrity: 'broken', integrityOk: false, lua: { ready: 0, total: 7 } },
  }));
  const missing = internals.renderComponents(missingContext, missingContext.data);

  assert.match(textOf(unknown), /Установленный releaseНе определён/);
  assert.match(textOf(missing), /Установленный releaseНе установлен/);
});

test('Components details CSS owns the responsive fact grid and natural wrapping', () => {
  assert.match(componentsCss, /z2m-component-fact-grid\{[^}]*repeat\(4/);
  assert.match(componentsCss, /@media\(max-width:1100px\)[\s\S]*z2m-component-fact-grid\{grid-template-columns:repeat\(2/);
  assert.match(componentsCss, /@media\(max-width:800px\)[\s\S]*z2m-component-fact-grid\{grid-template-columns:1fr/);
  assert.match(componentsCss, /z2m-components-page \.z2m-component-info-row strong[^}]*overflow-wrap:break-word/);
  assert.doesNotMatch(componentsCss, /z2m-components-page[^}]*overflow-wrap:anywhere/);
});

function ctxFor(internals, z2k) {
  return makeContext(engineStatus(), z2k);
}
