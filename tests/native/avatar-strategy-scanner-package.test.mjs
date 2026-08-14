import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backendMakefile = fs.readFileSync(path.join(ROOT, 'zapret2-manager/Makefile'), 'utf8');
const luciMakefile = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/Makefile'), 'utf8');
const rpc = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json',), 'utf8'))['zapret2-manager'];
const scannerDir = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager');
const scannerUiDir = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const scannerFiles = [
  'scanner-cli.uc', 'scanner-compiler-authority.uc', 'scanner-generator.uc',
  'scanner-model.uc', 'scanner-planner.uc', 'scanner-probe-adapter.uc',
  'scanner-probe-executor.uc', 'scanner-probes.uc', 'scanner-reconcile.uc',
  'scanner-results.uc', 'scanner-runtime-adapter.sh', 'scanner-state.uc',
  'scanner-targets.uc', 'scanner-transient.uc', 'scanner-worker.uc'
];

test('backend package copies every Scanner module and installs ucode with package mode', () => {
  assert.match(backendMakefile, /\$\(CP\) \.\/files\/\* \$\(1\)\//);
  assert.match(backendMakefile, /chmod 0644 \$\(1\)\/usr\/libexec\/zapret2-manager\/\*\.uc/);
  for (const name of scannerFiles) assert.ok(fs.existsSync(path.join(scannerDir, name)), name);
  assert.ok(fs.existsSync(path.join(scannerDir, 'core', 'native-helper.uc')), 'Scanner core dependency is packaged by files/*');
});

test('LuCI package copies Scanner view/API assets and ACL through existing wildcards', () => {
  assert.match(luciMakefile, /wildcard \.\/files\/usr\/share\/rpcd\/acl\.d\/\*\.json/);
  assert.match(luciMakefile, /wildcard \.\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/\*\.js/);
  for (const name of ['z2m-scanner.js', 'z2m-api.js', 'z2m-strategy-page.js'])
    assert.ok(fs.existsSync(path.join(scannerUiDir, name)), name);
  for (const method of ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated']) {
    assert.match(rpc, new RegExp(`\\b${method}:\\s*\\{`), method);
    assert.ok(acl.read.ubus['zapret2-manager'].includes(method) || acl.write.ubus['zapret2-manager'].includes(method), `ACL:${method}`);
  }
});

test('Scanner package surface preserves the single permanent Strategy Apply boundary', () => {
  const scannerSources = scannerFiles.filter(name => name.endsWith('.uc')).map(name => fs.readFileSync(path.join(scannerDir, name), 'utf8')).join('\n');
  const scannerUi = fs.readFileSync(path.join(scannerUiDir, 'z2m-scanner.js'), 'utf8');
  assert.match(scannerSources, /strategy_cli_dispatch/);
  assert.doesNotMatch(scannerSources, /scanner_apply|scannerApply/);
  assert.doesNotMatch(scannerUi, /scanner_apply|scannerApply/);
  assert.match(scannerUi, /strategies\[operation\]/);
});

test('Scanner package scope contains no DNS or Telegram package files', () => {
  assert.deepEqual(scannerFiles.filter(name => /dns|telegram/i.test(name)), []);
  assert.doesNotMatch(fs.readFileSync(path.join(scannerUiDir, 'z2m-scanner.js'), 'utf8'), /dns|telegram/i);
});
