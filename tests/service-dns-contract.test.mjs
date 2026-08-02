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
	const asyncCall = UI.indexOf('view._sdnsOp.promise = callSdnsSet');
	const catchStart = UI.indexOf('}).catch(function (e) {', asyncCall);
	const catchBlock = UI.slice(catchStart, UI.indexOf('\n\t\t});', catchStart));
	assert.match(catchBlock, /view\._sdnsOp = null;/);
	assert.doesNotMatch(catchBlock, /Configuration applied/);
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

test('worker discovers the effective config dynamically and rejects legacy registration', () => {
	assert.match(WORKER, /\/proc\//);
	assert.match(WORKER, /cmdline/);
	assert.match(WORKER, /legacy confdir remains registered/);
	assert.doesNotMatch(WORKER, /dnsmasq\.conf\.cfg01411c/);
});

test('fragment presence never promotes runtime forwarding evidence', () => {
	const runtimeAt = BACKEND.indexOf('runtimeForwardingVerified = false');
	const runtime = runtimeAt >= 0 ? BACKEND.slice(runtimeAt - 200, runtimeAt + 200) : '';
	assert.match(runtime, /runtimeForwardingVerified = false/);
	assert.doesNotMatch(WORKER, /runtimeForwardingVerified:\s*true/);
});
