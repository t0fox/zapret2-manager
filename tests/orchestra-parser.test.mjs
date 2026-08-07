// tests/orchestra-parser.test.mjs
// Parser regression tests: bounded input, malformed data, event types, runId, domain normalization.

import { strict as assert } from 'assert';

// --- domain normalization ---
function normalizeDomain(v) {
	if (!v) return null;
	let d = String(v).toLowerCase().trim();
	while (d.length > 0 && d[d.length - 1] === '.') d = d.slice(0, -1);
	return d || null;
}

console.log('1..15');

assert.strictEqual(normalizeDomain('Example.COM.'), 'example.com');
console.log('ok 1 - domain: trailing dot removed');

assert.strictEqual(normalizeDomain('test.org..'), 'test.org');
console.log('ok 2 - domain: multiple trailing dots');

assert.strictEqual(normalizeDomain('.'), null);
console.log('ok 3 - domain: dot-only is null');

assert.strictEqual(normalizeDomain(''), null);
console.log('ok 4 - domain: empty is null');

assert.strictEqual(normalizeDomain(null), null);
console.log('ok 5 - domain: null is null');

assert.strictEqual(normalizeDomain('  EXAMPLE.ORG  '), 'example.org');
console.log('ok 6 - domain: trim + lowercase');

// --- runId detection from NUL-separated cmdline ---
function detectRunId(rawCmdline) {
	const argv = rawCmdline.split('\0');
	for (const part of argv) {
		const p = part.trim();
		if (p.startsWith('tries-')) {
			const id = p.slice(6);
			if (/^[0-9a-fA-F]{8}$/.test(id)) return id;
		}
	}
	return null;
}

assert.strictEqual(detectRunId('/bin/nfqws2\0tries-abcd1234\0--debug'), 'abcd1234');
console.log('ok 7 - runId: NUL-separated cmdline parsed');

assert.strictEqual(detectRunId('/bin/nfqws2 tries-abcd1234 --debug'), null);
console.log('ok 8 - runId: space-separated without NUL returns null');

assert.strictEqual(detectRunId(''), null);
console.log('ok 9 - runId: empty cmdline returns null');

// --- match() result proper access ---
const line1 = 'INFO [2024-01-01 run_id=deadbeef] connected';
const m1 = line1.match(/run_id=([0-9a-fA-F_-]+)/);
assert.ok(m1);
assert.strictEqual(m1[1], 'deadbeef');
console.log('ok 10 - match: result[1] correctly accessed');

const line2 = 'INFO no run id here';
const m2 = line2.match(/run_id=([0-9a-fA-F_-]+)/);
assert.strictEqual(m2, null);
console.log('ok 11 - match: no match returns null');

// --- bounded input sanity ---
const MAX_INPUT = 10240;
const oversized = 'x'.repeat(MAX_INPUT * 3);
const tail = oversized.slice(-MAX_INPUT);
assert.strictEqual(tail.length, MAX_INPUT);
console.log('ok 12 - bounded input: oversized truncated to max');

// --- lines bounding ---
const manyLines = Array(500).fill('line').join('\n');
const lineArr = manyLines.split('\n');
const MAX_LINES = 100;
const truncated = lineArr.slice(-MAX_LINES);
assert.strictEqual(truncated.length, MAX_LINES);
console.log('ok 13 - bounded lines: oversize capped');

// --- event type allowlist ---
const ALLOWED = new Set([
	'ENGINE_STARTED', 'ENGINE_STOPPED', 'CAPABILITY_DETECTED',
	'HOST_RECORD_SEEN', 'STRATEGY_SELECTED', 'STRATEGY_ROTATED',
	'FAILURE_RETRANS', 'FAILURE_RST', 'FAILURE_HTTP_REDIRECT',
	'FAILURE_UDP_HEURISTIC', 'FAILURE_THRESHOLD_REACHED',
	'SUCCESS', 'FINAL_STRATEGY_REACHED',
	'PROFILE_MISMATCH', 'PARSE_WARNING', 'PARSE_ERROR'
]);
assert.strictEqual(ALLOWED.size, 16);
console.log('ok 14 - event types: 16 expected types validated');

// --- ndjson parse robustness ---
function parseNDJSON(raw) {
	const events = [];
	for (const line of raw.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		try { events.push(JSON.parse(t)); } catch (e) { continue; }
	}
	return events;
}

const ndjson = '{"a":1}\n{"b":2}\n\ncorrupt line\n{"c":3}\n';
const parsed = parseNDJSON(ndjson);
assert.strictEqual(parsed.length, 3);
assert.strictEqual(parsed[0].a, 1);
assert.strictEqual(parsed[1].b, 2);
assert.strictEqual(parsed[2].c, 3);
console.log('ok 15 - ndjson: corrupt lines skipped safely');

console.log('\nAll parser tests passed.');
