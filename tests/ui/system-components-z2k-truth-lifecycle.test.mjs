import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const componentsModelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const presentationPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
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

function buttonsOf(node) {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(buttonsOf);
  if (typeof node !== 'object') return [];
  return (node.tag === 'button' ? [node.attrs.label] : []).concat(buttonsOf(node.children || []));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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
  const code = `(function () {\n${prefix}\nreturn { renderComponents, checkUpdates, load, render, state };\n})()`;
  return vm.runInNewContext(code, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: {
      load: () => Promise.resolve([{}, {
        installed: true,
        serviceState: 'running',
        runtimeRunning: true,
        compatible: true,
      }]),
      render: () => null,
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
      provenance: { source: 'Z2K Resources', sourceCommit: 'p-79.18' },
    },
    manifest: { current: 'r-80.3' },
    ...overrides,
  };
}

function dataFor(z2k, options = {}) {
  return {
    components: {
      versions: { value: {} },
      engine: { value: [options.engineCatalog || {}, {
        installed: true,
        serviceState: 'running',
        runtimeRunning: true,
        compatible: true,
      }] },
      resources: { value: { checkedAt: options.resourcesCheckedAt === undefined ? 100 : options.resourcesCheckedAt, z2k } },
      telegram: { value: { ok: true, status: 'not-installed', readiness: { installed: false } } },
    },
  };
}

function makeContext(internals, initialZ2k, refreshedZ2k = initialZ2k, options = {}) {
  const check = deferred();
  const refreshes = [];
  const toasts = [];
  const statusResponses = [
    { ok: true, checkedAt: 300, z2k: refreshedZ2k },
  ];
  const ctx = {
    route: 'components',
    data: dataFor(initialZ2k, options),
    rendered: null,
    root: { replaceChildren(node) { this.node = node; } },
    shell: {
      button: (label, kind, click, disabled) => vnode('button', { label, kind, click, disabled }, label),
      panel: (title, body) => vnode('section', {}, [title, body]),
      statePanel: opts => vnode('div', {}, opts && opts.message || ''),
      switchControl: () => vnode('input', {}, ''),
      format: { timestamp: value => value ? `ts:${value}` : '' },
      showToast: (message, kind) => toasts.push({ message, kind }),
      openModal() {},
      closeModal() {},
    },
    store: { get: () => ({ ui: {} }), update() {} },
    api: {
      normalizeError: error => error && error.message ? error : { message: String(error || 'unknown') },
      maintenance: { versions: () => Promise.resolve({ ok: true }) },
      resources: {
        check: () => check.promise,
        status: () => Promise.resolve(statusResponses.shift() || { ok: true, checkedAt: 300, z2k: refreshedZ2k }),
      },
      tg: { product: { status: () => Promise.resolve({ ok: true, status: 'not-installed', readiness: { installed: false } }) } },
      engine: {},
    },
    refresh() {
      const promise = internals.load(ctx).then(data => {
        ctx.data = data;
        ctx.rendered = internals.renderComponents(ctx, data);
        refreshes.push(data);
        return data;
      });
      ctx.refreshPromise = promise;
      return promise;
    },
  };
  ctx.capture = { check, refreshes, toasts };
  return ctx;
}

test('healthy materialized Z2K with unknown release renders neutral identity wording', () => {
  const internals = loadMaintenance();
  const ctx = makeContext(internals, z2kRaw());
  const text = textOf(internals.renderComponents(ctx, ctx.data));

  assert.match(text, /УстановленоВерсия не определена/);
  assert.match(text, /Z2K CoreРесурсы Z2K для обхода блокировокРаботаетУстановленоВерсия не определена/);
});

test('actually missing Z2K still renders Не установлен', () => {
  const internals = loadMaintenance();
  const missing = z2kRaw({
    updateState: 'unknown',
    local: { installed: false, integrity: 'broken', integrityOk: false, lua: { ready: 0, total: 7 } },
  });
  const ctx = makeContext(internals, missing);
  const text = textOf(internals.renderComponents(ctx, ctx.data));

  assert.match(text, /УстановленоНе установлен/);
});

test('review-required exposes a standalone review explanation and safe re-check', () => {
  const internals = loadMaintenance();
  const review = z2kRaw({
    updateState: 'review-required',
    reviews: ['files/z2k-config-validator.sh'],
    blockingReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{
      path: 'files/z2k-config-validator.sh',
      reason: 'watched-upstream-file-changed',
      message: 'Наблюдаемый upstream-файл изменился; требуется semantic review.',
    }],
  });
  const ctx = makeContext(internals, review);
  internals.state.z2kExpanded = true;
  const rendered = internals.renderComponents(ctx, ctx.data);
  const text = textOf(rendered);
  const buttons = buttonsOf(rendered);

  assert.match(text, /Подробнее/, 'review state must keep the details disclosure available');
  assert.ok(buttons.includes('Проверить обновления'), 'explicit re-check must remain available');
  assert.ok(!buttons.includes('Обновить'), 'review state must not invent an update action');
  assert.match(text, /Причина проверки/);
  assert.match(text, /Блокирующих зависимостей: 1/);
});

test('catalog fetchedAt never becomes the Components last-check timestamp', () => {
  const internals = loadMaintenance();
  const checked = z2kRaw({ checkedAt: 100 });
  const ctx = makeContext(internals, checked, checked, { engineCatalog: { fetchedAt: 999 } });
  const text = textOf(internals.renderComponents(ctx, ctx.data));

  assert.match(text, /Последняя проверка: ts:100/);
  assert.doesNotMatch(text, /ts:999/);
});

test('catalog fetch alone leaves the explicit last-check timestamp unknown', () => {
  const internals = loadMaintenance();
  const noCheck = z2kRaw({ checkedAt: null });
  const ctx = makeContext(internals, noCheck, noCheck, {
    resourcesCheckedAt: null,
    engineCatalog: { fetchedAt: 999 },
  });
  const text = textOf(internals.renderComponents(ctx, ctx.data));

  assert.match(text, /Последняя проверка: ещё не проверялось/);
  assert.doesNotMatch(text, /ts:999/);
});

test('Engine catalog fetchedAt is not an explicit Engine check timestamp', () => {
  const model = loadComponentsModel();
  const page = model.normalizePage({
    engine: { status: { installed: true, serviceState: 'running', runtimeRunning: true, compatible: true }, catalog: { fetchedAt: 999 } },
    z2k: z2kRaw({ checkedAt: null }),
  });

  assert.equal(page.components.find(component => component.id === 'engine').checkedAt, null);
});

test('unresolved review survives a fresh re-check and is not rewritten to current', async () => {
  const internals = loadMaintenance();
  const review = z2kRaw({
    updateState: 'review-required',
    reviews: ['files/z2k-config-validator.sh'],
    blockingReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{
      path: 'files/z2k-config-validator.sh',
      reason: 'watched-upstream-file-changed',
      message: 'Наблюдаемый upstream-файл изменился; требуется semantic review.',
    }],
  });
  const ctx = makeContext(internals, review, review);
  internals.state.z2kExpanded = true;
  internals.checkUpdates(ctx, 'z2k');
  assert.equal(internals.state.componentOperation.kind, 'check');
  assert.equal(internals.state.componentOperation.scope, 'z2k');
  assert.ok(ctx.root.node, 're-check must render a pending state');
  assert.match(textOf(ctx.root.node), /Проверка обновлений…Проверяем доступные версии…/);

  ctx.capture.check.resolve({ ok: true, checkedAt: 300, z2k: review });
  for (let i = 0; i < 100 && !ctx.refreshPromise; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(ctx.refreshPromise, 're-check must cross the refresh boundary');
  await ctx.refreshPromise;

  assert.equal(internals.state.componentOperation, null);
  assert.match(textOf(ctx.rendered), /Есть блокирующие зависимости/);
  assert.doesNotMatch(textOf(ctx.rendered), /Требуется semantic review/);
  assert.doesNotMatch(textOf(ctx.rendered), /ОбновленияАктуально/);
});

test('review clears only when the refreshed canonical backend state is current', () => {
  const internals = loadMaintenance();
  const review = z2kRaw({
    updateState: 'review-required',
    reviews: ['files/z2k-config-validator.sh'],
    blockingReviews: ['files/z2k-config-validator.sh'],
    reviewDetails: [{ path: 'files/z2k-config-validator.sh', message: 'review remains unresolved' }],
  });
  const current = z2kRaw({ updateState: 'current', reviews: [], reviewDetails: [] });
  const ctx = makeContext(internals, review);
  const reviewText = textOf(internals.renderComponents(ctx, ctx.data));
  const currentText = textOf(internals.renderComponents(ctx, { ...dataFor(current), components: { ...dataFor(current).components, resources: { value: { checkedAt: 200, z2k: current } } } }));

  assert.match(reviewText, /Есть блокирующие зависимости/);
  assert.match(currentText, /Работает/);
  assert.doesNotMatch(currentText, /Причина проверки/);
});
