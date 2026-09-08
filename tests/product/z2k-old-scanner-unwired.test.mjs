import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scannerDir = path.join(root, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager');
const uiDir = path.join(root, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager');
const manifest = path.join(root, 'router-deploy-runtime-composition.manifest');
const projection = path.join(root, 'scripts', 'public-projection.mjs');
const read = (file) => fs.readFileSync(file, 'utf8');

test('scanner-cli is a compatibility shell over typed Detect actions only', () => {
  const cli = read(path.join(scannerDir, 'scanner-cli.uc'));
  for (const operation of ['probe', 'classify', 'quic', 'voice', 'tcp16'])
    assert.match(cli, new RegExp(`z2k_detect_${operation}`), `scanner-cli must expose z2k_detect_${operation}`);
  assert.match(cli, /z2k_detect_discovery/);
  assert.doesNotMatch(cli, /scanner_worker|scanner_probe|scanner-planner|scanner-probes/);
  assert.doesNotMatch(cli, /fallback|legacy scanner|old scanner/i);
});

test('production no longer imports retired probing modules', () => {
  const productionFiles = [
    ...fs.readdirSync(scannerDir).filter((name) => /\.uc$/.test(name)).map((name) => path.join(scannerDir, name)),
    path.join(root, 'zapret2-manager', 'files', 'usr', 'share', 'rpcd', 'ucode', 'zapret2-manager.uc'),
    ...fs.readdirSync(uiDir).filter((name) => /\.js$/.test(name)).map((name) => path.join(uiDir, name))
  ];
  const production = productionFiles.map((file) => ({ file, source: read(file) }));
  for (const retired of ['scanner-worker.uc', 'scanner-probes.uc', 'scanner-probe-adapter.uc', 'scanner-probe-executor.uc', 'scanner-planner.uc']) {
    assert.equal(fs.existsSync(path.join(scannerDir, retired)), false, `${retired} must be removed`);
    for (const item of production) assert.doesNotMatch(item.source, new RegExp(retired.replace('.', '\\.'), 'i'), item.file);
  }
});

test('production deployment and projection evidence close over the surviving scanner', () => {
  const retired = ['scanner-worker.uc', 'scanner-probes.uc', 'scanner-probe-adapter.uc', 'scanner-probe-executor.uc', 'scanner-planner.uc'];
  const deployment = read(manifest);
  const evidence = read(projection);
  for (const name of retired) {
    assert.doesNotMatch(deployment, new RegExp(name.replace('.', '\\.'), 'i'), name + ' deployment entry');
    assert.doesNotMatch(evidence, new RegExp(name.replace('.', '\\.'), 'i'), name + ' projection evidence');
  }
  assert.match(deployment, /scanner-cli\.uc\|\/usr\/libexec\/zapret2-manager\/scanner-cli\.uc/);
  assert.match(evidence, /scanner-cli\.uc/);
});

test('Scanner exposes only typed Detect probe/classify/quic/voice/tcp16 and autodiscovery controls', () => {
  const source = read(path.join(uiDir, 'z2m-scanner.js')) + read(path.join(uiDir, 'z2m-scanner-product.js'));
  for (const operation of ['probe', 'classify', 'quic', 'voice', 'tcp16']) assert.match(source, new RegExp(operation));
  assert.match(source, /autodiscovery|discovery/i);
  assert.doesNotMatch(source, /candidate.?count|planner.?complexity|complexity.?planner/i);
  assert.doesNotMatch(source, /scanner_worker|scanner_probe|scanner-planner|scanner-probes/);
});

test('scanner-runtime-adapter is shared by non-Scanner profile activation and is KEEP_SHARED', () => {
  const adapterPath = path.join(scannerDir, 'scanner-runtime-adapter.sh');
  const profilesApply = read(path.join(scannerDir, 'profiles-apply.uc'));
  assert.equal(fs.existsSync(adapterPath), true);
  assert.match(profilesApply, /SCANNER_RUNTIME_ADAPTER/);
  assert.match(profilesApply, /scanner_runtime_call\('activate'/);
  assert.match(profilesApply, /scanner_runtime_call\('session-cleanup'/);
  assert.match(profilesApply, /scanner_runtime_call\('stabilize'/);
  assert.match(profilesApply, /scanner_runtime_call\('cleanup'/);
});
