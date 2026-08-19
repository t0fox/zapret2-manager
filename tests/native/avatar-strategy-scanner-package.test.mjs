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

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('Scanner has exactly one production source tree', () => {
  assert.equal(fs.existsSync(path.join(CANONICAL, 'scanner-results.uc')), true);
  assert.equal(fs.existsSync(path.join(CANONICAL, 'scanner-worker.uc')), true);
  assert.equal(fs.existsSync(LEGACY) && fs.readdirSync(LEGACY).some((name) => name.startsWith('scanner-')), false,
    'root-level Scanner tree must not be production truth');
  assert.match(read(path.join(BACKEND, 'Makefile')), /\$\(CP\) \.\/files\/\* \$\(1\)\//);
});

test('Scanner ucode modules are packaged by backend wildcard', () => {
  const makefile = read(path.join(BACKEND, 'Makefile'));
  for (const module of ['scanner-model.uc', 'scanner-planner.uc', 'scanner-worker.uc', 'scanner-results.uc']) {
    assert.equal(fs.existsSync(path.join(CANONICAL, module)), true, module);
    assert.match(makefile, /files\/\*/);
  }
});

test('Scanner LuCI, ACL, and RPC surfaces are real and named consistently', () => {
  assert.ok(read(UI).trim().length > 0, 'Scanner LuCI module must not be empty');
  const acl = read(ACL);
  const rpc = read(RPC);
  for (const method of ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated']) {
    assert.match(acl, new RegExp(`"${method}"`), method + ' ACL');
    assert.match(rpc, new RegExp(`\\b${method}\\b`), method + ' RPC');
  }
});

test('Strategy Apply remains sole permanent Apply path', () => {
  const scannerSources = fs.readdirSync(CANONICAL).filter((name) => name.startsWith('scanner-'));
  for (const name of scannerSources) assert.doesNotMatch(read(path.join(CANONICAL, name)), /strateg(?:y|ies)_apply|profiles_apply\s*\(/);
});
