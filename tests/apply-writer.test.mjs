// Self-test for the apply.uc writer algorithm.
//
// ucode does not run in this build environment (no binary; only the target
// router has it). This file is the LOCAL red/green proof for the WRITER
// ALGORITHM: read_var / write_var on a shell-style VAR=value config. The
// node reference in tests/lib/apply-writer.mjs is the algorithm spec; the
// shipped ucode apply.uc implements the same logic, and its RUNTIME is
// confirmed on the target via tools/smoke.sh. Per the task, nothing is
// claimed to "work" on the strength of this node equivalent alone — it
// proves the algorithm; the ucode execution is a separate, on-target check.
//
// FIXTURE ORIGIN: the config sample is tests/fixtures/opt-zapret2-config.out,
// a snapshot of UNCONFIRMED origin. It was collected from a router by
// tools/collect-fixtures.sh before that device was factory-reset; the engine
// is no longer on the device, so the snapshot CANNOT be re-verified against
// the current target. It stands as a sample of the upstream config FORMAT,
// not as a verified live-target reading. If the real config on a freshly
// installed engine differs in format (especially multi-line value layout),
// these self-tests must be re-run against the real sample and discrepancies
// are a blocker (see the interrupt rule in the task).
//
// Run: node --test tests/apply-writer.test.mjs   (or node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { read_var, write_var } from './lib/apply-writer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// FIXTURE: snapshot of unconfirmed origin (see header). Used only as a config
// FORMAT sample for the writer algorithm self-test.
const FIXTURE = readFileSync(join(here, 'fixtures/opt-zapret2-config.out'), 'utf8');

// ---- read_var ---------------------------------------------------------------

test('read_var returns the value of a simple VAR=value line', () => {
	assert.equal(read_var(FIXTURE, 'NFQWS2_ENABLE'), '1');
	assert.equal(read_var(FIXTURE, 'MODE_FILTER'), 'none');
	assert.equal(read_var(FIXTURE, 'DISABLE_IPV6'), '1');
});

test('read_var returns null for an absent variable', () => {
	assert.equal(read_var(FIXTURE, 'DOES_NOT_EXIST'), null);
});

test('read_var does NOT match commented-out assignments', () => {
	// #FILTER_MARK=0x10000000 is commented in the fixture; the active var is
	// absent, so read_var must return null, not the commented value.
	assert.equal(read_var(FIXTURE, 'FILTER_MARK'), null);
	assert.equal(read_var(FIXTURE, 'POSTNAT'), null); // commented: #POSTNAT=0
});

test('read_var returns the full multi-line quoted value of NFQWS2_OPT', () => {
	const v = read_var(FIXTURE, 'NFQWS2_OPT');
	assert.ok(v != null, 'NFQWS2_OPT must be present');
	assert.ok(v.includes('--lua-desync='), 'OPT value contains lua-desync args');
	assert.ok(v.includes('--lua-init=@/opt/zapret2/lua/orchestra-extra/init.lua'));
	assert.ok(v.includes('--filter-tcp=80,443'));
	// the value is the text BETWEEN the opening and closing double quotes
	assert.ok(!v.startsWith('"'), 'value is inside quotes, not including them');
	assert.ok(!v.endsWith('"'));
});

test('read_var value may contain "=" (split on first "=" only)', () => {
	// IPSET_OPT="hashsize 262144 maxelem $SET_MAXELEM" — value has no =, but
	// NFQWS2_OPT's value has many "=". read_var must keep them.
	const v = read_var(FIXTURE, 'NFQWS2_OPT');
	assert.ok(v.includes('seqovl_pattern=tls_google'));
});

// ---- write_var: simple line (point 1 — pause) ------------------------------

test('write_var NFQWS2_ENABLE=0 changes only that line', () => {
	const out = write_var(FIXTURE, 'NFQWS2_ENABLE', '0');
	assert.equal(read_var(out, 'NFQWS2_ENABLE'), '0');
	// every other line is preserved byte-for-byte
	const a = FIXTURE.split('\n');
	const b = out.split('\n');
	assert.equal(b.length, a.length, 'line count unchanged');
	let changed = 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			changed++;
			assert.ok(a[i] === 'NFQWS2_ENABLE=1' && b[i] === 'NFQWS2_ENABLE=0',
				`only the NFQWS2_ENABLE line should change; got a[${i}]=${JSON.stringify(a[i])} b[${i}]=${JSON.stringify(b[i])}`);
		}
	}
	assert.equal(changed, 1, 'exactly one line changed');
});

test('write_var preserves the multi-line NFQWS2_OPT block when editing ENABLE', () => {
	const out = write_var(FIXTURE, 'NFQWS2_ENABLE', '0');
	assert.equal(read_var(out, 'NFQWS2_OPT'), read_var(FIXTURE, 'NFQWS2_OPT'),
		'NFQWS2_OPT value must be unchanged when editing NFQWS2_ENABLE');
});

test('write_var does NOT touch a commented line with the same name', () => {
	// FILTER_MARK only appears commented (#FILTER_MARK=...). Writing it must
	// APPEND a new active assignment, not rewrite the comment.
	const out = write_var(FIXTURE, 'FILTER_MARK', '0x10000000');
	assert.equal(read_var(out, 'FILTER_MARK'), '0x10000000');
	// the original comment line is still there
	assert.ok(out.includes('#FILTER_MARK=0x10000000'),
		'commented line preserved');
});

// ---- write_var: multi-line quoted (point 2 will use this; writer is general) ----

test('write_var NFQWS2_OPT replaces the whole quoted block, keeps other lines', () => {
	const stripped = '--filter-tcp=80,443\n--payload=all';
	const out = write_var(FIXTURE, 'NFQWS2_OPT', stripped);
	assert.equal(read_var(out, 'NFQWS2_OPT'), stripped);
	// NFQWS2_ENABLE and surrounding lines are intact
	assert.equal(read_var(out, 'NFQWS2_ENABLE'), '1');
	assert.equal(read_var(out, 'MODE_FILTER'), 'none');
	// the block is still a double-quoted assignment
	assert.ok(out.includes('NFQWS2_OPT="'), 'opening quote preserved');
});

test('write_var NFQWS2_OPT with no lua-desync is the passthrough shape', () => {
	// real passthrough: strip every --lua-desync line, keep the rest. The
	// stripper itself is point 2's concern; here we only assert the writer can
	// store a multi-line value that has no --lua-desync and reads back exactly.
	const passthrough = [
		'--lua-init=@/opt/zapret2/lua/orchestra-extra/init.lua',
		'--lua-init=@/opt/zapret2/lua/init_vars.lua',
		'--filter-tcp=80,443',
		'--payload=all'
	].join('\n');
	assert.ok(!passthrough.includes('--lua-desync='));
	const out = write_var(FIXTURE, 'NFQWS2_OPT', passthrough);
	assert.equal(read_var(out, 'NFQWS2_OPT'), passthrough);
	assert.ok(!read_var(out, 'NFQWS2_OPT').includes('--lua-desync='));
});

// ---- write_var: append when absent ------------------------------------------

test('write_var appends a new variable that does not exist', () => {
	const out = write_var(FIXTURE, 'BRAND_NEW_VAR', 'hello');
	assert.equal(read_var(out, 'BRAND_NEW_VAR'), 'hello');
	// original lines all preserved
	assert.equal(read_var(out, 'NFQWS2_ENABLE'), '1');
	assert.ok(out.endsWith('BRAND_NEW_VAR=hello'),
		'appended assignment is the last line');
});

test('write_var does not drop content when a multi-line quote is unterminated', () => {
	// a hand-corrupted config: NFQWS2_OPT opens but never closes. Rewriting
	// the block would silently drop the trailing content; the guard instead
	// replaces only the opening line and leaves the rest intact.
	const broken = 'NFQWS2_ENABLE=1\nNFQWS2_OPT="\n--lua-init=@/x.lua\n--filter-tcp=80\n';
	const out = write_var(broken, 'NFQWS2_ENABLE', '0');
	assert.equal(read_var(out, 'NFQWS2_ENABLE'), '0');
	// the unterminated OPT lines are still present (not dropped)
	assert.ok(out.includes('--lua-init=@/x.lua'), 'unterminated OPT content preserved');
	assert.ok(out.includes('--filter-tcp=80'), 'unterminated OPT content preserved');
});
