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
    baseclass: { extend: value => value }
  });
}

const runningMismatch = {
  serviceState: 'running',
  runtimeSummary: {
    status: 'mismatch',
    process: { found: true, pid: 31110, identityVerified: true },
    nfqueue: { number: 300, registered: true, ownerMatches: true, rulesPresent: true }
  },
  strategyStatus: { id: 'z2k_all_in_one', name: 'z2k_all_in_one' }
};

const confirmedRunning = {
  serviceState: 'running',
  runtimeSummary: {
    status: 'running',
    process: { found: true, pid: 31110, identityVerified: true },
    nfqueue: { number: 300, registered: true, ownerMatches: true, rulesPresent: true }
  },
  health: { queue: { number: 300, registered: true, ownerPid: 31110 } },
  strategyStatus: { id: 'z2k_all_in_one', name: 'z2k_all_in_one' }
};

test('P02-V3 treats a running service with confirmed process evidence as RUNNING despite config mismatch', () => {
  const model = loadModel();
  assert.equal(model.state(runningMismatch), 'running');
  assert.equal(model.normalize(runningMismatch).hero.label, 'Работает');
  assert.equal(model.normalize(runningMismatch).process.value, 'Работает');
});
test('P02-V3 retains last-known-good state during a bounded refresh gap', () => {
  const model = loadModel();
  const view = model.normalize({ error: { code: 'ETIMEDOUT' } }, null, {
    now: 12000,
    lastKnownAt: 6000,
    lastKnownState: 'running',
    lastKnownStatus: confirmedRunning,
    pollIntervalMs: 3000,
    refreshing: false
  });
  assert.equal(view.state, 'running');
  assert.equal(view.hero.label, 'Работает');
  assert.match(view.hero.detail, /Обновление состояния/);
  assert.equal(view.process.value, 'Работает');
});

test('P02-V3 exposes genuine UNKNOWN after the last-known-good snapshot is stale', () => {
  const model = loadModel();
  const view = model.normalize({ error: { code: 'ETIMEDOUT' } }, null, {
    now: 20000,
    lastKnownAt: 6000,
    lastKnownState: 'running',
    lastKnownStatus: confirmedRunning,
    pollIntervalMs: 3000,
    refreshing: false
  });
  assert.equal(view.state, 'unknown');
  assert.equal(view.hero.label, 'Состояние неизвестно');
  assert.equal(view.process.value, 'Неизвестно');
});
