import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BACKEND = path.join(ROOT, 'zapret2-manager');
const CANONICAL = path.join(BACKEND, 'files/usr/libexec/zapret2-manager');
const LEGACY = path.join(ROOT, 'files/usr/libexec/zapret2-manager');
const RPC = path.join(BACKEND, 'files/usr/share/rpcd/ucode/zapret2-manager.uc');
const ACL = path.join(ROOT, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const UI = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js');
const MANIFEST = path.join(ROOT, 'router-deploy-runtime-composition.manifest');

function read(file) { return fs.readFileSync(file, 'utf8'); }

const RETIRED = [
  'scanner-worker.uc',
  'scanner-probes.uc',
  'scanner-probe-adapter.uc',
  'scanner-probe-executor.uc',
  'scanner-planner.uc'
];

function productionSources() {
  return [
    ...fs.readdirSync(CANONICAL).filter((name) => /\.(?:uc|sh)$/.test(name)).map((name) => path.join(CANONICAL, name)),
    RPC,
    ...fs.readdirSync(path.dirname(UI)).filter((name) => /\.js$/.test(name)).map((name) => path.join(path.dirname(UI), name))
  ];
}

test('Scanner has exactly one canonical production source tree', () => {
  assert.equal(fs.existsSync(path.join(CANONICAL, 'scanner-cli.uc')), true);
  assert.equal(fs.existsSync(path.join(CANONICAL, 'scanner-cli-entry.uc')), true);
  assert.equal(fs.existsSync(LEGACY), false, 'root-level Scanner tree must not be production truth');
  assert.match(read(path.join(BACKEND, 'Makefile')), /\$\(CP\) \.\/files\/\* \$\(1\)\//);
});

test('Scanner compatibility shell and typed Detect RPC are packaged without retired modules', () => {
  const makefile = read(path.join(BACKEND, 'Makefile'));
  const cli = read(path.join(CANONICAL, 'scanner-cli.uc'));
  for (const module of ['scanner-cli.uc', 'scanner-cli-entry.uc', 'scanner-model.uc', 'scanner-results.uc']) {
    assert.equal(fs.existsSync(path.join(CANONICAL, module)), true, module);
    assert.match(makefile, /files\/\*/);
  }
  for (const retired of RETIRED) assert.equal(fs.existsSync(path.join(CANONICAL, retired)), false, retired);
  assert.match(cli, /z2k_detect_(probe|classify|quic|voice|tcp16)/);
  assert.match(cli, /z2k_detect_discovery/);
});

test('Production RPC/CLI/UI import closure contains no retired scanner modules or fallback', () => {
  for (const file of productionSources()) {
    const source = read(file);
    for (const retired of RETIRED) assert.doesNotMatch(source, new RegExp(retired.replace('.', '\\.'), 'i'), file);
    assert.doesNotMatch(source, /old scanner|legacy scanner|scanner_worker|scanner_probe/i, file);
  }
  const rpc = read(RPC);
  const acl = read(ACL);
  for (const method of ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated']) {
    assert.doesNotMatch(acl, new RegExp(`"${method}"`), method + ' ACL');
    assert.doesNotMatch(rpc, new RegExp(`\\b${method}:`), method + ' RPC');
  }
  assert.doesNotMatch(rpc, /scanner-cli-entry|scanner_edit_action|setsid sh -c/);
});

test('Deployment manifest and public projection close over the surviving Scanner authority', () => {
  const manifest = read(MANIFEST);
  const projection = read(path.join(ROOT, 'scripts/public-projection.mjs'));
  for (const retired of RETIRED) {
    assert.doesNotMatch(manifest, new RegExp(retired.replace('.', '\\.'), 'i'), retired + ' deployment entry');
    assert.doesNotMatch(projection, new RegExp(retired.replace('.', '\\.'), 'i'), retired + ' projection evidence');
  }
  assert.match(manifest, /scanner-cli\.uc\|\/usr\/libexec\/zapret2-manager\/scanner-cli\.uc/);
  assert.match(projection, /scanner-cli\.uc/);
});

test('Strategy Apply remains the sole permanent Apply path', () => {
  const scannerSources = fs.readdirSync(CANONICAL).filter((name) => name.startsWith('scanner-'));
  for (const name of scannerSources) assert.doesNotMatch(read(path.join(CANONICAL, name)), /strateg(?:y|ies)_apply|profiles_apply\s*\(/);
});
