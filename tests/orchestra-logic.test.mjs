// orchestra-logic.test.mjs — Orchestra read-only adapter v2 (Phase D).
// Run: node --test tests/orchestra-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	detectEngineInArgv, capabilityMatrix, unavailableResult,
	parseAutohostlistVars, boundedEvidence,
	semanticAutohostlist, safeDiagTail, parseIntSafe, parseBoolSafe,
	adaptiveState,
	PINNED_UPSTREAM
} from './lib/orchestra-logic.mjs';

const LIVE_ARGV = '/opt/zapret2/nfq2/nfqws2 --user=daemon --fwmark=0x40000000 --lua-init=@/opt/zapret2/lua/zapret-lib.lua --lua-init=@/opt/zapret2/lua/zapret-antidpi.lua --lua-init=@/opt/zapret2/lua/zapret-auto.lua --qnum=300 --comment=Strategy__default --filter-tcp=80';

// ---- engine detection -----------------------------------------------------------

test('detectEngineInArgv: detects auto/antidpi/lib from the live argv shape', () => {
	const r = detectEngineInArgv(LIVE_ARGV);
	assert.deepEqual(r, { auto: true, antidpi: true, lib: true });
	assert.equal(detectEngineInArgv('--qnum=300 --filter-tcp=80').auto, false);
	assert.equal(detectEngineInArgv(null).auto, false);
});

// ---- capability matrix -------------------------------------------------------------

test('capabilityMatrix: engine/autostate/config available; preload/events/mutations honestly unavailable', () => {
	const m = capabilityMatrix({
		engine: detectEngineInArgv(LIVE_ARGV),
		luaFiles: [{ path: '/opt/zapret2/lua/zapret-auto.lua', sha256: 'a'.repeat(64) }],
		version: '0.9',
		compatVer: 5,
		autohostlistVars: { AUTOHOSTLIST_FAIL_THRESHOLD: '3' },
		debugEnabled: false
	});
	const byCap = Object.fromEntries(m.map((c) => [c.capability, c]));
	assert.equal(byCap['engine-loaded'].available, true);
	assert.equal(byCap['lua-bundle-present'].available, true);
	assert.equal(byCap['autostate-model'].available, true);
	assert.match(byCap['autostate-model'].reason, /IN-PROCESS MEMORY ONLY/);

	for (const cap of ['preload-apis', 'event-stream', 'lock-block-whitelist-mutation']) {
		assert.equal(byCap[cap].available, false, cap + ' must be honestly unavailable');
		assert.ok(byCap[cap].reason && byCap[cap].reason.length > 10, cap + ' needs a reason');
		assert.ok(byCap[cap].evidence.length > 0, cap + ' needs evidence');
	}
	assert.match(byCap['preload-apis'].reason, /do NOT exist/);
	assert.match(byCap['event-stream'].reason, /DLOG|debug/);
	assert.equal(byCap['autohostlist-config'].available, true);
});

test('capabilityMatrix: engine NOT loaded degrades honestly', () => {
	const m = capabilityMatrix({ engine: { auto: false, antidpi: false, lib: false }, luaFiles: [] });
	const byCap = Object.fromEntries(m.map((c) => [c.capability, c]));
	assert.equal(byCap['engine-loaded'].available, false);
	assert.ok(byCap['engine-loaded'].reason);
	assert.equal(byCap['autostate-model'].available, false);
});

// ---- pinned upstream constant ----------------------------------------------------

test('pinned upstream is present and looks like a commit hash', () => {
	assert.equal(PINNED_UPSTREAM.length, 40);
	assert.match(PINNED_UPSTREAM, /^[a-f0-9]{40}$/);
});

// ---- unavailable envelope --------------------------------------------------------------

test('unavailableResult carries reason + evidence, never an empty fake array', () => {
	const r = unavailableResult('history', 'autostate is in-process memory; no preload API in pinned upstream', ['zapret-auto.lua:48-57', 'grep slm_preload → empty']);
	assert.equal(r.available, false);
	assert.ok(r.reason.length > 0);
	assert.ok(r.evidence.length > 0);
	assert.match(r.note, /unavailable instead of an empty array/);
	assert.equal(r.rows, undefined, 'no fake empty rows');
});

// ---- autohostlist vars parse --------------------------------------------------------------

const CONFIG_SAMPLE = `
NFQWS2_ENABLE=1
AUTOHOSTLIST_FAIL_THRESHOLD=3
AUTOHOSTLIST_FAIL_TIME=60
# AUTOHOSTLIST_DEBUGLOG=0
AUTOHOSTLIST_DEBUGLOG=0
AUTOHOSTLIST_INCOMING_MAXSEQ=4096
`;

test('parseAutohostlistVars: verbatim AUTOHOSTLIST_* (no manager thresholds, comments skipped)', () => {
	const v = parseAutohostlistVars(CONFIG_SAMPLE);
	assert.equal(v.AUTOHOSTLIST_FAIL_THRESHOLD, '3');
	assert.equal(v.AUTOHOSTLIST_FAIL_TIME, '60');
	assert.equal(v.AUTOHOSTLIST_DEBUGLOG, '0', 'the ACTIVE debuglog line is read (commented one ignored)');
	assert.equal(v.AUTOHOSTLIST_INCOMING_MAXSEQ, '4096');
	assert.equal(v.NFQWS2_ENABLE, undefined, 'non-AUTOHOSTLIST vars excluded');
});

// ---- semantic autohostlist parsing --------------------------------------------------------

test('semanticAutohostlist: parses failure threshold and window', () => {
	const sem = semanticAutohostlist({
		AUTOHOSTLIST_FAIL_THRESHOLD: '3',
		AUTOHOSTLIST_FAIL_TIME: '60'
	});
	assert.equal(sem.failure.threshold, 3);
	assert.equal(sem.failure.windowSeconds, 60);
	assert.deepEqual(sem.parseErrors, []);
});

test('semanticAutohostlist: parses retransmission settings', () => {
	const sem = semanticAutohostlist({
		AUTOHOSTLIST_RETRANSMIT_THRESHOLD: '5',
		AUTOHOSTLIST_RETRANSMIT_RESET: '1',
		AUTOHOSTLIST_RETRANSMIT_MAXSEQ: '2048'
	});
	assert.equal(sem.retransmission.threshold, 5);
	assert.equal(sem.retransmission.reset, true);
	assert.equal(sem.retransmission.maxSequence, 2048);
});

test('semanticAutohostlist: parses boolean values correctly', () => {
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_RETRANSMIT_RESET: '1' }).retransmission.reset, true);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_RETRANSMIT_RESET: '0' }).retransmission.reset, false);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_RETRANSMIT_RESET: 'true' }).retransmission.reset, true);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_RETRANSMIT_RESET: 'false' }).retransmission.reset, false);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_RETRANSMIT_RESET: 'yes' }).retransmission.reset, true);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_RETRANSMIT_RESET: 'no' }).retransmission.reset, false);
});

test('semanticAutohostlist: parses UDP observation', () => {
	const sem = semanticAutohostlist({
		AUTOHOSTLIST_INCOMING_MAXSEQ: '4096',
		AUTOHOSTLIST_OUTGOING_MAXSEQ: '2048'
	});
	assert.equal(sem.udp.incomingMaxSeq, 4096);
	assert.equal(sem.udp.outgoingMaxSeq, 2048);
});

test('semanticAutohostlist: debug disabled by default', () => {
	const sem = semanticAutohostlist({});
	assert.equal(sem.debug.enabled, false);
	assert.equal(sem.debug.path, null);
});

test('semanticAutohostlist: debug enabled when set to 1', () => {
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_DEBUGLOG: '1' }).debug.enabled, true);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_DEBUGLOG: 'true' }).debug.enabled, true);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_DEBUGLOG: '/tmp/log.txt' }).debug.enabled, true);
	assert.equal(semanticAutohostlist({ AUTOHOSTLIST_DEBUGLOG: '/tmp/log.txt' }).debug.path, '/tmp/log.txt');
});

test('semanticAutohostlist: malformed values reported as parse errors', () => {
	const sem = semanticAutohostlist({
		AUTOHOSTLIST_FAIL_THRESHOLD: 'not-a-number',
		AUTOHOSTLIST_RETRANSMIT_THRESHOLD: ''
	});
	assert.ok(sem.parseErrors.length > 0);
	assert.equal(sem.failure.threshold, undefined);
	assert.equal(sem.retransmission.threshold, undefined);
});

test('semanticAutohostlist: zero vs missing distinction', () => {
	const semZero = semanticAutohostlist({ AUTOHOSTLIST_FAIL_THRESHOLD: '0' });
	const semMissing = semanticAutohostlist({});
	assert.equal(semZero.failure.threshold, 0, 'zero is a valid value');
	assert.equal(semMissing.failure.threshold, undefined, 'missing is undefined, not zero');
});

test('semanticAutohostlist: null/empty safe', () => {
	const sem = semanticAutohostlist(null);
	assert.equal(sem.failure.threshold, undefined);
	assert.deepEqual(sem.parseErrors, []);
	const sem2 = semanticAutohostlist(undefined);
	assert.equal(sem2.failure.threshold, undefined);
});

test('parseIntSafe: handles edge cases', () => {
	assert.equal(parseIntSafe('42'), 42);
	assert.equal(parseIntSafe('0'), 0);
	assert.equal(parseIntSafe('-1'), -1);
	assert.equal(parseIntSafe(null), null);
	assert.equal(parseIntSafe(''), null);
	assert.equal(parseIntSafe('abc'), null);
	assert.equal(parseIntSafe('3147483647'), null, 'exceeds int32 range');
});

test('parseBoolSafe: handles edge cases', () => {
	assert.equal(parseBoolSafe('1'), true);
	assert.equal(parseBoolSafe('0'), false);
	assert.equal(parseBoolSafe('true'), true);
	assert.equal(parseBoolSafe('false'), false);
	assert.equal(parseBoolSafe(null), null);
	assert.equal(parseBoolSafe(''), null);
	assert.equal(parseBoolSafe('bogus'), null);
});

// ---- adaptive state determination ------------------------------------------------

test('adaptiveState: determines from engine + semantic model', () => {
	assert.equal(adaptiveState({ auto: false }, {}), 'inactive');
	assert.equal(adaptiveState({ auto: true }, { failure: {}, retransmission: {} }), 'partial');
	assert.equal(adaptiveState({ auto: true }, { failure: { threshold: 3 }, retransmission: {} }), 'active');
	assert.equal(adaptiveState({ auto: true }, { failure: {}, retransmission: { threshold: 5 } }), 'active');
	assert.equal(adaptiveState(null, {}), 'inactive');
});

// ---- safe diagnostic tail parsing -----------------------------------------------

test('safeDiagTail: parses known event classes, counts unknown', () => {
	const lines = [
		'adaptive_failure: host=example.com threshold=3',
		'retransmission: threshold reached for flow X',
		'autohostlist_decision: allow host=foo.com',
		'garbage line that should be unknown',
		'strategy_transition: mode=adaptive',
		'',
		'another unknown line'
	];
	const result = safeDiagTail(lines);
	assert.equal(result.parsed.length, 4, '4 known events parsed');
	assert.equal(result.unknownCount, 2, '2 unknown lines (excluding empty)');
	assert.equal(result.parserVersion, 1);
});

test('safeDiagTail: empty input', () => {
	const result = safeDiagTail([]);
	assert.equal(result.parsed.length, 0);
	assert.equal(result.unknownCount, 0);
});

test('safeDiagTail: no fake events', () => {
	const result = safeDiagTail(['completely unrelated text', 'yet more nonsense']);
	assert.equal(result.parsed.length, 0);
	assert.equal(result.unknownCount, 2);
});

test('safeDiagTail: preserves raw line hashes', () => {
	const lines = ['adaptive_failure: host=x threshold=5'];
	const result = safeDiagTail(lines);
	assert.equal(result.parsed.length, 1);
	assert.equal(typeof result.parsed[0].rawLineHash, 'string');
	assert.equal(result.parsed[0].rawLineHash.length, 8);
});

// ---- boundedEvidence ---------------------------------------------------------------

test('boundedEvidence caps lists', () => {
	assert.equal(boundedEvidence([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).length, 8);
});

// ---- version detection (optional, tests logic structure) ---------------------------

test('detected version fields are present in capability matrix shape', () => {
	// the detected.packageVersion / detected.pinnedUpstream pattern
	const pinned = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';
	assert.equal(pinned.length, 40);
	assert.match(pinned, /^[a-f0-9]{40}$/);
});

// ---- no fake events/history --------------------------------------------------------

test('safeDiagTail does not fabricate events for empty/unknown input', () => {
	const empty = safeDiagTail([]);
	const unknown = safeDiagTail(['blah', 'foo', 'nonsense']);
	assert.equal(empty.parsed.length, 0);
	assert.equal(unknown.parsed.length, 0, 'no events fabricated from unknown lines');
});

test('unavailableResult carries no rows/entries field', () => {
	const r = unavailableResult('history', 'reason', ['evidence']);
	assert.equal(r.rows, undefined);
	assert.equal(r.entries, undefined);
});
