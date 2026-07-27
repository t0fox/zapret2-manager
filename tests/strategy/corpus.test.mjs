// corpus.test.mjs — runs the fixture corpus against the expectation manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runCorpus } from './lib/corpus.mjs';
import { parse } from './lib/parse.mjs';
import { allDiagnostics, codesOf } from './lib/validate.mjs';
import { serializePreserve } from './lib/serialize.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/strategies/', import.meta.url));
const EXPECTED = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures.expected.json', import.meta.url)), 'utf8'));

// Mandatory check #1: exactly 19 fixtures.
test('fixture inventory is exactly 19 files (9 historically-good, 10 historically-bad)', () => {
	const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.txt')).sort();
	assert.equal(files.length, 19);
	const good = files.filter((f) => f.startsWith('g') || f === 'selftest-good.txt');
	const bad = files.filter((f) => f.startsWith('b') || f === 'selftest-bad.txt');
	assert.equal(good.length, 9);
	assert.equal(bad.length, 10);
	assert.deepEqual(Object.keys(EXPECTED.fixtures).sort(), files);
});

test('corpus runner: every fixture matches its expectation manifest', () => {
	const { files, totals } = runCorpus(FIXTURE_DIR);
	assert.equal(totals.files, 19);
	for (const rec of files) {
		const exp = EXPECTED.fixtures[rec.file];
		assert.ok(exp, `no expectation for ${rec.file}`);
		assert.equal(rec.managerParse, exp.manager.parse, `${rec.file}: parse`);
		assert.equal(rec.preserveRoundtrip, exp.manager.preserveRoundtrip, `${rec.file}: preserve round-trip`);
		assert.equal(rec.profiles, exp.profiles, `${rec.file}: profile count`);
		const expectedCodes = [...exp.manager.diagnostics, ...exp.catalog.warnings].sort();
		assert.deepEqual(rec.diagnosticCodes, expectedCodes, `${rec.file}: diagnostic codes`);
		assert.equal(rec.nativeStatus, exp.native.status, `${rec.file}: native status`);
	}
	// aggregate arithmetic must line up with the manifest
	const expSuccess = Object.values(EXPECTED.fixtures).filter((e) => e.manager.parse === 'success').length;
	assert.equal(totals.managerParseSuccess, expSuccess);
	assert.equal(totals.managerParseSuccess + totals.managerParseFailure, 19);
	assert.equal(totals.preserveRoundtripSuccess, 19);
	assert.equal(totals.nativeNotChecked, 19);
	assert.equal(totals.nativePartial, 0);
	assert.equal(totals.nativeRejected, 0);
});

// Mandatory check #18: one bad fixture does not stop the corpus.
test('a failing file does not stop the corpus runner', () => {
	const virtualFs = {
		'ok.txt': '--filter-tcp=443\n--lua-desync=fake:blob=fake_default_tls\n',
		'broken.txt': '--filter-tcp=abc-xyz\n--out-range=!!!bad\n',
		'ok2.txt': '--filter-udp=443\n',
	};
	const readDir = () => Object.keys(virtualFs);
	const readFile = (p) => virtualFs[p.split(/[\\/]/).pop()];
	const { files, totals } = runCorpus('virtual', { readDir, readFile });
	assert.equal(totals.files, 3);
	assert.equal(totals.managerParseSuccess, 2);
	assert.equal(totals.managerParseFailure, 1);
	assert.ok(files.every((f) => f.file !== 'broken.txt' || f.diagnosticCodes.length > 0));
});

test('lua function hints match the manifest', () => {
	for (const [file, exp] of Object.entries(EXPECTED.fixtures)) {
		const text = readFileSync(join(FIXTURE_DIR, file), 'utf8');
		const m = parse(text);
		const hints = [...new Set(m.profiles.flatMap((p) => p.luaDesync.map((e) => e.catalogHints.functionName)))].sort();
		assert.deepEqual(hints, [...exp.luaFunctionHints].sort(), file);
	}
});

test('historically-bad does NOT mean native-invalid (terminology honesty)', () => {
	for (const [file, exp] of Object.entries(EXPECTED.fixtures)) {
		if (exp.historicalClass === 'historically-bad') {
			assert.notEqual(exp.native.status, 'invalid', `${file}: historical label must not pre-judge native verdict`);
			assert.equal(exp.native.status, 'not_checked');
		}
	}
});
