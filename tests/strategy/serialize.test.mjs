// serialize.test.mjs — preserve (byte-identical) + canonical (top-level).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './lib/parse.mjs';
import { serializePreserve, serializeCanonical } from './lib/serialize.mjs';
import { semanticProjection } from './lib/semantics.mjs';

test('preserve is byte-identical including whitespace and newlines', () => {
	const text = '--filter-tcp=443\n  --payload=all\n\n--lua-desync=fake:blob=tls_google:repeats=8\n';
	const m = parse(text);
	const out = serializePreserve(m);
	assert.equal(out.text, text);
	assert.equal(out.diagnostics.length, 0);
});

// Mandatory check #5: preserve keeps the `--new=GamesTCP` form.
test('preserve keeps --new=GamesTCP byte-for-byte', () => {
	const text = '--new=GamesTCP\n--filter-tcp=1024-65535';
	const m = parse(text);
	const out = serializePreserve(m);
	assert.equal(out.text, text);
	assert.ok(out.text.includes('--new=GamesTCP'));
});

// Mandatory check #6: preserve does NOT rewrite it into `--new --name=GamesTCP`.
test('preserve never normalizes --new=X into --new + --name=X', () => {
	const text = '--new=GamesTCP\n--filter-tcp=443';
	const m = parse(text);
	const out = serializePreserve(m).text;
	assert.ok(!out.includes('--name='));
	assert.equal((out.match(/--new/g) ?? []).length, 1);
});

test('preserve keeps quoted values byte-for-byte', () => {
	const text = "--name='My Profile'\n--payload=all";
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
});

test('preserve keeps separate-form (--option value) byte-for-byte', () => {
	const text = '--filter-tcp 443 --payload=all';
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
});

test('LOSSY: dropping a semantic entry triggers MANAGER_LOSSY_ROUNDTRIP', () => {
	const text = '--strange-opt=1 --filter-tcp=443';
	const m = parse(text);
	m.profiles[0].unknownOptions.length = 0; // simulated model tampering
	const out = serializePreserve(m);
	const d = out.diagnostics.find((x) => x.code === 'MANAGER_LOSSY_ROUNDTRIP');
	assert.ok(d);
	assert.equal(d.severity, 'error');
	assert.notEqual(out.text, text);
});

test('canonical: stable grouped order of top-level structure', () => {
	// stateful options BEFORE lua-desync → canonical regroups them
	// (documented order: filters → payload → lists → ipsets → ranges)
	const text = '--payload=all\n--filter-tcp=443\n--hostlist-domains=example.com\n--lua-desync=fake:blob=tls_google';
	const m = parse(text);
	const c = serializeCanonical(m).text;
	const lines = c.split('\n');
	assert.deepEqual(lines, [
		'--filter-tcp=443',
		'--payload=all',
		'--hostlist-domains=example.com',
		'--lua-desync=fake:blob=tls_google',
	]);
});

test('canonical: lua-desync internals are NEVER rewritten or reordered', () => {
	const raw = 'circular:fails=2:time=30:retrans=2:maxseq=16384:reset';
	const m = parse(`--lua-desync=${raw}\n--lua-desync=fake:blob=tls_google:strategy=1`);
	const c = serializeCanonical(m).text;
	assert.ok(c.includes(`--lua-desync=${raw}`));
	assert.ok(c.indexOf('circular') < c.indexOf('fake:blob')); // original order kept
});

// Mandatory check #10 (colon fragments not reordered), canonical mode included.
test('canonical: multi-fragment expression stays in original fragment order', () => {
	const raw = 'multisplit:pos=1,host+2,sld+2,endhost-2:seqovl=681:seqovl_pattern=tls_google:repeats=8';
	const m = parse(`--lua-desync=${raw}`);
	const c = serializeCanonical(m).text;
	assert.ok(c.includes(raw));
});

test('canonical: profile with stateful option AFTER lua-desync falls back to original order', () => {
	const text = '--lua-desync=fake:blob=tls_google\n--payload=http_req\n--filter-tcp=80';
	const m = parse(text);
	const c = serializeCanonical(m).text.split('\n');
	assert.deepEqual(c, [
		'--lua-desync=fake:blob=tls_google',
		'--payload=http_req',
		'--filter-tcp=80',
	]);
});

test('canonical round-trip is semantically equivalent (no byte-identity promise)', () => {
	const text = '--new=GamesTCP\n--filter-tcp=1024-65535\n--payload=unknown\n--out-range=-n3\n--lua-desync=fake:blob=fake_default_tls:repeats=2\n--new\n--filter-udp=443';
	const m1 = parse(text);
	const canon = serializeCanonical(m1).text;
	const m2 = parse(canon);
	assert.deepEqual(semanticProjection(m2), semanticProjection(m1));
});

test('canonical escapes values with spaces; re-parse recovers them', () => {
	const m1 = parse('--name="My Profile"\n--filter-tcp=443');
	assert.equal(m1.profiles[0].name, 'My Profile');
	const canon = serializeCanonical(m1).text;
	assert.ok(canon.includes('--name="My Profile"'));
	const m2 = parse(canon);
	assert.equal(m2.profiles[0].name, 'My Profile');
});

test('preserve on trailing --new keeps the separator byte-for-byte', () => {
	const text = '--filter-tcp=443\n--new\n';
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
});

test('empty profile survives canonical (its --new is kept)', () => {
	const text = '--new\n--new\n--filter-tcp=443';
	const m = parse(text);
	const canon = serializeCanonical(m).text;
	const m2 = parse(canon);
	assert.equal(m2.profiles.length, 2);
	assert.equal(m2.profiles[0].originalTokens.length, 0);
});
