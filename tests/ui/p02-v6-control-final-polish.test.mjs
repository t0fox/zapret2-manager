import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const managerRoot = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager');
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

function loadModel() {
  return vm.runInNewContext(`(function () { ${read(viewRoot, 'z2m-control-model.js')}\n })()`, {
    baseclass: { extend: value => value }
  });
}

const running = {
  serviceState: 'running',
  runtimeSummary: { status: 'running', process: { found: true, pid: 1538 } },
  strategyStatus: { id: 'z2k_all_in_one', name: 'z2k_all_in_one' }
};

test('P02-V6 strategy card uses canonical human name and source-owned subtitle', () => {
  const model = loadModel();
  const view = model.normalize(running, {
    name: 'z2k всё-в-одном (TLS/HTTP + QUIC + Discord)',
    description: 'Один автоподбор на всё: TCP TLS/HTTP, YouTube QUIC и Discord.'
  });
  assert.equal(view.strategy.value, 'z2k всё-в-одном');
  assert.equal(view.strategy.detail, 'TLS/HTTP + QUIC + Discord');
});

test('P02-V6 explicit presentation metadata wins over canonical-name splitting', () => {
  const model = loadModel();
  const view = model.normalize(running, {
    displayName: 'Canonical presentation name',
    shortDescription: 'Canonical presentation subtitle',
    name: 'raw_id (must not become the UI label)'
  });
  assert.equal(view.strategy.value, 'Canonical presentation name');
  assert.equal(view.strategy.detail, 'Canonical presentation subtitle');
});

test('P02-V6 firewall rows have fixed semantic icon and state slots', () => {
  const page = read(viewRoot, 'z2m-avatar-control.js');
  const css = read(viewRoot, 'z2m-ui.css');
  assert.match(page, /control-firewall-icon-slot/);
  assert.match(page, /label\('network', _\('Очередь NFQUEUE'\)\)/);
  assert.match(page, /label\('route', _\('Правила перенаправления'\)\)/);
  assert.match(page, /control-firewall-state .*icon\(confirmed \? 'circle-check' : 'circle-alert'/);
  assert.match(css, /control-firewall-label\{display:grid;grid-template-columns:18px minmax\(0,1fr\)/);
  assert.match(css, /control-firewall-icon-slot svg\{display:block;width:16px;height:16px/);
  assert.match(css, /control-firewall-state\{display:grid;grid-template-columns:16px auto/);
  assert.match(css, /control-firewall-state svg\{display:block;width:15px;height:15px/);
});

test('P02-V6 manual transitions suppress only bounded convergence, not real loss', () => {
  const constants = read(managerRoot, 'constants.uc');
  const service = read(managerRoot, 'service.uc');
  const watchdog = read(managerRoot, 'watchdog.uc');
  assert.match(constants, /MANUAL_TRANSITION_TTL_SEC = 15/);
  assert.match(constants, /manual_transition: '/);
  assert.match(service, /begin_manual_transition\('start'\)/);
  assert.match(service, /begin_manual_transition\('restart'\)/);
  assert.match(service, /code: 'manual_start'/);
  assert.match(service, /code: 'manual_restart'/);
  assert.match(watchdog, /reason: 'manual_transition'/);
  assert.match(watchdog, /reason: 'desired_stopped'/);
  assert.match(watchdog, /code: 'process_unexpected_loss'/);
  assert.match(watchdog, /code: 'queue_not_registered'/);
  assert.match(watchdog, /code: 'rules_missing'/);
  assert.match(watchdog, /desiredState: 'running'/);
});
