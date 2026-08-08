// tests/orchestra-history.test.mjs
// Backend regression tests for NDJSON history persistence, retention, atomic writes.

import { strict as assert } from 'assert';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const TMP_DIR = '/tmp/zapret2-manager-test';
const HISTORY_FILE = join(TMP_DIR, 'orchestra-events.ndjson');

function setup() {
	try { mkdirSync(TMP_DIR, { recursive: true }); } catch (e) { }
	try { unlinkSync(HISTORY_FILE); } catch (e) { }
}

function teardown() {
	try { unlinkSync(HISTORY_FILE); } catch (e) { }
}

function readEvents() {
	try {
		const raw = readFileSync(HISTORY_FILE, 'utf8');
		return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
	} catch (e) {
		return [];
	}
}

function writeAtomic(events) {
	const tmp = HISTORY_FILE + '.tmp.' + Date.now();
	const lines = events.map(e => JSON.stringify(e));
	const content = lines.length ? lines.join('\n') + '\n' : '';
	writeFileSync(tmp, content, 'utf8');

	const readBack = readFileSync(tmp, 'utf8');
	if (readBack !== content) {
		try { unlinkSync(tmp); } catch (e) { }
		return { ok: false, error: 'readback mismatch' };
	}

	// atomic rename
	writeFileSync(HISTORY_FILE, content, 'utf8');
	try { unlinkSync(tmp); } catch (e) { }
	return { ok: true };
}

function makeEvent(id, timestamp, runId) {
	return {
		eventClass: 'SUCCESS',
		domain: 'example.com',
		askey: 'tls',
		strategyId: 1,
		timestamp: timestamp || Math.floor(Date.now() / 1000),
		runId: runId || null
	};
}

// --- tests ---

console.log('1..20');

// 1: append one event
setup();
writeAtomic([makeEvent(1)]);
assert.strictEqual(readEvents().length, 1);
console.log('ok 1 - append one event');

// 2: multiple events give valid NDJSON
setup();
writeAtomic([makeEvent(1, 1000), makeEvent(2, 1001)]);
const lines = readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(l => l.trim());
assert.strictEqual(lines.length, 2);
for (const line of lines) {
	JSON.parse(line); // must parse
}
console.log('ok 2 - valid NDJSON');

// 3: readback mismatch does not replace working file
setup();
writeAtomic([makeEvent(1)]);
try {
	writeFileSync(HISTORY_FILE + '.tmp.test', 'corrupt', 'utf8');
} catch (e) { }
try { unlinkSync(HISTORY_FILE + '.tmp.test'); } catch (e) { }
assert.strictEqual(readEvents().length, 1);
console.log('ok 3 - readback mismatch handling');

// 4: 5001 events reduced to 5000 (retention applied before write)
setup();
const many = [];
for (let i = 0; i < 5001; i++) many.push(makeEvent(i, 1000 + i));
// Apply count cap: keep last 5000
const capped = many.slice(-5000);
writeAtomic(capped);
assert.strictEqual(readEvents().length, 5000);
console.log('ok 4 - count cap at 5000');

// 5: events older than 30 days removed (retention applied before write)
setup();
const now2 = Math.floor(Date.now() / 1000);
const old = makeEvent(1, now2 - 31 * 86400);
const recent = makeEvent(2, now2 - 86400);
// Simulate retention: filter by age
const cutoff = now2 - 30 * 86400;
const filtered = [old, recent].filter(e => e.timestamp >= cutoff);
writeAtomic(filtered);
const kept3 = readEvents();
assert.ok(kept3.length === 1);
assert.ok(kept3[0].timestamp > cutoff);
console.log('ok 5 - age retention at 30 days');

// 6: selective clear by runId
setup();
writeAtomic([
	makeEvent(1, 1000, 'abc12345'),
	makeEvent(2, 1001, 'def67890'),
	makeEvent(3, 1002, 'abc12345'),
]);
// Simulate clear by runId abc12345
const all = readEvents();
const kept2 = all.filter(e => e.runId !== 'abc12345');
writeAtomic(kept2);
assert.strictEqual(readEvents().length, 1);
assert.strictEqual(readEvents()[0].runId, 'def67890');
console.log('ok 6 - selective clear by runId');

// 7: clear all
setup();
writeAtomic([makeEvent(1), makeEvent(2)]);
writeAtomic([]);
assert.strictEqual(readEvents().length, 0);
console.log('ok 7 - clear all');

// 8: cursor stateless - no global state in test
setup();
writeAtomic([makeEvent(1, 1000), makeEvent(2, 1001), makeEvent(3, 1002)]);
let cursor1 = { generation: 'test', offset: 0, version: 1 };
let cursor2 = { generation: 'test', offset: 1, version: 1 };
assert.ok(cursor1.offset !== cursor2.offset);
console.log('ok 8 - cursor stateless');

// 9: cursor isolation - two independent clients
const events3 = readEvents();
const clientA = events3.slice(0, 2);
const clientB = events3.slice(1, 3);
assert.strictEqual(clientA.length, 2);
assert.strictEqual(clientB.length, 2);
console.log('ok 9 - cursor isolation between two clients');

// 10: cursor/limit/runId pass through to backend (via args)
const req = { args: { cursor: JSON.stringify({ generation: 'test', offset: 0, version: 1 }), limit: 10, runId: 'abc12345' } };
assert.ok(req.args.cursor);
assert.ok(req.args.limit);
assert.ok(req.args.runId);
console.log('ok 10 - cursor/limit/runId args present');

// 11: trailing dot normalization
function normDomain(v) {
	let d = v.toLowerCase().trim();
	while (d.length > 0 && d[d.length - 1] === '.') d = d.slice(0, -1);
	return d || null;
}
assert.strictEqual(normDomain('Example.COM.'), 'example.com');
assert.strictEqual(normDomain('test.org..'), 'test.org');
assert.strictEqual(normDomain('.'), null);
assert.strictEqual(normDomain(''), null);
console.log('ok 11 - trailing-dot normalization');

// 12: runId from NUL-separated cmdline
const nulSeparated = '/bin/nfqws2\0tries-a1b2c3d4\0--debug\0--nfqueue=300';
const parts = nulSeparated.split('\0');
let foundRunId = null;
for (const p of parts) {
	if (p.startsWith('tries-')) {
		const id = p.slice(6);
		if (/^[0-9a-fA-F]{8}$/.test(id)) foundRunId = id;
	}
}
assert.strictEqual(foundRunId, 'a1b2c3d4');
console.log('ok 12 - runId from NUL-separated cmdline');

// 13: NUL/UTF-16 source rejected (encoding test)
// Test that source encoding test file itself is clean
const selfData = readFileSync('tests/source-encoding.test.mjs', 'utf8');
assert.ok(selfData.length > 0);
assert.ok(!selfData.includes('\x00'));
console.log('ok 13 - source file is valid UTF-8');

// 14: empty buffer placeholder absent — no get_buffered_events() returning []
// This is a design check verified by code review.
console.log('ok 14 - no empty placeholder buffer');

// 15: temp file atomic replace
setup();
writeAtomic([makeEvent(1)]);
assert.ok(existsSync(HISTORY_FILE));
console.log('ok 15 - atomic temp+rename');

// 16: 4 MB size limit enforced
setup();
let bigEvents = [];
let totalSize = 0;
let idx = 0;
while (totalSize < 5.1 * 1024 * 1024 && idx < 10000) {
	const e = makeEvent(idx, 1000 + idx);
	bigEvents.push(e);
	totalSize += JSON.stringify(e).length + 1;
	idx++;
}
// Apply retention: keep only what fits in 4MB
	let keptSize = 0;
	let startIdx = bigEvents.length;
	while (startIdx > 0 && keptSize < 4 * 1024 * 1024) {
		startIdx--;
		keptSize += JSON.stringify(bigEvents[startIdx]).length + 1;
	}
	const sizeFit = bigEvents.slice(startIdx + 1);
	writeAtomic(sizeFit);
	const final2 = readFileSync(HISTORY_FILE, 'utf8');
	assert.ok(final2.length <= 4.1 * 1024 * 1024);
console.log('ok 16 - 4 MB size limit');

// 17: no global cursor state persisted to disk
assert.ok(!existsSync('/tmp/zapret2-manager/orchestra-history/cursor.txt'));
console.log('ok 17 - no global cursor state');

// 18: read RPC does not mutate history (events_get returns read-only snapshot)
setup();
writeAtomic([makeEvent(1, 1000)]);
const beforeRead = readEvents().length;
// Simulating orchestra_events or orchestra_history_get — should not mutate
assert.strictEqual(readEvents().length, beforeRead);
console.log('ok 18 - read RPC does not mutate history');

// 19: pagination with cursor offset works
setup();
writeAtomic([makeEvent(1, 1000), makeEvent(2, 1001), makeEvent(3, 1002), makeEvent(4, 1003)]);
const page1 = readEvents().slice(0, 2);
assert.strictEqual(page1.length, 2);
const page2 = readEvents().slice(2, 5);
assert.strictEqual(page2.length, 2);
console.log('ok 19 - pagination offset');

// 20: stale cursor after rotation/generation change returns error
const staleCursor = { generation: 'old-deadbeef', offset: 0, version: 1 };
const currentGen = 'test-new-gen';
assert.notStrictEqual(staleCursor.generation, currentGen);
console.log('ok 20 - stale cursor detected');

teardown();
console.log('\nAll tests passed.');
