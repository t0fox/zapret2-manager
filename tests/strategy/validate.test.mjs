// validate.test.mjs — manager-level diagnostics: codes, severities, boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './lib/parse.mjs';
import { validateManager, allDiagnostics, hasErrors, codesOf } from './lib/validate.mjs';

const diags = (text) => allDiagnostics(parse(text));

test('invalid port element → MANAGER_INVALID_TOP_LEVEL_PORT (error)', () => {
	const ds = diags('--filter-tcp=abc-xyz');
	assert.ok(ds.some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_PORT' && d.severity === 'error'));
});

test('out-of-range port and reversed range → errors', () => {
	assert.ok(diags('--filter-tcp=70000').some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_PORT'));
	assert.ok(diags('--filter-udp=9000-80').some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_PORT'));
});

test('valid ports incl. negation and star pass', () => {
	const ds = diags('--filter-tcp=~53,*\n--filter-udp=1024-65535');
	assert.ok(!ds.some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_PORT'));
});

test('invalid range expression → MANAGER_INVALID_TOP_LEVEL_RANGE (error)', () => {
	const ds = diags('--out-range=!!!bad');
	assert.ok(ds.some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_RANGE' && d.severity === 'error'));
});

// Mandatory: bare numeric range operand is rejected (native packet_pos_parse
// requires a unit prefix).
test('bare numeric range -10 → error naming the missing unit prefix', () => {
	const ds = diags('--out-range=-10');
	const d = ds.find((x) => x.code === 'MANAGER_INVALID_TOP_LEVEL_RANGE');
	assert.ok(d);
	assert.equal(d.severity, 'error');
	assert.match(d.message, /unit prefix/);
});

test('native range grammar edge forms: "-" "<" "a" "x" "n1-n3" "n1<n3" are valid', () => {
	for (const raw of ['-', '<', 'a', 'x', 'n1-n3', 'n1<n3', '-n3', '<n3', 'd1-d10', 's4096-']) {
		const ds = diags(`--out-range=${raw}`);
		assert.ok(!ds.some((d) => d.code === 'MANAGER_INVALID_TOP_LEVEL_RANGE'), raw);
	}
});

// Mandatory check #9: unknown Lua function → warning, NOT fatal.
test('unknown lua function hint → MANAGER_NOT_IN_CATALOG warning, zero errors', () => {
	const ds = diags('--filter-tcp=443\n--lua-desync=my_custom_orchestrator:x=1:y=2');
	const d = ds.find((x) => x.code === 'MANAGER_NOT_IN_CATALOG');
	assert.ok(d);
	assert.equal(d.severity, 'warning');
	assert.equal(hasErrors(ds), false);
});

test('undeclared blob hint → MANAGER_NOT_IN_CATALOG warning; declared passes', () => {
	const bad = diags('--lua-desync=fake:blob=totally_made_up');
	assert.ok(bad.some((d) => d.code === 'MANAGER_NOT_IN_CATALOG' && d.message.includes('totally_made_up')));
	const good = diags('--blob=mine:@/opt/zapret2/bin/tls_clienthello.bin\n--lua-desync=fake:blob=mine');
	assert.ok(!good.some((d) => d.code === 'MANAGER_NOT_IN_CATALOG'));
});

test('builtin blob hints (fake_default_tls, tls_google) never warn', () => {
	const ds = diags('--lua-desync=fake:blob=fake_default_tls\n--lua-desync=multisplit:seqovl=1:seqovl_pattern=tls_google');
	assert.ok(!ds.some((d) => d.code === 'MANAGER_NOT_IN_CATALOG'));
});

test('duplicate profile name → MANAGER_DUPLICATE_PROFILE_NAME (warning)', () => {
	const ds = diags('--new=Games\n--filter-tcp=443\n--new=Games\n--filter-udp=443');
	const d = ds.find((x) => x.code === 'MANAGER_DUPLICATE_PROFILE_NAME');
	assert.ok(d);
	assert.equal(d.severity, 'warning');
});

// Contract §9: --new=One + --name=Two must not be silently chosen.
test('--new=One --name=Two → MANAGER_CONFLICTING_PROFILE_NAMES, both forms kept', () => {
	const m = parse('--new=One\n--name=Two\n--filter-tcp=443');
	const ds = validateManager(m);
	const d = ds.find((x) => x.code === 'MANAGER_CONFLICTING_PROFILE_NAMES');
	assert.ok(d);
	assert.equal(d.severity, 'warning');
	const p = m.profiles[0];
	assert.deepEqual(p.nameRecords.map((r) => r.value), ['One', 'Two']);
	assert.equal(p.name, 'Two'); // native semantics: last naming event wins
});

test('--new=X --name=X (same value) → no conflict diagnostic', () => {
	const ds = diags('--new=X\n--name=X\n--filter-tcp=443');
	assert.ok(!ds.some((d) => d.code === 'MANAGER_CONFLICTING_PROFILE_NAMES'));
});

test('unknown top-level option → MANAGER_UNKNOWN_OPTION warning (preserved)', () => {
	const ds = diags('--dpi-desync-fooling=md5sig,badseq');
	const d = ds.find((x) => x.code === 'MANAGER_UNKNOWN_OPTION');
	assert.ok(d);
	assert.equal(d.severity, 'warning');
});

test('known top-level passthrough options do not warn', () => {
	const ds = diags('--qnum=300\n--user=nobody\n--server=0\n--ctrack-disable\n--ipcache-lifetime=7200');
	assert.ok(!ds.some((d) => d.code === 'MANAGER_UNKNOWN_OPTION'));
});

test('clean strategy → no diagnostics at all', () => {
	const ds = diags('--filter-tcp=443\n--payload=tls_client_hello\n--lua-desync=fake:blob=fake_default_tls:repeats=4');
	assert.equal(ds.length, 0);
});

test('codesOf returns sorted unique codes', () => {
	const ds = diags('--filter-tcp=abc\n--out-range=-10\n--lua-desync=zzz:x=1');
	assert.deepEqual(codesOf(ds), ['MANAGER_INVALID_TOP_LEVEL_PORT', 'MANAGER_INVALID_TOP_LEVEL_RANGE', 'MANAGER_NOT_IN_CATALOG']);
});
