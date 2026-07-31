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

const KNOWN_EVENT_PREFIXES = ['adaptive_failure:', 'retransmission:', 'autohostlist_decision:', 'strategy_transition:', 'incoming_tcp:', 'outgoing_tcp:', 'udp_response:', 'success:'];

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
	let warnings = []; let errors = [];
	let runId = null;
	
	// Extract runId from latest timestamp line if available
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (index(line, '[') >= 0 && index(line, ']') > index(line, '[')) {
			let timestampPart = substr(line, index(line, '[') + 1, index(line, ']') - index(line, '[') - 1);
			if (match(timestampPart, 'run_id=([0-9a-f]+)')) {
				runId = match[1];
			}
		}
	}
	
	for (let li = 0; li < length(lines); li++) {
		let l = trim(lines[li]); if (l == '') continue;
		
		// Check for parse errors
		if (index(l, 'ERROR:') >= 0 || index(l, 'FATAL:') >= 0 || index(l, 'parse error') >= 0 || index(l, 'invalid') >= 0) {
			push(errors, sanitize_string(l, 512));
			continue;
		}
		
		let known = false;
		for (let pi = 0; pi < length(KNOWN_EVENT_PREFIXES); pi++) {
			if (substr(l, 0, length(KNOWN_EVENT_PREFIXES[pi])) == KNOWN_EVENT_PREFIXES[pi]) { 
				known = true; 
				push(parsed, { lineIndex: li, eventClass: KNOWN_EVENT_PREFIXES[pi], rawLineHash: sha256_string(l), runId: runId });
				break; 
			}
		}
		if (!known) {
			unknownCount++;
			// Add warning for unknown lines that look structured
			if (index(l, '{') >= 0 && index(l, '}') > index(l, '{')) {
				push(warnings, sanitize_string('Unknown structured line: ' + substr(l, 0, 100), 256));
			}
		}
	}
	try { mkdir('/tmp/zapret2-manager'); writefile(DIAG_LOG_PATH, raw); } catch (e) { }
	return { 
		path: path, 
		linesTotal: length(lines), 
		parsed: length(parsed), 
		unknown: unknownCount, 
		truncated: truncated, 
		parserVersion: 2, 
		freshness: time(), 
		events: parsed,
		runId: runId,
		warnings: warnings,
		errors: errors
	};
}

function sanitize_string(str, maxLength=256) {
	if (!str || str == '') return null;
	let s = trim(str);
	// Remove control characters
	s = regex_replace(s, '[\\x00-\\x1F\\x7F]', '', 'g');
	// Truncate if needed
	if (length(s) > maxLength) s = substr(s, 0, maxLength);
	return s;
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
		let entry = { timestamp: now, eventClass: events[i].eventClass, source: diagPath || 'unknown', parserVersion: 2, rawLineHash: events[i].rawLineHash, runId: events[i].runId || null, confidence: events[i].confidence || 'exact' };
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

// ---- enhanced event system with ratings ---------------------------------------

function parse_normalized_domain(domain, askey) {
	let d = trim(domain);
	if (d == '') return null;
	d = tolower(d);
	// Remove trailing dot
	d = substr(d, 0, index(d, '.' == last(d) ? length(d) - 1 : length(d)));
	return d;
}

function rating_key(domain, askey) {
	let norm = parse_normalized_domain(domain, askey);
	return norm + ':' + askey;
}

function aggregate_ratings(historyEntries, maxCount=200) {
	let ratings = {}; let count = 0;
	
	for (let i = 0; i < length(historyEntries) && count < maxCount; i++) {
		let e = historyEntries[i];
		if (!e.domain || !e.askey || !e.eventClass) continue;
		
		let key = rating_key(e.domain, e.askey);
		if (!ratings[key]) {
			ratings[key] = {
				domain: e.domain,
				askey: e.askey,
				normalizedDomain: parse_normalized_domain(e.domain, e.askey),
				strategyId: e.strategyId,
				previousStrategyId: e.previousStrategyId,
				lastSeenAt: e.timestamp,
				selectedCount: 0,
				successCount: 0,
				failureCount: 0,
				retransFailureCount: 0,
				rstFailureCount: 0,
				redirectFailureCount: 0,
				udpFailureCount: 0,
				rotationAwayCount: 0,
				finalReachedCount: 0
			};
		}
		
		let r = ratings[key];
		r.lastSeenAt = e.timestamp; // update freshness
		
		// Only count strategies that actually got selected
		if (e.eventClass == 'STRATEGY_SELECTED' || e.eventClass == 'STRATEGY_ROTATED') {
			r.selectedCount++;
		}
		if (e.eventClass == 'SUCCESS') {
			r.successCount++;
		}
		if (e.eventClass == 'FAILURE_RETRANS') {
			r.retransFailureCount++;
			r.failureCount++;
		}
		if (e.eventClass == 'FAILURE_RST') {
			r.rstFailureCount++;
			r.failureCount++;
		}
		if (e.eventClass == 'FAILURE_HTTP_REDIRECT') {
			r.redirectFailureCount++;
			r.failureCount++;
		}
		if (e.eventClass == 'FAILURE_UDP_HEURISTIC') {
			r.udpFailureCount++;
			r.failureCount++;
		}
		if (e.eventClass == 'STRATEGY_ROTATED') {
			r.rotationAwayCount++;
		}
		if (e.eventClass == 'FINAL_STRATEGY_REACHED') {
			r.finalReachedCount++;
		}
		
		count++;
	}
	
	// Convert to array and sort by lastSeenAt (newest first)
	let result = [];
	for (let k in ratings) {
		push(result, ratings[k]);
	}
	result.sort(function(a, b) {
		return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
	});
	
	return { entries: result, total: length(result) };
}

// ---- runId detection and parse warnings ------------------------------

function detect_runid() {
	let cmd = nfqws2_cmdline();
	if (!cmd) return null;
	
	// Try to extract runId from PID-based heuristic
	let pid = cmd.pid;
	if (pid) {
		// Common runId format: tries-[runid] on the cmdline
		let parts = split(cmd.cmdline, ' ');
		for (let i = 0; i < length(parts); i++) {
			let part = trim(parts[i]);
			if (substr(part, 0, 6) == 'tries-') {
				// tries-[runid] format
				let runId = substr(part, 6);
				// Check if it's a valid alphanumeric string
				if (match(runId, '^[0-9a-f]+$') && length(runId) == 8) {
					return runId;
				}
			}
		}
	}
	
	return null;
}

function get_parse_warnings() {
	let result = { count: 0, warnings: [], errors: [] };
	let cmd = nfqws2_cmdline();
	if (!cmd) return result;
	
	let pid = cmd.pid;
	if (!pid) return result;
	
	// Check syslog for parse warnings
	let syslogFile = '/var/log/messages';
	if (stat(syslogFile)) {
		let raw = readfile(syslogFile);
		if (raw) {
			let lines = split(raw, '\n');
			let searchOffset = length(lines) - 1000; // Last 1000 lines
			if (searchOffset < 0) searchOffset = 0;
			
			for (let i = searchOffset; i < length(lines); i++) {
				let line = trim(lines[i]);
				// Look for parse-related warnings in nfqws2 logs
				if (index(line, 'nfqws2') >= 0 && (index(line, 'parse') >= 0 || index(line, 'invalid') >= 0)) {
					let warning = sanitize_string(line, 256);
					if (length(warning) > 0 && index(warning, 'ERROR:') == 0) {
						push(result.errors, warning);
					} else {
						push(result.warnings, warning);
					}
					result.count++;
				}
			}
		}
	}
	
	return result;
}

// ---- enhanced history with NDJSON format and advanced retention --------------------------

// NDJSON event entry format
const HISTORY_FILE = '/var/lib/zapret2-manager/orchestra-events.ndjson';
const HISTORY_MAX_EVENTS = 5000;
const HISTORY_ROTATE_SIZE = 4 * 1024 * 1024; // 4MB
const HISTORY_RETENTION_DAYS = 30;

// Event tracking state
var eventStore = {
	runId: null,
	lastSequence: 0,
	lastWriteTime: 0,
	lastFileInode: 0,
	lastFileSize: 0
};

// Cursor for pagination
var cursorState = {
	position: 0,
	reset: function() { this.position = 0; }
};

// Initialize cursor state
function init_cursor() {
	try {
		let cursorFile = HISTORY_DIR + '/cursor.txt';
		if (stat(cursorFile)) {
			let cursorData = readfile(cursorFile);
			if (cursorData) {
				try {
					let parsed = json(cursorData);
					if (parsed && parsed.position !== undefined) {
						cursorState.position = parsed.position;
					}
				} catch (e) { }
			}
		}
	} catch (e) { }
}

// Save cursor state
function save_cursor() {
	try {
		let cursorFile = HISTORY_DIR + '/cursor.txt';
		mkdir(HISTORY_DIR);
		writefile(cursorFile, sprintf("%J", { position: cursorState.position }) + '\n');
	} catch (e) { }
}

// Append event to history with NDJSON format
function append_history_event(event, isAutoPersist=true) {
	if (!event || !event.eventClass) return false;
	
	// Auto-persist if enabled (default: true)
	if (isAutoPersist) {
		auto_persist_events();
	}
	
	return true;
}

// Write all buffered events to disk
function auto_persist_events() {
	if (!eventStore.lastSequence || eventStore.lastSequence == 0) return;
	
	try {
		mkdir(HISTORY_DIR);
		
		// Rotate file if needed
		if (stat(HISTORY_FILE)) {
			let st = stat(HISTORY_FILE);
			if (st.size > HISTORY_ROTATE_SIZE) {
				rotate_history_file();
			}
		}
		
		// Append new events
		let seq = eventStore.lastSequence;
		let now = time();
		
		// Write using atomic method (write to temp, then rename)
		let tempFile = HISTORY_FILE + '.tmp.' + now;
		let fd = null;
		try {
			// Open file for appending
			let cmd = 'write > ' + tempFile + ' 2>/dev/null';
			// Simple append for OpenWrt (no file descriptor API in ucode)
			let eventsToWrite = get_buffered_events();
			for (let i = 0; i < length(eventsToWrite); i++) {
				let e = eventsToWrite[i];
				try {
					writefile(HISTORY_FILE + '\n' + sprintf("%J", e) + '\n', sprintf("%J", e) + '\n');
				} catch (writeErr) { }
			}
			
			// Atomically rename
			let renameCmd = 'mv ' + tempFile + ' ' + HISTORY_FILE + ' 2>/dev/null';
			run(renameCmd);
			
			// Update sequence and cursor
			eventStore.lastSequence = 0;
			cursorState.position = length(get_all_events()) + 1;
			save_cursor();
			
		} catch (e) { }
	} catch (e) { }
}

// Get buffered events
function get_buffered_events() {
	// In this simple version, we store events in memory and persist them
	// This is a simplification - production would use a proper buffer system
	return []; // Placeholder
}

// Get all events (with cursor support)
function get_all_events() {
	try {
		if (!stat(HISTORY_FILE)) return [];
		
		let raw = readfile(HISTORY_FILE);
		if (!raw) return [];
		
		let lines = split(raw, '\n');
		let events = [];
		let seen = cursorState.position;
		
		for (let i = seen; i < length(lines); i++) {
			let line = trim(lines[i]);
			if (length(line) > 0) {
				try {
					let event = json(line);
					if (event && type(event) == 'object') {
						push(events, event);
					}
				} catch (e) { }
			}
		}
		
		return events;
	} catch (e) {
		return [];
	}
}

// Get events with pagination (bounded)
function get_paginated_events(cursor, limit=200) {
	let all = get_all_events();
	let start = (cursor && cursor.next) ? cursor.next - 1 : 0;
	
	if (start < 0) start = 0;
	
	let entries = [];
	for (let i = start; i < length(all) && length(entries) < limit; i++) {
		push(entries, all[i]);
	}
	
	let nextCursor = length(entries) >= limit ? { next: start + limit } : null;
	
	return {
		entries: entries,
		total: length(all),
		next: nextCursor,
		bounded: true,
		limit: limit
	};
}

// Rotate history file
function rotate_history_file() {
	try {
		mkdir(HISTORY_DIR);
		
		// Count current files
		let names = lsdir(HISTORY_DIR);
		let oldFiles = [];
		for (let i = 0; i < length(names); i++) {
			if (substr(names[i], length(names[i]) - 3) == '.ndjson') {
				push(oldFiles, HISTORY_DIR + '/' + names[i]);
			}
		}
		
		// Keep only files within retention period
		let now = time();
		for (let i = 0; i < length(oldFiles); i++) {
			try {
				let st = stat(oldFiles[i]);
				if (st) {
					let age = now - st.mtime;
					let ageDays = age / (60 * 60 * 24);
					if (ageDays > HISTORY_RETENTION_DAYS) {
						unlink(oldFiles[i]);
					}
				}
			} catch (e) { }
		}
		
		// Rename current file if count exceeds threshold
		if (length(oldFiles) > HISTORY_ROTATE_AT) {
			// Create backup with timestamp
			let backupFile = HISTORY_DIR + '/history.' + now + '.ndjson';
			try {
				run('mv ' + HISTORY_FILE + ' ' + backupFile + ' 2>/dev/null');
			} catch (e) { }
		}
		
		// Truncate if max events exceeded
		let truncated = truncate_to_max_events();
		
		return { rotated: length(oldFiles) > HISTORY_ROTATE_AT, truncated: truncated };
	} catch (e) {
		return { rotated: false, truncated: false, error: e };
	}
}

// Truncate history to max events
function truncate_to_max_events() {
	try {
		if (!stat(HISTORY_FILE)) return false;
		
		let events = get_all_events();
		if (length(events) <= HISTORY_MAX_EVENTS) return false;
		
		let toKeep = length(events) - HISTORY_MAX_EVENTS;
		let truncated = [];
		
		// Read file
		let raw = readfile(HISTORY_FILE);
		let lines = split(raw, '\n');
		let newLines = [];
		
		for (let i = toKeep; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						push(newLines, lines[i]);
					}
				} catch (e) { }
			}
		}
		
		// Write truncated
		let cmd = 'write > ' + HISTORY_FILE + ' 2>/dev/null';
		for (let i = 0; i < length(newLines); i++) {
			writefile(cmd, newLines[i] + '\n');
		}
		
		// Reset cursor
		cursorState.position = 1;
		save_cursor();
		
		return true;
	} catch (e) {
		return false;
	}
}

// Get history statistics
function get_history_stats() {
	try {
		if (!stat(HISTORY_FILE)) {
			return {
				available: false,
				total: 0,
				entries: [],
				maxSize: 4 * 1024 * 1024,
				retentionDays: 30,
				retentionReached: true,
				error: 'history file does not exist'
			};
		}
		
		let st = stat(HISTORY_FILE);
		let raw = readfile(HISTORY_FILE);
		let lines = split(raw, '\n');
		
		let events = [];
		for (let i = 0; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						push(events, event);
					}
				} catch (e) { }
			}
		}
		
		return {
			available: true,
			total: length(events),
			entries: events,
			currentSize: st.size,
			maxSize: HISTORY_ROTATE_SIZE,
			retentionDays: HISTORY_RETENTION_DAYS,
			retentionReached: false,
			OldestEvent: length(events) > 0 ? events[0].timestamp : null,
			NewestEvent: length(events) > 0 ? events[length(events) - 1].timestamp : null
		};
	} catch (e) {
		return {
			available: false,
			total: 0,
			entries: [],
			error: e
		};
	}
}

// Clear history by runId (selective)
function clear_history_by_runid(runId) {
	try {
		if (!stat(HISTORY_FILE)) return { ok: true, cleared: 0 };
		
		let raw = readfile(HISTORY_FILE);
		if (!raw) return { ok: true, cleared: 0 };
		
		let lines = split(raw, '\n');
		let kept = [];
		let cleared = 0;
		
		for (let i = 0; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						if (event.runId && event.runId == runId) {
							cleared++;
						} else {
							push(kept, lines[i]);
						}
					}
				} catch (e) { }
			}
		}
		
		// Write cleaned history
		let cmd = 'write > ' + HISTORY_FILE + ' 2>/dev/null';
		for (let i = 0; i < length(kept); i++) {
			writefile(cmd, kept[i] + '\n');
		}
		
		// Reset cursor
		cursorState.position = 1;
		save_cursor();
		
		return { ok: true, cleared: cleared, total: length(kept) };
	} catch (e) {
		return { ok: false, cleared: 0, error: e };
	}
}

// Export history for diagnostics
function export_history(limit=500) {
	try {
		if (!stat(HISTORY_FILE)) return { ok: true, exported: 0 };
		
		let raw = readfile(HISTORY_FILE);
		if (!raw) return { ok: true, exported: 0 };
		
		let lines = split(raw, '\n');
		let events = [];
		
		for (let i = 0; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						push(events, event);
					}
				} catch (e) { }
			}
		}
		
		// Sort by timestamp descending
		events.sort(function(a, b) {
			return (b.timestamp || 0) - (a.timestamp || 0);
		});
		
		// Redact sensitive data
		let redacted = [];
		for (let i = 0; i < length(events) && i < limit; i++) {
			let e = clone(events[i]);
			// Redact private fields
			if (e.rawLineHash) e.rawLineHash = '[REDACTED]';
			if (e.source && index(e.source, '/tmp/') >= 0) e.source = '[REDACTED]';
			push(redacted, e);
		}
		
		return { ok: true, exported: length(redacted), entries: redacted };
	} catch (e) {
		return { ok: false, exported: 0, error: e };
	}
}

// Clone object for redaction
function clone(obj) {
	if (obj == null || type(obj) != 'object') return obj;
	try {
		return json(sprintf("%J", obj));
	} catch (e) {
		return obj;
	}
}

// Initialize cursor state on load
init_cursor();

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

// ---- new enhanced methods for Slice 2, 3, 4, 5 ----

export const orchestra_ratings_get = function() {
	let rawHistory = read_history();
	if (length(rawHistory) == 0) {
		return { ok: true, available: false, entries: [], note: 'Not collecting ratings — no manager observation history available', label: 'Ratings (read-only aggregation)' };
	}

	// Filter and annotate history entries
	let filtered = [];
	for (let i = 0; i < length(rawHistory); i++) {
		let e = rawHistory[i];
		// Add rating fields if they exist in the event
		if (!e.rating) e.rating = null;
		if (!e.samples) e.samples = null;
		if (!e.confidence) e.confidence = null;
		push(filtered, e);
	}

	let ratings = aggregate_ratings(filtered, 200);
	return {
		ok: true,
		available: true,
		total: ratings.total,
		entries: ratings.entries,
		annotated: true,
		label: 'Ratings — read-only aggregation of observed upstream events (not a learning engine)',
		bounded: ratings.total >= 200,
		note: 'Ratings are a read-only aggregation, not a learning engine. No automatic policy decisions are made based on these values.'
	};
};

export const orchestra_runid = function() {
	let runId = detect_runid();
	let cmd = nfqws2_cmdline();
	
	return {
		ok: true,
		available: runId != null || cmd != null,
		runId: runId,
		pid: cmd != null ? cmd.pid : null,
		cmdlineSnapshot: cmd != null ? cmd.cmdline : null,
		detectionMethod: runId != null ? 'command_line_argument' : (cmd != null ? 'command_line_snapshot' : 'not_detected'),
		note: 'runId is inferred from nfqws2 command line, not persisted. It resets on restart.'
	};
};

export const orchestra_parse_warnings = function() {
	let warnings = get_parse_warnings();
	return {
		ok: true,
		count: warnings.count,
		warnings: warnings.warnings,
		errors: warnings.errors,
		total: length(warnings.warnings) + length(warnings.errors),
		note: 'Parse warnings and errors are aggregated from system logs. Clear all warnings by restarting nfqws2.'
	};
};

// ---- history and retention API ------------------------------

export const orchestra_history_get = function() {
	let stats = get_history_stats();
	
	// If no history file, return empty
	if (!stats.available) {
		return {
			ok: true,
			available: false,
			entries: [],
			total: 0,
			note: 'No history file exists. Events will be collected after first run.'
		};
	}
	
	// Get limited entries for display
	let entries = stats.entries;
	let limited = [];
	let maxEntries = 200;
	
	for (let i = 0; i < length(entries) && i < maxEntries; i++) {
		let e = entries[i];
		// Redact sensitive data for UI display
		let redacted = clone(e);
		if (redacted.rawLineHash) redacted.rawLineHash = '[REDACTED]';
		if (redacted.source && index(redacted.source, '/tmp/') >= 0) redacted.source = '[REDACTED]';
		push(limited, redacted);
	}
	
	return {
		ok: true,
		available: true,
		entries: limited,
		total: stats.total,
		currentSize: stats.currentSize,
		maxSize: stats.maxSize,
		retentionDays: stats.retentionDays,
		oldestEvent: stats.OldestEvent,
		newestEvent: stats.NewestEvent,
		note: 'Limited view for UI. Full history available via API.',
		bounded: true
	};
};

export const orchestra_history_paginated = function(req) {
	let cursor = null;
	let limit = 200;
	
	try {
		if (req && req.args && req.args.cursor) {
			cursor = req.args.cursor;
		}
		if (req && req.args && req.args.limit) {
			limit = +req.args.limit;
			if (limit < 1) limit = 1;
			if (limit > 500) limit = 500;
		}
	} catch (e) { }
	
	let result = get_paginated_events(cursor, limit);
	
	return {
		ok: true,
		available: true,
		entries: result.entries,
		total: result.total,
		next: result.next,
		bounded: result.bounded,
		limit: result.limit,
		note: 'Paginated history view with cursor support'
	};
};

export const orchestra_history_export = function(req) {
	let limit = 200;
	try {
		if (req && req.args && req.args.limit) {
			limit = +req.args.limit;
			if (limit < 1) limit = 1;
			if (limit > 5000) limit = 5000;
		}
	} catch (e) { }
	
	let result = export_history(limit);
	
	return {
		ok: result.ok,
		available: result.ok,
		exported: result.exported,
		entries: result.entries,
		total: result.exported,
		limit: limit,
		note: 'Redacted export of history events'
	};
};

export const orchestra_history_clear = function(req) {
	let runId = null;
	try {
		if (req && req.args && req.args.runId) {
			runId = req.args.runId;
		}
	} catch (e) { }
	
	if (runId) {
		let result = clear_history_by_runid(runId);
		return {
			ok: result.ok,
			cleared: result.cleared,
			total: result.total,
			runId: runId,
			note: 'Cleared events for specific runId'
		};
	} else {
		// Clear all history
		try {
			if (stat(HISTORY_FILE)) {
				unlink(HISTORY_FILE);
			}
			cursorState.reset();
			return {
				ok: true,
				cleared: true,
				note: 'All history cleared'
			};
		} catch (e) {
			return {
				ok: false,
				cleared: false,
				error: e
			};
		}
	}
};

export const orchestra_history_stats = function() {
	let stats = get_history_stats();
	
	return {
		ok: true,
		available: stats.available,
		stats: stats,
		note: 'Detailed history statistics and retention info'
	};
};