import test from 'node:test';
import assert from 'node:assert/strict';
import {
	convertWinws2Line,
	parseZapret2GuiCatalog,
	buildZapret2GuiCandidates,
	selectZapret2Gui,
} from './lib/orchestra-zapret2gui.mjs';

test('imports a Zapret2GUI preset and generated candidate', () => {
	const defs = parseZapret2GuiCatalog('[tls_demo]\nname = TLS demo\nlabel = recommended\n--lua-desync=multisplit:pos=2\n', 'preset/demo.txt', 'rev1');
	assert.equal(defs.length, 1);
	const [candidate] = buildZapret2GuiCandidates(defs, { installedLua: ['multisplit'], installedBlobs: [] });
	assert.equal(candidate.source, 'zapret2gui');
	assert.equal(candidate.sourcePath, 'preset/demo.txt');
	assert.match(candidate.id, /^z2gui-tcp_https-[0-9a-f]{64}$/);
});

test('converts winws2 filters and HOSTLIST into one nfqws2 target line', () => {
	const result = convertWinws2Line('--filter-tcp=443 --hostlist-domains=<HOSTLIST> --payload=tls_client_hello --lua-desync=multisplit:pos=2', 'tcp_https', 'youtube.com');
	assert.equal(result.ok, true);
	assert.equal(result.parameters, '--payload=tls_client_hello --lua-desync=multisplit:pos=2');
	assert.deepEqual(result.removedManagerOnlyOptions, ['--filter-tcp=443', '--hostlist-domains=<HOSTLIST>']);
	assert.equal(result.scope, 'youtube.com');
});

test('preserves --new chain separators and detects required Lua/blob resources', () => {
	const result = convertWinws2Line('--filter-tcp=443 --payload=tls_client_hello --lua-desync=fake:blob=tls_google --new --lua-desync=multisplit:pos=2', 'tcp_https', 'youtube.com');
	assert.equal(result.parameters, '--payload=tls_client_hello --lua-desync=fake:blob=tls_google --new --lua-desync=multisplit:pos=2');
	assert.deepEqual(result.requiredLuaFunctions, ['fake', 'multisplit']);
	assert.deepEqual(result.requiredBlobs, ['tls_google']);
});

test('rejects unresolved placeholders and incompatible protocol resources', () => {
	const result = convertWinws2Line('--payload=tls_client_hello --lua-desync=custom_missing <MISSING>', 'tcp_https', 'youtube.com');
	assert.equal(result.ok, false);
	assert.equal(result.rejectionReason, 'unresolved placeholder');
});

test('deduplicates effective parameters while retaining all source references', () => {
	const defs = [
		{name: 'a', protocol: 'tcp_https', lines: ['--payload=tls_client_hello --lua-desync=multisplit:pos=2'], sourcePath: 'a.txt'},
		{name: 'b', protocol: 'tcp_https', lines: ['--payload=tls_client_hello --lua-desync=multisplit:pos=2'], sourcePath: 'b.txt'},
	];
	const result = buildZapret2GuiCandidates(defs, { installedLua: ['multisplit'], installedBlobs: [] });
	assert.equal(result.length, 1);
	assert.equal(result[0].sources.length, 2);
});

test('selects Recommended, All, Selected and Zapret2GUI-only modes', () => {
	const defs = [
		{name: 'recommended', label: 'recommended', protocol: 'tcp_https', lines: ['--payload=tls_client_hello --lua-desync=multisplit:pos=2'], sourcePath: 'a.txt'},
		{name: 'other', label: '', protocol: 'tcp_https', lines: ['--payload=tls_client_hello --lua-desync=multisplit:pos=1'], sourcePath: 'b.txt'},
	];
	const z2 = buildZapret2GuiCandidates(defs, { installedLua: ['multisplit'], installedBlobs: [] });
	assert.equal(selectZapret2Gui('zapret2gui-only', z2, []).length, 2);
	assert.equal(selectZapret2Gui('all', z2, []).length, 2);
	assert.equal(selectZapret2Gui('recommended', z2, []).length, 1);
	assert.equal(selectZapret2Gui('selected', z2, [z2[1].id]).length, 1);
});
