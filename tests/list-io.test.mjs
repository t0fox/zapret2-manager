// Self-test for list file I/O (Part 2: lists.uc as a module — the single
// writer). read_list_file / write_list_file live in apply.uc (single-writer
// module, same as set_var) and are imported by lists.uc. No second write path.
//
// Run: node --test tests/list-io.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { read_list_file, write_list_file } from './lib/list-io.mjs';

let dir;
test.before(() => { dir = mkdtempSync(join(tmpdir(), 'z2m-listio-')); });
test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

// ---- read_list_file ----

test('read_list_file: missing file → empty list (no invented entries)', () => {
	assert.deepEqual(read_list_file(join(dir, 'does-not-exist.txt')), []);
});

test('read_list_file: one entry per line, order preserved', () => {
	const p = join(dir, 'ordered.txt');
	writeFileSync(p, 'a.com\nb.org\nc.net\n');
	assert.deepEqual(read_list_file(p), ['a.com', 'b.org', 'c.net']);
});

test('read_list_file: trims each line and drops empty lines', () => {
	const p = join(dir, 'messy.txt');
	writeFileSync(p, '  spaced.com  \n\n\tnet.org\t\n   \n');
	assert.deepEqual(read_list_file(p), ['spaced.com', 'net.org']);
});

test('read_list_file: no trailing newline is fine', () => {
	const p = join(dir, 'notrail.txt');
	writeFileSync(p, 'x.com\ny.com');
	assert.deepEqual(read_list_file(p), ['x.com', 'y.com']);
});

// ---- write_list_file ----

test('write_list_file: one entry per line, LF-separated, trailing LF', () => {
	const p = join(dir, 'write1.txt');
	const content = write_list_file(p, ['a.com', 'b.org']);
	assert.equal(content, 'a.com\nb.org\n');
	assert.equal(readFileSync(p, 'utf8'), 'a.com\nb.org\n');
});

test('write_list_file: trims + drops empty entries before writing', () => {
	const p = join(dir, 'write2.txt');
	write_list_file(p, ['  a.com  ', '', '   ', 'b.org']);
	assert.equal(readFileSync(p, 'utf8'), 'a.com\nb.org\n');
});

test('write_list_file: creates the parent directory if missing', () => {
	const p = join(dir, 'nested', 'deep', 'list.txt');
	write_list_file(p, ['x.com']);
	assert.ok(existsSync(p));
	assert.deepEqual(read_list_file(p), ['x.com']);
});

test('write_list_file: atomic — no leftover temp after success', () => {
	const p = join(dir, 'atomic.txt');
	write_list_file(p, ['a.com']);
	// the temp must be gone (renamed into place); only the target exists.
	const tmps = existsSync(p + '.tmp.0');   // any temp pattern is fine to assert absent
	assert.equal(tmps, false);
	assert.ok(existsSync(p));
});

test('write_list_file + read_list_file round-trip preserves the list', () => {
	const p = join(dir, 'roundtrip.txt');
	const src = ['one.com', 'two.org', 'three.net'];
	write_list_file(p, src);
	assert.deepEqual(read_list_file(p), src);
});

test('write_list_file: overwrite replaces the whole file (no stale lines)', () => {
	const p = join(dir, 'overwrite.txt');
	write_list_file(p, ['old.com', 'stale.org']);
	write_list_file(p, ['new.com']);
	assert.deepEqual(read_list_file(p), ['new.com']);   // old/stale gone
});

test('write_list_file: returns null on rename failure (error surfaces, not swallowed)', () => {
	// Rename fails across filesystems (tmpdir vs an impossible target): a path
	// under a non-existent root that mkdir cannot create (parent is a file).
	const blocker = join(dir, 'blocker-file');
	writeFileSync(blocker, 'x');   // a FILE where a parent dir would need to be
	const p = join(blocker, 'child', 'list.txt');   // blocker-file/child/ — impossible
	const r = write_list_file(p, ['a.com']);
	assert.equal(r, null, 'write failure returns null, not a silent success');
});
