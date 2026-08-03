import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', import.meta.url), 'utf8');
const dns = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc', import.meta.url), 'utf8');
const service = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc', import.meta.url), 'utf8');

test('Manual overrides have editable controls, discard and explicit validation/apply', () => {
  assert.match(ui, /placeholder:\s*['"]example\.com['"]/);
  assert.match(ui, /placeholder:\s*['"]1\.1\.1\.1['"]/);
  assert.match(ui, /Добавить переопределение/);
  assert.match(ui, /Отменить изменения/);
  assert.match(ui, /Проверить и применить/);
  assert.match(ui, /api\.dns\.validate[\s\S]*api\.dns\.set[\s\S]*api\.dns\.apply/);
  assert.match(ui, /ctx\.clearDraft\(['"]dns['"]\)/);
});

test('dnsmasq status contract is explicit and ubus-backed', () => {
  assert.match(dns, /dnsmasq:\s*\{[\s\S]*installed: dm\.installed[\s\S]*running: active\.section != null[\s\S]*version: dm\.version/);
  assert.match(dns, /ubus call service list/);
});

test('Setup actions include check, restore automatic DNS and sequential provider checks', () => {
  assert.match(ui, /api\.dns\.check/);
  assert.match(ui, /api\.dns\.restoreAuto/);
  assert.match(ui, /function checkAllProviders/);
  assert.match(ui, /reduce\s*\(/);
  assert.doesNotMatch(ui, /Promise\.all\([^\n]*diagnose/);
});

test('success feedback uses the typed success path', () => {
  assert.match(ui, /showToast\([^\n]+,\s*['"]ok['"]\)/);
  assert.doesNotMatch(ui, /Configuration applied[^\n]*err/);
});

test('DNS rollback availability is snapshot-backed and enforced in UI', () => {
  assert.match(dns, /rollbackAvailable: dns_snapshot_available\(\)/);
  assert.match(ui, /dns\.rollbackAvailable\s*!==\s*true/);
  assert.match(ui, /Откатить DNS/);
});

test('Service rollback is queued through the worker', () => {
  assert.doesNotMatch(service, /ENOTSUP/);
  assert.match(service, /kind: 'rollback'/);
  assert.match(service, /service-dns-apply-worker\.uc/);
  assert.match(worker, /if \(job\.kind == 'rollback'\) rollback_job\(\)/);
});

test('History renders applied revision and operation details without raw object coercion', () => {
  assert.match(ui, /appliedRevision/);
  assert.match(ui, /operationId/);
  assert.match(ui, /routeCount/);
  assert.doesNotMatch(ui, /\[object Object\]/);
});

test('manager-owned addnhosts warning is explicit', () => {
  assert.doesNotMatch(ui, /share the same overrides file/);
  assert.match(ui, /Файл DNS-переопределений менеджера не подключён к dnsmasq/);
});
