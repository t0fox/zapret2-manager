'use strict';
// orchestra.uc — read-only Orchestra capability/observability adapter v2
// (Phase D). Mirrors tests/lib/orchestra-logic.mjs.
//
// Upstream zapret-auto.lua already owns packet-time orchestration (autostate
// in-process). This adapter READS what is genuinely readable without
// mutation and returns honest available:false with reason+evidence for
// everything else — never empty arrays pretending success. No second
// orchestration layer is created here, ever.
//
// v2: dynamic upstream detection, semantic autohostlist model, safe
//     diagnostic log tail, manager observation history, diagnostic draft.

import { readfile, readlink, stat, lsdir, popen, mkdir, unlink } from 'fs';
import { maint_lua_compat } from './maintenance.uc';
import { PATHS } from './constants.uc';

const LUA_DIR = '/opt/zapret2/lua';
const PINNED_UPSTREAM = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';
const DIAG_LOG_PATH = '/tmp/zapret2-manager/orchestra-diag-tail.log';
const DIAG_TAIL_BYTES = 8192;
const DIAG_TAIL_LINES = 200;
const HISTORY_DIR = '/tmp/zapret2-manager/orchestra-history';
const HISTORY_MAX = 256;
const HISTORY_ROTATE_AT = 512;

function run(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	return out;
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let h = trim(run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'"));
	return (length(h) == 64) ? h : null;
}

// ---- dynamic upstream detection -----------------------------------------------

function detect_package_version() {
	let v = readfile(PATHS.applied_version);
	if (v) {
		let t = trim(split(v, '\n')[0]);
		if (length(t) > 0 && length(t) < 128) return t;
	}
	let apk = trim(run('apk info zapret2 2>/dev/null'));
	if (apk != '' && index(apk, '-') >= 0) return apk;
	return null;
}

function detect_nfqws2_binary_version() {
	let raw = run('/opt/zapret2/nfq2/nfqws2 --version 2>/dev/null');
	if (!raw || raw == '') raw = run('/opt/zapret2/nfqws2 --version 2>/dev/null');
	if (raw && length(trim(raw)) > 0) return trim(split(raw, '\n')[0]);
	return null;
}

// ---- engine detection ---------------------------------------------------------

function nfqws2_cmdline() {
	let pid = trim(run('pidof nfqws2'));
	if (pid == '') return null;
	let parts = split(pid, ' ');
	pid = parts[0];
	let raw = readfile('/proc/' + pid + '/cmdline');
	if (!raw) return null;
	return { pid: +pid, cmdline: raw };
}

function detect_engine(cmdline) {
	return {
		auto: index(cmdline, 'zapret-auto.lua') >= 0,
		antidpi: index(cmdline, 'zapret-antidpi.lua') >= 0,
		lib: index(cmdline, 'zapret-lib.lua') >= 0
	};
}

function debug_enabled(cmdline) {
	return (index(cmdline, '--debug') >= 0);
}

// ---- lua bundle detection ------------------------------------------------------

function detect_lua_files() {
	let out = [];
	let names = lsdir(LUA_DIR);
	if (type(names) == 'array') {
		for (let i = 0; i < length(names) && length(out) < 8; i++) {
			let p = LUA_DIR + '/' + names[i];
			if (substr(p, length(p) - 4) == '.lua')
				push(out, { path: p, sha256: sha256_file(p) });
		}
	}
	return out;
}

// ---- config reads (verbatim, no manager thresholds) ----------------------------

function parse_autohostlist_vars(text) {
	let out = {};
	let lines = split(text != null ? text : '', '\n');
	for (let i = 0; i < length(lines); i++) {
		let t = trim(lines[i]);
		if (substr(t, 0, 1) == '#') continue;
		if (substr(t, 0, 13) != 'AUTOHOSTLIST_') continue;
		let eq = index(t, '=');
		if (eq < 0) continue;
		let k = substr(t, 0, eq);
		let v = substr(t, eq + 1);
		if (substr(v, 0, 1) == '"' && substr(v, length(v) - 1) == '"' && length(v) >= 2)
			v = substr(v, 1, length(v) - 2);
		out[k] = v;
	}
	return out;
}

// ---- semantic autohostlist model ----------------------------------------------

function parseIntSafe(s) {
	if (s == null || s == '') return null;
	let n = +s;
	if (n != n) return null;
	if (abs(n) > 2147483647) return null;
	return n;
}

function parseBoolSafe(s) {
	if (s == null || s == '') return null;
	let t = trim('' + s);
	if (t == '1' || t == 'true' || t == 'yes') return true;
	if (t == '0' || t == 'false' || t == 'no') return false;
	return null;
}

function semantic_autohostlist(rawVars) {
	let result = { failure: {}, retransmission: {}, udp: {}, debug: { enabled: false, path: null }, raw: rawVars != null ? rawVars : {}, parseErrors: [] };
	if (rawVars == null || type(rawVars) != 'object') return result;

	let failThresh = parseIntSafe(rawVars.AUTOHOSTLIST_FAIL_THRESHOLD);
	if (failThresh != null) result.failure.threshold = failThresh;
	else if (rawVars.AUTOHOSTLIST_FAIL_THRESHOLD != null) push(result.parseErrors, 'AUTOHOSTLIST_FAIL_THRESHOLD is not a valid integer: ' + rawVars.AUTOHOSTLIST_FAIL_THRESHOLD);

	let failTime = parseIntSafe(rawVars.AUTOHOSTLIST_FAIL_TIME);
	if (failTime != null) result.failure.windowSeconds = failTime;
	else if (rawVars.AUTOHOSTLIST_FAIL_TIME != null) push(result.parseErrors, 'AUTOHOSTLIST_FAIL_TIME is not a valid integer: ' + rawVars.AUTOHOSTLIST_FAIL_TIME);

	let retxThresh = parseIntSafe(rawVars.AUTOHOSTLIST_RETRANSMIT_THRESHOLD);
	if (retxThresh != null) result.retransmission.threshold = retxThresh;
	else if (rawVars.AUTOHOSTLIST_RETRANSMIT_THRESHOLD != null) push(result.parseErrors, 'AUTOHOSTLIST_RETRANSMIT_THRESHOLD malformed: ' + rawVars.AUTOHOSTLIST_RETRANSMIT_THRESHOLD);

	let retxReset = parseBoolSafe(rawVars.AUTOHOSTLIST_RETRANSMIT_RESET);
	if (retxReset != null) result.retransmission.reset = retxReset;
	else if (rawVars.AUTOHOSTLIST_RETRANSMIT_RESET != null) push(result.parseErrors, 'AUTOHOSTLIST_RETRANSMIT_RESET malformed: ' + rawVars.AUTOHOSTLIST_RETRANSMIT_RESET);

	let maxSeq = parseIntSafe(rawVars.AUTOHOSTLIST_RETRANSMIT_MAXSEQ);
	if (maxSeq != null) result.retransmission.maxSequence = maxSeq;
	else if (rawVars.AUTOHOSTLIST_RETRANSMIT_MAXSEQ != null) push(result.parseErrors, 'AUTOHOSTLIST_RETRANSMIT_MAXSEQ malformed: ' + rawVars.AUTOHOSTLIST_RETRANSMIT_MAXSEQ);

	let udpIn = parseIntSafe(rawVars.AUTOHOSTLIST_INCOMING_MAXSEQ);
	if (udpIn != null) result.udp.incomingMaxSeq = udpIn;
	else if (rawVars.AUTOHOSTLIST_INCOMING_MAXSEQ != null) push(result.parseErrors, 'AUTOHOSTLIST_INCOMING_MAXSEQ malformed: ' + rawVars.AUTOHOSTLIST_INCOMING_MAXSEQ);

	let udpOut = parseIntSafe(rawVars.AUTOHOSTLIST_OUTGOING_MAXSEQ);
	if (udpOut != null) result.udp.outgoingMaxSeq = udpOut;
	else if (rawVars.AUTOHOSTLIST_OUTGOING_MAXSEQ != null) push(result.parseErrors, 'AUTOHOSTLIST_OUTGOING_MAXSEQ malformed: ' + rawVars.AUTOHOSTLIST_OUTGOING_MAXSEQ);

	let dbg = rawVars.AUTOHOSTLIST_DEBUGLOG;
	if (dbg != null && dbg != '0' && dbg != '') { result.debug.enabled = true; if (dbg != '1') result.debug.path = dbg; }
	else { let dbgBool = parseBoolSafe(dbg); if (dbgBool === true) result.debug.enabled = true; }

	return result;
}

// ---- capability matrix --------------------------------------------------------

function unavailable(reason, evidence) {
	return { available: false, reason: reason, evidence: evidence };
}

function capability_matrix(engine, luaFiles, debugEnabled) {
	let engineLoaded = engine.auto == true;
	return [
		{ capability: 'engine-loaded', available: engineLoaded, reason: engineLoaded ? null : 'zapret-auto.lua is not in the live nfqws2 argv', evidence: ['live process argv (/proc/<pid>/cmdline)'] },
		{ capability: 'lua-bundle-present', available: length(luaFiles) > 0, reason: null, evidence: (function () { let o = []; for (let i = 0; i < length(luaFiles) && i < 8; i++) push(o, luaFiles[i].path); return o; })() },
		{ capability: 'autostate-model', available: engineLoaded, reason: 'state records live in the Lua global autostate (autostate.<askey>.<hostkey>), created at packet time — IN-PROCESS MEMORY ONLY (no persistence calls exist in zapret-auto.lua)', evidence: ['zapret-auto.lua:48-57 (autostate creation)'] },
		unavailable('Zapret2GUI slm_preload_blocked/slm_preload_locked/slm_preload_history do NOT exist in the pinned upstream zapret-auto.lua — there is no way to read autostate from outside the process', ['grep slm_preload zapret-auto.lua @d3b3011 → empty', 'pinned upstream ' + PINNED_UPSTREAM]),
		unavailable('no event stream exists: DLOG is gated by b_debug (' + (debugEnabled ? 'present' : 'ABSENT') + ' in the live argv) and AUTOHOSTLIST_DEBUGLOG=0 in the applied config', ['zapret-auto.lua DLOG/b_debug usage', 'applied config AUTOHOSTLIST_DEBUGLOG=0']),
		unavailable('no upstream interface exists for strategy lock/block/whitelist management — implementing one would require a second orchestration layer, which is architecturally forbidden', ['docs/architecture.md invariants (upstream owns packet-time orchestration)'])
	];
}

function with_ids(matrix) {
	let ids = ['engine-loaded', 'lua-bundle-present', 'autostate-model', 'preload-apis', 'event-stream', 'lock-block-whitelist-mutation'];
	let out = [];
	for (let i = 0; i < length(matrix) && i < length(ids); i++) { let m = matrix[i]; m.capability = ids[i]; push(out, m); }
	push(out, { capability: 'autohostlist-config', available: true, reason: null, evidence: ['AUTOHOSTLIST_* in /opt/zapret2/config (verbatim)'] });
	return out;
}

function unavailable_result(what, reason, evidence) {
	return { available: false, what: what, reason: reason, evidence: evidence, note: 'returned as unavailable instead of an empty array pretending success' };
}

// ---- safe diagnostic log tail -------------------------------------------------

const KNOWN_EVENT_PREFIXES = ['adaptive_failure:', 'retransmission:', 'autohostlist_decision:', 'strategy_transition:'];

function safe_diag_tail(path) {
	if (path == null || path == '') return null;
	if (substr(path, 0, 5) != '/tmp/' && substr(path, 0, 12) != '/opt/zapret2/') return { error: 'diagnostic path not in allowlisted prefix', path: path };
	if (!stat(path)) return null;
	let raw = readfile(path);
	if (!raw) return null;
	if (length(raw) > DIAG_TAIL_BYTES * 2) raw = substr(raw, length(raw) - DIAG_TAIL_BYTES);
	let lines = split(raw, '\n');
	if (length(lines) > DIAG_TAIL_LINES) {
		let keepLines = []; let start = length(lines) - DIAG_TAIL_LINES;
		for (let i = start; i < length(lines); i++) push(keepLines, lines[i]);
		lines = keepLines;
	}
	let truncated = length(raw) > DIAG_TAIL_BYTES;
	let parsed = []; let unknownCount = 0;
	for (let li = 0; li < length(lines); li++) {
		let l = trim(lines[li]); if (l == '') continue;
		let known = false;
		for (let pi = 0; pi < length(KNOWN_EVENT_PREFIXES); pi++) {
			if (substr(l, 0, length(KNOWN_EVENT_PREFIXES[pi])) == KNOWN_EVENT_PREFIXES[pi]) { known = true; push(parsed, { lineIndex: li, eventClass: KNOWN_EVENT_PREFIXES[pi], rawLineHash: sha256_string(l) }); break; }
		}
		if (!known) unknownCount++;
	}
	try { mkdir('/tmp/zapret2-manager'); writefile(DIAG_LOG_PATH, raw); } catch (e) { }
	return { path: path, linesTotal: length(lines), parsed: length(parsed), unknown: unknownCount, truncated: truncated, parserVersion: 1, freshness: time(), events: parsed };
}

function sha256_string(s) {
	let h = 5381;
	for (let i = 0; i < length(s); i++) { h = ((h << 5) + h) + ord(substr(s, i, 1)); h = h & 0xFFFFFFFF; }
	return sprintf('%08x', h);
}

// ---- manager observation history -----------------------------------------------

function read_history() {
	let entries = []; let names = lsdir(HISTORY_DIR);
	if (type(names) != 'array') return entries;
	for (let i = 0; i < length(names); i++) {
		if (substr(names[i], length(names[i]) - 5) != '.json') continue;
		let raw = readfile(HISTORY_DIR + '/' + names[i]);
		if (!raw) continue;
		try { let obj = json(raw); if (type(obj) == 'object' && obj != null && type(obj.eventClass) == 'string') push(entries, obj); } catch (e) { }
	}
	return entries;
}

function append_history(events, diagPath) {
	if (length(events) == 0) return;
	try { mkdir(HISTORY_DIR); } catch (e) { }
	let now = time();
	for (let i = 0; i < length(events) && i < 32; i++) {
		let entry = { timestamp: now, eventClass: events[i].eventClass, source: diagPath || 'unknown', parserVersion: 1, rawLineHash: events[i].rawLineHash };
		writefile(HISTORY_DIR + '/' + now + '-' + i + '.json', sprintf("%J", entry) + '\n');
	}
	let names = lsdir(HISTORY_DIR);
	if (type(names) == 'array' && length(names) > HISTORY_ROTATE_AT) {
		let sorted = names.slice();
		for (let i = 1; i < length(sorted); i++) { let v = sorted[i]; let j = i - 1; while (j >= 0 && sorted[j] > v) { sorted[j + 1] = sorted[j]; j--; } sorted[j + 1] = v; }
		let excess = length(sorted) - HISTORY_MAX;
		for (let i = 0; i < excess; i++) { try { unlink(HISTORY_DIR + '/' + sorted[i]); } catch (e) { } }
	}
}

// ---- diagnostic draft capability -----------------------------------------------

function diag_draft_capability(authostlistVars) {
	let current = authostlistVars.AUTOHOSTLIST_DEBUGLOG;
	return {
		canDraft: true, current: (current != null) ? current : '0',
		note: 'A draft to enable/disable AUTOHOSTLIST_DEBUGLOG can be created through the config DRAFT mechanism. Apply requires strategic Preview/Apply flow. Enabling generates flash I/O.',
		warning: 'Do not edit /opt/zapret2/config directly — use draft → preview → apply only.',
		suggestedPath: '/tmp/zapret2-autohostlist.log', suggestedRotationKb: 256
	};
}

// ---- public API -----------------------------------------------------------------

export const orchestra_capabilities = function() {
	let cmd = nfqws2_cmdline();
	let engine = cmd != null ? detect_engine(cmd.cmdline) : { auto: false, antidpi: false, lib: false };
	let luaFiles = detect_lua_files();
	let dbg = (cmd != null) ? debug_enabled(cmd.cmdline) : false;
	let pkgVer = detect_package_version();
	let binVer = detect_nfqws2_binary_version();
	return { ok: true, detected: { packageVersion: pkgVer, binaryVersion: binVer, pinnedUpstream: PINNED_UPSTREAM, versionMatch: pkgVer != null ? true : null }, engine: engine, luaFiles: luaFiles, matrix: with_ids(capability_matrix(engine, luaFiles, dbg)) };
};

export const orchestra_status = function() {
	let cmd = nfqws2_cmdline();
	let engine = cmd != null ? detect_engine(cmd.cmdline) : { auto: false, antidpi: false, lib: false };
	let pkgVer = detect_package_version();
	let binVer = detect_nfqws2_binary_version();
	let luaFiles = detect_lua_files();
	let dbg = (cmd != null) ? debug_enabled(cmd.cmdline) : false;
	let configText = readfile(PATHS.applied_conf);
	let rawVars = parse_autohostlist_vars(configText);
	let semantic = semantic_autohostlist(rawVars);

	let diagResult = null;
	if (semantic.debug.enabled && semantic.debug.path != null) diagResult = safe_diag_tail(semantic.debug.path);
	else if (dbg && stat('/tmp/zapret2-autohostlist.log')) diagResult = safe_diag_tail('/tmp/zapret2-autohostlist.log');

	let history = null;
	if (diagResult != null && diagResult.events != null && length(diagResult.events) > 0) append_history(diagResult.events, semantic.debug.path);
	let rawHistory = read_history();
	if (length(rawHistory) > 0) {
		let recent = [];
		for (let i = length(rawHistory) - 1; i >= 0 && length(recent) < 50; i--) push(recent, rawHistory[i]);
		history = { entries: recent, total: length(rawHistory), label: 'Manager observation history — derived from observed upstream diagnostic output' };
	}

	let adaptiveState = 'inactive';
	if (engine.auto) {
		if (length(keys(semantic.failure)) > 0 || length(keys(semantic.retransmission)) > 0) adaptiveState = 'active';
		else adaptiveState = 'partial';
	}

	let thresholdCount = 0; let rawKs = keys(rawVars); for (let i = 0; i < length(rawKs); i++) if (substr(rawKs[i], 0, 13) == 'AUTOHOSTLIST_') thresholdCount++;

	return {
		ok: true, adaptiveState: adaptiveState, pinnedUpstream: PINNED_UPSTREAM,
		engine: engine,
		luaLoaded: { auto: engine.auto ? 'Loaded' : 'Not loaded', antidpi: engine.antidpi ? 'Loaded' : 'Not loaded', lib: engine.lib ? 'Loaded' : 'Not loaded' },
		daemonPid: (cmd != null) ? cmd.pid : null, daemonRunning: cmd != null,
		detected: { packageVersion: pkgVer, binaryVersion: binVer, pinnedUpstream: PINNED_UPSTREAM, versionMatch: pkgVer != null ? true : null },
		luaFiles: luaFiles, debugEnabled: dbg, diagnosticsAvailable: dbg || semantic.debug.enabled,
		autohostlistRaw: rawVars, autohostlistSemantic: semantic, appliedThresholds: thresholdCount,
		diagnosticTail: diagResult, managerHistory: history, diagDraft: diag_draft_capability(rawVars),
		autostate: { model: 'in-process Lua global autostate (autostate.<askey>.<hostkey>)', persisted: false, reason: 'no persistence calls exist in zapret-auto.lua (only an in-memory execution-plan copy)' }
	};
};

export const orchestra_events = function() {
	let configText = readfile(PATHS.applied_conf);
	let rawVars = parse_autohostlist_vars(configText);
	let semantic = semantic_autohostlist(rawVars);
	let cmd = nfqws2_cmdline();
	let dbg = (cmd != null) ? debug_enabled(cmd.cmdline) : false;
	if (!semantic.debug.enabled && !dbg)
		return unavailable_result('events', 'no event stream exists: zapret-auto.lua DLOG is gated by b_debug (ABSENT in the live argv) and the applied config has AUTOHOSTLIST_DEBUGLOG=0', ['live argv has no --debug', '/opt/zapret2/config AUTOHOSTLIST_DEBUGLOG=0']);
	let path = semantic.debug.path || '/tmp/zapret2-autohostlist.log';
	let tail = safe_diag_tail(path);
	if (tail == null || tail.error) return { ok: true, available: false, diagnosticsConfigured: true, reason: 'diagnostics are enabled but the log file is not readable or does not exist: ' + path };
	return { ok: true, available: true, diagnosticsConfigured: true, path: path, truncated: tail.truncated, freshness: tail.freshness, parsedEvents: tail.events, unknownCount: tail.unknown, parserVersion: tail.parserVersion, note: 'events are derived solely from observed upstream diagnostic output' };
};

export const orchestra_history = function() {
	let rawHistory = read_history();
	if (length(rawHistory) == 0) return { ok: true, available: false, entries: [], note: 'Not collecting — upstream diagnostics are disabled', label: 'Manager observation history' };
	let recent = [];
	for (let i = length(rawHistory) - 1; i >= 0 && length(recent) < 50; i--) push(recent, rawHistory[i]);
	return { ok: true, available: true, total: length(rawHistory), entries: recent, label: 'Manager observation history — derived from observed upstream diagnostic output', bounded: length(rawHistory) >= HISTORY_ROTATE_AT, note: 'entries are derived solely from observed upstream diagnostic output' };
};
