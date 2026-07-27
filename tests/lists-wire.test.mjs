// Self-test for the lists_set wire format (Part 3).
//
// edit arrives as a JSON STRING. validate_edit parses it ONCE, requires an
// object with ALLOWED keys (arrays of strings), rejects engine-owned lists.
// lists_set validates → conflict-check → writes via write_list_file (single
// writer). No sprintf("%J") before parse, no double-encode.
//
// Run: node --test tests/lists-wire.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate_edit, lists_set } from './lib/lists-wire.mjs';

let dir;
const paths = {};
test.before(() => {
	dir = mkdtempSync(join(tmpdir(), 'z2m-wire-'));
	for (const k of ['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock'])
		paths[k] = join(dir, `${k}.txt`);
});
test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

// ---- validate_edit: the wire-format rules ----

test('edit must be a string (not an object, not a number)', () => {
	assert.match(validate_edit({ a: 1 }).error, /JSON string/);
	assert.match(validate_edit(42).error, /JSON string/);
	assert.match(validate_edit(null).error, /JSON string/);
});

test('invalid JSON → error', () => {
	assert.match(validate_edit('{not json').error, /invalid JSON/);
	assert.match(validate_edit('').error, /invalid JSON|JSON string/);
});

test('JSON array (not object) → error', () => {
	assert.match(validate_edit('["a","b"]').error, /must decode to an object/);
});

test('unknown key → error', () => {
	assert.match(validate_edit('{"unknownList":["a.com"]}').error, /unknown list key: unknownList/);
});

test('value not an array → error', () => {
	assert.match(validate_edit('{"domainInclude":"a.com"}').error, /must be an array/);
});

test('element not a string → error', () => {
	assert.match(validate_edit('{"domainInclude":[123]}').error, /element 0 of domainInclude must be a string/);
});

test('engine-owned list (autohostlist) → error', () => {
	assert.match(validate_edit('{"autohostlist":["a.com"]}').error, /engine-owned/);
});

test('include/exclude conflict → refused BEFORE any write', () => {
	const r = lists_set(JSON.stringify({ domainInclude: ['a.com'], domainExclude: ['a.com'] }), paths);
	assert.equal(r.ok, false);
	assert.equal(r.error, 'conflict');
	assert.deepEqual(r.conflicts, ['a.com']);
	// no file written
	assert.throws(() => statSync(paths.domainInclude), { code: 'ENOENT' });
});

// ---- positive: write a test user list, read back, restore ----

test('positive: edit a user list, read back, restore (sha256 matches after restore)', () => {
	const target = paths.domainInclude;
	// seed an original
	writeFileSync(target, 'original.com\nkeep.org\n');
	const before = readFileSync(target, 'utf8');
	// write a new list via lists_set (edit is a JSON STRING)
	const r = lists_set(JSON.stringify({ domainInclude: ['new.com', 'second.org'] }), paths);
	assert.equal(r.ok, true);
	assert.deepEqual(r.written, ['domainInclude']);
	assert.equal(readFileSync(target, 'utf8'), 'new.com\nsecond.org\n');
	// restore the original
	writeFileSync(target, before);
	assert.equal(readFileSync(target, 'utf8'), before);
});

test('positive: only the present keys are written; absent lists untouched', () => {
	// seed ipInclude so we can confirm it is NOT touched when absent from edit
	writeFileSync(paths.ipInclude, 'untouched-ip.txt\n');
	const r = lists_set(JSON.stringify({ domainInclude: ['only.com'] }), paths);
	assert.equal(r.ok, true);
	assert.deepEqual(r.written, ['domainInclude']);
	assert.equal(readFileSync(paths.ipInclude, 'utf8'), 'untouched-ip.txt\n');
});

test('no double-encode: a pre-encoded JSON string is parsed once', () => {
	// The rpcd plugin writes edit verbatim (no sprintf("%J")). lists_set must
	// parse the string ONCE — a value 'a.com' stays 'a.com', not '"a.com"'.
	const r = lists_set(JSON.stringify({ domainInclude: ['a.com'] }), paths);
	assert.equal(r.ok, true);
	assert.equal(readFileSync(paths.domainInclude, 'utf8'), 'a.com\n');   // not "\"a.com\"\n'
});
