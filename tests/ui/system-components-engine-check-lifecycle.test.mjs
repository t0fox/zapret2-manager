import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const enginePanelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const enginePanelSource = fs.readFileSync(enginePanelPath, 'utf8');

function vnode(tag, attrs, children) {
  const list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  return { tag, attrs: attrs || {}, children: list };
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(textOf).join('');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadMaintenanceInternals() {
  const returnMarker = '\nreturn baseclass.extend({';
  const returnIndex = maintenanceSource.lastIndexOf(returnMarker);
  assert.ok(returnIndex >= 0, 'maintenance module return marker must exist');

  const rerenderSource = /function rerender\(ctx\) \{[\s\S]*?\n\}/;
  const instrumentedRerender = `function rerender(ctx) {
  var operation = state.componentOperation;
  ctx.dom.busy = !!operation;
  ctx.dom.operation = operation ? renderInlineOperation(ctx, { id: 'engine' }) : null;
  ctx.dom.operationText = textOf(ctx.dom.operation);
}`;
  const prefix = maintenanceSource.slice(0, returnIndex).replace(rerenderSource, instrumentedRerender);
  assert.notEqual(prefix, maintenanceSource.slice(0, returnIndex), 'test harness must replace rerender');

  const modelInputs = [];
  const componentsModel = {
    normalizePage(input) {
      modelInputs.push(input);
      return {
        checkedAt: input.checkedAt,
        health: { ready: 2, total: 2, state: 'ready', message: 'ok' },
        components: [
          {
            id: 'engine', label: 'Zapret2 Engine', summary: 'engine', health: 'ready', runtimeHealth: 'ready',
            updateState: 'current', compatibility: { state: 'compatible' }, installed: { version: 'v1.0.4' },
            available: {}, details: {}, counters: {}
          },
          {
            id: 'z2k-core', label: 'Z2K Core', summary: 'z2k', health: 'ready', runtimeHealth: 'ready',
            updateState: 'current', compatibility: { state: 'compatible' }, installedRelease: { value: 'r77' },
            availableRelease: null, details: { provenance: {} }, counters: {}
          }
        ]
      };
    }
  };

  const operationStatusCalls = [];
  const enginePanel = vm.runInNewContext(`(function () { ${enginePanelSource}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Model: {},
    ComponentsModel: {},
    window: { setInterval, clearInterval },
    Promise,
    setInterval,
    clearInterval,
    console
  }, { filename: enginePanelPath });

  const sandboxWindow = {
    setTimeout(fn, milliseconds) {
      return setTimeout(fn, milliseconds >= 1000 ? 5 : milliseconds);
    },
    clearTimeout
  };
  const code = `(function () {\n${prefix}\nreturn { checkUpdates, load, renderComponents, state };\n})()`;
  const internals = vm.runInNewContext(code, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: enginePanel,
    ComponentsModel: componentsModel,
    UpdatePresentation: { describe: value => ({ label: value }) },
    window: sandboxWindow,
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
    textOf
  }, { filename: maintenancePath });

  return { internals, modelInputs, operationStatusCalls };
}

function makeContext(internals, operationStatusCalls) {
  const freshEngineCheckAt = 2000;
  const oldResourcesCheckAt = 1000;
  const engineCheck = deferred();
  const refreshes = [];
  const toasts = [];

  const ctx = {
    route: 'components',
    dom: { busy: false, operation: null, operationText: '' },
    toasts,
    shell: {
      button: (label, kind, click, disabled) => vnode('button', { label, kind, click, disabled }, label),
      panel: (title, body) => vnode('section', {}, [title, body]),
      statePanel: options => vnode('div', {}, options && options.message || ''),
      switchControl: () => vnode('input', {}, ''),
      format: { timestamp: value => value ? `ts:${value}` : '' },
      showToast: (message, kind) => toasts.push({ message, kind }),
      openModal() {},
      closeModal() {}
    },
    store: { get: () => ({ ui: {} }), update() {} },
    api: {
      normalizeError: error => error && error.message ? error : { message: String(error || 'unknown') },
      maintenance: { versions: () => Promise.resolve({ ok: true }) },
      resources: {
        status: () => Promise.resolve({ ok: true, checkedAt: oldResourcesCheckAt, z2k: {} })
      },
      tg: { product: { status: () => Promise.resolve({ ok: true, status: 'not-installed', readiness: { installed: false } }) } },
      engine: {
        check: () => engineCheck.promise,
        gateStatus: () => Promise.resolve({ ok: true }),
        releases: () => Promise.resolve({ ok: true, fetchedAt: freshEngineCheckAt, releases: [] }),
        status: () => Promise.resolve({ ok: true, installed: true, serviceState: 'running' }),
        operationStatus: input => {
          operationStatusCalls.push(input);
          return Promise.resolve({ ok: true, operation: null });
        }
      }
    },
    refresh() {
      const refreshPromise = internals.load(ctx).then(data => {
        ctx.rendered = internals.renderComponents(ctx, data);
        ctx.dom.operation = internals.state.componentOperation
          ? internals.renderInlineOperation && internals.renderInlineOperation(ctx, { id: 'engine' })
          : null;
        refreshes.push(data);
        return data;
      });
      ctx.refreshPromise = refreshPromise;
      return refreshPromise;
    }
  };
  ctx.capture = { engineCheck, freshEngineCheckAt, oldResourcesCheckAt, refreshes, toasts };
  return ctx;
}

async function waitForRefresh(ctx) {
  for (let i = 0; i < 100 && !ctx.refreshPromise; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(ctx.refreshPromise, 'check must cross the refresh boundary');
  await ctx.refreshPromise;
}

async function runScenario(mode) {
  const { internals, modelInputs, operationStatusCalls } = loadMaintenanceInternals();
  const ctx = makeContext(internals, operationStatusCalls);

  const originalState = internals.state;
  const originalCheck = internals.checkUpdates;
  originalCheck(ctx, 'engine');
  assert.equal(originalState.componentOperation.kind, 'check');
  assert.equal(ctx.dom.busy, true, `${mode}: busy must be visible while pending`);
  assert.match(ctx.dom.operationText, /Проверка обновлений…Проверяем доступные версии…/, `${mode}: current busy copy must be visible`);

  if (mode === 'success') ctx.capture.engineCheck.resolve({ ok: true, checkedAt: ctx.capture.freshEngineCheckAt });
  if (mode === 'error') ctx.capture.engineCheck.reject({ code: 'EUPSTREAM', message: 'upstream failed' });
  await waitForRefresh(ctx);

  assert.equal(originalState.componentOperation, null, `${mode}: componentOperation must be cleared`);
  assert.equal(ctx.dom.operation, null, `${mode}: operation UI must be absent after refresh`);
  assert.equal(ctx.dom.busy, false, `${mode}: busy must be cleared after refresh`);
  assert.equal(operationStatusCalls.length, 0, `${mode}: synchronous Engine check must not poll engine_operation_status`);

  if (mode === 'success') {
    assert.equal(modelInputs.at(-1).checkedAt, ctx.capture.freshEngineCheckAt, 'successful Engine check must advance the canonical last-check timestamp');
  } else {
    assert.ok(ctx.toasts.some(toast => toast.kind === 'err'), `${mode}: error must be visible`);
  }
}

test('successful Engine check clears busy UI and uses fresh canonical timestamp', async () => {
  await runScenario('success');
});

test('failed Engine check shows an error and clears operation UI', async () => {
  await runScenario('error');
});

test('timed-out Engine check shows an error and clears operation UI', async () => {
  const { internals, modelInputs, operationStatusCalls } = loadMaintenanceInternals();
  const ctx = makeContext(internals, operationStatusCalls);
  internals.checkUpdates(ctx, 'engine');
  assert.equal(ctx.dom.busy, true, 'timeout: busy must be visible while pending');
  await waitForRefresh(ctx);
  assert.equal(internals.state.componentOperation, null, 'timeout: componentOperation must be cleared');
  assert.equal(ctx.dom.operation, null, 'timeout: operation UI must be absent after refresh');
  assert.equal(ctx.dom.busy, false, 'timeout: busy must be cleared after refresh');
  assert.ok(ctx.toasts.some(toast => toast.kind === 'err'), 'timeout: error must be visible');
  assert.equal(operationStatusCalls.length, 0, 'timeout: synchronous Engine check must not poll engine_operation_status');
  assert.equal(modelInputs.length, 1, 'timeout: canonical refresh must still render one page');
});
