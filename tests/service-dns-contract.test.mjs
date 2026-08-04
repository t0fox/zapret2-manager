// Contract checks for the shipped Split DNS request path. Backend source stays
// immutable during frontend completion; UI checks target z2m-dns.js and the
// central z2m-api facade.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const UI = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', 'utf8');
const API = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');
const BACKEND = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', 'utf8');
const WORKER = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc', 'utf8');
const ACL = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

test('all Service DNS RPC methods remain in the central facade and narrow ACL', () => {
  const read = ['service_dns_providers','service_dns_status','service_dns_preview','service_dns_apply_status'];
  const write = ['service_dns_set','service_dns_apply','service_dns_apply_async','service_dns_rollback'];
  for (const method of [...read, ...write]) assert.match(API, new RegExp(method));
  for (const method of read) assert.ok(ACL.read.ubus['zapret2-manager'].includes(method), method);
  for (const method of write) assert.ok(ACL.write.ubus['zapret2-manager'].includes(method), method);
  assert.equal(ACL.read.ubus['zapret2-manager'].includes('service_dns_set'), false);
});

test('backend service_dns_set advances and returns the authoritative draft revision', () => {
  const serviceSet = BACKEND.slice(BACKEND.indexOf('export const service_dns_set'), BACKEND.indexOf('export const service_dns_apply_async'));
  assert.match(serviceSet, /state\.draftRevision\s*=\s*\(state\.draftRevision\s*\|\|\s*0\)\s*\+\s*1/);
  assert.match(serviceSet, /return \{ ok: true, draftRevision: state\.draftRevision/);
});

test('Service DNS changes remain semantic drafts when no safe coordinator path exists', () => {
  assert.match(UI, /ctx\.setDraft\(['"]service-dns['"]/);
  assert.match(UI, /безопасный синхронный preview\/apply путь отсутствует/);
  assert.match(UI, /ctx\.openSemanticDiff/);
  assert.doesNotMatch(UI, /draftRevision:\s*setResult\.draftRevision/);
  assert.doesNotMatch(UI, /api\.dns\.serviceApplyAsync/);
});

test('UI polls async operation status without overlapping intervals', () => {
  assert.match(UI, /api\.dns\.serviceApplyStatus/);
  assert.match(UI, /serviceOperationTimer/);
  assert.match(UI, /serviceOperationInFlight/);
  assert.match(UI, /setTimeout/);
  assert.doesNotMatch(UI, /setInterval/);
  assert.match(UI, /terminalServiceOperation/);
});

test('UI clears pending operation and timer after Access denied, conflict or terminal failure', () => {
  assert.match(UI, /function clearServiceOperation/);
  assert.match(UI, /state\.operation\s*=\s*null/);
  assert.match(UI, /clearTimeout/);
  assert.match(UI, /catch\(function \(error\)[\s\S]*clearServiceOperation\(\)/);
  assert.match(UI, /terminalServiceOperation[\s\S]*clearServiceOperation\(\)/);
  assert.doesNotMatch(UI, /Configuration applied/);
});

test('Service DNS rollback is explicit and disabled without backend capability', () => {
  assert.match(UI, /api\.dns\.serviceRollback/);
  assert.match(UI, /serviceStatus\.rollbackAvailable\s*!==\s*true/);
  assert.match(UI, /Откатить DNS сервисов/);
});

test('async apply queues a native UCI job without production mutation', () => {
  const apply = BACKEND.slice(BACKEND.indexOf('function enqueue_native_apply'), BACKEND.indexOf('// service_dns_apply_async'));
  assert.match(apply, /nativeUciPrecondition/);
  assert.doesNotMatch(apply, /uci add_list/);
  assert.doesNotMatch(apply, /writefile\(tmpf, routingConf\)/);
});

test('worker uses native cursor and cuts legacy confdir over before verification', () => {
  assert.match(WORKER, /require\('uci'\)/);
  assert.match(WORKER, /cursor\(\)/);
  assert.match(WORKER, /previousUciServerEntries/);
  assert.match(WORKER, /remove_manager_confdir/);
  assert.doesNotMatch(WORKER, /uci show dhcp\.@dnsmasq\[0\]\.server/);
});

test('worker discovers effective config dynamically and never promotes fragment presence to runtime evidence', () => {
  assert.match(WORKER, /\/proc\//);
  assert.match(WORKER, /cmdline/);
  assert.match(WORKER, /legacy confdir remains registered/);
  assert.doesNotMatch(WORKER, /dnsmasq\.conf\.cfg01411c/);
  const runtimeAt = BACKEND.indexOf('runtimeForwardingVerified = false');
  const runtime = runtimeAt >= 0 ? BACKEND.slice(runtimeAt - 200, runtimeAt + 200) : '';
  assert.match(runtime, /runtimeForwardingVerified = false/);
  assert.doesNotMatch(WORKER, /runtimeForwardingVerified:\s*true/);
});
