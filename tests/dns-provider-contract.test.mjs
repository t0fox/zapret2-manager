import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dnsprov = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov.uc', 'utf8');
const cli = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov-cli.uc', 'utf8');
const rpc = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'));
const ui = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js', 'utf8');

test('provider Select has RPC dispatcher, write ACL and UI handler', () => {
	assert.match(rpc, /dns_select_provider_method/);
	assert.match(rpc, /dns_select_provider:\s*\{ args: \{ edit: 'string' \}/);
	assert.ok(acl['zapret2-manager'].write.ubus['zapret2-manager'].includes('dns_select_provider'));
	assert.match(ui, /callProvSelect\s*=\s*rpc\.declare/);
	assert.match(ui, /selectBtn\.addEventListener\('click'/);
});

test('selection snapshots before native UCI mutation and has rollback verification', () => {
	assert.ok(dnsprov.indexOf('provider_snapshot(') < dnsprov.indexOf("c.set('network', 'wan', 'peerdns'"));
	assert.match(dnsprov, /rollback_network\(snapshot\)/);
	assert.match(dnsprov, /localhostDns/);
	assert.match(dnsprov, /routerDns/);
	assert.doesNotMatch(dnsprov, /dhcp.*server/);
});

test('diagnostic DNS probe is independent of ping and checks every IPv4', () => {
	assert.ok(dnsprov.indexOf('nslookup_probe(domain, p.ipv4[j])') < dnsprov.indexOf('ping_probe(resolver)'));
	assert.match(dnsprov, /j < length\(p\.ipv4\)/);
	assert.match(dnsprov, /resolverIp: resolver/);
	assert.match(dnsprov, /dnsAnswered: dns\.dnsAnswered/);
	assert.match(dnsprov, /pingAnswered: ping\.answered/);
});

test('UI updates each provider card, has retry handler and no custom CRUD controls', () => {
	assert.match(ui, /providerCardRefs = \{\};/);
	assert.match(ui, /updateProviderCard\(p\.id, res, null\)/);
	assert.match(ui, /updateProviderCard\(p\.id, null, e\)/);
	assert.match(ui, /view\.reload\(\)\.catch/);
	assert.doesNotMatch(ui, /Add custom provider|customProviderForm|Provider name/);
	assert.doesNotMatch(ui, /Save.*Test/);
});

test('dispatcher CLI exposes provider selection without shell-selected method names', () => {
	assert.match(cli, /mode == 'select'/);
	assert.match(cli, /dns_select_provider\(read_args/);
	assert.match(rpc, /cli_edit_action\(DNSPROV_CLI, 'select'/);
});
