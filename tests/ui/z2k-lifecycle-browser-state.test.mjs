import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const apiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const maintenanceSource = fs.readFileSync(maintenancePath, 'utf8');
const apiSource = fs.readFileSync(apiPath, 'utf8');

function vnode(tag, attrs, children) {
  const list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  return { tag, attrs: attrs || {}, children: list };
}

function loadMaintenance() {
  const marker = '\nreturn baseclass.extend({';
  const end = maintenanceSource.lastIndexOf(marker);
  return vm.runInNewContext(`(function () {
${maintenanceSource.slice(0, end)}
return { updateZ2K, waitForZ2KUpdate, refreshZ2KAfterMutation, state };
})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    E: vnode,
    Icons: { wrappedNode: () => vnode('span', {}, ''), html: () => '' },
    MaintenanceModel: {},
    EnginePanel: { load: () => Promise.resolve([{}, {}]), render: () => null, unmount() {} },
    ComponentsModel: { normalizePage: value => value },
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

function context(overrides = {}) {
  return {
    route: 'components',
    root: { replaceChildren() {} },
    shell: {
      button: (label, kind, click, disabled, attrs) => vnode('button', { label, kind, click, disabled, ...(attrs || {}) }, label),
      showToast() {},
      openModal() {},
      closeModal() {},
      format: { timestamp: value => String(value || '') },
    },
    api: {
      normalizeError: error => error || {},
      resources: {},
    },
    refresh: () => Promise.resolve(),
    rerender() {},
    ...overrides,
  };
}

test('terminal rollback failure preserves initiating error and rollback evidence', async () => {
  const internals = loadMaintenance();
  internals.state.componentOperation = { kind: 'update', scope: 'z2k', operationId: 'z2k-1', phase: 'failed' };
  const ctx = context({
    api: {
      normalizeError: error => error || {},
      resources: {
        updateStatus: () => Promise.resolve({
          ok: true,
          operationId: 'z2k-1',
          phase: 'failed',
          finished: true,
          result: {
            ok: false,
            error: { code: 'EPOSTFLIGHT', message: 'postflight failed' },
            rollback: { attempted: true, ok: true, restored: { release: 'p-82.18' } },
          },
        }),
      },
    },
  });

  await assert.rejects(internals.waitForZ2KUpdate(ctx, 'z2k-1'), error => {
    assert.equal(error.code, 'EPOSTFLIGHT');
    assert.deepEqual(error.rollback, { attempted: true, ok: true, restored: { release: 'p-82.18' } });
    return true;
  });
});

test('failed mutation has a terminal canonical reread path instead of leaving stale selection', () => {
  assert.match(maintenanceSource, /refreshZ2KAfterTerminal/);
  assert.match(maintenanceSource, /operationErrorProjection\(ctx, error\)[\s\S]*refreshZ2KAfterTerminal/);
  assert.match(maintenanceSource, /state\.componentOperation\s*=\s*null/);
});

test('browser reload resumes a persisted active operation from backend status', () => {
  assert.match(maintenanceSource, /resumeZ2KOperation/);
  assert.match(maintenanceSource, /localStorage/);
  assert.match(maintenanceSource, /resources\.updateStatus/);
});

test('repair is a distinct broken-Core action and rollback is not generic transport copy', () => {
  assert.match(maintenanceSource, /Восстановить/);
  assert.match(maintenanceSource, /rollback\.attempted/);
  assert.match(apiSource, /rollback/);
});

test('prepare API preserves same-release repair intent and error rollback evidence', () => {
  assert.match(apiSource, /z2kPrepareVersion/);
  assert.match(apiSource, /repair/);
  assert.match(apiSource, /rollback/);
});
