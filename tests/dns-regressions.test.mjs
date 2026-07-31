import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js', import.meta.url), 'utf8');
const dns = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc', import.meta.url), 'utf8');
const service = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc', import.meta.url), 'utf8');

test('Advanced status builds DOM children for the badge', () => {
	assert.match(ui, /h\(_\('Status: '\)\)[\s\S]*badge\(_\('Off'\), 'neutral'\)/);
	assert.doesNotMatch(ui, /_\('Status: '\)\s*\+\s*badge/);
});

test('Manual Overrides has real editable controls and RPC actions', () => {
	assert.match(ui, /['"]placeholder['"]:\s*_\('domain'\)/);
	assert.match(ui, /['"]placeholder['"]:\s*_\('IPv4'\)/);
	assert.match(ui, /_\('Add'\)/);
	assert.match(ui, /_\('Save & Apply'\)/);
	assert.match(ui, /_\('Discard'\)/);
	assert.match(ui, /callDnsValidate[\s\S]*callDnsSet[\s\S]*callDnsApply/);
});

test('dnsmasq status contract is explicit and ubus-backed', () => {
	assert.match(dns, /dnsmasq:\s*\{[\s\S]*installed: dm\.installed[\s\S]*running: active\.section != null[\s\S]*version: dm\.version/);
	assert.match(dns, /ubus call service list/);
});

test('Setup actions are wired and provider test-all is bounded sequential', () => {
	assert.match(ui, /callDnsCheck\(JSON\.stringify\(\{\}\)\)/);
	assert.match(ui, /callDnsRestoreAuto\(\)/);
	assert.match(ui, /function next\(\)[\s\S]*callProvDiag\(JSON\.stringify\(\{ provider: p\.id \}\)\)/);
});

test('success flash uses the green typed variant', () => {
	assert.match(ui, /showFlash\(_\('Configuration applied[^;]*\), 'success'\)/);
	assert.match(ui, /z2m-callout-success/);
});

test('DNS rollback availability is snapshot-backed', () => {
	assert.match(dns, /rollbackAvailable: dns_snapshot_available\(\)/);
	assert.match(ui, /dns\.rollbackAvailable === true/);
});

test('Service rollback is queued through the worker', () => {
	assert.doesNotMatch(service, /ENOTSUP/);
	assert.match(service, /kind: 'rollback'/);
	assert.match(service, /service-dns-apply-worker\.uc/);
	assert.match(worker, /if \(job\.kind == 'rollback'\) rollback_job\(\)/);
});

test('History uses appliedRevision and operation details', () => {
	assert.match(ui, /sdnsStatus\.appliedRevision/);
	assert.match(ui, /ev\.operationId/);
	assert.match(ui, /ev\.routeCount/);
});

test('old shared overrides-file wording is gone', () => {
	assert.doesNotMatch(ui, /share the same overrides file/);
	assert.match(ui, /separate manager-owned addnhosts file/);
});
