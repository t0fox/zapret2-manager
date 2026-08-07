// parse.test.mjs — profile structure + top-level extraction tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './lib/parse.mjs';

// Mandatory check #2: `--new` creates a profile.
test('--new splits profiles; first profile exists before the first --new', () => {
	const m = parse('--filter-tcp=443\n--new\n--filter-udp=443');
	assert.equal(m.profiles.length, 2);
	assert.equal(m.profiles[0].tcpPorts.length, 1);
	assert.equal(m.profiles[1].udpPorts.length, 1);
	assert.equal(m.profiles[0].separator, null); // implicit first profile
	assert.equal(m.profiles[1].separator.form, 'new');
});

// Mandatory check #3: `--new=GamesTCP` creates a profile AND a name.
test('--new=GamesTCP begins a named profile (native semantics, nfqws.c:2738)', () => {
	const m = parse('--filter-tcp=80\n--new=GamesTCP\n--filter-tcp=1024-65535');
	assert.equal(m.profiles.length, 2);
	assert.equal(m.profiles[1].name, 'GamesTCP');
	assert.equal(m.profiles[1].nameSource, 'new');
	assert.equal(m.profiles[1].separator.form, 'new-with-name');
	assert.equal(m.profiles[1].separator.raw, '--new=GamesTCP');
});

// Mandatory check #4: `--new --name=GamesTCP` yields the same manager-level name.
test('--new --name=GamesTCP gives the same name via name-option', () => {
	const a = parse('--new=GamesTCP\n--filter-tcp=443');
	const b = parse('--new\n--name=GamesTCP\n--filter-tcp=443');
	assert.equal(a.profiles[0].name, 'GamesTCP');
	assert.equal(b.profiles[0].name, 'GamesTCP');
	assert.equal(b.profiles[0].nameSource, 'name-option');
});

test('a leading --new does not create a phantom empty profile before it', () => {
	const m = parse('--new\n--filter-tcp=443');
	assert.equal(m.profiles.length, 1);
	assert.equal(m.profiles[0].separator.form, 'new');
	assert.equal(m.profiles[0].tcpPorts.length, 1);
});

test('profile without a name is allowed (name stays null)', () => {
	const m = parse('--filter-tcp=443');
	assert.equal(m.profiles[0].name, null);
	assert.equal(m.profiles[0].nameSource, null);
});

test('trailing --new: no empty profile, MANAGER_TRAILING_NEW_SEPARATOR, token preserved', () => {
	const m = parse('--filter-tcp=443\n--new');
	assert.equal(m.profiles.length, 1);
	assert.equal(m.trailingTokens.length, 1);
	const d = m.diagnostics.find((x) => x.code === 'MANAGER_TRAILING_NEW_SEPARATOR');
	assert.ok(d);
	assert.equal(d.severity, 'warning');
});

test('empty profile between separators → MANAGER_EMPTY_PROFILE (kept in model)', () => {
	const m = parse('--new\n--new\n--filter-tcp=443');
	assert.equal(m.profiles.length, 2);
	assert.equal(m.profiles[0].originalTokens.length, 0);
	const d = m.diagnostics.find((x) => x.code === 'MANAGER_EMPTY_PROFILE');
	assert.ok(d);
	assert.equal(d.profileIndex, 0);
});

test('lua-desync is opaque: raw preserved, hints are not an AST', () => {
	const raw = 'circular:fails=2:time=30:retrans=2:maxseq=16384:reset';
	const m = parse(`--filter-tcp=443\n--lua-desync=${raw}`);
	const e = m.profiles[0].luaDesync[0];
	assert.equal(e.raw, raw);
	assert.equal(e.optionRaw, `--lua-desync=${raw}`);
	assert.equal(e.catalogHints.functionName, 'circular');
	assert.equal(e.catalogHints.fragmentCount, 6);
	assert.equal(e.nativeValidation.status, 'not_checked');
	assert.equal(e.nativeValidation.luaCompatVer, null);
});

test('blob hint extraction: blob= / seqovl_pattern= / pattern= / fallback=, skipping 0x/#/%', () => {
	const m = parse('--lua-desync=fake:blob=tls_google:repeats=8\n--lua-desync=multisplit:seqovl=681:seqovl_pattern=0x1603 --lua-desync=fake:blob=%dyn');
	const [a, b, c] = m.profiles[0].luaDesync;
	assert.deepEqual(a.catalogHints.referencedBlobs, ['tls_google']);
	assert.deepEqual(b.catalogHints.referencedBlobs, []); // inline hex is not a name ref
	assert.deepEqual(c.catalogHints.referencedBlobs, []); // %var dynamic ref is not a name ref
});

test('escaped colon inside lua-desync does not inflate the fragment count hint', () => {
	const m = parse('--lua-desync=luaexec:code=x\\:y=1');
	assert.equal(m.profiles[0].luaDesync[0].catalogHints.fragmentCount, 2);
	assert.equal(m.profiles[0].luaDesync[0].catalogHints.functionName, 'luaexec');
	// and the raw expression keeps the native `\:` escape intact
	assert.equal(m.profiles[0].luaDesync[0].raw, 'luaexec:code=x\\:y=1');
});

test('repeated options are all preserved (duplicates never merged)', () => {
	const m = parse('--payload=all\n--payload=unknown');
	assert.equal(m.profiles[0].payloads.length, 2);
	assert.equal(m.profiles[0].payloads[0].value, 'all');
	assert.equal(m.profiles[0].payloads[1].value, 'unknown');
});

test('--option=value and --option value forms both work', () => {
	const m = parse('--filter-tcp 443 --payload=all');
	assert.equal(m.profiles[0].tcpPorts[0].value, '443');
	assert.equal(m.profiles[0].tcpPorts[0].separateForm, true);
	assert.equal(m.profiles[0].payloads[0].value, 'all');
});

test('top-level extraction: ports/ranges/lists/ipsets/blobs/lua-init/protocol', () => {
	const m = parse([
		'--lua-init=@/opt/zapret2/zapret-auto.lua',
		'--blob=myquic:@/opt/zapret2/bin/quic_initial.bin',
		'--filter-tcp=80,443,2053-2096',
		'--filter-udp=3478-3481',
		'--filter-l7=tls,quic',
		'--payload=tls_client_hello',
		'--hostlist-domains=example.com',
		'--hostlist-exclude=/opt/x.txt',
		'--ipset=/opt/y.txt',
		'--ipset-exclude-ip=1.2.3.4',
		'--in-range=-s4096',
		'--out-range=-n3',
		'--lua-desync=fake:blob=myquic',
	].join('\n'));
	const p = m.profiles[0];
	assert.equal(p.protocol, 'mixed');
	assert.equal(p.tcpPorts[0].elements.length, 3);
	assert.deepEqual(p.tcpPorts[0].elements[2], { raw: '2053-2096', negated: false, star: false, from: 2053, to: 2096, valid: true });
	assert.equal(p.outboundRanges[0].range.to.prefix, 'n');
	assert.equal(p.inboundRanges[0].range.to.prefix, 's');
	assert.equal(p.blobs[0].blobName, 'myquic');
	assert.equal(p.blobs[0].blobSourceType, 'file');
	assert.equal(m.globalOptions.length, 1);
	assert.equal(m.globalOptions[0].value, '@/opt/zapret2/zapret-auto.lua');
});

test('range structuring: -d10, -n3, <n2, <n3, -s4096, cutoff-style unit prefixes', () => {
	for (const [raw, op, prefix] of [['-d10', '-', 'd'], ['-n3', '-', 'n'], ['<n2', '<', 'n'], ['<n3', '<', 'n'], ['-s4096', '-', 's']]) {
		const m = parse(`--out-range=${raw}`);
		const r = m.profiles[0].outboundRanges[0].range;
		assert.equal(r.valid, true, raw);
		assert.equal(r.op, op, raw);
		assert.equal(r.to.prefix, prefix, raw);
	}
});

test('placeholders <HOSTLIST> / <HOSTLIST_NOAUTO> land in values untouched', () => {
	const m = parse('--hostlist=<HOSTLIST>\n--hostlist-auto=<HOSTLIST_NOAUTO>');
	assert.equal(m.profiles[0].hostlists[0].value, '<HOSTLIST>');
	assert.equal(m.profiles[0].hostlists[1].value, '<HOSTLIST_NOAUTO>');
});

test('--payload=http_req after the strategy block stays a separate payloads entry', () => {
	const m = parse('--lua-desync=circular:fails=2\n--payload=http_req');
	const p = m.profiles[0];
	assert.equal(p.luaDesync.length, 1);
	assert.equal(p.payloads.length, 1);
	assert.equal(p.payloads[0].value, 'http_req');
	// and the parser did NOT pull it inside the lua expression
	assert.equal(p.luaDesync[0].raw, 'circular:fails=2');
});

test('--skip marks the profile disabled (preserved as passthrough)', () => {
	const m = parse('--filter-tcp=443\n--new\n--skip\n--filter-udp=443');
	assert.equal(m.profiles[1].enabled, false);
	assert.equal(m.profiles[0].enabled, true);
});

test('recipes coverage: ports/ranges of the community strategy pack parse cleanly', () => {
	const text = [
		'--filter-tcp=80,443,1984,2053,2083,2087,2096,5222-5228,7790,8443', // incl. 1984, 5222-5228, 7790
		'--new=game-udp',
		'--filter-udp=590-600,1400,3478-3481,5349,19294-19344,32000-32050,45395,49152-65535,51372-51400',
		'--payload=unknown',
		'--out-range=-n3',
		'--blob=quic_dbankcloud:@/opt/zapret2/bin/quic_initial_dbankcloud_ru.bin',
		'--lua-desync=fake:blob=quic_dbankcloud:repeats=10',
	].join('\n');
	const m = parse(text);
	assert.equal(m.profiles.length, 2);
	assert.equal(m.profiles[1].name, 'game-udp');
	const udp = m.profiles[1].udpPorts[0].elements;
	assert.equal(udp.length, 9);
	assert.ok(udp.every((e) => e.valid));
	assert.equal(m.profiles[1].luaDesync[0].catalogHints.referencedBlobs[0], 'quic_dbankcloud');
});

test('parser never throws on garbage; model + diagnostics come back', () => {
	const m = parse('--=x\n\x00--filter-tcp=abc\n"unclosed');
	assert.ok(m.diagnostics.length >= 2);
	assert.ok(m.profiles.length >= 1);
});

test('empty input → zero profiles, no crash', () => {
	const m = parse('');
	assert.equal(m.profiles.length, 0);
});
