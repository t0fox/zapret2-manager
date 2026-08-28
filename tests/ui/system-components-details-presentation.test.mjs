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
  const internals = vm.runInNewContext(`(function () {\n${prefix}\nreturn { renderComponents, state, toggleEngine, toggleZ2K, checkUpdates, updateZ2K, z2kNeedsIntegration };\n})()`, {
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

test('Z2K model preserves snapshot identity and separates advisory attention from apply eligibility', () => {
  const model = loadComponentsModel();
  const component = model.normalizeZ2k({
    updateState: 'update-available',
    attentionState: 'review-advisory',
    canApply: true,
    planToken: 'z2k-plan-v1:200:48:r-80.3',
    advisoryReviews: ['files/z2k-config-validator.sh'],
    blockingReviews: [],
    blockingReasons: [],
    manifest: { seq: 48, current: 'r-80.3' },
    local: { installed: true, lua: { ready: 7, total: 7 }, integrityOk: true },
  }, true);

  assert.equal(component.planToken, 'z2k-plan-v1:200:48:r-80.3');
  assert.equal(component.attentionState, 'review-advisory');
  assert.equal(component.canApply, true);
  assert.equal(component.actions.primary, 'update');
  assert.deepEqual(JSON.parse(JSON.stringify(component.advisoryReviews)), ['files/z2k-config-validator.sh']);
  assert.equal(component.details.manifest.seq, 48);
  assert.equal(component.details.manifest.current, 'r-80.3');
});

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
  assert.ok(buttonsOf(detailPanels[0]).includes('Обновить до v1.0.5'));
  assert.ok(buttonsOf(detailPanels[0]).includes('Проверить снова'));
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
  assert.ok(buttonsOf(details).includes('Проверить обновления'));
  assert.ok(!buttonsOf(findAll(rendered, node => classHas(node, 'z2m-component-card--z2k'))[0]).includes('Обновить до r-80.4'));
});

test('Z2K blocking review suppresses update even when a remote update is present', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'update-available',
    attentionState: 'review-required',
    canApply: false,
    availableRelease: 'r-80.4',
    blockingReviews: ['files/etc/z2k-roots.pem'],
    blockingReasons: ['trust root changed'],
  }));
  internals.state.z2kExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];

  assert.ok(!buttonsOf(details).includes('Обновить'));
  assert.match(textOf(details), /Требуется semantic review/);
});

test('Z2K advisory review keeps an applicable update action without becoming a primary warning', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'update-available',
    attentionState: 'review-advisory',
    canApply: true,
    availableRelease: 'r-80.4',
    local: {
      installed: true,
      integrity: 'verified',
      integrityOk: true,
      lua: { ready: 7, total: 7 },
      installedRelease: { value: 'r-80.3', confidence: 'confirmed', authority: 'activation-receipt' },
    },
    advisoryReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{ path: 'files/z2k-config-validator.sh', message: 'Наблюдаемый upstream-файл изменился.' }],
  }));
  internals.state.z2kExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const card = findAll(rendered, node => classHas(node, 'z2m-component-card--z2k'))[0];
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];
  const updateState = findAll(details, node => classHas(node, 'z2m-component-update-state'));
  const chip = findAll(card, node => classHas(node, 'z2m-chip'))[0];

  assert.ok(buttonsOf(details).includes('Проверить обновления'));
  assert.equal(textOf(chip), 'Доступно обновление');
  assert.equal(updateState.length, 0);
  assert.doesNotMatch(textOf(updateState), /Требует внимания/);
  assert.doesNotMatch(textOf(details), /Требует внимания/);
  assert.doesNotMatch(textOf(details), /Требуется semantic review/);
  assert.doesNotMatch(textOf(details), /Наблюдаемый upstream-файл изменился/);
});

test('Z2K advisory current keeps the Актуален primary badge without a secondary warning', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'current',
    attentionState: 'review-advisory',
    canApply: false,
    advisoryReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{ path: 'files/z2k-config-validator.sh', message: 'Наблюдаемый upstream-файл изменился.' }],
  }));
  internals.state.z2kExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const card = findAll(rendered, node => classHas(node, 'z2m-component-card--z2k'))[0];
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];
  const chip = findAll(card, node => classHas(node, 'z2m-chip'))[0];
  const updateState = findAll(details, node => classHas(node, 'z2m-component-update-state'));

  assert.equal(textOf(chip), 'Работает');
  assert.equal(updateState.length, 0);
  assert.doesNotMatch(textOf(details), /Требует внимания/);
  assert.doesNotMatch(textOf(details), /Наблюдаемый upstream-файл изменился/);
});

test('Z2K collapsed card answers update questions without promoting advisory files', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'update-available',
    attentionState: 'review-advisory',
    canApply: true,
    availableRelease: 'r-80.4',
    advisoryReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{ path: 'files/z2k-config-validator.sh', message: 'Наблюдаемый upstream-файл изменился.' }],
  }));

  const rendered = internals.renderComponents(ctx, ctx.data);
  const card = findAll(rendered, node => classHas(node, 'z2m-component-card--z2k'))[0];

  assert.match(textOf(card), /r-80\.4/);
  assert.doesNotMatch(textOf(card), /Требует внимания/);
  assert.ok(buttonsOf(card).includes('Проверить обновления'));
  assert.equal(findAll(card, node => classHas(node, 'z2m-component-review-callout')).length, 0);
  assert.equal(findAll(rendered, node => classHas(node, 'z2m-component-details')).length, 0);
});

test('Z2K advisory current remains Актуален in collapsed card without secondary attention', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'current',
    attentionState: 'review-advisory',
    advisoryReviews: ['files/z2k-config-validator.sh'],
  }));

  const rendered = internals.renderComponents(ctx, ctx.data);
  const card = findAll(rendered, node => classHas(node, 'z2m-component-card--z2k'))[0];

  assert.equal(textOf(findAll(card, node => classHas(node, 'z2m-chip'))[0]), 'Работает');
  assert.doesNotMatch(textOf(card), /Требует внимания/);
  assert.equal(findAll(card, node => classHas(node, 'z2m-component-review-callout--advisory')).length, 0);
});

test('hero reports an available update instead of saying no updates are required', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'update-available',
    attentionState: 'none',
    canApply: true,
    availableRelease: 'r-80.4',
  }));

  const rendered = internals.renderComponents(ctx, ctx.data);
  const hero = findAll(rendered, node => classHas(node, 'z2m-components-hero'))[0];

  assert.match(textOf(hero), /Доступно 1 обновление/);
  assert.doesNotMatch(textOf(hero), /Обновления не требуются/);
});

test('Z2K collapsed integration attention follows canonical attention, blocking and rebase fields', () => {
  const { internals } = loadMaintenance();

  assert.equal(internals.z2kNeedsIntegration({ updateState: 'current', attentionState: 'integration-required' }), true);
  assert.equal(internals.z2kNeedsIntegration({ updateState: 'current', attentionState: 'review-advisory', blockingReviews: ['files/etc/z2k-roots.pem'] }), true);
  assert.equal(internals.z2kNeedsIntegration({ updateState: 'current', attentionState: 'review-advisory', rebases: ['files/lua/z2k-state-persist.lua'] }), true);
  assert.equal(internals.z2kNeedsIntegration({ updateState: 'current', attentionState: 'review-advisory', advisoryReviews: ['files/z2k-config-validator.sh'] }), false);
});

test('Z2K rebase attention suppresses update and explains adapted files', () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw({
    updateState: 'current',
    attentionState: 'rebase-required',
    canApply: false,
    rebases: ['files/lua/z2k-state-persist.lua'],
  }));
  internals.state.z2kExpanded = true;

  const rendered = internals.renderComponents(ctx, ctx.data);
  const details = findAll(rendered, node => classHas(node, 'z2m-component-details'))[0];

  assert.ok(!buttonsOf(details).includes('Обновить'));
  assert.match(textOf(details), /Требуется адаптация/);
  assert.match(textOf(details), /z2k-state-persist\.lua/);
});

test('Z2K update prepares the selected release and sends its target token to resources_update', async () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw());
  const calls = [];
  const prepareCalls = [];
  let modal = null;
  ctx.shell.openModal = (title, message, actions) => { modal = { title, message, actions }; };
  ctx.api.resources.check = () => Promise.resolve({
    ok: true,
    checkedAt: 200,
    planToken: 'z2k-plan-v1:200:48:r-80.3',
    z2k: {
      ...z2kRaw({ updateState: 'update-available', canApply: true, planToken: 'z2k-plan-v1:200:48:r-80.3' }),
    },
  });
  ctx.api.resources.update = edit => {
    calls.push(JSON.parse(edit));
    return Promise.resolve({ ok: true, planned: 1, applied: 1 });
  };
  ctx.api.resources.prepareVersion = value => {
    prepareCalls.push(value);
    return Promise.resolve({ ok: true, target: { targetVersion: 'r-80.3', operation: 'reinstall' }, planToken: 'z2k-target-v2:test' });
  };

  internals.checkUpdates(ctx, 'z2k');
  await new Promise(resolve => setTimeout(resolve, 0));
  internals.updateZ2K(ctx, { updateState: 'update-available', canApply: true, selectedVersion: 'r-80.3', selectedDetails: { version: 'r-80.3', installable: true, operation: 'reinstall' } });
  assert.ok(modal, 'update must wait for explicit confirmation');
  modal.actions[1].attrs.click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(internals.state.z2kCheck.checkedAt, 200);
  assert.equal(internals.state.z2kCheck.manifest.current, 'r-80.3');
  assert.deepEqual(JSON.parse(JSON.stringify(prepareCalls)), [{ version: 'r-80.3' }]);
  assert.deepEqual(calls, [{ bundleId: 'z2k-curated-lua', confirm: true, targetVersion: 'r-80.3', planToken: 'z2k-target-v2:test' }]);
});

test('Z2K update confirms target release before prepare and mutation', async () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw());
  const calls = [];
  const prepareCalls = [];
  const toasts = [];
  let modal = null;
  ctx.shell.openModal = (title, message, actions) => { modal = { title, message, actions }; };
  ctx.shell.showToast = (message, kind) => { toasts.push({ message, kind }); };
  ctx.api.resources.update = edit => {
    calls.push(JSON.parse(edit));
    return Promise.resolve({ ok: true, planned: 1, applied: 1 });
  };
  ctx.api.resources.prepareVersion = value => {
    prepareCalls.push(value);
    return Promise.resolve({ ok: true, target: { targetVersion: 'r-80.4', operation: 'upgrade' }, planToken: 'z2k-target-v2:test' });
  };

  internals.updateZ2K(ctx, {
    updateState: 'update-available',
    attentionState: 'review-advisory',
    canApply: true,
    availableRelease: 'r-80.4',
    selectedVersion: 'r-80.4',
    selectedDetails: { version: 'r-80.4', installable: true, operation: 'upgrade' },
    advisoryReviews: ['files/z2k-config-validator.sh'],
  });

  assert.equal(calls.length, 0, 'resources_update must wait for explicit confirmation');
  assert.ok(modal, 'update must open a confirmation modal');
  assert.match(modal.title, /r-80\.4/);
  assert.match(textOf(modal.message), /r-80\.4/);
  assert.equal(modal.actions[1].attrs.label, 'Обновить до r-80.4');

  modal.actions[1].attrs.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(JSON.parse(JSON.stringify(prepareCalls)), [{ version: 'r-80.4' }]);
  assert.deepEqual(calls, [{ bundleId: 'z2k-curated-lua', confirm: true, targetVersion: 'r-80.4', planToken: 'z2k-target-v2:test' }]);
  assert.deepEqual(toasts, [{ message: 'Z2K Core: Обновить до r-80.4.', kind: 'ok' }]);
});

test('Z2K stale target stops before resources_update after confirmation', async () => {
  const { internals } = loadMaintenance();
  const ctx = makeContext(engineStatus(), z2kRaw());
  const calls = [];
  const toasts = [];
  let modal = null;
  ctx.shell.openModal = (title, message, actions) => { modal = { title, message, actions }; };
  ctx.shell.showToast = (message, kind) => { toasts.push({ message, kind }); };
  ctx.api.resources.prepareVersion = () => Promise.reject({ code: 'ECHECK_STALE', message: 'Z2K target snapshot is stale.' });
  ctx.api.resources.update = edit => { calls.push(JSON.parse(edit)); return Promise.resolve({ ok: true }); };

  internals.updateZ2K(ctx, { updateState: 'update-available', canApply: true, selectedVersion: 'r-80.4', selectedDetails: { version: 'r-80.4', installable: true, operation: 'upgrade' } });
  assert.equal(calls.length, 0, 'stale state must not mutate');
  assert.ok(modal, 'the selected target must still be confirmed before prepare');
  modal.actions[1].attrs.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(calls, []);
  assert.deepEqual(toasts.at(-1), { message: 'Z2K target snapshot is stale.', kind: 'err' });
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

  assert.match(textOf(unknown), /УстановленоВерсия не определена/);
  assert.match(textOf(missing), /УстановленоНе установлен/);
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
