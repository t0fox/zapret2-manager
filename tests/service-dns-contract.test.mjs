// Contract checks for the shipped Split DNS request path. These are source-backed
// because the OpenWrt ucode runtime is not available in the Node test environment.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const UI = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/dns.js', 'utf8');
const BACKEND = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', 'utf8');
const WORKER = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc', 'utf8');
const FORMAT = UI.match(/function formatRpcError\(error\) \{[\s\S]*?\n\}/);
function format(error) {
	assert.ok(FORMAT, 'dns.js must provide formatRpcError');
	return Function(FORMAT[0] + '; return formatRpcError;')()(error);
}

test('structured RPC errors retain code and message', () => {
	assert.equal(format({ error: { code: 'ECONFLICT', message: 'revision mismatch' } }), 'ECONFLICT: revision mismatch');
	assert.equal(format({ code: -32002, message: 'Access denied' }), '-32002: Access denied');
	assert.equal(format({ error: 'worker failed' }), 'worker failed');
});

test('RPC error formatting never emits object coercion text', () => {
	assert.doesNotMatch(format({ detail: 'no route' }), /\[object Object\]/);
	assert.doesNotMatch(format({}), /\[object Object\]/);
});

test('UI applies the draft revision returned by service_dns_set', () => {
	assert.match(BACKEND, /return \{ ok: true, draftRevision: [^}]+ \}/);
	assert.match(UI, /callSdnsApplyAsync\(JSON\.stringify\(\{ operationId: opId, draftRevision: sr\.draftRevision \}\)\)/);
});

test('UI clears the pending operation after Access denied or revision conflict', () => {
	const catchBlock = UI.slice(UI.indexOf("}).catch(function (e) {"), UI.indexOf("\n\t\t});\n\t\t});", UI.indexOf("}).catch(function (e) {")));
	assert.match(catchBlock, /view\._sdnsOp = null;/);
	assert.doesNotMatch(catchBlock, /Configuration applied/);
});

test('async apply snapshots and registers only dnsmasq confdir', () => {
	const apply = BACKEND.slice(BACKEND.indexOf('function create_op_snapshot'), BACKEND.indexOf('export const service_dns_apply_status'));
	assert.match(apply, /uci show dhcp\.@dnsmasq\[0\]\.confdir/);
	assert.match(apply, /uci add_list dhcp\.@dnsmasq\[0\]\.confdir/);
	assert.doesNotMatch(apply, /conf_file/);
});

test('rollback restores the confdir registration together with the fragment', () => {
	assert.match(WORKER, /previous-uci-confdir/);
	assert.match(WORKER, /uci delete dhcp\.@dnsmasq\[0\]\.confdir/);
	assert.doesNotMatch(WORKER, /conf_file/);
});

test('effective dnsmasq configuration without the confdir fails verification', () => {
	assert.match(WORKER, /uci show dhcp\.@dnsmasq\[0\]\.confdir/);
	assert.match(WORKER, /confdir not registered after restart/);
});

test('fragment presence never promotes runtime forwarding evidence', () => {
	const runtimeAt = BACKEND.indexOf('runtimeForwardingVerified = false');
	const runtime = runtimeAt >= 0 ? BACKEND.slice(runtimeAt - 200, runtimeAt + 200) : '';
	assert.match(runtime, /runtimeForwardingVerified = false/);
	assert.doesNotMatch(WORKER, /runtimeForwardingVerified:\s*true/);
});
