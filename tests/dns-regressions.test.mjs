import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', import.meta.url), 'utf8');
const dns = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc', import.meta.url), 'utf8');
const globalDns = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc', import.meta.url), 'utf8');
const service = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc', import.meta.url), 'utf8');

test('Advanced DNS controls remain editable semantic drafts', () => {
  assert.match(ui, /id: 'z2m-dns-custom-rules'/);
  assert.match(ui, /function globalPayload\(revision\)/);
  assert.match(ui, /ctx\.clearDraft\(['"]dns-global['"]\)/);
});

test('dnsmasq status contract is explicit and ubus-backed', () => {
  assert.match(dns, /dnsmasq:\s*\{[\s\S]*installed: dm\.installed[\s\S]*running: active\.section != null[\s\S]*version: dm\.version/);
  assert.match(dns, /ubus call service list/);
});

test('DNS setup and provider checks use backend diagnostics', () => {
  assert.match(ui, /api\.dns\.check/);
  assert.match(ui, /function diagnoseProvider/);
  assert.match(ui, /function checkAllProviders/);
  assert.match(ui, /providerLatency/);
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

test('DNS component status uses the backend running and initPresent fields', () => {
  assert.match(ui, /item\.running === true/);
  assert.match(ui, /item\.initPresent === false/);
  assert.match(ui, /Инициализационный скрипт отсутствует/);
});

test('Service DNS access derives services from provider profiles', () => {
  assert.match(ui, /serviceCatalogRows/);
  assert.match(ui, /profile\.serviceId/);
  assert.match(ui, /serviceCatalogData\.items/);
});

test('System DNS status states when latency has not been measured', () => {
  assert.match(ui, /Системный DNS[\s\S]*не измерялся/);
  assert.match(ui, /function responseText\(provider\)/);
});

test('Advanced DNS controls submit their draft fields and clear custom rules', () => {
  assert.match(ui, /'class': 'z2m-sw'/);
  assert.match(ui, /function globalPayload\(revision\)/);
  assert.match(ui, /customRules: draft\.customRules/);
  assert.match(globalDns, /rm -f \/etc\/zapret2-manager\/dns-routing\.d\/99-custom\.conf/);
});
