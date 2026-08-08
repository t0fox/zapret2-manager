import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const uiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js';
const apiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js';
const ui = fs.readFileSync(uiPath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');
const facade = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov.uc', 'utf8');
const backend = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns/providers.uc', 'utf8');
const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = JSON.parse(fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

test('DNS tab uses the established provider facade and backend exports', () => {
  for (const method of ['dnsprov_components','dnsprov_providers','dnsprov_diagnose','dns_select_provider']) assert.match(api, new RegExp(method));
  for (const call of ['api.dns.components','api.dns.providers','api.dns.diagnose','api.dns.selectProvider']) assert.match(ui, new RegExp(call.replaceAll('.', '\\.')));
  assert.match(facade, /\.\/dns\/providers\.uc/);
  for (const exported of ['dnsprov_components','dnsprov_providers','dnsprov_diagnose','dns_select_provider']) {
    assert.match(backend, new RegExp(`export const ${exported}`));
    assert.match(facade, new RegExp(`export const ${exported} = impl\\.${exported}`));
  }
  assert.match(rpc, /dns_select_provider_method/);
});

test('selection snapshots before native UCI mutation and has rollback verification', () => {
  assert.ok(backend.indexOf('provider_snapshot(') < backend.indexOf("c.set('network', 'wan', 'peerdns'"));
  assert.match(backend, /rollback_network\(snapshot\)/);
  assert.match(backend, /localhostDns/);
  assert.match(backend, /routerDns/);
  assert.doesNotMatch(backend, /dhcp.*server/);
});

test('diagnostic DNS probe is independent of ping and checks every IPv4', () => {
  assert.ok(backend.indexOf('nslookup_probe(domain, p.ipv4[j])') < backend.indexOf('ping_probe(resolver)'));
  assert.match(backend, /j < length\(p\.ipv4\)/);
  assert.match(backend, /resolverIp: resolver/);
  assert.match(backend, /dnsAnswered: dns\.dnsAnswered/);
  assert.match(backend, /pingAnswered: ping\.answered/);
});

test('provider cards expose separate pending, success, failure and RPC error states', () => {
  for (const token of ['providerBusy','providerResults','providerErrors','z2m-provider-progress','z2m-provider-result-success','z2m-provider-result-fail','z2m-provider-result-error'])
    assert.match(ui, new RegExp(token));
  assert.match(ui, /providerId:\s*provider\.id/);
  assert.match(ui, /ctx\.api\.dns\.diagnose/);
  assert.match(ui, /ctx\.api\.dns\.selectProvider/);
  assert.doesNotMatch(ui, /innerHTML/);
});

test('Check all providers is sequential and does not fan out diagnostics', () => {
  assert.match(ui, /Проверить все/);
  assert.match(ui, /function checkAllProviders/);
  assert.match(ui, /reduce\s*\(/);
  assert.doesNotMatch(ui, /Promise\.all\([^\n]*diagnose/);
});

test('selected provider is derived from backend state and selection is explicit', () => {
  assert.match(ui, /selectedProviderId/);
  assert.match(ui, /z2m-provider-card-selected/);
  assert.match(ui, /apply:\s*true/);
  assert.match(ui, /shell\.button\(_\(['"]Выбрать['"]\)/);
});

test('provider diagnostics are read-only while selection stays write-only', () => {
  for (const method of ['dnsprov_components','dnsprov_providers','dnsprov_diagnose'])
    assert.ok(acl.read.ubus['zapret2-manager'].includes(method), method);
  assert.equal(acl.write.ubus['zapret2-manager'].includes('dnsprov_diagnose'), false);
  assert.ok(acl.write.ubus['zapret2-manager'].includes('dns_select_provider'));
  assert.equal(acl.read.ubus['zapret2-manager'].includes('dns_select_provider'), false);
});
