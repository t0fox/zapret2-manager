import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

function loadModel() {
  const source = read('z2m-control-model.js');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: value => value }
  });
}

const stopped = {
  serviceState: 'stopped',
  runtimeSummary: { status: 'stopped', process: { found: false } },
  strategyStatus: { id: 'z2k_all_in_one', name: 'z2k_all_in_one' }
};

const running = {
  serviceState: 'running',
  runtimeSummary: { status: 'running', process: { found: true, pid: 1234 } },
  strategyStatus: { id: 'z2k_all_in_one', name: 'z2k_all_in_one' }
};

test('P02-V3 hero uses compact state copy and canonical human strategy metadata', () => {
  const model = loadModel();
  const stoppedView = model.normalize(stopped, { name: 'z2k всё-в-одном (TLS/HTTP + QUIC + Discord)' });
  const runningView = model.normalize(running, { name: 'z2k всё-в-одном (TLS/HTTP + QUIC + Discord)' });
  const pendingView = model.normalize(stopped, null, { pending: true, action: 'start' });
  assert.equal(stoppedView.hero.detail, 'nfqws2 не запущен');
  assert.equal(runningView.hero.detail, 'nfqws2 запущен · PID 1234');
  assert.equal(stoppedView.strategy.value, 'z2k всё-в-одном');
  assert.equal(stoppedView.strategy.detail, 'TLS/HTTP + QUIC + Discord');
  assert.equal(pendingView.hero.kind, 'pending');
});

test('P02-V3 wide hero uses a compact icon medallion and has no duplicate success status', () => {
  const page = read('z2m-avatar-control.js');
  const css = read('z2m-ui.css');
  assert.match(page, /if \(kind === 'pending'\) return E\('span'/);
  assert.match(page, /runtime\.result\.kind !== 'error'/);
  assert.doesNotMatch(page, /runtime\.result\.kind === 'success'/);
  assert.match(css, /control-status-indicator\{[^}]*width:50px;height:50px/);
  assert.match(css, /control-status-indicator\.running \.control-status-ring[^}]*animation/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
