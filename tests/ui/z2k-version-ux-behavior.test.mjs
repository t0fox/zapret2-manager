import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const apiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const presentationPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const modelSource = fs.readFileSync(modelPath, 'utf8');
const apiSource = fs.readFileSync(apiPath, 'utf8');
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
    releaseChanges: overrides.releaseChanges || { modified: 1, added: 1, removed: 0 },
    installChanges: overrides.installChanges || overrides.changes || { modified: 2, added: 1, removed: 0 },
    changes: overrides.changes || overrides.installChanges || { modified: 2, added: 1, removed: 0 },
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
  assert.match(text, /Что изменится на устройстве/);
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

test('incompatible catalog release remains selectable and disables only its action', async () => {
  const internals = loadMaintenance();
  const z2k = z2kRaw({
    selectedVersion: 'r-80.3',
    catalog: [
      { version: 'r-80.3', latest: true, installed: true, installable: true },
      { version: 'r-80.1', installed: false, installable: false, unavailableReason: 'incompatible-manager' },
    ],
  });
  const ctx = makeContext(z2k);
  ctx.api.resources = {
    versionDetails: () => Promise.resolve({
      version: 'r-80.1',
      releaseName: 'Z2K r-80.1',
      installable: false,
      unavailableReason: 'incompatible-manager',
    }),
  };
  internals.state.componentOperation = null;
  internals.state.z2kExpanded = true;
  internals.state.z2kDetails = z2k.selectedDetails;
  internals.state.z2kSelectedVersion = 'r-80.3';

  const rendered = internals.renderComponents(ctx, ctx.data);
  const select = findAll(rendered, node => node.tag === 'select')[0];
  const incompatibleOption = findAll(select, node => node.tag === 'option' && node.attrs.value === 'r-80.1')[0];

  assert.equal(incompatibleOption.attrs.disabled, undefined);
  select.attrs.change({ target: { value: 'r-80.1' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(internals.state.z2kSelectedVersion, 'r-80.1');
  assert.equal(internals.state.z2kDetails.installable, false);
  const after = internals.renderComponents(ctx, ctx.data);
  assert.doesNotMatch(textOf(z2kCard(after)), /Несовместим|Ошибка/);
  const action = findAll(z2kDetails(after), node => node.tag === 'button' && textOf(node) === 'Установка недоступна')[0];
  assert.ok(action);
  assert.equal(action.attrs.disabled, true);
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

test('selected current release keeps a non-empty changelog body', () => {
  const internals = loadMaintenance();
  const body = 'Текущий release содержит исправления проверки.';
  const z2k = z2kRaw({
    installedVersion: 'r-80.3',
    selectedVersion: 'r-80.3',
    selectedDetails: { version: 'r-80.3', releaseName: 'Z2K r-80.3', installable: true, operation: 'reinstall', releaseBody: body, installChanges: { modified: 0, added: 0, removed: 0 } },
  });
  const rendered = renderState(internals, z2k);
  internals.state.z2kDetailsExpanded = true;
  const expanded = internals.renderComponents(makeContext(z2k), makeContext(z2k).data);
  assert.equal(textOf(z2kDetails(expanded)).split(body).length - 1, 1);
});

test('unknown installed Z2K identity does not claim a ready whole-page hero or no updates', () => {
  const internals = loadMaintenance();
  const rendered = renderState(internals, z2kRaw({ installedVersion: null, selectedVersion: 'r-80.3' }));
  const text = textOf(rendered);

  assert.match(text, /2 \/ 2 обязательных компонента работают/);
  assert.match(text, /Система работает|Версия Z2K требует уточнения/);
  assert.doesNotMatch(text, /Система готова/);
  assert.doesNotMatch(text, /Обновления не требуются/);
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

test('rapid release selection cannot let a stale A response overwrite the latest B response', async () => {
  const internals = loadMaintenance();
  const pending = {};
  const ctx = {
    api: {
      resources: {
        versionDetails: ({ version }) => new Promise(resolve => { pending[version] = resolve; }),
      },
    },
    shell: { normalizeError: value => value },
  };
  internals.state.componentOperation = null;
  internals.state.z2kReleaseRefresh = () => {};

  internals.selectZ2KVersion(ctx, 'r-80.3');
  internals.selectZ2KVersion(ctx, 'r-80.2');
  pending['r-80.2']({ version: 'r-80.2', installable: true, operation: 'reinstall', releaseBody: 'B' });
  await new Promise(resolve => setTimeout(resolve, 0));
  pending['r-80.3']({ version: 'r-80.3', installable: true, operation: 'upgrade', releaseBody: 'A' });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(internals.state.z2kSelectedVersion, 'r-80.2');
  assert.equal(internals.state.z2kDetails.version, 'r-80.2');
  assert.equal(internals.state.z2kDetails.releaseBody, 'B');
});

test('expanded Z2K view has one primary operation action', () => {
  const internals = loadMaintenance();
  const details = z2kDetails(renderState(internals, z2kRaw({ installedVersion: 'r-80.2', selectedVersion: 'r-80.3' })));
  const operationButtons = buttonsOf(details).filter(label => /^(Обновить|Переустановить|Откатить|Установить)/.test(label));

  assert.deepEqual(operationButtons, ['Обновить до r-80.3']);
});

test('expanded Z2K details show the managed device delta, not the upstream path dump', () => {
  const internals = loadMaintenance();
  const z2k = z2kRaw({
    installedVersion: 'r-79.7',
    selectedVersion: 'r-80.3',
    releaseChanges: {
      known: true,
      modified: 33,
      added: 0,
      removed: 0,
      managedPaths: ['files/init.d/S51z2k-warp', 'mtproxy-client/client.bin', 'webpanel/www/index.html'],
    },
    installChanges: {
      known: true,
      modified: 2,
      added: 2,
      removed: 6,
      modifiedItems: [
        { id: 'lua:z2k-modern-core', name: 'Z2K modern core', sourcePath: 'files/lua/z2k-modern-core.lua', type: 'lua', summary: 'fixture explanation XYZ', summarySource: 'immutable-manifest' },
        { id: 'lua:z2k-state-persist', name: 'z2k-state-persist.lua', sourcePath: 'files/lua/z2k-state-persist.lua', type: 'lua' },
      ],
      addedItems: [
        { id: 'blob:active-discord-udp', name: 'active_discord_udp.bin', sourcePath: 'files/fake/active_discord_udp.bin', type: 'blob', summary: 'second explanation', summarySource: 'repository-compare' },
        { id: 'blob:warp-endpoints', name: 'warp-endpoints.txt', sourcePath: 'files/lists/warp-endpoints.txt', type: 'blob' },
      ],
      removedItems: Array.from({ length: 6 }, (_, index) => ({
        id: `blob:old-${index + 1}`,
        name: `old-${index + 1}.bin`,
        sourcePath: `files/fake/old-${index + 1}.bin`,
        type: 'blob',
      })),
      modifiedPaths: ['files/lua/z2k-modern-core.lua', 'files/lua/z2k-state-persist.lua'],
      addedPaths: ['files/fake/active_discord_udp.bin', 'files/lists/warp-endpoints.txt'],
      removedPaths: Array.from({ length: 6 }, (_, index) => `files/fake/old-${index + 1}.bin`),
      managedPaths: [],
    },
  });
  const ctx = makeContext(z2k);
  renderState(internals, z2k);
  internals.state.z2kDetailsExpanded = true;
  const expanded = internals.renderComponents(ctx, ctx.data);
  const text = textOf(expanded);
  const region = findAll(expanded, node => node.attrs && node.attrs.id === 'z2m-z2k-release-details')[0];

  assert.ok(region);
  assert.equal(region.children.some(Array.isArray), false);
  assert.match(text, /Что изменится на устройстве/);
  assert.match(text, /Обновится.*2/);
  assert.match(text, /Добавится.*2/);
  assert.match(text, /Удалится.*6/);
  assert.match(text, /Z2K modern core/);
  assert.match(text, /active_discord_udp\.bin/);
  assert.match(text, /fixture explanation XYZ/);
  assert.match(text, /second explanation/);
  assert.match(text, /Удалён в r-80\.3/);
  assert.match(text, /old-1\.bin/);
  assert.doesNotMatch(text, /Причина upstream:|Удалён в upstream:/);
  assert.doesNotMatch(text, /S51z2k-warp|mtproxy-client|webpanel/);
  assert.doesNotMatch(text, /\[object HTMLDivElement\]/);
  assert.match(text, /Сравнить upstream изменения ↗/);
});

test('repository Compare is requested only after the managed-resource details expand', () => {
  assert.match(apiSource, /versionDetails:function\(value\)\{return value&&typeof value==='object'\?calls\.z2kVersionDetails\(value\.version,value\.includeCompare\):calls\.z2kVersionDetails\(value\);\}/);
  assert.match(maintenanceSource, /versionDetails\(\{ version: version, includeCompare: includeCompare === true \? 'compare' : 'fallback' \}\)/);
  assert.match(maintenanceSource, /loadZ2KVersionDetails\(ctx, version, false\)/);
  assert.match(maintenanceSource, /state\.z2kDetailsExpanded && !state\.z2kDetailsCompared\) loadZ2KVersionDetails\(ctx, state\.z2kSelectedVersion, true\)/);
  assert.match(modelSource, /summarySource === 'repository-compare'/);
});
