import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const presentationPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const modelSource = fs.readFileSync(modelPath, 'utf8');
const presentationSource = fs.readFileSync(presentationPath, 'utf8');

function vnode(tag, attrs, children) {
  const list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  return { tag, attrs: attrs || {}, children: list };
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node !== 'object') return String(node);
  return (node.children || []).map(textOf).join('');
}

function findAll(node, predicate) {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(item => findAll(item, predicate));
  if (typeof node !== 'object') return [];
  return (predicate(node) ? [node] : []).concat(findAll(node.children || [], predicate));
}

function classHas(node, name) {
  return !!(node && node.attrs && String(node.attrs.class || '').split(/\s+/).includes(name));
}

function buttonsOf(node) {
  return findAll(node, item => item.tag === 'button').map(item => item.attrs.label || textOf(item));
}

function loadModel() {
  const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
  }, { filename: presentationPath });
  return vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
    UpdatePresentation: presentation,
  }, { filename: modelPath });
}

function loadMaintenance() {
  const marker = '\nreturn baseclass.extend({';
  const end = maintenanceSource.lastIndexOf(marker);
  return vm.runInNewContext(`(function () {\n${maintenanceSource.slice(0, end)}\nreturn { renderComponents, selectZ2KVersion, toggleZ2K, state };\n})()`, {
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

function z2kRaw(overrides = {}) {
  const installed = overrides.installedVersion === undefined ? 'r-80.2' : overrides.installedVersion;
  const selected = overrides.selectedVersion || 'r-80.3';
  const details = overrides.selectedDetails || {
    version: selected,
    releaseName: `Z2K ${selected}`,
    releaseBody: 'Исправления ресурсов и проверок.',
    publishedAt: '2026-08-27T16:47:50Z',
    installable: true,
    operation: installed === null ? 'install' : selected === installed ? 'reinstall' : selected === 'r-80.3' ? 'upgrade' : 'downgrade',
    installedVersion: installed,
    changes: overrides.changes || { modified: 2, added: 1, removed: 0 },
    compareUrl: 'https://github.com/necronicle/z2k/compare/r-80.2...r-80.3',
  };
  return {
    updateState: overrides.updateState || (installed === 'r-80.2' ? 'update-available' : 'current'),
    attentionState: overrides.attentionState || 'none',
    canApply: overrides.canApply === undefined ? true : overrides.canApply,
    checkedAt: 100,
    local: {
      installed: true,
      integrity: 'verified',
      integrityOk: true,
      lua: { ready: 7, total: 7 },
      installedRelease: { value: installed, confidence: installed ? 'confirmed' : 'unknown', authority: installed ? 'activation-receipt' : null },
    },
    catalog: [
      { version: 'r-80.3', latest: true, installed: installed === 'r-80.3', installable: true },
      { version: 'r-80.2', installed: installed === 'r-80.2', installable: true },
      { version: 'r-80.1', installable: true },
    ],
    selectedVersion: selected,
    selectedDetails: details,
    availableRelease: 'r-80.3',
    advisoryReviews: overrides.advisoryReviews || [],
    reviewDetails: overrides.reviewDetails || [],
    ...overrides,
  };
}

function makeContext(z2k) {
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
    api: { normalizeError: error => error || {}, tg: { product: { status: () => Promise.resolve({}) } } },
    data: {
      components: {
        versions: { value: {} },
        engine: { value: [{}, { installed: true, serviceState: 'running', runtimeRunning: true, compatible: true }] },
        resources: { value: { checkedAt: 100, z2k } },
        catalog: { value: { versions: z2k.catalog } },
        telegram: { value: { ok: true, status: 'not-installed', readiness: { installed: false } } },
      },
    },
  };
}

function renderState(internals, z2k) {
  internals.state.componentOperation = null;
  internals.state.z2kExpanded = true;
  internals.state.engineExpanded = false;
  internals.state.z2kDetails = null;
  internals.state.z2kSelectedVersion = null;
  const ctx = makeContext(z2k);
  return internals.renderComponents(ctx, ctx.data);
}

function z2kCard(rendered) {
  return findAll(rendered, node => classHas(node, 'z2m-component-card--z2k'))[0];
}

function z2kDetails(rendered) {
  return findAll(rendered, node => classHas(node, 'z2m-component-details--z2k'))[0];
}

test('opening Z2K details loads the selected release before showing the operation', async () => {
  const internals = loadMaintenance();
  const calls = [];
  const ctx = makeContext(z2kRaw({ selectedDetails: null }));
  ctx.api.resources = {
    versionDetails: value => {
      calls.push(value);
      return Promise.resolve({ version: 'r-80.3', installable: true, operation: 'upgrade', releaseBody: 'Новое описание.' });
    }
  };
  internals.state.z2kSelectedVersion = 'r-80.3';

  internals.toggleZ2K(ctx);
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].version, 'r-80.3');
  assert.equal(internals.state.z2kDetails.version, 'r-80.3');
});

test('current selection is factual and exposes reinstall as the sole operation', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({ installedVersion: 'r-80.3', selectedVersion: 'r-80.3' }));
  const text = textOf(rendered);
  const details = z2kDetails(rendered);

  assert.match(text, /Версии/);
  assert.match(text, /Эта версия уже установлена/);
  assert.ok(buttonsOf(details).includes('Переустановить r-80.3'));
  assert.doesNotMatch(text, /Применить/);
  assert.equal(findAll(details, node => classHas(node, 'z2m-component-updates')).length, 0);
});

test('newer selection uses canonical upgrade operation and installed-to-selected transition', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({ installedVersion: 'r-80.2', selectedVersion: 'r-80.3' }));
  const text = textOf(z2kDetails(rendered));

  assert.match(text, /Доступно обновление/);
  assert.match(text, /r-80\.2 → r-80\.3/);
  assert.match(text, /Изменения при установке/);
  assert.ok(buttonsOf(z2kDetails(rendered)).includes('Обновить до r-80.3'));
});

test('older selection uses canonical downgrade operation without critical warning', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({ installedVersion: 'r-80.3', selectedVersion: 'r-80.1' }));
  const text = textOf(z2kDetails(rendered));

  assert.match(text, /r-80\.3 → r-80\.1/);
  assert.match(text, /более ранняя версия/);
  assert.ok(buttonsOf(z2kDetails(rendered)).includes('Откатить до r-80.1'));
  assert.doesNotMatch(text, /Ошибка|Требуется восстановление/);
});

test('healthy runtime with unknown installed identity is Работает and offers install', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({ installedVersion: null, selectedVersion: 'r-80.3' }));
  const cardText = textOf(z2kCard(rendered));
  const details = z2kDetails(rendered);

  assert.match(cardText, /Работает/);
  assert.match(cardText, /Версия не определена/);
  assert.doesNotMatch(cardText, /Актуален/);
  assert.ok(buttonsOf(details).includes('Установить r-80.3'));
});

test('incompatible selected release does not change current component health', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({
    selectedVersion: 'r-80.1',
    selectedDetails: { version: 'r-80.1', releaseName: 'Z2K r-80.1', installable: false, unavailableReason: 'incompatible-manager' },
  }));
  const cardText = textOf(z2kCard(rendered));
  const detailsText = textOf(z2kDetails(rendered));

  assert.match(cardText, /Доступно обновление|Работает/);
  assert.doesNotMatch(cardText, /Несовместим/);
  assert.match(detailsText, /Release несовместим/);
  assert.ok(buttonsOf(z2kDetails(rendered)).includes('Установка недоступна'));
});

test('advisory metadata is not a warning and zero diff uses user-facing copy', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({
    installedVersion: 'r-80.3',
    selectedVersion: 'r-80.3',
    attentionState: 'review-advisory',
    advisoryReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{ path: 'files/z2k-config-validator.sh', message: 'advisory' }],
    changes: { modified: 0, added: 0, removed: 0 },
  }));
  const text = textOf(rendered);
  const primary = textOf(z2kDetails(rendered).children.filter(node => !classHas(node, 'z2m-component-technical')));

  assert.doesNotMatch(primary, /Требует внимания|замечание|z2k-config-validator\.sh/);
  assert.match(text, /Изменений относительно установленной версии нет/);
  assert.doesNotMatch(text, /exact-managed/);
});

test('changing the selector refreshes only the release panel and keeps the page mounted', async () => {
  const internals = loadMaintenance();
  let rootReplacements = 0;
  let panelRefreshes = 0;
  const ctx = {
    root: { replaceChildren() { rootReplacements++; } },
    api: { resources: { versionDetails: () => Promise.resolve({ version: 'r-80.1', installable: true, operation: 'downgrade', changes: {} }) } },
    shell: { normalizeError: value => value },
  };
  internals.state.componentOperation = null;
  internals.state.z2kReleaseRefresh = () => { panelRefreshes++; };

  internals.selectZ2KVersion(ctx, 'r-80.1');
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(rootReplacements, 0);
  assert.equal(panelRefreshes, 2);
  assert.equal(internals.state.z2kSelectedVersion, 'r-80.1');
  assert.equal(internals.state.z2kDetails.operation, 'downgrade');
});

test('expanded Z2K view has one primary operation action', () => {
  const internals = loadMaintenance();
  const details = z2kDetails(renderState(internals, z2kRaw({ installedVersion: 'r-80.2', selectedVersion: 'r-80.3' })));
  const operationButtons = buttonsOf(details).filter(label => /^(Обновить|Переустановить|Откатить|Установить)/.test(label));

  assert.deepEqual(operationButtons, ['Обновить до r-80.3']);
});
