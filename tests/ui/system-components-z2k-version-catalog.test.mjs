import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const modelSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const presentationSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
const maintenanceSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');

function vnode(tag, attrs, children) {
  const list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  return { tag, attrs: attrs || {}, children: list };
}

function findAll(node, predicate) {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(item => findAll(item, predicate));
  if (typeof node !== 'object') return [];
  return (predicate(node) ? [node] : []).concat(findAll(node.children || [], predicate));
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node !== 'object') return String(node);
  return (node.children || []).map(textOf).join('');
}

function loadModel() {
  const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
  });
  return vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
    UpdatePresentation: presentation,
  });
}

function loadMaintenance() {
  const marker = '\nreturn baseclass.extend({';
  const end = maintenanceSource.lastIndexOf(marker);
  return vm.runInNewContext(`(function () {\n${maintenanceSource.slice(0, end)}\nreturn { renderComponents, state };\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: { load: () => Promise.resolve([{}, {}]), render: () => null, mount() {}, unmount() {} },
    ComponentsModel: loadModel(),
    UpdatePresentation: { describe: value => ({ label: String(value), kind: '' }) },
    window: { setTimeout, clearTimeout },
    Promise,
    setTimeout,
    clearTimeout,
    Object,
    Array,
    Number,
    String,
    Math,
    JSON,
    Date,
  });
}

function z2kValue() {
  return {
    updateState: 'current',
    checkedAt: 100,
    local: { installed: true, integrity: 'verified', integrityOk: true, lua: { ready: 39, total: 39 }, installedRelease: { value: 'r-80.3', confidence: 'confirmed' } },
    catalog: [
      { version: 'r-80.3', latest: true, installed: true, installable: true },
      { version: 'r-80.2', installable: true },
      { version: 'r-79.7', installable: false, unavailableReason: 'incompatible-manager' },
    ],
    selectedVersion: 'r-80.2',
    selectedDetails: {
      version: 'r-80.2',
      releaseName: 'Z2K r-80.2',
      releaseBody: 'Исправления списков и detector assets.',
      installable: true,
      changes: { modified: 2, added: 1, removed: 0 },
      operation: 'upgrade',
    },
  };
}

test('Z2K model keeps catalog selection, lazy details, and operation separate from raw execution tokens', () => {
  const model = loadModel();
  const component = model.normalizeZ2k({ z2k: z2kValue() }, true);

  assert.equal(component.selectedVersion, 'r-80.2');
  assert.equal(component.selectedDetails.releaseBody, 'Исправления списков и detector assets.');
  assert.equal(component.operation, 'upgrade');
  assert.equal(component.catalog.length, 3);
  assert.equal(component.catalog[2].installable, false);
  assert.equal(component.planToken, null);
});

test('Z2K details render a bounded release selector and human changelog without internals', () => {
  const internals = loadMaintenance();
  const ctx = {
    route: 'components',
    data: { components: {
      versions: { value: {} },
      engine: { value: [{}, { installed: true, serviceState: 'running', runtimeRunning: true, compatible: true }] },
      resources: { value: { checkedAt: 100, z2k: z2kValue() } },
      telegram: { value: { ok: true, status: 'not-installed', readiness: { installed: false } } },
    } },
    store: { get: () => ({ ui: {} }), update() {} },
    shell: {
      button: (label, kind, click, disabled) => vnode('button', { label, kind, click, disabled }, label),
      panel: (title, body) => vnode('section', {}, [title, body]),
      statePanel: options => vnode('div', {}, options && options.message || ''),
      switchControl: () => vnode('input', {}, ''),
      format: { timestamp: value => value ? `ts:${value}` : '' },
      showToast() {}, openModal() {}, closeModal() {},
    },
    api: { normalizeError: error => error || {}, resources: {}, tg: { product: { status: () => Promise.resolve({}) } } },
  };
  internals.state.z2kExpanded = true;
  const rendered = internals.renderComponents(ctx, ctx.data);
  const selects = findAll(rendered, node => node.tag === 'select');
  const options = findAll(rendered, node => node.tag === 'option');
  const text = textOf(rendered);

  assert.equal(selects.length, 1);
  assert.equal(options.length, 3);
  assert.ok(options.some(option => option.attrs.disabled), 'incompatible releases must be disabled');
  assert.match(text, /Исправления списков и detector assets/);
  assert.doesNotMatch(text, /z2k-target-v2:|manifestSha256|targetCommitSha|planToken/);
});

test('Z2K UI owns catalog/detail/prepare lifecycle and does not promote advisory files to primary warning', () => {
  assert.match(maintenanceSource, /versionDetails/);
  assert.match(maintenanceSource, /prepareVersion/);
  assert.match(maintenanceSource, /confirmAction/);
  assert.match(maintenanceSource, /!component\.catalog\s*\|\|\s*!component\.catalog\.length/);
  assert.doesNotMatch(maintenanceSource, /advisoryReviews\.join/);
});
