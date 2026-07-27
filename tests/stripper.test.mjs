// Self-test for the lua-desync stripper (point 2 — passthrough).
//
// Passthrough = nfqws2 is up, filters and ports in place, but NOT A SINGLE
// --lua-desync argument is passed. The stripper takes the current applied
// NFQWS2_OPT value and removes every --lua-desync arg, keeping the rest
// unchanged (order + separators preserved). The stripped string is written
// back via apply.uc; the original is saved to last-good for resume.
//
// As with apply-writer, ucode does not run locally; this node self-test is
// the red/green proof for the STRIPPING ALGORITHM. The shipped ucode
// strip_lua_desync mirrors tests/lib/stripper.mjs; its runtime is confirmed
// on the target via smoke.sh.
//
// FIXTURE ORIGIN: tests/fixtures/opt-zapret2-config.out is a snapshot of
// UNCONFIRMED origin (collected from a router before it was factory-reset;
// the engine is no longer on the device, so the snapshot cannot be re-verified
// against the current target). It is a FORMAT sample, not a verified live
// reading. A format mismatch on a freshly installed engine is a blocker.
//
// Run: node --test tests/stripper.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { read_var } from './lib/apply-writer.mjs';
import { strip_lua_desync } from './lib/stripper.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// FIXTURE: snapshot of unconfirmed origin (see header). FORMAT sample only.
const FIXTURE = readFileSync(join(here, 'fixtures/opt-zapret2-config.out'), 'utf8');
const REAL_OPT = read_var(FIXTURE, 'NFQWS2_OPT');

// ---- the NFQWS2_OPT from the unconfirmed-origin fixture sample ---------------

test('stripping the fixture NFQWS2_OPT removes every --lua-desync and keeps the rest', () => {
	assert.ok(REAL_OPT != null && REAL_OPT.includes('--lua-desync='),
		'sanity: the fixture OPT has lua-desync args to strip');
	const out = strip_lua_desync(REAL_OPT);
	// not a single lua-desync remains
	assert.equal(out.includes('--lua-desync='), false,
		'no --lua-desync= may remain after stripping');
	// the non-lua-desync args are preserved, in order
	for (const kept of [
		'--lua-init=@/opt/zapret2/lua/orchestra-extra/init.lua',
		'--lua-init=@/opt/zapret2/lua/init_vars.lua',
		'--blob=stun_pat:@/opt/zapret2/bin/stun.bin',
		'--filter-tcp=80,443,1080,2053,2083,2087,2096,8443',
		'--hostlist-domains=discord.com',
		'--payload=all',
		'--in-range=-d10000',
		'--out-range=-d10'
	]) {
		assert.ok(out.includes(kept), `kept arg preserved: ${kept}`);
	}
});

test('stripped real OPT preserves the order of the kept args', () => {
	const out = strip_lua_desync(REAL_OPT);
	const idx = (s) => out.indexOf(s);
	const luainit = idx('--lua-init=@/opt/zapret2/lua/orchestra-extra/init.lua');
	const blob = idx('--blob=stun_pat:');
	const filter = idx('--filter-tcp=');
	const payload = idx('--payload=all');
	const outrange = idx('--out-range=-d10');
	assert.ok(luainit < blob && blob < filter && filter < payload && payload < outrange,
		'kept args remain in their original order');
});

// ---- task edge cases ---------------------------------------------------------

test('arg with value through "=" is removed', () => {
	const v = '--lua-desync=circular_quality:key=tls:fails=3:failure_detector=combined_failure_detector';
	assert.equal(strip_lua_desync(v), '');
});

test('several --lua-desync args in a row are all removed', () => {
	const v = '--lua-desync=a:1\n--lua-desync=b:2\n--lua-desync=c:3';
	assert.equal(strip_lua_desync(v), '');
});

test('a --lua-desync arg LAST in the string is removed; result ends with the prior kept line', () => {
	const v = '--filter-tcp=80,443\n--lua-desync=multisplit:strategy=24';
	const out = strip_lua_desync(v);
	assert.equal(out, '--filter-tcp=80,443');
});

test('complete absence of --lua-desync leaves the string unchanged', () => {
	const v = '--lua-init=@/x.lua\n--filter-tcp=80\n--payload=all';
	assert.equal(strip_lua_desync(v), v);
});

test('a foreign arg with a similar name start (--lua-init) is NOT removed', () => {
	// both start with "--lua-" but only "--lua-desync=" is stripped
	const v = '--lua-init=@/opt/zapret2/lua/init_vars.lua\n--lua-desync=fake:1\n--lua-init=@/opt/zapret2/lua/custom_funcs.lua';
	const out = strip_lua_desync(v);
	assert.equal(out, '--lua-init=@/opt/zapret2/lua/init_vars.lua\n--lua-init=@/opt/zapret2/lua/custom_funcs.lua');
});

test('a lookalike with a longer name (--lua-desync2=) is NOT removed', () => {
	// exact prefix is "--lua-desync="; "--lua-desync2=" must survive
	const v = '--lua-desync2=not-a-real-arg\n--lua-desync=real:1';
	const out = strip_lua_desync(v);
	assert.equal(out, '--lua-desync2=not-a-real-arg');
});

test('order and separators of the kept args are preserved with lua-desync in the middle', () => {
	const v = '--lua-init=@/a.lua\n--lua-desync=mid:1\n--filter-tcp=80\n--lua-desync=mid:2\n--payload=all';
	const out = strip_lua_desync(v);
	assert.equal(out, '--lua-init=@/a.lua\n--filter-tcp=80\n--payload=all');
});

test('several args on one line: --lua-desync is stripped, the rest kept in order', () => {
	// arg-based (followup 3): several nfqws2 args share a line separated by
	// spaces. The --lua-desync token is removed; the kept args stay in order
	// with a single space between them (the dropped token's separator goes too).
	const v = '--filter-tcp=80,443 --lua-desync=mid:1 --payload=all';
	assert.equal(strip_lua_desync(v), '--filter-tcp=80,443 --payload=all');
});

test('several args on one line with multiple --lua-desync interspersed', () => {
	const v = '--lua-init=@/a.lua --lua-desync=x:1 --filter-tcp=80 --lua-desync=y:2 --payload=all';
	assert.equal(strip_lua_desync(v), '--lua-init=@/a.lua --filter-tcp=80 --payload=all');
});

test('a --lua-desync token mid-line (not at line start) IS stripped (arg-based)', () => {
	// The OLD line-based stripper kept a line that merely contained
	// --lua-desync= mid-line. The arg-based stripper (followup 3) treats the
	// value as a whitespace-separated arg list, so the inline --lua-desync
	// token IS removed. This is the silent-defect class the change targets.
	const v = '--filter-tcp=80 --lua-desync=x';
	assert.equal(strip_lua_desync(v), '--filter-tcp=80');
});

test('mixed newlines and spaces: separators of kept args preserved', () => {
	// one arg per line AND an inline pair; the kept args keep their newline
	// separators (space-separated inline pair keeps its single space).
	const v = '--lua-init=@/a.lua\n--filter-tcp=80 --lua-desync=x --payload=all\n--in-range=-d10000';
	assert.equal(strip_lua_desync(v), '--lua-init=@/a.lua\n--filter-tcp=80 --payload=all\n--in-range=-d10000');
});

test('leading --lua-desync dropped: no orphan leading separator', () => {
	// the first token is dropped; its preceding separator (none here, but the
	// separator BEFORE the first kept token must not be orphaned)
	assert.equal(strip_lua_desync('--lua-desync=x --filter-tcp=80'), '--filter-tcp=80');
	assert.equal(strip_lua_desync('--lua-desync=x\n--filter-tcp=80'), '--filter-tcp=80');
	assert.equal(strip_lua_desync('  --lua-desync=x --filter-tcp=80'), '--filter-tcp=80');
});

// ---- ПУНКТ ТРЕТЬЕ: real-format markers/separators survive stripping ----------------
// The real NFQWS2_OPT uses <HOSTLIST>/<HOSTLIST_NOAUTO> list placeholders, --new
// profile separators, --filter-l7= protocol filter. Stripping --lua-desync must
// NOT eat any of these (eating them corrupts the user's config — worst defect class).

test('<HOSTLIST> placeholder survives stripping (not eaten)', () => {
	const v = '--filter-tcp=80 --filter-l7=http <HOSTLIST> --lua-desync=fake:1 --payload=http_req';
	const out = strip_lua_desync(v);
	assert.ok(out.includes('<HOSTLIST>'), '<HOSTLIST> placeholder preserved');
	assert.ok(!out.includes('--lua-desync='), 'lua-desync removed');
});

test('<HOSTLIST_NOAUTO> placeholder survives stripping (not eaten)', () => {
	const v = '--filter-udp=443 --filter-l7=quic <HOSTLIST_NOAUTO> --lua-desync=fake:quic:repeats=6 --payload=quic_initial';
	const out = strip_lua_desync(v);
	assert.ok(out.includes('<HOSTLIST_NOAUTO>'), '<HOSTLIST_NOAUTO> placeholder preserved');
	assert.ok(!out.includes('--lua-desync='));
});

test('--new profile separator survives stripping (not eaten)', () => {
	const v = '--comment=A --filter-tcp=80 --lua-desync=fake:a  --new --filter-tcp=443 --lua-desync=fake:b';
	const out = strip_lua_desync(v);
	assert.ok(out.includes('--new'), '--new profile separator preserved');
	assert.ok(!out.includes('--lua-desync='));
});

test('--filter-l7= protocol filter survives stripping (not eaten)', () => {
	const v = '--filter-tcp=80 --filter-l7=http --lua-desync=fake:1 --payload=http_req';
	const out = strip_lua_desync(v);
	assert.ok(out.includes('--filter-l7=http'), 'protocol filter preserved');
	assert.ok(!out.includes('--lua-desync='));
});

test('real default NFQWS2_OPT: strip all lua-desync, keep every marker/separator (no corruption)', () => {
	const F = readFileSync(join(here, 'fixtures-postinstall/opt-zapret2-config.out'), 'utf8');
	const v = read_var(F, 'NFQWS2_OPT');
	const out = strip_lua_desync(v);
	assert.ok(!out.includes('--lua-desync='), 'no lua-desync remains');
	// every marker and separator that was in the real OPT is still there
	assert.ok(out.includes('<HOSTLIST>'));
	assert.ok(out.includes('<HOSTLIST_NOAUTO>'));
	assert.ok(out.includes('--new'));
	assert.ok(out.includes('--filter-l7='));
	assert.ok(out.includes('--comment=Strategy__default'));
	// profile count by --new is unchanged (the --new separators are NOT eaten)
	assert.equal((out.match(/--new/g) || []).length, (v.match(/--new/g) || []).length);
});
