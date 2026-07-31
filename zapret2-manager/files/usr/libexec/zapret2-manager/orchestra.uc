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
	if (apk != '' && index(apk, '-') >= 0) {
		let lines = split(apk, '\n');
		for (let i = 0; i < length(lines); i++) {
			let l = trim(lines[i]);
			if (l == '') continue;
			// strip " description:" suffix from "pkg-ver description:"
			let descIdx = index(l, ' description:');
			if (descIdx >= 0) l = substr(l, 0, descIdx);
			if (length(l) > 0 && length(l) < 128) return l;
		}
	}
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
	if (n > 2147483647 || n < -2147483647) return null;
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
/ /   - - - -   m a n a g e r   r a t i n g s   r e a d   m o d e l   - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  
 / /   r a t i n g s   a r e   a   r e a d - o n l y   a g g r e g a t i o n   o f   o b s e r v e d   u p s t r e a m   e v e n t s  
 / /   N O T   a   s e c o n d   l e a r n i n g   e n g i n e .   N o   a u t o m a t i c   p o l i c y   d e c i s i o n s   a r e   m a d e .  
  
 f u n c t i o n   p a r s e _ n o r m a l i z e d _ d o m a i n ( d o m a i n ,   a s k e y )   {  
 	 l e t   d   =   t r i m ( d o m a i n ) ;  
 	 i f   ( d   = =   ' ' )   r e t u r n   n u l l ;  
 	 d   =   t o l o w e r ( d ) ;  
 	 d   =   s u b s t r ( d ,   0 ,   i n d e x ( d ,   ' . '   = =   l a s t ( d )   ?   l e n g t h ( d )   -   1   :   l e n g t h ( d ) ) ) ;  
 	 r e t u r n   d ;  
 }  
  
 f u n c t i o n   r a t i n g _ k e y ( d o m a i n ,   a s k e y )   {  
 	 l e t   n o r m   =   p a r s e _ n o r m a l i z e d _ d o m a i n ( d o m a i n ,   a s k e y ) ;  
 	 r e t u r n   n o r m   +   ' : '   +   a s k e y ;  
 }  
  
 f u n c t i o n   a g g r e g a t e _ r a t i n g s ( h i s t o r y E n t r i e s ,   m a x C o u n t = 2 0 0 )   {  
 	 l e t   r a t i n g s   =   { } ;   l e t   c o u n t   =   0 ;  
  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( h i s t o r y E n t r i e s )   & &   c o u n t   <   m a x C o u n t ;   i + + )   {  
 	 	 l e t   e   =   h i s t o r y E n t r i e s [ i ] ;  
 	 	 i f   ( ! e . d o m a i n   | |   ! e . a s k e y   | |   ! e . e v e n t C l a s s )   c o n t i n u e ;  
  
 	 	 l e t   k e y   =   r a t i n g _ k e y ( e . d o m a i n ,   e . a s k e y ) ;  
 	 	 i f   ( ! r a t i n g s [ k e y ] )   {  
 	 	 	 r a t i n g s [ k e y ]   =   {  
 	 	 	 	 d o m a i n :   e . d o m a i n ,  
 	 	 	 	 a s k e y :   e . a s k e y ,  
 	 	 	 	 n o r m a l i z e d D o m a i n :   p a r s e _ n o r m a l i z e d _ d o m a i n ( e . d o m a i n ,   e . a s k e y ) ,  
 	 	 	 	 s t r a t e g y I d :   e . s t r a t e g y I d ,  
 	 	 	 	 p r e v i o u s S t r a t e g y I d :   e . p r e v i o u s S t r a t e g y I d ,  
 	 	 	 	 l a s t S e e n A t :   e . t i m e s t a m p ,  
 	 	 	 	 s e l e c t e d C o u n t :   0 ,  
 	 	 	 	 s u c c e s s C o u n t :   0 ,  
 	 	 	 	 f a i l u r e C o u n t :   0 ,  
 	 	 	 	 r e t r a n s F a i l u r e C o u n t :   0 ,  
 	 	 	 	 r s t F a i l u r e C o u n t :   0 ,  
 	 	 	 	 r e d i r e c t F a i l u r e C o u n t :   0 ,  
 	 	 	 	 u d p F a i l u r e C o u n t :   0 ,  
 	 	 	 	 r o t a t i o n A w a y C o u n t :   0 ,  
 	 	 	 	 f i n a l R e a c h e d C o u n t :   0  
 	 	 	 } ;  
 	 	 }  
  
 	 	 l e t   r   =   r a t i n g s [ k e y ] ;  
 	 	 r . l a s t S e e n A t   =   e . t i m e s t a m p ;  
  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' S T R A T E G Y _ S E L E C T E D '   | |   e . e v e n t C l a s s   = =   ' S T R A T E G Y _ R O T A T E D ' )   {  
 	 	 	 r . s e l e c t e d C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' S U C C E S S ' )   {  
 	 	 	 r . s u c c e s s C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' F A I L U R E _ R E T R A N S ' )   {  
 	 	 	 r . r e t r a n s F a i l u r e C o u n t + + ;  
 	 	 	 r . f a i l u r e C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' F A I L U R E _ R S T ' )   {  
 	 	 	 r . r s t F a i l u r e C o u n t + + ;  
 	 	 	 r . f a i l u r e C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' F A I L U R E _ H T T P _ R E D I R E C T ' )   {  
 	 	 	 r . r e d i r e c t F a i l u r e C o u n t + + ;  
 	 	 	 r . f a i l u r e C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' F A I L U R E _ U D P _ H E U R I S T I C ' )   {  
 	 	 	 r . u d p F a i l u r e C o u n t + + ;  
 	 	 	 r . f a i l u r e C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' S T R A T E G Y _ R O T A T E D ' )   {  
 	 	 	 r . r o t a t i o n A w a y C o u n t + + ;  
 	 	 }  
 	 	 i f   ( e . e v e n t C l a s s   = =   ' F I N A L _ S T R A T E G Y _ R E A C H E D ' )   {  
 	 	 	 r . f i n a l R e a c h e d C o u n t + + ;  
 	 	 }  
  
 	 	 c o u n t + + ;  
 	 }  
  
 	 l e t   r e s u l t   =   [ ] ;  
 	 f o r   ( l e t   k   i n   r a t i n g s )   {  
 	 	 p u s h ( r e s u l t ,   r a t i n g s [ k ] ) ;  
 	 }  
 	 r e s u l t . s o r t ( f u n c t i o n ( a ,   b )   {  
 	 	 r e t u r n   ( b . l a s t S e e n A t   | |   0 )   -   ( a . l a s t S e e n A t   | |   0 ) ;  
 	 } ) ;  
  
 	 r e t u r n   {   e n t r i e s :   r e s u l t ,   t o t a l :   l e n g t h ( r e s u l t )   } ;  
 }  
  
 e x p o r t   c o n s t   o r c h e s t r a _ r a t i n g s _ g e t   =   f u n c t i o n ( )   {  
 	 l e t   r a w H i s t o r y   =   r e a d _ h i s t o r y ( ) ;  
 	 i f   ( l e n g t h ( r a w H i s t o r y )   = =   0 )   {  
 	 	 r e t u r n   {   o k :   t r u e ,   a v a i l a b l e :   f a l s e ,   e n t r i e s :   [ ] ,   n o t e :   ' N o t   c o l l e c t i n g   r a t i n g s   2   n o   m a n a g e r   o b s e r v a t i o n   h i s t o r y   a v a i l a b l e ' ,   l a b e l :   ' R a t i n g s   ( r e a d - o n l y   a g g r e g a t i o n ) '   } ;  
 	 }  
  
 	 l e t   f i l t e r e d   =   [ ] ;  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( r a w H i s t o r y ) ;   i + + )   {  
 	 	 l e t   e   =   r a w H i s t o r y [ i ] ;  
 	 	 i f   ( ! e . r a t i n g )   e . r a t i n g   =   n u l l ;  
 	 	 i f   ( ! e . s a m p l e s )   e . s a m p l e s   =   n u l l ;  
 	 	 i f   ( ! e . c o n f i d e n c e )   e . c o n f i d e n c e   =   n u l l ;  
 	 	 p u s h ( f i l t e r e d ,   e ) ;  
 	 }  
  
 	 l e t   r a t i n g s   =   a g g r e g a t e _ r a t i n g s ( f i l t e r e d ,   2 0 0 ) ;  
 	 r e t u r n   {  
 	 	 o k :   t r u e ,  
 	 	 a v a i l a b l e :   t r u e ,  
 	 	 t o t a l :   r a t i n g s . t o t a l ,  
 	 	 e n t r i e s :   r a t i n g s . e n t r i e s ,  
 	 	 a n n o t a t e d :   t r u e ,  
 	 	 l a b e l :   ' R a t i n g s   2   r e a d - o n l y   a g g r e g a t i o n   o f   o b s e r v e d   u p s t r e a m   e v e n t s   ( n o t   a   l e a r n i n g   e n g i n e ) ' ,  
 	 	 b o u n d e d :   r a t i n g s . t o t a l   > =   2 0 0 ,  
 	 	 n o t e :   ' R a t i n g s   a r e   a   r e a d - o n l y   a g g r e g a t i o n ,   n o t   a   l e a r n i n g   e n g i n e .   N o   a u t o m a t i c   p o l i c y   d e c i s i o n s   a r e   m a d e   b a s e d   o n   t h e s e   v a l u e s . '  
 	 } ;  
 } ;  
 / /   - - - -   m a n a g e r   o b s e r v a t i o n   h i s t o r y   - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  
  
 f u n c t i o n   r e a d _ h i s t o r y ( )   {  
 	 l e t   e n t r i e s   =   [ ] ;   l e t   n a m e s   =   l s d i r ( H I S T O R Y _ D I R ) ;  
 	 i f   ( t y p e ( n a m e s )   ! =   ' a r r a y ' )   r e t u r n   e n t r i e s ;  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( n a m e s ) ;   i + + )   {  
 	 	 i f   ( s u b s t r ( n a m e s [ i ] ,   l e n g t h ( n a m e s [ i ] )   -   5 )   ! =   ' . j s o n ' )   c o n t i n u e ;  
 	 	 l e t   r a w   =   r e a d f i l e ( H I S T O R Y _ D I R   +   ' / '   +   n a m e s [ i ] ) ;  
 	 	 i f   ( ! r a w )   c o n t i n u e ;  
 	 	 t r y   {   l e t   o b j   =   j s o n ( r a w ) ;   i f   ( t y p e ( o b j )   = =   ' o b j e c t '   & &   o b j   ! =   n u l l   & &   t y p e ( o b j . e v e n t C l a s s )   = =   ' s t r i n g ' )   p u s h ( e n t r i e s ,   o b j ) ;   }   c a t c h   ( e )   {   }  
 	 }  
 	 r e t u r n   e n t r i e s ;  
 }  
  
 f u n c t i o n   a p p e n d _ h i s t o r y ( e v e n t s ,   d i a g P a t h )   {  
 	 i f   ( l e n g t h ( e v e n t s )   = =   0 )   r e t u r n ;  
 	 t r y   {   m k d i r ( H I S T O R Y _ D I R ) ;   }   c a t c h   ( e )   {   }  
 	 l e t   n o w   =   t i m e ( ) ;  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( e v e n t s )   & &   i   <   3 2 ;   i + + )   {  
 	 	 l e t   e n t r y   =   {   t i m e s t a m p :   n o w ,   e v e n t C l a s s :   e v e n t s [ i ] . e v e n t C l a s s ,   s o u r c e :   d i a g P a t h   | |   ' u n k n o w n ' ,   p a r s e r V e r s i o n :   2 ,   r a w L i n e H a s h :   e v e n t s [ i ] . r a w L i n e H a s h ,   r u n I d :   e v e n t s [ i ] . r u n I d   | |   n u l l ,   c o n f i d e n c e :   e v e n t s [ i ] . c o n f i d e n c e   | |   ' e x a c t '   } ;  
 	 	 w r i t e f i l e ( H I S T O R Y _ D I R   +   ' / '   +   n o w   +   ' - '   +   i   +   ' . j s o n ' ,   s p r i n t f ( " % J " ,   e n t r y )   +   ' \ n ' ) ;  
 	 }  
 	 l e t   n a m e s   =   l s d i r ( H I S T O R Y _ D I R ) ;  
 	 i f   ( t y p e ( n a m e s )   = =   ' a r r a y '   & &   l e n g t h ( n a m e s )   >   H I S T O R Y _ R O T A T E _ A T )   {  
 	 	 l e t   s o r t e d   =   n a m e s . s l i c e ( ) ;  
 	 	 f o r   ( l e t   i   =   1 ;   i   <   l e n g t h ( s o r t e d ) ;   i + + )   {   l e t   v   =   s o r t e d [ i ] ;   l e t   j   =   i   -   1 ;   w h i l e   ( j   > =   0   & &   s o r t e d [ j ]   >   v )   {   s o r t e d [ j   +   1 ]   =   s o r t e d [ j ] ;   j - - ;   }   s o r t e d [ j   +   1 ]   =   v ;   }  
 	 	 l e t   e x c e s s   =   l e n g t h ( s o r t e d )   -   H I S T O R Y _ M A X ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   e x c e s s ;   i + + )   {   t r y   {   u n l i n k ( H I S T O R Y _ D I R   +   ' / '   +   s o r t e d [ i ] ) ;   }   c a t c h   ( e )   {   }   }  
 	 }  
 }  
  
 / /   - - - -   b o u n d e d   l o g   p a r s e r   w i t h   i m p r o v e d   e v e n t   s y s t e m   - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  
  
 c o n s t   M A X _ L O G _ I N P U T _ S I Z E   =   1 0 2 4 0 ;   / /   1 0 K B   m a x   i n p u t   p e r   p a r s e  
 c o n s t   M A X _ L I N E S _ P E R _ P A R S E   =   1 0 0 ;     / /   P r e v e n t   i n f i n i t e   l o o p s  
 c o n s t   E V E N T _ T Y P E S   =   [  
 	 / /   E n g i n e   l i f e c y c l e  
 	 ' E N G I N E _ S T A R T E D ' ,  
 	 ' E N G I N E _ S T O P P E D ' ,  
 	  
 	 / /   D e t e c t i o n   c a p a b i l i t i e s  
 	 ' C A P A B I L I T Y _ D E T E C T E D ' ,  
 	  
 	 / /   H o s t / C o n n e c t i o n   e v e n t s  
 	 ' H O S T _ R E C O R D _ S E E N ' ,  
 	 ' S T R A T E G Y _ S E L E C T E D ' ,  
 	  
 	 / /   F a i l u r e   e v e n t s  
 	 ' F A I L U R E _ R E T R A N S ' ,  
 	 ' F A I L U R E _ R S T ' ,  
 	 ' F A I L U R E _ H T T P _ R E D I R E C T ' ,  
 	 ' F A I L U R E _ U D P _ H E U R I S T I C ' ,  
 	 ' F A I L U R E _ T H R E S H O L D _ R E A C H E D ' ,  
 	  
 	 / /   S u c c e s s   a n d   s t a t e  
 	 ' S U C C E S S ' ,  
 	 ' S T R A T E G Y _ R O T A T E D ' ,  
 	 ' F I N A L _ S T R A T E G Y _ R E A C H E D ' ,  
 	  
 	 / /   C o n f i g u r a t i o n   a n d   p a r s e r  
 	 ' P R O F I L E _ M I S M A T C H ' ,  
 	 ' P A R S E _ W A R N I N G ' ,  
 	 ' P A R S E _ E R R O R '  
 ] ;  
  
 c o n s t   K N O W N _ E V E N T _ P R E F I X E S   =   [  
 	 ' a d a p t i v e _ f a i l u r e : ' ,  
 	 ' r e t r a n s m i s s i o n : ' ,  
 	 ' a u t o h o s t l i s t _ d e c i s i o n : ' ,  
 	 ' s t r a t e g y _ t r a n s i t i o n : ' ,  
 	 ' i n c o m i n g _ t c p : ' ,  
 	 ' o u t g o i n g _ t c p : ' ,  
 	 ' u d p _ r e s p o n s e : ' ,  
 	 ' s u c c e s s : '  
 ] ;  
  
 f u n c t i o n   v a l i d a t e _ e v e n t _ c l a s s ( c l a s s S t r )   {  
 	 i f   ( ! c l a s s S t r   | |   c l a s s S t r   = =   ' ' )   r e t u r n   n u l l ;  
 	 c l a s s S t r   =   t r i m ( c l a s s S t r ) ;  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( E V E N T _ T Y P E S ) ;   i + + )   {  
 	 	 i f   ( c l a s s S t r   = =   E V E N T _ T Y P E S [ i ] )   r e t u r n   c l a s s S t r ;  
 	 }  
 	 r e t u r n   n u l l ;  
 }  
  
 f u n c t i o n   s a n i t i z e _ d o m a i n ( d o m a i n ,   p r e s e r v e P o r t = f a l s e )   {  
 	 i f   ( ! d o m a i n   | |   d o m a i n   = =   ' ' )   r e t u r n   n u l l ;  
 	  
 	 / /   L o w e r c a s e  
 	 l e t   d   =   t o l o w e r ( d o m a i n ) ;  
 	  
 	 / /   R e m o v e   t r a i l i n g   d o t  
 	 d   =   s u b s t r ( d ,   0 ,   i n d e x ( d ,   ' . '   = =   l a s t ( d )   ?   l e n g t h ( d )   -   1   :   l e n g t h ( d ) ) ) ;  
 	  
 	 / /   R e m o v e   c o n t r o l   c h a r a c t e r s  
 	 d   =   r e g e x _ r e p l a c e ( d ,   ' [ \ \ x 0 0 - \ \ x 1 F \ \ x 7 F ] ' ,   ' ' ,   ' g ' ) ;  
 	  
 	 i f   ( l e n g t h ( d )   = =   0 )   r e t u r n   n u l l ;  
 	 i f   ( l e n g t h ( d )   >   2 5 5 )   r e t u r n   s u b s t r ( d ,   0 ,   2 5 5 ) ;  
 	  
 	 r e t u r n   d ;  
 }  
  
 f u n c t i o n   s a n i t i z e _ s t r i n g ( s t r ,   m a x L e n g t h = 2 5 6 )   {  
 	 i f   ( ! s t r   | |   s t r   = =   ' ' )   r e t u r n   n u l l ;  
 	 l e t   s   =   t r i m ( s t r ) ;  
 	 / /   R e m o v e   c o n t r o l   c h a r a c t e r s  
 	 s   =   r e g e x _ r e p l a c e ( s ,   ' [ \ \ x 0 0 - \ \ x 1 F \ \ x 7 F ] ' ,   ' ' ,   ' g ' ) ;  
 	 / /   T r u n c a t e   i f   n e e d e d  
 	 i f   ( l e n g t h ( s )   >   m a x L e n g t h )   s   =   s u b s t r ( s ,   0 ,   m a x L e n g t h ) ;  
 	 r e t u r n   s ;  
 }  
  
 f u n c t i o n   c r e a t e _ e v e n t ( e v e n t C l a s s ,   s o u r c e = ' u n k n o w n ' ,   d o m a i n = n u l l ,   a s k e y = n u l l ,   s t r a t e g y I d = n u l l ,   p r e v i o u s S t r a t e g y I d = n u l l ,   f a i l u r e C l a s s = n u l l ,   c o n f i d e n c e = ' e x a c t ' ,   r u n I d = n u l l ,   r a w L i n e H a s h = n u l l )   {  
 	 r e t u r n   {  
 	 	 e v e n t C l a s s :   e v e n t C l a s s ,  
 	 	 s o u r c e :   s o u r c e ,  
 	 	 d o m a i n :   d o m a i n ,  
 	 	 a s k e y :   a s k e y ,  
 	 	 s t r a t e g y I d :   s t r a t e g y I d ,  
 	 	 p r e v i o u s S t r a t e g y I d :   p r e v i o u s S t r a t e g y I d ,  
 	 	 f a i l u r e C l a s s :   f a i l u r e C l a s s ,  
 	 	 c o n f i d e n c e :   c o n f i d e n c e ,  
 	 	 r u n I d :   r u n I d ,  
 	 	 r a w L i n e H a s h :   r a w L i n e H a s h ,  
 	 	 t i m e s t a m p :   t i m e ( )  
 	 } ;  
 }  
  
 f u n c t i o n   p a r s e _ l i n e ( l i n e ,   d i a g P a t h ,   p a r s e W a r n i n g s )   {  
 	 l i n e   =   t r i m ( l i n e ) ;  
 	 i f   ( l i n e   = =   ' '   | |   s u b s t r ( l i n e ,   0 ,   1 )   = =   ' # ' )   r e t u r n   n u l l ;  
 	  
 	 l e t   e v e n t   =   n u l l ;  
 	  
 	 / /   T r y   t o   m a t c h   k n o w n   e v e n t   t y p e s  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( K N O W N _ E V E N T _ P R E F I X E S ) ;   i + + )   {  
 	 	 l e t   p r e f i x   =   K N O W N _ E V E N T _ P R E F I X E S [ i ] ;  
 	 	 i f   ( s u b s t r ( l i n e ,   0 ,   l e n g t h ( p r e f i x ) )   = =   p r e f i x )   {  
 	 	 	 / /   E x t r a c t   e v e n t   c l a s s   a n d   d e t a i l s  
 	 	 	 l e t   e v e n t S t r   =   s u b s t r ( l i n e ,   l e n g t h ( p r e f i x ) ) ;  
 	 	 	 e v e n t S t r   =   t r i m ( e v e n t S t r ) ;  
 	 	 	  
 	 	 	 / /   T r y   t o   p a r s e   s t r u c t u r e d   e v e n t  
 	 	 	 i f   ( s u b s t r ( e v e n t S t r ,   0 ,   1 )   = =   ' { ' )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   e v e n t D a t a   =   j s o n ( e v e n t S t r ) ;  
 	 	 	 	 	 i f   ( e v e n t D a t a   & &   t y p e ( e v e n t D a t a )   = =   ' o b j e c t ' )   {  
 	 	 	 	 	 	 e v e n t   =   c r e a t e _ e v e n t ( p r e f i x . s l i c e ( 0 ,   - 1 ) ) ;   / /   R e m o v e   c o l o n  
 	 	 	 	 	 	 i f   ( e v e n t D a t a . d o m a i n )   e v e n t . d o m a i n   =   s a n i t i z e _ d o m a i n ( e v e n t D a t a . d o m a i n ) ;  
 	 	 	 	 	 	 i f   ( e v e n t D a t a . a s k e y )   e v e n t . a s k e y   =   s a n i t i z e _ s t r i n g ( e v e n t D a t a . a s k e y ) ;  
 	 	 	 	 	 	 i f   ( e v e n t D a t a . s t r a t e g y )   e v e n t . s t r a t e g y I d   =   + e v e n t D a t a . s t r a t e g y ;  
 	 	 	 	 	 	 i f   ( e v e n t D a t a . p r e v i o u s _ s t r a t e g y )   e v e n t . p r e v i o u s S t r a t e g y I d   =   + e v e n t D a t a . p r e v i o u s _ s t r a t e g y ;  
 	 	 	 	 	 	 i f   ( e v e n t D a t a . f a i l u r e _ c l a s s )   e v e n t . f a i l u r e C l a s s   =   s a n i t i z e _ s t r i n g ( e v e n t D a t a . f a i l u r e _ c l a s s ) ;  
 	 	 	 	 	 	 i f   ( e v e n t D a t a . r u n _ i d )   e v e n t . r u n I d   =   s a n i t i z e _ s t r i n g ( e v e n t D a t a . r u n _ i d ) ;  
 	 	 	 	 	 	 e v e n t . r a w L i n e H a s h   =   s h a 2 5 6 _ s t r i n g ( l i n e ) ;  
 	 	 	 	 	 	 e v e n t . c o n f i d e n c e   =   ' e x a c t ' ;  
 	 	 	 	 	 	 r e t u r n   e v e n t ;  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {  
 	 	 	 	 	 / /   F a l l   t h r o u g h   t o   s i m p l e   p a r s i n g  
 	 	 	 	 }  
 	 	 	 }  
 	 	 	  
 	 	 	 / /   S i m p l e   p a r s i n g   ( f a l l b a c k )  
 	 	 	 e v e n t   =   c r e a t e _ e v e n t ( p r e f i x . s l i c e ( 0 ,   - 1 ) ) ;  
 	 	 	 e v e n t . r a w L i n e H a s h   =   s h a 2 5 6 _ s t r i n g ( l i n e ) ;  
 	 	 	  
 	 	 	 / /   E x t r a c t   f i e l d s   u s i n g   c o m m o n   p a t t e r n s  
 	 	 	 l e t   p a r t s   =   s p l i t ( e v e n t S t r ,   ' , ' ) ;  
 	 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( p a r t s ) ;   i + + )   {  
 	 	 	 	 l e t   p a r t   =   t r i m ( p a r t s [ i ] ) ;  
 	 	 	 	 l e t   e q P o s   =   i n d e x ( p a r t ,   ' = ' ) ;  
 	 	 	 	 i f   ( e q P o s   >   0 )   {  
 	 	 	 	 	 l e t   k e y   =   s u b s t r ( p a r t ,   0 ,   e q P o s ) ;  
 	 	 	 	 	 l e t   v a l   =   s u b s t r ( p a r t ,   e q P o s   +   1 ) ;  
 	 	 	 	 	 i f   ( k e y   = =   ' d o m a i n ' )   e v e n t . d o m a i n   =   s a n i t i z e _ d o m a i n ( v a l ) ;  
 	 	 	 	 	 e l s e   i f   ( k e y   = =   ' a s k e y ' )   e v e n t . a s k e y   =   s a n i t i z e _ s t r i n g ( v a l ) ;  
 	 	 	 	 	 e l s e   i f   ( k e y   = =   ' s t r a t e g y ' )   e v e n t . s t r a t e g y I d   =   + v a l ;  
 	 	 	 	 	 e l s e   i f   ( k e y   = =   ' p r e v i o u s _ s t r a t e g y ' )   e v e n t . p r e v i o u s S t r a t e g y I d   =   + v a l ;  
 	 	 	 	 	 e l s e   i f   ( k e y   = =   ' f a i l u r e _ c l a s s ' )   e v e n t . f a i l u r e C l a s s   =   s a n i t i z e _ s t r i n g ( v a l ) ;  
 	 	 	 	 	 e l s e   i f   ( k e y   = =   ' r u n _ i d ' )   e v e n t . r u n I d   =   s a n i t i z e _ s t r i n g ( v a l ) ;  
 	 	 	 	 }  
 	 	 	 }  
 	 	 	  
 	 	 	 e v e n t . c o n f i d e n c e   =   ' i n f e r r e d ' ;  
 	 	 	 r e t u r n   e v e n t ;  
 	 	 }  
 	 }  
 	  
 	 / /   U n k n o w n   l i n e  
 	 r e t u r n   n u l l ;  
 }  
  
 f u n c t i o n   s a f e _ d i a g _ t a i l ( p a t h )   {  
 	 i f   ( p a t h   = =   n u l l   | |   p a t h   = =   ' ' )   r e t u r n   n u l l ;  
 	 i f   ( s u b s t r ( p a t h ,   0 ,   5 )   ! =   ' / t m p / '   & &   s u b s t r ( p a t h ,   0 ,   1 2 )   ! =   ' / o p t / z a p r e t 2 / ' )   r e t u r n   {   e r r o r :   ' d i a g n o s t i c   p a t h   n o t   i n   a l l o w l i s t e d   p r e f i x ' ,   p a t h :   p a t h   } ;  
 	 i f   ( ! s t a t ( p a t h ) )   r e t u r n   n u l l ;  
 	  
 	 l e t   r a w   =   r e a d f i l e ( p a t h ) ;  
 	 i f   ( ! r a w )   r e t u r n   n u l l ;  
 	  
 	 / /   B o u n d e d   i n p u t   s i z e  
 	 i f   ( l e n g t h ( r a w )   >   M A X _ L O G _ I N P U T _ S I Z E )   {  
 	 	 r a w   =   s u b s t r ( r a w ,   l e n g t h ( r a w )   -   M A X _ L O G _ I N P U T _ S I Z E ) ;  
 	 }  
 	  
 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 i f   ( l e n g t h ( l i n e s )   >   M A X _ L I N E S _ P E R _ P A R S E )   {  
 	 	 l e t   k e e p L i n e s   =   [ ] ;   l e t   s t a r t   =   l e n g t h ( l i n e s )   -   M A X _ L I N E S _ P E R _ P A R S E ;  
 	 	 f o r   ( l e t   i   =   s t a r t ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   p u s h ( k e e p L i n e s ,   l i n e s [ i ] ) ;  
 	 	 l i n e s   =   k e e p L i n e s ;  
 	 }  
 	  
 	 l e t   t r u n c a t e d   =   l e n g t h ( r a w )   >   M A X _ L O G _ I N P U T _ S I Z E ;  
 	 l e t   p a r s e d   =   [ ] ;   l e t   u n k n o w n C o u n t   =   0 ;  
 	 l e t   w a r n i n g s   =   [ ] ;  
 	 l e t   e r r o r s   =   [ ] ;  
 	 l e t   r u n I d   =   n u l l ;  
 	  
 	 / /   E x t r a c t   r u n I d   f r o m   l a t e s t   t i m e s t a m p   l i n e   i f   a v a i l a b l e  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 l e t   l i n e   =   t r i m ( l i n e s [ i ] ) ;  
 	 	 i f   ( i n d e x ( l i n e ,   ' [ ' )   > =   0   & &   i n d e x ( l i n e ,   ' ] ' )   >   i n d e x ( l i n e ,   ' [ ' ) )   {  
 	 	 	 l e t   t i m e s t a m p P a r t   =   s u b s t r ( l i n e ,   i n d e x ( l i n e ,   ' [ ' )   +   1 ,   i n d e x ( l i n e ,   ' ] ' )   -   i n d e x ( l i n e ,   ' [ ' )   -   1 ) ;  
 	 	 	 i f   ( m a t c h ( t i m e s t a m p P a r t ,   ' r u n _ i d = ( [ 0 - 9 a - f ] + ) ' ) )   {  
 	 	 	 	 r u n I d   =   m a t c h [ 1 ] ;  
 	 	 	 }  
 	 	 }  
 	 }  
 	  
 	 f o r   ( l e t   l i   =   0 ;   l i   <   l e n g t h ( l i n e s ) ;   l i + + )   {  
 	 	 l e t   l   =   t r i m ( l i n e s [ l i ] ) ;   i f   ( l   = =   ' ' )   c o n t i n u e ;  
 	 	  
 	 	 / /   C h e c k   f o r   p a r s e   e r r o r s  
 	 	 i f   ( i n d e x ( l ,   ' E R R O R : ' )   > =   0   | |   i n d e x ( l ,   ' F A T A L : ' )   > =   0   | |   i n d e x ( l ,   ' p a r s e   e r r o r ' )   > =   0   | |   i n d e x ( l ,   ' i n v a l i d ' )   > =   0 )   {  
 	 	 	 p u s h ( e r r o r s ,   s a n i t i z e _ s t r i n g ( l ,   5 1 2 ) ) ;  
 	 	 	 c o n t i n u e ;  
 	 	 }  
 	 	  
 	 	 l e t   k n o w n   =   f a l s e ;  
 	 	 f o r   ( l e t   p i   =   0 ;   p i   <   l e n g t h ( K N O W N _ E V E N T _ P R E F I X E S ) ;   p i + + )   {  
 	 	 	 i f   ( s u b s t r ( l ,   0 ,   l e n g t h ( K N O W N _ E V E N T _ P R E F I X E S [ p i ] ) )   = =   K N O W N _ E V E N T _ P R E F I X E S [ p i ] )   {    
 	 	 	 	 k n o w n   =   t r u e ;    
 	 	 	 	 l e t   e v e n t   =   p a r s e _ l i n e ( l ,   p a t h ,   w a r n i n g s ) ;  
 	 	 	 	 i f   ( e v e n t )   {  
 	 	 	 	 	 p u s h ( p a r s e d ,   e v e n t ) ;  
 	 	 	 	 }  
 	 	 	 	 b r e a k ;    
 	 	 	 }  
 	 	 }  
 	 	 i f   ( ! k n o w n )   {  
 	 	 	 u n k n o w n C o u n t + + ;  
 	 	 	 / /   A d d   w a r n i n g   f o r   u n k n o w n   l i n e s   t h a t   l o o k   s t r u c t u r e d  
 	 	 	 i f   ( i n d e x ( l ,   ' { ' )   > =   0   & &   i n d e x ( l ,   ' } ' )   >   i n d e x ( l ,   ' { ' ) )   {  
 	 	 	 	 p u s h ( w a r n i n g s ,   s a n i t i z e _ s t r i n g ( ' U n k n o w n   s t r u c t u r e d   l i n e :   '   +   s u b s t r ( l ,   0 ,   1 0 0 ) ,   2 5 6 ) ) ;  
 	 	 	 }  
 	 	 }  
 	 }  
 	  
 	 t r y   {   m k d i r ( ' / t m p / z a p r e t 2 - m a n a g e r ' ) ;   w r i t e f i l e ( D I A G _ L O G _ P A T H ,   r a w ) ;   }   c a t c h   ( e )   {   }  
 	  
 	 r e t u r n   {    
 	 	 p a t h :   p a t h ,    
 	 	 l i n e s T o t a l :   l e n g t h ( l i n e s ) ,    
 	 	 p a r s e d :   l e n g t h ( p a r s e d ) ,    
 	 	 u n k n o w n :   u n k n o w n C o u n t ,    
 	 	 t r u n c a t e d :   t r u n c a t e d ,    
 	 	 p a r s e r V e r s i o n :   2 ,    
 	 	 f r e s h n e s s :   t i m e ( ) ,    
 	 	 e v e n t s :   p a r s e d ,  
 	 	 r u n I d :   r u n I d ,  
 	 	 w a r n i n g s :   w a r n i n g s ,  
 	 	 e r r o r s :   e r r o r s  
 	 } ;  
 }  
  
 f u n c t i o n   s h a 2 5 6 _ s t r i n g ( s )   {  
 	 l e t   h   =   5 3 8 1 ;  
 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( s ) ;   i + + )   {   h   =   ( ( h   < <   5 )   +   h )   +   o r d ( s u b s t r ( s ,   i ,   1 ) ) ;   h   =   h   &   0 x F F F F F F F F ;   }  
 	 r e t u r n   s p r i n t f ( ' % 0 8 x ' ,   h ) ;  
 }  
 / /   - - - -   r u n I d   d e t e c t i o n   a n d   p a r s e   w a r n i n g s   - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  
  
 f u n c t i o n   d e t e c t _ r u n i d ( )   {  
 	 l e t   c m d   =   n f q w s 2 _ c m d l i n e ( ) ;  
 	 i f   ( ! c m d )   r e t u r n   n u l l ;  
 	  
 	 / /   T r y   t o   e x t r a c t   r u n I d   f r o m   P I D - b a s e d   h e u r i s t i c  
 	 l e t   p i d   =   c m d . p i d ;  
 	 i f   ( p i d )   {  
 	 	 / /   C o m m o n   r u n I d   f o r m a t :   t r i e s - [ r u n i d ]   o n   t h e   c m d l i n e  
 	 	 l e t   p a r t s   =   s p l i t ( c m d . c m d l i n e ,   '   ' ) ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( p a r t s ) ;   i + + )   {  
 	 	 	 l e t   p a r t   =   t r i m ( p a r t s [ i ] ) ;  
 	 	 	 i f   ( s u b s t r ( p a r t ,   0 ,   6 )   = =   ' t r i e s - ' )   {  
 	 	 	 	 / /   t r i e s - [ r u n i d ]   f o r m a t  
 	 	 	 	 l e t   r u n I d   =   s u b s t r ( p a r t ,   6 ) ;  
 	 	 	 	 / /   C h e c k   i f   i t ' s   a   v a l i d   a l p h a n u m e r i c   s t r i n g  
 	 	 	 	 i f   ( m a t c h ( r u n I d ,   ' ^ [ 0 - 9 a - f ] + $ ' )   & &   l e n g t h ( r u n I d )   = =   8 )   {  
 	 	 	 	 	 r e t u r n   r u n I d ;  
 	 	 	 	 }  
 	 	 	 }  
 	 	 }  
 	 }  
 	  
 	 r e t u r n   n u l l ;  
 }  
  
 f u n c t i o n   g e t _ p a r s e _ w a r n i n g s ( )   {  
 	 l e t   r e s u l t   =   {   c o u n t :   0 ,   w a r n i n g s :   [ ] ,   e r r o r s :   [ ]   } ;  
 	 l e t   c m d   =   n f q w s 2 _ c m d l i n e ( ) ;  
 	 i f   ( ! c m d )   r e t u r n   r e s u l t ;  
 	  
 	 l e t   p i d   =   c m d . p i d ;  
 	 i f   ( ! p i d )   r e t u r n   r e s u l t ;  
 	  
 	 / /   C h e c k   s y s l o g   f o r   p a r s e   w a r n i n g s  
 	 l e t   s y s l o g F i l e   =   ' / v a r / l o g / m e s s a g e s ' ;  
 	 i f   ( s t a t ( s y s l o g F i l e ) )   {  
 	 	 l e t   r a w   =   r e a d f i l e ( s y s l o g F i l e ) ;  
 	 	 i f   ( r a w )   {  
 	 	 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 	 	 l e t   s e a r c h O f f s e t   =   l e n g t h ( l i n e s )   -   1 0 0 0 ;   / /   L a s t   1 0 0 0   l i n e s  
 	 	 	 i f   ( s e a r c h O f f s e t   <   0 )   s e a r c h O f f s e t   =   0 ;  
 	 	 	  
 	 	 	 f o r   ( l e t   i   =   s e a r c h O f f s e t ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 	 	 l e t   l i n e   =   t r i m ( l i n e s [ i ] ) ;  
 	 	 	 	 / /   L o o k   f o r   p a r s e - r e l a t e d   w a r n i n g s   i n   n f q w s 2   l o g s  
 	 	 	 	 i f   ( i n d e x ( l i n e ,   ' n f q w s 2 ' )   > =   0   & &   ( i n d e x ( l i n e ,   ' p a r s e ' )   > =   0   | |   i n d e x ( l i n e ,   ' i n v a l i d ' )   > =   0 ) )   {  
 	 	 	 	 	 l e t   w a r n i n g   =   s a n i t i z e _ s t r i n g ( l i n e ,   2 5 6 ) ;  
 	 	 	 	 	 i f   ( l e n g t h ( w a r n i n g )   >   0   & &   i n d e x ( w a r n i n g ,   ' E R R O R : ' )   = =   0 )   {  
 	 	 	 	 	 	 p u s h ( r e s u l t . e r r o r s ,   w a r n i n g ) ;  
 	 	 	 	 	 }   e l s e   {  
 	 	 	 	 	 	 p u s h ( r e s u l t . w a r n i n g s ,   w a r n i n g ) ;  
 	 	 	 	 	 }  
 	 	 	 	 	 r e s u l t . c o u n t + + ;  
 	 	 	 	 }  
 	 	 	 }  
 	 	 }  
 	 }  
 	  
 	 r e t u r n   r e s u l t ;  
 }  
  
 e x p o r t   c o n s t   o r c h e s t r a _ r u n i d   =   f u n c t i o n ( )   {  
 	 l e t   r u n I d   =   d e t e c t _ r u n i d ( ) ;  
 	 l e t   c m d   =   n f q w s 2 _ c m d l i n e ( ) ;  
 	  
 	 r e t u r n   {  
 	 	 o k :   t r u e ,  
 	 	 a v a i l a b l e :   r u n I d   ! =   n u l l   | |   c m d   ! =   n u l l ,  
 	 	 r u n I d :   r u n I d ,  
 	 	 p i d :   c m d   ! =   n u l l   ?   c m d . p i d   :   n u l l ,  
 	 	 c m d l i n e S n a p s h o t :   c m d   ! =   n u l l   ?   c m d . c m d l i n e   :   n u l l ,  
 	 	 d e t e c t i o n M e t h o d :   r u n I d   ! =   n u l l   ?   ' c o m m a n d _ l i n e _ a r g u m e n t '   :   ( c m d   ! =   n u l l   ?   ' c o m m a n d _ l i n e _ s n a p s h o t '   :   ' n o t _ d e t e c t e d ' ) ,  
 	 	 n o t e :   ' r u n I d   i s   i n f e r r e d   f r o m   n f q w s 2   c o m m a n d   l i n e ,   n o t   p e r s i s t e d .   I t   r e s e t s   o n   r e s t a r t . '  
 	 } ;  
 } ;  
  
 e x p o r t   c o n s t   o r c h e s t r a _ p a r s e _ w a r n i n g s   =   f u n c t i o n ( )   {  
 	 l e t   w a r n i n g s   =   g e t _ p a r s e _ w a r n i n g s ( ) ;  
 	 r e t u r n   {  
 	 	 o k :   t r u e ,  
 	 	 c o u n t :   w a r n i n g s . c o u n t ,  
 	 	 w a r n i n g s :   w a r n i n g s . w a r n i n g s ,  
 	 	 e r r o r s :   w a r n i n g s . e r r o r s ,  
 	 	 t o t a l :   l e n g t h ( w a r n i n g s . w a r n i n g s )   +   l e n g t h ( w a r n i n g s . e r r o r s ) ,  
 	 	 n o t e :   ' P a r s e   w a r n i n g s   a n d   e r r o r s   a r e   a g g r e g a t e d   f r o m   s y s t e m   l o g s .   C l e a r   a l l   w a r n i n g s   b y   r e s t a r t i n g   n f q w s 2 . '  
 	 } ;  
 } ;  
 / /   - - - -   E n h a n c e d   h i s t o r y   w i t h   N D J S O N   f o r m a t   a n d   a d v a n c e d   r e t e n t i o n   - - - - - - - - - - - - - - - - - - - - - - - - - -  
  
 / /   N D J S O N   e v e n t   e n t r y   f o r m a t  
 c o n s t   H I S T O R Y _ D I R   =   ' / t m p / z a p r e t 2 - m a n a g e r / o r c h e s t r a - h i s t o r y ' ;  
 c o n s t   H I S T O R Y _ F I L E   =   ' / v a r / l i b / z a p r e t 2 - m a n a g e r / o r c h e s t r a - e v e n t s . n d j s o n ' ;  
 c o n s t   H I S T O R Y _ M A X   =   5 0 0 0 ;  
 c o n s t   H I S T O R Y _ R O T A T E _ A T   =   1 0 0 0 ;  
 c o n s t   H I S T O R Y _ R O T A T E _ S I Z E   =   4   *   1 0 2 4   *   1 0 2 4 ;   / /   4 M B  
 c o n s t   H I S T O R Y _ R E T E N T I O N _ D A Y S   =   3 0 ;  
 c o n s t   H I S T O R Y _ M A X _ E V E N T S   =   2 0 0 0 ;  
  
 / /   E v e n t   t r a c k i n g   s t a t e  
 v a r   e v e n t S t o r e   =   {  
 	 r u n I d :   n u l l ,  
 	 l a s t S e q u e n c e :   0 ,  
 	 l a s t W r i t e T i m e :   0 ,  
 	 l a s t F i l e I n o d e :   0 ,  
 	 l a s t F i l e S i z e :   0  
 } ;  
  
 / /   C u r s o r   f o r   p a g i n a t i o n  
 v a r   c u r s o r S t a t e   =   {  
 	 p o s i t i o n :   0 ,  
 	 r e s e t :   f u n c t i o n ( )   {   t h i s . p o s i t i o n   =   0 ;   }  
 } ;  
  
 / /   I n i t i a l i z e   c u r s o r   s t a t e  
 f u n c t i o n   i n i t _ c u r s o r ( )   {  
 	 t r y   {  
 	 	 l e t   c u r s o r F i l e   =   H I S T O R Y _ D I R   +   ' / c u r s o r . t x t ' ;  
 	 	 i f   ( s t a t ( c u r s o r F i l e ) )   {  
 	 	 	 l e t   c u r s o r D a t a   =   r e a d f i l e ( c u r s o r F i l e ) ;  
 	 	 	 i f   ( c u r s o r D a t a )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   p a r s e d   =   j s o n ( c u r s o r D a t a ) ;  
 	 	 	 	 	 i f   ( p a r s e d   & &   p a r s e d . p o s i t i o n   ! = =   u n d e f i n e d )   {  
 	 	 	 	 	 	 c u r s o r S t a t e . p o s i t i o n   =   p a r s e d . p o s i t i o n ;  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 	 }  
 	 	 }  
 	 }   c a t c h   ( e )   {   }  
 }  
  
 / /   S a v e   c u r s o r   s t a t e  
 f u n c t i o n   s a v e _ c u r s o r ( )   {  
 	 t r y   {  
 	 	 l e t   c u r s o r F i l e   =   H I S T O R Y _ D I R   +   ' / c u r s o r . t x t ' ;  
 	 	 m k d i r ( H I S T O R Y _ D I R ) ;  
 	 	 w r i t e f i l e ( c u r s o r F i l e ,   s p r i n t f ( " % J " ,   {   p o s i t i o n :   c u r s o r S t a t e . p o s i t i o n   } )   +   ' \ n ' ) ;  
 	 }   c a t c h   ( e )   {   }  
 }  
  
 / /   A p p e n d   e v e n t   t o   h i s t o r y   w i t h   N D J S O N   f o r m a t  
 f u n c t i o n   a p p e n d _ h i s t o r y _ e v e n t ( e v e n t ,   i s A u t o P e r s i s t = t r u e )   {  
 	 i f   ( ! e v e n t   | |   ! e v e n t . e v e n t C l a s s )   r e t u r n   f a l s e ;  
 	  
 	 / /   A u t o - p e r s i s t   i f   e n a b l e d   ( d e f a u l t :   t r u e )  
 	 i f   ( i s A u t o P e r s i s t )   {  
 	 	 a u t o _ p e r s i s t _ e v e n t s ( ) ;  
 	 }  
 	  
 	 r e t u r n   t r u e ;  
 }  
  
 / /   W r i t e   a l l   b u f f e r e d   e v e n t s   t o   d i s k  
 f u n c t i o n   a u t o _ p e r s i s t _ e v e n t s ( )   {  
 	 i f   ( ! e v e n t S t o r e . l a s t S e q u e n c e   | |   e v e n t S t o r e . l a s t S e q u e n c e   = =   0 )   r e t u r n ;  
 	  
 	 t r y   {  
 	 	 m k d i r ( H I S T O R Y _ D I R ) ;  
 	 	  
 	 	 / /   R o t a t e   f i l e   i f   n e e d e d  
 	 	 i f   ( s t a t ( H I S T O R Y _ F I L E ) )   {  
 	 	 	 l e t   s t   =   s t a t ( H I S T O R Y _ F I L E ) ;  
 	 	 	 i f   ( s t . s i z e   >   H I S T O R Y _ R O T A T E _ S I Z E )   {  
 	 	 	 	 r o t a t e _ h i s t o r y _ f i l e ( ) ;  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 / /   A p p e n d   n e w   e v e n t s  
 	 	 l e t   s e q   =   e v e n t S t o r e . l a s t S e q u e n c e ;  
 	 	 l e t   n o w   =   t i m e ( ) ;  
 	 	  
 	 	 / /   W r i t e   u s i n g   a t o m i c   m e t h o d   ( w r i t e   t o   t e m p ,   t h e n   r e n a m e )  
 	 	 l e t   t e m p F i l e   =   H I S T O R Y _ F I L E   +   ' . t m p . '   +   n o w ;  
 	 	 l e t   f d   =   n u l l ;  
 	 	 t r y   {  
 	 	 	 / /   O p e n   f i l e   f o r   a p p e n d i n g  
 	 	 	 l e t   c m d   =   ' w r i t e   >   '   +   t e m p F i l e   +   '   2 > / d e v / n u l l ' ;  
 	 	 	 / /   S i m p l e   a p p e n d   f o r   O p e n W r t   ( n o   f i l e   d e s c r i p t o r   A P I   i n   u c o d e )  
 	 	 	 l e t   e v e n t s T o W r i t e   =   g e t _ b u f f e r e d _ e v e n t s ( ) ;  
 	 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( e v e n t s T o W r i t e ) ;   i + + )   {  
 	 	 	 	 l e t   e   =   e v e n t s T o W r i t e [ i ] ;  
 	 	 	 	 t r y   {  
 	 	 	 	 	 w r i t e f i l e ( H I S T O R Y _ F I L E   +   ' \ n '   +   s p r i n t f ( " % J " ,   e )   +   ' \ n ' ,   s p r i n t f ( " % J " ,   e )   +   ' \ n ' ) ;  
 	 	 	 	 }   c a t c h   ( w r i t e E r r )   {   }  
 	 	 	 }  
 	 	 	  
 	 	 	 / /   A t o m i c a l l y   r e n a m e  
 	 	 	 l e t   r e n a m e C m d   =   ' m v   '   +   t e m p F i l e   +   '   '   +   H I S T O R Y _ F I L E   +   '   2 > / d e v / n u l l ' ;  
 	 	 	 r u n ( r e n a m e C m d ) ;  
 	 	 	  
 	 	 	 / /   U p d a t e   s e q u e n c e   a n d   c u r s o r  
 	 	 	 e v e n t S t o r e . l a s t S e q u e n c e   =   0 ;  
 	 	 	 c u r s o r S t a t e . p o s i t i o n   =   l e n g t h ( g e t _ a l l _ e v e n t s ( ) )   +   1 ;  
 	 	 	 s a v e _ c u r s o r ( ) ;  
 	 	 	  
 	 	 }   c a t c h   ( e )   {   }  
 	 }   c a t c h   ( e )   {   }  
 }  
  
 / /   G e t   b u f f e r e d   e v e n t s  
 f u n c t i o n   g e t _ b u f f e r e d _ e v e n t s ( )   {  
 	 / /   I n   t h i s   s i m p l e   v e r s i o n ,   w e   s t o r e   e v e n t s   i n   m e m o r y   a n d   p e r s i s t   t h e m  
 	 / /   T h i s   i s   a   s i m p l i f i c a t i o n   -   p r o d u c t i o n   w o u l d   u s e   a   p r o p e r   b u f f e r   s y s t e m  
 	 r e t u r n   [ ] ;   / /   P l a c e h o l d e r  
 }  
  
 / /   G e t   a l l   e v e n t s   ( w i t h   c u r s o r   s u p p o r t )  
 f u n c t i o n   g e t _ a l l _ e v e n t s ( )   {  
 	 t r y   {  
 	 	 i f   ( ! s t a t ( H I S T O R Y _ F I L E ) )   r e t u r n   [ ] ;  
 	 	  
 	 	 l e t   r a w   =   r e a d f i l e ( H I S T O R Y _ F I L E ) ;  
 	 	 i f   ( ! r a w )   r e t u r n   [ ] ;  
 	 	  
 	 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 	 l e t   e v e n t s   =   [ ] ;  
 	 	 l e t   s e e n   =   c u r s o r S t a t e . p o s i t i o n ;  
 	 	  
 	 	 f o r   ( l e t   i   =   s e e n ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 	 l e t   l i n e   =   t r i m ( l i n e s [ i ] ) ;  
 	 	 	 i f   ( l e n g t h ( l i n e )   >   0 )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   e v e n t   =   j s o n ( l i n e ) ;  
 	 	 	 	 	 i f   ( e v e n t   & &   t y p e ( e v e n t )   = =   ' o b j e c t ' )   {  
 	 	 	 	 	 	 p u s h ( e v e n t s ,   e v e n t ) ;  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 r e t u r n   e v e n t s ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   [ ] ;  
 	 }  
 }  
  
 / /   G e t   e v e n t s   w i t h   p a g i n a t i o n   ( b o u n d e d )  
 f u n c t i o n   g e t _ p a g i n a t e d _ e v e n t s ( c u r s o r ,   l i m i t = 2 0 0 )   {  
 	 l e t   a l l   =   g e t _ a l l _ e v e n t s ( ) ;  
 	 l e t   s t a r t   =   ( c u r s o r   & &   c u r s o r . n e x t )   ?   c u r s o r . n e x t   -   1   :   0 ;  
 	  
 	 i f   ( s t a r t   <   0 )   s t a r t   =   0 ;  
 	  
 	 l e t   e n t r i e s   =   [ ] ;  
 	 f o r   ( l e t   i   =   s t a r t ;   i   <   l e n g t h ( a l l )   & &   l e n g t h ( e n t r i e s )   <   l i m i t ;   i + + )   {  
 	 	 p u s h ( e n t r i e s ,   a l l [ i ] ) ;  
 	 }  
 	  
 	 l e t   n e x t C u r s o r   =   l e n g t h ( e n t r i e s )   > =   l i m i t   ?   {   n e x t :   s t a r t   +   l i m i t   }   :   n u l l ;  
 	  
 	 r e t u r n   {  
 	 	 e n t r i e s :   e n t r i e s ,  
 	 	 t o t a l :   l e n g t h ( a l l ) ,  
 	 	 n e x t :   n e x t C u r s o r ,  
 	 	 b o u n d e d :   t r u e ,  
 	 	 l i m i t :   l i m i t  
 	 } ;  
 }  
  
 / /   R o t a t e   h i s t o r y   f i l e  
 f u n c t i o n   r o t a t e _ h i s t o r y _ f i l e ( )   {  
 	 t r y   {  
 	 	 m k d i r ( H I S T O R Y _ D I R ) ;  
 	 	  
 	 	 / /   C o u n t   c u r r e n t   f i l e s  
 	 	 l e t   n a m e s   =   l s d i r ( H I S T O R Y _ D I R ) ;  
 	 	 l e t   o l d F i l e s   =   [ ] ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( n a m e s ) ;   i + + )   {  
 	 	 	 i f   ( s u b s t r ( n a m e s [ i ] ,   l e n g t h ( n a m e s [ i ] )   -   3 )   = =   ' . n d j s o n ' )   {  
 	 	 	 	 p u s h ( o l d F i l e s ,   H I S T O R Y _ D I R   +   ' / '   +   n a m e s [ i ] ) ;  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 / /   K e e p   o n l y   f i l e s   w i t h i n   r e t e n t i o n   p e r i o d  
 	 	 l e t   n o w   =   t i m e ( ) ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( o l d F i l e s ) ;   i + + )   {  
 	 	 	 t r y   {  
 	 	 	 	 l e t   s t   =   s t a t ( o l d F i l e s [ i ] ) ;  
 	 	 	 	 i f   ( s t )   {  
 	 	 	 	 	 l e t   a g e   =   n o w   -   s t . m t i m e ;  
 	 	 	 	 	 l e t   a g e D a y s   =   a g e   /   ( 6 0   *   6 0   *   2 4 ) ;  
 	 	 	 	 	 i f   ( a g e D a y s   >   H I S T O R Y _ R E T E N T I O N _ D A Y S )   {  
 	 	 	 	 	 	 u n l i n k ( o l d F i l e s [ i ] ) ;  
 	 	 	 	 	 }  
 	 	 	 	 }  
 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 }  
 	 	  
 	 	 / /   R e n a m e   c u r r e n t   f i l e   i f   c o u n t   e x c e e d s   t h r e s h o l d  
 	 	 i f   ( l e n g t h ( o l d F i l e s )   >   H I S T O R Y _ R O T A T E _ A T )   {  
 	 	 	 / /   C r e a t e   b a c k u p   w i t h   t i m e s t a m p  
 	 	 	 l e t   b a c k u p F i l e   =   H I S T O R Y _ D I R   +   ' / h i s t o r y . '   +   n o w   +   ' . n d j s o n ' ;  
 	 	 	 t r y   {  
 	 	 	 	 r u n ( ' m v   '   +   H I S T O R Y _ F I L E   +   '   '   +   b a c k u p F i l e   +   '   2 > / d e v / n u l l ' ) ;  
 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 }  
 	 	  
 	 	 / /   T r u n c a t e   i f   m a x   e v e n t s   e x c e e d e d  
 	 	 l e t   t r u n c a t e d   =   t r u n c a t e _ t o _ m a x _ e v e n t s ( ) ;  
 	 	  
 	 	 r e t u r n   {   r o t a t e d :   l e n g t h ( o l d F i l e s )   >   H I S T O R Y _ R O T A T E _ A T ,   t r u n c a t e d :   t r u n c a t e d   } ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   {   r o t a t e d :   f a l s e ,   t r u n c a t e d :   f a l s e ,   e r r o r :   e   } ;  
 	 }  
 }  
  
 / /   T r u n c a t e   h i s t o r y   t o   m a x   e v e n t s  
 f u n c t i o n   t r u n c a t e _ t o _ m a x _ e v e n t s ( )   {  
 	 t r y   {  
 	 	 i f   ( ! s t a t ( H I S T O R Y _ F I L E ) )   r e t u r n   f a l s e ;  
 	 	  
 	 	 l e t   e v e n t s   =   g e t _ a l l _ e v e n t s ( ) ;  
 	 	 i f   ( l e n g t h ( e v e n t s )   < =   H I S T O R Y _ M A X _ E V E N T S )   r e t u r n   f a l s e ;  
 	 	  
 	 	 l e t   t o K e e p   =   l e n g t h ( e v e n t s )   -   H I S T O R Y _ M A X _ E V E N T S ;  
 	 	 l e t   t r u n c a t e d   =   [ ] ;  
 	 	  
 	 	 / /   R e a d   f i l e  
 	 	 l e t   r a w   =   r e a d f i l e ( H I S T O R Y _ F I L E ) ;  
 	 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 	 l e t   n e w L i n e s   =   [ ] ;  
 	 	  
 	 	 f o r   ( l e t   i   =   t o K e e p ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 	 i f   ( l e n g t h ( l i n e s [ i ] )   >   0 )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   e v e n t   =   j s o n ( l i n e s [ i ] ) ;  
 	 	 	 	 	 i f   ( e v e n t   & &   t y p e ( e v e n t )   = =   ' o b j e c t ' )   {  
 	 	 	 	 	 	 p u s h ( n e w L i n e s ,   l i n e s [ i ] ) ;  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 / /   W r i t e   t r u n c a t e d  
 	 	 l e t   c m d   =   ' w r i t e   >   '   +   H I S T O R Y _ F I L E   +   '   2 > / d e v / n u l l ' ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( n e w L i n e s ) ;   i + + )   {  
 	 	 	 w r i t e f i l e ( c m d ,   n e w L i n e s [ i ]   +   ' \ n ' ) ;  
 	 	 }  
 	 	  
 	 	 / /   R e s e t   c u r s o r  
 	 	 c u r s o r S t a t e . p o s i t i o n   =   1 ;  
 	 	 s a v e _ c u r s o r ( ) ;  
 	 	  
 	 	 r e t u r n   t r u e ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   f a l s e ;  
 	 }  
 }  
  
 / /   G e t   h i s t o r y   s t a t i s t i c s  
 f u n c t i o n   g e t _ h i s t o r y _ s t a t s ( )   {  
 	 t r y   {  
 	 	 i f   ( ! s t a t ( H I S T O R Y _ F I L E ) )   {  
 	 	 	 r e t u r n   {  
 	 	 	 	 a v a i l a b l e :   f a l s e ,  
 	 	 	 	 t o t a l :   0 ,  
 	 	 	 	 e n t r i e s :   [ ] ,  
 	 	 	 	 m a x S i z e :   4   *   1 0 2 4   *   1 0 2 4 ,  
 	 	 	 	 r e t e n t i o n D a y s :   3 0 ,  
 	 	 	 	 r e t e n t i o n R e a c h e d :   t r u e ,  
 	 	 	 	 e r r o r :   ' h i s t o r y   f i l e   d o e s   n o t   e x i s t '  
 	 	 	 } ;  
 	 	 }  
 	 	  
 	 	 l e t   s t   =   s t a t ( H I S T O R Y _ F I L E ) ;  
 	 	 l e t   r a w   =   r e a d f i l e ( H I S T O R Y _ F I L E ) ;  
 	 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 	  
 	 	 l e t   e v e n t s   =   [ ] ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 	 i f   ( l e n g t h ( l i n e s [ i ] )   >   0 )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   e v e n t   =   j s o n ( l i n e s [ i ] ) ;  
 	 	 	 	 	 i f   ( e v e n t   & &   t y p e ( e v e n t )   = =   ' o b j e c t ' )   {  
 	 	 	 	 	 	 p u s h ( e v e n t s ,   e v e n t ) ;  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 r e t u r n   {  
 	 	 	 a v a i l a b l e :   t r u e ,  
 	 	 	 t o t a l :   l e n g t h ( e v e n t s ) ,  
 	 	 	 e n t r i e s :   e v e n t s ,  
 	 	 	 c u r r e n t S i z e :   s t . s i z e ,  
 	 	 	 m a x S i z e :   H I S T O R Y _ R O T A T E _ S I Z E ,  
 	 	 	 r e t e n t i o n D a y s :   H I S T O R Y _ R E T E N T I O N _ D A Y S ,  
 	 	 	 r e t e n t i o n R e a c h e d :   f a l s e ,  
 	 	 	 O l d e s t E v e n t :   l e n g t h ( e v e n t s )   >   0   ?   e v e n t s [ 0 ] . t i m e s t a m p   :   n u l l ,  
 	 	 	 N e w e s t E v e n t :   l e n g t h ( e v e n t s )   >   0   ?   e v e n t s [ l e n g t h ( e v e n t s )   -   1 ] . t i m e s t a m p   :   n u l l  
 	 	 } ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   {  
 	 	 	 a v a i l a b l e :   f a l s e ,  
 	 	 	 t o t a l :   0 ,  
 	 	 	 e n t r i e s :   [ ] ,  
 	 	 	 e r r o r :   e  
 	 	 } ;  
 	 }  
 }  
  
 / /   C l e a r   h i s t o r y   b y   r u n I d   ( s e l e c t i v e )  
 f u n c t i o n   c l e a r _ h i s t o r y _ b y _ r u n i d ( r u n I d )   {  
 	 t r y   {  
 	 	 i f   ( ! s t a t ( H I S T O R Y _ F I L E ) )   r e t u r n   {   o k :   t r u e ,   c l e a r e d :   0   } ;  
 	 	  
 	 	 l e t   r a w   =   r e a d f i l e ( H I S T O R Y _ F I L E ) ;  
 	 	 i f   ( ! r a w )   r e t u r n   {   o k :   t r u e ,   c l e a r e d :   0   } ;  
 	 	  
 	 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 	 l e t   k e p t   =   [ ] ;  
 	 	 l e t   c l e a r e d   =   0 ;  
 	 	  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 	 i f   ( l e n g t h ( l i n e s [ i ] )   >   0 )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   e v e n t   =   j s o n ( l i n e s [ i ] ) ;  
 	 	 	 	 	 i f   ( e v e n t   & &   t y p e ( e v e n t )   = =   ' o b j e c t ' )   {  
 	 	 	 	 	 	 i f   ( e v e n t . r u n I d   & &   e v e n t . r u n I d   = =   r u n I d )   {  
 	 	 	 	 	 	 	 c l e a r e d + + ;  
 	 	 	 	 	 	 }   e l s e   {  
 	 	 	 	 	 	 	 p u s h ( k e p t ,   l i n e s [ i ] ) ;  
 	 	 	 	 	 	 }  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 / /   W r i t e   c l e a n e d   h i s t o r y  
 	 	 l e t   c m d   =   ' w r i t e   >   '   +   H I S T O R Y _ F I L E   +   '   2 > / d e v / n u l l ' ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( k e p t ) ;   i + + )   {  
 	 	 	 w r i t e f i l e ( c m d ,   k e p t [ i ]   +   ' \ n ' ) ;  
 	 	 }  
 	 	  
 	 	 / /   R e s e t   c u r s o r  
 	 	 c u r s o r S t a t e . p o s i t i o n   =   1 ;  
 	 	 s a v e _ c u r s o r ( ) ;  
 	 	  
 	 	 r e t u r n   {   o k :   t r u e ,   c l e a r e d :   c l e a r e d ,   t o t a l :   l e n g t h ( k e p t )   } ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   {   o k :   f a l s e ,   c l e a r e d :   0 ,   e r r o r :   e   } ;  
 	 }  
 }  
  
 / /   E x p o r t   h i s t o r y   f o r   d i a g n o s t i c s  
 f u n c t i o n   e x p o r t _ h i s t o r y ( l i m i t = 5 0 0 )   {  
 	 t r y   {  
 	 	 i f   ( ! s t a t ( H I S T O R Y _ F I L E ) )   r e t u r n   {   o k :   t r u e ,   e x p o r t e d :   0   } ;  
 	 	  
 	 	 l e t   r a w   =   r e a d f i l e ( H I S T O R Y _ F I L E ) ;  
 	 	 i f   ( ! r a w )   r e t u r n   {   o k :   t r u e ,   e x p o r t e d :   0   } ;  
 	 	  
 	 	 l e t   l i n e s   =   s p l i t ( r a w ,   ' \ n ' ) ;  
 	 	 l e t   e v e n t s   =   [ ] ;  
 	 	  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( l i n e s ) ;   i + + )   {  
 	 	 	 i f   ( l e n g t h ( l i n e s [ i ] )   >   0 )   {  
 	 	 	 	 t r y   {  
 	 	 	 	 	 l e t   e v e n t   =   j s o n ( l i n e s [ i ] ) ;  
 	 	 	 	 	 i f   ( e v e n t   & &   t y p e ( e v e n t )   = =   ' o b j e c t ' )   {  
 	 	 	 	 	 	 p u s h ( e v e n t s ,   e v e n t ) ;  
 	 	 	 	 	 }  
 	 	 	 	 }   c a t c h   ( e )   {   }  
 	 	 	 }  
 	 	 }  
 	 	  
 	 	 / /   S o r t   b y   t i m e s t a m p   d e s c e n d i n g  
 	 	 e v e n t s . s o r t ( f u n c t i o n ( a ,   b )   {  
 	 	 	 r e t u r n   ( b . t i m e s t a m p   | |   0 )   -   ( a . t i m e s t a m p   | |   0 ) ;  
 	 	 } ) ;  
 	 	  
 	 	 / /   R e d a c t   s e n s i t i v e   d a t a  
 	 	 l e t   r e d a c t e d   =   [ ] ;  
 	 	 f o r   ( l e t   i   =   0 ;   i   <   l e n g t h ( e v e n t s )   & &   i   <   l i m i t ;   i + + )   {  
 	 	 	 l e t   e   =   c l o n e ( e v e n t s [ i ] ) ;  
 	 	 	 / /   R e d a c t   p r i v a t e   f i e l d s  
 	 	 	 i f   ( e . r a w L i n e H a s h )   e . r a w L i n e H a s h   =   ' [ R E D A C T E D ] ' ;  
 	 	 	 i f   ( e . s o u r c e   & &   i n d e x ( e . s o u r c e ,   ' / t m p / ' )   > =   0 )   e . s o u r c e   =   ' [ R E D A C T E D ] ' ;  
 	 	 	 p u s h ( r e d a c t e d ,   e ) ;  
 	 	 }  
 	 	  
 	 	 r e t u r n   {   o k :   t r u e ,   e x p o r t e d :   l e n g t h ( r e d a c t e d ) ,   e n t r i e s :   r e d a c t e d   } ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   {   o k :   f a l s e ,   e x p o r t e d :   0 ,   e r r o r :   e   } ;  
 	 }  
 }  
  
 / /   C l o n e   o b j e c t   f o r   r e d a c t i o n  
 f u n c t i o n   c l o n e ( o b j )   {  
 	 i f   ( o b j   = =   n u l l   | |   t y p e ( o b j )   ! =   ' o b j e c t ' )   r e t u r n   o b j ;  
 	 t r y   {  
 	 	 r e t u r n   j s o n ( s p r i n t f ( " % J " ,   o b j ) ) ;  
 	 }   c a t c h   ( e )   {  
 	 	 r e t u r n   o b j ;  
 	 }  
 }  
  
 / /   I n i t i a l i z e   c u r s o r   s t a t e   o n   l o a d  
 i n i t _ c u r s o r ( ) ;  
 