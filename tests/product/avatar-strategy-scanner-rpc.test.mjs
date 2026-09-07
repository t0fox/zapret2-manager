import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const state = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc');
const acl = JSON.parse(read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'));
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const ui = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js');
const product = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner-product.js');
const app = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');

const managerAcl = acl['zapret2-manager'];
const readMethods = managerAcl.read.ubus['zapret2-manager'];
const writeMethods = managerAcl.write.ubus['zapret2-manager'];
const scannerMethods = ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated'];

test('legacy Scanner RPC methods are removed from the production boundary', () => {
  for (const method of scannerMethods)
    assert.doesNotMatch(rpc, new RegExp(`\\b${method}:\\s*\\{`), method);
  assert.doesNotMatch(rpc, /SCANNER_CLI|scanner-cli-entry|scanner_edit_action|scanner_start_async_impl|setsid sh -c/);
  assert.doesNotMatch(api, /method:'scanner_/);
});

test('legacy Scanner RPC methods have no ACL placement', () => {
  for (const method of [...scannerMethods, 'scanner_history_list', 'scanner_history_get']) {
    assert.equal(readMethods.includes(method), false, method);
    assert.equal(writeMethods.includes(method), false, method);
  }
});

test('Scanner API and view use only the canonical typed Detect boundary', () => {
  for (const method of ['z2kDetectStatus', 'z2kDetectProbe', 'z2kDetectClassify', 'z2kDetectQuic', 'z2kDetectVoice', 'z2kDetectTcp16'])
    assert.match(api, new RegExp(`${method}:`), method);
  assert.doesNotMatch(api, /scannerUnavailable|scanner:\{/);
  for (const control of ['target', 'protocol', 'mode', 'dpi_type'])
    assert.match(ui, new RegExp(control), control);
  assert.doesNotMatch(ui, /ctx\.api\.scanner|api\.scanner/);
  assert.doesNotMatch(product, /ctx\.api\.scanner|api\.scanner/);
  for (const method of ['z2kDetectStatus', 'z2kDetectProbe', 'z2kDetectClassify', 'z2kDetectQuic', 'z2kDetectVoice', 'z2kDetectTcp16'])
    assert.match(ui + product, new RegExp(`ctx\\.api\\.${method}\\s*\\(`), method);
  for (const hook of ['load:', 'render:', 'mount:', 'unmount:']) assert.match(ui, new RegExp(hook), hook);
  assert.match(ui, /setTimeout|setInterval/);
  assert.match(ui, /disposed|unmounted|generation|token/);
  assert.match(ui, /Save as Strategy|Preview|Validate|Apply|handoff/i);
  assert.match(ui, /Use Strategy|strategyId/);
  assert.doesNotMatch(ui, /nfqws|raw command|effectiveArgv|join\(['"] --new ['"]|\.sort\(/i);
  assert.match(app, /z2m-scanner as Scanner/);
  assert.match(app, /z2m-scanner-product as ScannerProduct/);
  assert.match(app, /MODULES = \{[\s\S]*scan: ScannerProduct/);
});

test('Scanner refresh keeps the user on the canonical Scanner route', () => {
  assert.match(ui, /function refresh\(ctx\) \{\s*return ctx\.refresh\('scan'\);\s*\}/);
  assert.doesNotMatch(ui, /function refresh\(ctx\) \{\s*return ctx\.refresh\('strategy'\);\s*\}/);
  assert.match(product, /function childContext\(ctx, tab\) \{[\s\S]*refresh: function \(\) \{ return ctx\.refresh\('scan'\); \}/);
});

test('Scanner history reads one record per scan and applies the bound after sorting', () => {
  assert.ok(state.includes("substr(name, -12) != '.record.json'"));
  assert.match(state, /return \{ ok: true, items: slice\(rows, 0, limit\), limit: limit \};/);
  assert.doesNotMatch(state, /if \(length\(rows\) >= limit\) break;/);
});

test('Scanner history uses a bounded secure fast reader instead of serial helper RPCs', () => {
  assert.match(state, /function history_read_record\(id\)/);
  assert.match(state, /metadata\.type != 'file'/);
  assert.match(state, /metadata\.uid == 0/);
  assert.match(state, /metadata\.gid == 0/);
  assert.match(state, /metadata\.mode != 384/);
  assert.match(state, /readlink\(file\) != null/);
  assert.match(state, /let loaded = history_read_record\(id\)/);
  assert.match(state, /if \(!test_mode\(\) && !ensure_root\(\)\)/);
  assert.match(state, /const HISTORY_INDEX = '\.history\.json'/);
  assert.match(state, /source: 'compact-index'/);
  assert.match(state, /native\.atomic_write\('runtime', native_path\('', HISTORY_INDEX\)/);
  assert.match(state, /history_index_upsert\(candidate\)/);
});
