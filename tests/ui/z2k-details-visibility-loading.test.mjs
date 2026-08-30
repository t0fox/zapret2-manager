import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const componentsCssPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css');
const uiCssPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const componentsCss = fs.readFileSync(componentsCssPath, 'utf8');
const uiCss = fs.readFileSync(uiCssPath, 'utf8');

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

function classHas(node, className) {
  return !!(node && node.attrs && String(node.attrs.class || '').split(/\s+/).includes(className));
}

function loadMaintenance() {
  const returnMarker = '\nreturn baseclass.extend({';
  const returnIndex = maintenanceSource.lastIndexOf(returnMarker);
  assert.ok(returnIndex >= 0, 'maintenance module return marker must exist');
  return vm.runInNewContext(`(function () {\n${maintenanceSource.slice(0, returnIndex)}\nreturn { renderZ2KReleasePanel, state };\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: { load: () => Promise.resolve([{}, {}]), render: () => null, mount() {}, unmount() {} },
    ComponentsModel: {},
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

function context() {
  return {
    shell: {
      button: (label, kind, click, disabled, attrs) => vnode('button', { label, kind, click, disabled, ...(attrs || {}) }, label),
      format: { timestamp: value => value ? String(value) : '' },
    },
  };
}

function componentWithDeviceChanges() {
  return {
    selectedVersion: 'r-80.3',
    installedRelease: { value: 'r-80.2' },
    selectedDetails: {
      version: 'r-80.3',
      releaseName: 'Z2K r-80.3',
      releaseBody: 'Исправления ресурсов.',
      installable: true,
      operation: 'upgrade',
      deviceChanges: { known: true, modified: 1, added: 0, removed: 0 },
    },
    canApply: true,
  };
}

test('collapsed Z2K device details are hidden in DOM while expanded details are visible', () => {
  const internals = loadMaintenance();
  internals.state.z2kDetailsExpanded = false;
  internals.state.z2kDetailsLoading = false;
  internals.state.z2kDetailsCompared = true;

  const collapsed = internals.renderZ2KReleasePanel(context(), componentWithDeviceChanges());
  const collapsedRegion = findAll(collapsed, node => node.attrs && node.attrs.id === 'z2m-z2k-release-details')[0];
  assert.equal(collapsedRegion.attrs.hidden, 'hidden');

  internals.state.z2kDetailsExpanded = true;
  const expanded = internals.renderZ2KReleasePanel(context(), componentWithDeviceChanges());
  const expandedRegion = findAll(expanded, node => node.attrs && node.attrs.id === 'z2m-z2k-release-details')[0];
  assert.equal(expandedRegion.attrs.hidden, undefined);
  assert.equal(expandedRegion.attrs['aria-busy'], 'false');
});

test('Z2K release selection exposes an accessible visual loading indicator', () => {
  const internals = loadMaintenance();
  const rendered = internals.renderZ2KReleasePanel(context(), { selectedVersion: 'r-80.3' });
  const loading = findAll(rendered, node => classHas(node, 'z2m-z2k-release-panel-loading'))[0];
  const spinner = findAll(loading, node => classHas(node, 'spinner-inline'))[0];

  assert.ok(loading, 'release loading state must have a dedicated status row');
  assert.equal(loading.attrs.role, 'status');
  assert.equal(loading.attrs['aria-live'], 'polite');
  assert.ok(spinner, 'release loading state must show a circular spinner');
  assert.equal(spinner.attrs['aria-hidden'], 'true');
});

test('Z2K details CSS restores native hidden semantics and keeps loading motion reduced', () => {
  const baseRule = componentsCss.match(/\.z2m-components-page \.z2m-z2k-release-details\{([^}]*)\}/);
  assert.ok(baseRule, 'Z2K details base rule must exist');
  assert.doesNotMatch(baseRule[1], /display\s*:/, 'base details rule must not override native hidden');
  assert.match(componentsCss, /\.z2m-components-page \.z2m-z2k-release-details:not\(\[hidden\]\)\{[^}]*display:grid/);
  assert.match(componentsCss, /\.z2m-components-page \.z2m-z2k-release-details\[hidden\]\{[^}]*display:none/);
  assert.match(componentsCss, /\.z2m-components-page \.z2m-z2k-release-panel-loading\{[^}]*display:flex/);
  assert.match(componentsCss, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*z2m-z2k-release-panel-loading \.spinner-inline/);
  assert.match(componentsCss, /\.z2m-dns-pane\[hidden\]\{display:none\}/, 'existing scoped hidden convention must remain intact');
});

test('spinner-inline and fallback z2m-spinner are self-contained loading indicators', () => {
  const inlineRule = uiCss.match(/\.z2m-view \.spinner-inline\{([^}]*)\}/);
  const fallbackRule = uiCss.match(/\.z2m-view \.z2m-spinner\{([^}]*)\}/);

  assert.ok(inlineRule, 'spinner-inline contract must exist in the shared UI stylesheet');
  assert.ok(fallbackRule, 'z2m-spinner fallback contract must exist in the shared UI stylesheet');

  for (const property of ['display:inline-block', 'border:2px solid var(--border)', 'border-top-color:var(--blue)', 'border-radius:50%', 'animation:z2m-avatar-spin .8s linear infinite']) {
    assert.match(inlineRule[1], new RegExp(property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `spinner-inline must define ${property}`);
    assert.match(fallbackRule[1], new RegExp(property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `z2m-spinner must define ${property}`);
  }
});
