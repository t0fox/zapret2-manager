import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const backendRoot = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Scanner history is a bounded read-only projection of existing Scanner state', () => {
  const state = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc');
  const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
  const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
  for (const name of ['scanner_state_history_list', 'scanner_state_history_get'])
    assert.match(state, new RegExp(`export const ${name}\\s*=`), name);
  assert.match(state, /lsdir\(root\(\)\)/);
  assert.match(state, /MAX_HISTORY|MAX_RECORDS|MAX_RESULTS/);
  for (const command of ['history', 'history-get']) assert.match(cli, new RegExp(command));
  for (const method of ['scanner_history_list', 'scanner_history_get']) {
    assert.doesNotMatch(rpc, new RegExp(`\\b${method}:`), method);
    assert.doesNotMatch(api, new RegExp(method.replace('scanner_', '')));
    assert.doesNotMatch(acl, new RegExp(`"${method}"`));
  }
  assert.doesNotMatch(acl, /"scanner_history_(list|get)"[^\n]*write/);
  assert.doesNotMatch(rpc, /scanner-orchestrator\.uc/);
  assert.equal(fs.existsSync(path.join(backendRoot, 'scanner-orchestrator.uc')), true);
});

test('NFQUEUE dependencies and fail-before-mutation preflight are explicit', () => {
  const makefile = read('zapret2-manager/Makefile');
  const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc');
  const preflight = path.join(backendRoot, 'scanner-dependency-preflight.uc');
  assert.match(makefile, /\+kmod-nfnetlink-queue/);
  assert.match(makefile, /\+kmod-nft-queue/);
  assert.equal(fs.existsSync(preflight), true);
  const source = fs.readFileSync(preflight, 'utf8');
  assert.match(source, /EDEPENDENCY/);
  assert.match(source, /nfnetlink_queue/);
  assert.match(source, /nft_queue/);
  assert.match(worker, /scanner_dependency_preflight/);
  const preflightPosition = worker.indexOf('scanner_dependency_preflight();');
  assert.ok(preflightPosition >= 0);
  assert.ok(preflightPosition < worker.indexOf('scanner_state_claim'), 'preflight must precede state claim');
  assert.ok(preflightPosition < worker.indexOf('scanner_session_begin('), 'preflight must precede session begin');
  assert.doesNotMatch(worker, /insmod|modprobe/);
});

test('Legacy Scanner RPC does not wire the module-safe entrypoint into production', () => {
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
  const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
  const entry = path.join(backendRoot, 'scanner-cli-entry.uc');
  assert.equal(fs.existsSync(entry), true, 'runtime entrypoint must exist');
  assert.match(fs.readFileSync(entry, 'utf8'), /import .*scanner-cli\.uc/);
  assert.match(fs.readFileSync(entry, 'utf8'), /scanner_cli_request/);
  assert.doesNotMatch(rpc, /scanner-cli-entry\.uc|scanner_edit_action|scanner_start_async/);
  assert.doesNotMatch(cli, /if \(ARGV\[0\] != null\)/);
});

test('Legacy Scanner RPC request temp transport is absent from production', () => {
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
  const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc');
  assert.doesNotMatch(rpc, /mktemp \/tmp\/zapret2-manager\/runtime\/requests\/scanner\.XXXXXX/);
  assert.doesNotMatch(rpc, /scanner\.XXXXXX\.json/);
  assert.match(cli, /REQUEST_ROOT/);
  assert.doesNotMatch(cli, /\.json\$\/\)\) return result\('EINPUT'/);
});

test('Scanner async start has no production RPC implementation', () => {
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
  assert.doesNotMatch(rpc, /function scanner_start_async\(req\)|function scanner_start_async_impl\(req\)|scanner_edit_action|SCANNER_CLI|setsid sh -c/);
});
