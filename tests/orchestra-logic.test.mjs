// orchestra-logic.test.mjs — Orchestra read-only adapter (Phase D).
// Run: node --test tests/orchestra-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	detectEngineInArgv, capabilityMatrix, unavailableResult,
	parseAutohostlistVars, boundedEvidence,
	ORCHESTRA_VERSION, ORCHESTRA_UPSTREAM_COMMIT
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
		version: ORCHESTRA_VERSION,
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

// ---- unavailable envelope --------------------------------------------------------------

test('unavailableResult carries reason + evidence + version, never an empty fake array', () => {
	const r = unavailableResult('history', 'autostate is in-process memory; no preload API in pinned upstream', ['zapret-auto.lua:48-57', 'grep slm_preload → empty']);
	assert.equal(r.available, false);
	assert.equal(r.upstreamVersion, ORCHESTRA_VERSION);
	assert.equal(r.upstreamCommit, ORCHESTRA_UPSTREAM_COMMIT);
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

test('boundedEvidence caps lists', () => {
	assert.equal(boundedEvidence([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).length, 8);
});
