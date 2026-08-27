import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-control-model.js');

function loadModel() {
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

const stopped = {
  serviceState: 'stopped',
  runtimeSummary: {
    status: 'stopped',
    process: { found: false },
    nfqueue: { number: 300, registered: false, rulesPresent: false }
  },
  health: { queue: { number: 300, registered: false } },
  strategyStatus: { id: 'split', name: 'split', availability: 'available' }
};

const running = {
  serviceState: 'running',
  runtimeSummary: {
    status: 'running',
    process: { found: true, pid: 16676, identityVerified: true },
    nfqueue: { number: 300, registered: true, ownerMatches: true, rulesPresent: true }
  },
  health: { queue: { number: 300, registered: true, ownerPid: 16676 } },
  strategyStatus: { id: 'split', name: 'split', availability: 'available' }
};

test('Control model has conservative STOPPED, RUNNING, and UNKNOWN states', () => {
  const model = loadModel();
  assert.equal(model.state(stopped), 'stopped');
  assert.equal(model.state(running), 'running');
  assert.equal(model.state({ runtimeSummary: {} }), 'unknown');
  assert.equal(model.state({ error: { code: 'ETIMEDOUT' } }), 'unknown');
  const stoppedView = model.normalize(stopped, {}, { pending: false });
  const runningView = model.normalize(running, {}, { pending: false });
  const unknownView = model.normalize({ runtimeSummary: {} }, {}, { pending: false });
  const pendingView = model.normalize(running, {}, { pending: true, action: 'start' });
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(stoppedView.actions).map(([key, value]) => [key, value.disabled])))), { start: false, stop: true, restart: true });
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(runningView.actions).map(([key, value]) => [key, value.disabled])))), { start: true, stop: false, restart: false });
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(unknownView.actions).map(([key, value]) => [key, value.disabled])))), { start: true, stop: true, restart: true });
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(pendingView.actions).map(([key, value]) => [key, value.disabled])))), { start: true, stop: true, restart: true });
});

test('Control model exposes structured process, strategy, and firewall evidence', () => {
  const model = loadModel();
  const view = model.normalize(running, { strategyState: { active: { id: 'split', name: 'split' } } });
  assert.equal(view.hero.label, 'Работает');
  assert.equal(view.process.value, 'Работает');
  assert.equal(view.process.pid, 16676);
  assert.equal(view.strategy.value, 'split');
  assert.equal(view.firewall.value, 'Применён');
  assert.equal(view.firewall.queueNumber, 300);
  assert.equal(view.firewall.registered, true);
  assert.equal(view.firewall.detailsVisible, true);
});

test('Control model keeps pending visible and maps lifecycle results to Russian copy', () => {
  const model = loadModel();
  const pending = model.normalize(stopped, null, { pending: true, action: 'start' });
  assert.equal(pending.hero.label, 'Запускается nfqws2…');
  assert.equal(pending.hero.pending, true);
  assert.equal(pending.actions.start.pending, true);
  assert.equal(pending.actions.start.label, 'Запустить');
  assert.equal(pending.actions.stop.disabled, true);
  assert.equal(model.actionCopy('restart').success, 'nfqws2 перезапущен');
  assert.equal(model.actionCopy('stop').failure, 'Не удалось остановить nfqws2');
});

test('Control model preserves fast-status running, stopped, and queue-owner error semantics', () => {
  const model = loadModel();
  const fastRunning = {
    schema: 'status-fast.v1', serviceState: 'running',
    runtimeSummary: { status: 'running', process: { found: true, pid: 42 }, nfqueue: { number: 300, registered: true, ownerMatches: true, rulesPresent: null } },
    health: { queue: { number: 300, registered: true, ownerConflict: false } },
    strategyStatus: { id: 'active-fast', name: 'Active fast' }
  };
  const fastStopped = {
    schema: 'status-fast.v1', serviceState: 'stopped',
    runtimeSummary: { status: 'stopped', process: { found: false }, nfqueue: { number: 300, registered: false, ownerMatches: null, rulesPresent: null } },
    health: { queue: { number: 300, registered: false } }, strategyStatus: null
  };
  const fastOwnerError = {
    schema: 'status-fast.v1', serviceState: 'error',
    runtimeSummary: { status: 'error', process: { found: true, pid: 42 }, nfqueue: { number: 300, registered: true, ownerMatches: false, rulesPresent: null } },
    health: { queue: { number: 300, registered: true, ownerConflict: true } }, strategyStatus: null
  };
  assert.equal(model.state(fastRunning), 'running');
  assert.equal(model.normalize(fastRunning, {}).strategy.value, 'Active fast');
  assert.equal(model.state(fastStopped), 'stopped');
  assert.equal(model.state(fastOwnerError), 'unknown');
  assert.equal(model.normalize(fastOwnerError, {}).firewall.registered, true);
  assert.equal(model.normalize(fastOwnerError, {}).firewall.value, 'Неизвестно');
});

test('Control model marks a fast-status firewall applied only with independent nft rule evidence', () => {
  const model = loadModel();
  const fastRunning = {
    schema: 'status-fast.v1', serviceState: 'running',
    runtimeSummary: { status: 'running', process: { found: true, pid: 42 },
      nfqueue: { number: 300, registered: true, ownerMatches: true, rulesPresent: true } },
    health: { queue: { number: 300, registered: true, ownerConflict: false } }
  };
  const noRules = JSON.parse(JSON.stringify(fastRunning));
  noRules.runtimeSummary.nfqueue.rulesPresent = false;
  const unknownRules = JSON.parse(JSON.stringify(fastRunning));
  unknownRules.runtimeSummary.nfqueue.rulesPresent = null;
  assert.equal(model.normalize(fastRunning, {}).firewall.value, 'Применён');
  assert.equal(model.normalize(noRules, {}).firewall.value, 'Не применён');
  assert.equal(model.normalize(unknownRules, {}).firewall.value, 'Неизвестно');
});
