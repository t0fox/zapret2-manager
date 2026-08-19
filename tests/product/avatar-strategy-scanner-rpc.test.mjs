import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const acl = JSON.parse(read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'));
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const ui = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js');
const app = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');

const managerAcl = acl['zapret2-manager'];
const readMethods = managerAcl.read.ubus['zapret2-manager'];
const writeMethods = managerAcl.write.ubus['zapret2-manager'];
const scannerMethods = ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated'];

test('Scanner RPC methods use fixed CLI subcommands and private bounded edit transport', () => {
  for (const method of scannerMethods)
    assert.match(rpc, new RegExp(`\\b${method}:\\s*\\{`), method);
  assert.match(rpc, /const SCANNER_CLI = ['"]\/usr\/libexec\/zapret2-manager\/scanner-cli\.uc['"]/);
  assert.match(rpc, /function scanner_edit_action\(sub, req, tag\)/);
  assert.match(rpc, /mktemp \/tmp\/zapret2-manager\/runtime\/requests\/scanner\.XXXXXX\.json/);
  assert.match(rpc, /writefile\(tmp, edit\)/);
  assert.match(rpc, /SCANNER_CLI \+ ' ' \+ sub \+ ' ' \+ tmp/);
  assert.match(rpc, /head -c/);
  assert.match(rpc, /unlink\(tmp\)/);
  for (const subcommand of ['start', 'status', 'results', 'stop', 'resume', 'save-generated'])
    assert.match(rpc, new RegExp(`scanner_edit_action\\('${subcommand}'`), subcommand);
  assert.doesNotMatch(rpc, /scanner.*(exec|command|argv).*req/i);
});

test('Scanner RPC methods have explicit read/write ACL placement', () => {
  assert.ok(readMethods.includes('scanner_status'));
  assert.ok(readMethods.includes('scanner_results'));
  for (const method of ['scanner_start', 'scanner_stop', 'scanner_resume', 'scanner_save_generated'])
    assert.ok(writeMethods.includes(method), method);
  assert.ok(!readMethods.includes('scanner_start'));
  assert.ok(!readMethods.includes('scanner_stop'));
});

test('Scanner API and view use server-owned lifecycle data', () => {
  for (const method of scannerMethods)
    assert.match(api, new RegExp(`method:'${method}'`), method);
  for (const method of ['start', 'status', 'results', 'stop', 'resume', 'saveGenerated'])
    assert.match(api, new RegExp(`\\b${method}:calls\\.`), method);
  for (const control of ['target', 'protocol', 'mode', 'resume', 'dpi_type'])
    assert.match(ui, new RegExp(control), control);
  for (const lifecycle of ['start', 'status', 'results', 'stop', 'resume', 'saveGenerated'])
    assert.match(ui, new RegExp(`ctx\\.api\\.scanner\\.${lifecycle}`), lifecycle);
  for (const hook of ['load:', 'render:', 'mount:', 'unmount:']) assert.match(ui, new RegExp(hook), hook);
  assert.match(ui, /setTimeout|setInterval/);
  assert.match(ui, /disposed|unmounted|generation|token/);
  assert.match(ui, /Save as Strategy|Preview|Validate|Apply|handoff/i);
  assert.match(ui, /Use Strategy|strategyId/);
  assert.doesNotMatch(ui, /nfqws|raw command|effectiveArgv|join\(['"] --new ['"]|\.sort\(/i);
  assert.match(app, /z2m-scanner as Scanner/);
  assert.match(app, /TAB_IDS = \['overview','strategy','scanner'/);
  assert.match(app, /MODULES = \{[\s\S]*scanner: Scanner/);
});
