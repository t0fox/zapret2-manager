import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runtime-state.js');
const watchdogPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc');
const enginePanelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js');
const overviewPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js');
const appPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');
const statusCollectorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc');
const statusCompatPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc');

function loadLuCIModel(file) {
  const source = fs.readFileSync(file, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, { console, baseclass: { extend: (value) => value } });
}

test('canonical runtime state maps every UI surface from one snapshot', () => {
  const model = loadLuCIModel(modelPath);
  assert.equal(model.state({ runtimeSummary: { status: 'running' } }), 'running');
  assert.equal(model.state({ serviceState: 'stopped', runtimeSummary: { status: 'unknown' } }), 'unknown');
  assert.equal(model.state({ runtimeSummary: { status: 'degraded' } }), 'degraded');
  assert.equal(model.state({ error: { code: 'ETIMEDOUT' } }), 'unavailable');
});

test('canonical runtime state does not call missing evidence stopped', () => {
  const model = loadLuCIModel(modelPath);
  assert.equal(model.state({ serviceState: 'stopped', runtime: { present: true }, runtimeSummary: {} }), 'unknown');
  assert.equal(model.state({ runtime: { present: false }, runtimeSummary: {} }), 'unknown');
});

test('watchdog matches NUL-delimited argv and qualified nft table', () => {
  const source = fs.readFileSync(watchdogPath, 'utf8');
  assert.match(source, /split\(cl,\s*chr\(0\)\)/);
  assert.match(source, /nft list table inet /);
  assert.doesNotMatch(source, /index\(replace\(cl, '\\x00', ' '\), DAEMON\)/);
  assert.doesNotMatch(source, /nft list table ' \+ NFT_TABLE/);
});

test('engine UI uses the official release catalog and keeps package metadata out of the normal version row', () => {
  const source = fs.readFileSync(enginePanelPath, 'utf8');
  assert.match(source, /state\.selectedVersion/);
  assert.match(source, /items\.filter\(function\(i\)/);
  assert.match(source, /status\.installedRelease/);
  assert.match(source, /value:status\.installedRelease/);
  assert.doesNotMatch(source, / · package /);
  assert.match(source, /Технические детали/);
  assert.doesNotMatch(source, /label: _\('Package version'\)/);
  assert.doesNotMatch(source, /Поддерживаются remittor\/zapret-openwrt/);
});

test('official release remains the only normal version authority while build metadata stays technical', () => {
  const overview = fs.readFileSync(overviewPath, 'utf8');
  const panel = fs.readFileSync(enginePanelPath, 'utf8');
  const collector = fs.readFileSync(statusCollectorPath, 'utf8');
  assert.doesNotMatch(overview, /detail[\s\S]{0,400}snapshot\.packageVersion/);
  assert.doesNotMatch(overview, /detail[\s\S]{0,400}snapshot\.runtimeVersion/);
  assert.match(panel, /value:status\.installedRelease/);
  assert.doesNotMatch(panel, / · package /);
  assert.match(panel, /packageVersion/);
  assert.match(panel, /runtimeBuild/);
  assert.match(collector, /apk info -e -v zapret2/);
  assert.match(collector, /packageVersion: packageVersion/);
  assert.match(collector, /serviceState: svc_state/);
  assert.match(fs.readFileSync(statusCompatPath, 'utf8'), /observations\.serviceState != null \? observations\.serviceState/);
});

test('legacy engine package removal verifies that APK ownership is actually gone', () => {
  const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh'), 'utf8');
  assert.match(worker, /apk del --no-interactive zapret2/);
  assert.match(worker, /remove_legacy_package\(\)[\s\S]{0,500}apk del --no-interactive zapret2[\s\S]{0,200}apk info -e zapret2[\s\S]{0,100}return 1/);
});

test('runtime mismatch is presented consistently instead of contradictory running/stopped labels', () => {
  const overview = fs.readFileSync(overviewPath, 'utf8');
  const app = fs.readFileSync(appPath, 'utf8');
  assert.match(overview, /snapshot\.state === 'mismatch'/);
  assert.match(app, /value === 'mismatch'.*расхождение/s);
});

test('Dashboard zapret2 card links to engine management', () => {
  const overview = fs.readFileSync(overviewPath, 'utf8');
  assert.match(overview, /card-zapret-ver/);
  assert.match(overview, /Официальный release bol-van\/zapret2/);
  assert.doesNotMatch(overview, /id: 'card-zapret-ver', label: 'zapret2'/,
    'engine version remains restrained System metadata rather than a peer overview card');
});
