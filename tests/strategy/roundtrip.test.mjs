// roundtrip.test.mjs — lossless transport proofs over the whole corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from './lib/parse.mjs';
import { serializePreserve, serializeCanonical } from './lib/serialize.mjs';
import { semanticProjection } from './lib/semantics.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/strategies/', import.meta.url));
const FIXTURES = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.txt')).sort();

// Mandatory check #7 + #8: lua expressions byte-identical; unknown ones too.
test('ALL 19 fixtures: text → parse → preserve → byte-identical → parse → same semantics', () => {
	for (const file of FIXTURES) {
		const text = readFileSync(join(FIXTURE_DIR, file), 'utf8');
		const m1 = parse(text);
		const pres = serializePreserve(m1);
		assert.equal(pres.text, text, `${file}: preserve must be byte-identical`);
		assert.ok(!pres.diagnostics.some((d) => d.code === 'MANAGER_LOSSY_ROUNDTRIP'), file);
		const m2 = parse(pres.text);
		assert.deepEqual(semanticProjection(m2), semanticProjection(m1), `${file}: semantic equality after round-trip`);
	}
});

test('ALL 19 fixtures: canonical serialization → parse → same semantics', () => {
	for (const file of FIXTURES) {
		const text = readFileSync(join(FIXTURE_DIR, file), 'utf8');
		const m1 = parse(text);
		const canon = serializeCanonical(m1).text;
		const m2 = parse(canon);
		assert.deepEqual(semanticProjection(m2), semanticProjection(m1), `${file}: canonical semantic equivalence`);
	}
});

test('unknown lua expression survives byte-for-byte (b06-class input)', () => {
	const text = '--filter-tcp=443\n--lua-desync=my_custom_orchestrator:x=1:y=2\n';
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
	assert.equal(m.profiles[0].luaDesync[0].raw, 'my_custom_orchestrator:x=1:y=2');
});

// Mandatory check #10: colon fragments are never reordered (both modes).
test('colon fragment order preserved in preserve AND canonical modes', () => {
	const raw = 'multidisorder:pos=1,host+2,sld+2,sld+5,sniext+1,sniext+2,endhost-2:seqovl=1:strategy=7';
	const text = `--filter-tcp=443\n--lua-desync=${raw}`;
	const m = parse(text);
	assert.ok(serializePreserve(m).text.includes(raw));
	assert.ok(serializeCanonical(m).text.includes(raw));
});

// Mandatory check #13: range forms preserved exactly (-n3, <n3, -d10, -s4096).
test('range forms are preserved verbatim, never normalized', () => {
	for (const r of ['-n3', '<n3', '-d10', '-s4096']) {
		const text = `--filter-tcp=443\n--out-range=${r}`;
		const m = parse(text);
		assert.equal(serializePreserve(m).text, text);
		assert.ok(serializeCanonical(m).text.includes(`--out-range=${r}`));
	}
	// and -n3 is NOT turned into -3 anywhere
	const m = parse('--out-range=-n3');
	assert.ok(serializePreserve(m).text.includes('-n3'));
	assert.ok(!serializePreserve(m).text.includes('-3\n'));
});

// Mandatory checks #11/#12: placeholders survive both modes.
test('<HOSTLIST> and <HOSTLIST_NOAUTO> preserved in both modes', () => {
	const text = '--hostlist=<HOSTLIST>\n--hostlist-auto=<HOSTLIST_NOAUTO>\n--filter-tcp=443';
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
	const canon = serializeCanonical(m).text;
	assert.ok(canon.includes('--hostlist=<HOSTLIST>'));
	assert.ok(canon.includes('--hostlist-auto=<HOSTLIST_NOAUTO>'));
});

// Mandatory check #14: unknown top-level option preserved in both modes.
test('unknown top-level option preserved in both modes', () => {
	const text = '--dpi-desync-fooling=md5sig,badseq\n--filter-tcp=443\n';
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
	assert.ok(serializeCanonical(m).text.includes('--dpi-desync-fooling=md5sig,badseq'));
});

test('escaped-colon lua expression round-trips byte-identically', () => {
	const text = '--lua-desync=luaexec:code=x\\:y=1:strategy=1';
	const m = parse(text);
	assert.equal(serializePreserve(m).text, text);
	const m2 = parse(serializeCanonical(m).text);
	assert.equal(m2.profiles[0].luaDesync[0].raw, 'luaexec:code=x\\:y=1:strategy=1');
});

test('duplicate options survive round-trip in both modes', () => {
	const text = '--payload=all\n--payload=unknown\n--lua-desync=fake:blob=fake_default_tls';
	const m1 = parse(text);
	assert.equal(serializePreserve(m1).text, text);
	const m2 = parse(serializeCanonical(m1).text);
	assert.equal(m2.profiles[0].payloads.length, 2);
	assert.deepEqual(semanticProjection(m2), semanticProjection(m1));
});

test('special recipe shapes (circular youtube, seqovl ladder, quic fake, voice udp) round-trip', () => {
	const cases = [
		'--lua-desync=circular:fails=2:time=30:retrans=2:maxseq=16384:reset',
		'--lua-desync=multisplit:pos=2:seqovl=20000:seqovl_pattern=tls_google:strategy=4:final=1',
		'--lua-desync=fake:blob=quic_initial:repeats=11',
		'--lua-desync=udplen:increment=2',
	];
	for (const line of cases) {
		const text = `--filter-udp=443\n${line}\n`;
		const m = parse(text);
		assert.equal(serializePreserve(m).text, text, line);
	}
});
