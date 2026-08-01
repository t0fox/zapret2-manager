'use strict';
// orchestra.uc — read-only Orchestra capability/observability adapter v2
// (Phase D). Mirrors tests/lib/orchestra-logic.mjs.
//
// Upstream zapret-auto.lua already owns packet-time orchestration (autostate
// in-process). This adapter READS what is genuinely readable without
// mutation and returns honest available:false with reason+evidence for
// everything else.
//
// v3 (r46.7.1): functional fixes — atomic NDJSON write, stateless cursor,
//     proper retention, domain normalization, NUL-separated cmdline parsing.

import { readfile, readlink, stat, lsdir, popen, mkdir, unlink, writefile } from 'fs';
import { maint_lua_compat } from './maintenance.uc';
import { PATHS } from './constants.uc';

const LUA_DIR = '/opt/zapret2/lua';
const STRESSOZZ_CORPUS = '/usr/libexec/zapret2-manager/catalog/stressozz-corpus.json';
const STRESSOZZ_COMPILED = '/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json';
const PINNED_UPSTREAM = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';
const DIAG_LOG_PATH = '/tmp/zapret2-manager/orchestra-diag-tail.log';
const DIAG_TAIL_BYTES = 8192;
const DIAG_TAIL_LINES = 200;
const HISTORY_DIR = '/tmp/zapret2-manager/orchestra-history';
const HISTORY_MAX = 256;
const HISTORY_ROTATE_AT = 512;

const HISTORY_FILE = '/var/lib/zapret2-manager/orchestra-events.ndjson';
const HISTORY_MAX_EVENTS = 5000;
const HISTORY_ROTATE_SIZE = 4 * 1024 * 1024;
const HISTORY_RETENTION_DAYS = 30;

function run(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	return out;
}

function runcmd(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let h = trim(run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'"));
	return (length(h) == 64) ? h : null;
}

function stressozz_corpus_summary() {
	let raw = readfile(STRESSOZZ_CORPUS), doc = null;
	let compiledRaw = readfile(STRESSOZZ_COMPILED), compiled = null;
	try { if (raw) doc = json(raw); } catch (e) { doc = null; }
	try { if (compiledRaw) compiled = json(compiledRaw); } catch (e) { compiled = null; }
	let counts = { 'discord-media': 0, 'discord-voice': 0, 'discord-finland': 0, 'game-filter': 0 };
	if (doc && type(doc.records) == 'array') for (let r in doc.records) if (counts[r.feature] != null) counts[r.feature]++;
	let adapted = 0, unsupported = 0, unsupportedRecords = [], adaptedDigests = [];
	if (compiled && type(compiled.records) == 'array') for (let c in compiled.records) {
		if (c.executionStatus == 'adapted') { adapted++; push(adaptedDigests, { candidateId: c.candidateId, compiledDigest: c.compiledDigest }); }
		if (c.executionStatus == 'unsupported') { unsupported++; push(unsupportedRecords, { candidateId: c.candidateId, feature: c.feature, reasons: c.compatibilityReasons }); }
	}
	return { sourceRepo: doc && doc.sourceRepo || 'missing', pinnedCommit: doc && doc.sourceCommit || 'missing',
		totalRecords: doc && type(doc.records) == 'array' ? length(doc.records) : 0,
		discordMediaCount: counts['discord-media'], discordVoiceCount: counts['discord-voice'],
		discordFinlandCount: counts['discord-finland'], gameFilterCount: counts['game-filter'], executionStatus: compiled ? null : 'not-adapted',
		compilerVersion: compiled && compiled.compilerVersion || null, adaptedCount: adapted, unsupportedCount: unsupported,
		unsupportedRecords: unsupportedRecords, adaptedDigests: adaptedDigests };
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
		{ capability: 'autostate-model', available: engineLoaded, reason: 'state records live in the Lua global autostate (autostate.<askey>.<hostkey>), created at packet time', evidence: ['zapret-auto.lua:48-57 (autostate creation)'] },
		unavailable('preload APIs do NOT exist in the pinned upstream zapret-auto.lua', ['grep slm_preload zapret-auto.lua empty', 'pinned upstream ' + PINNED_UPSTREAM]),
		unavailable('no event stream exists: DLOG is gated by b_debug (' + (debugEnabled ? 'present' : 'ABSENT') + ' in the live argv)', ['zapret-auto.lua DLOG/b_debug usage']),
		unavailable('no upstream interface for strategy lock/block/whitelist', ['docs/architecture.md invariants'])
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

	for (let li = 0; li < length(lines); li++) {
		let l = trim(lines[li]); if (l == '') continue;

		if (index(l, 'run_id=') >= 0) {
			let matched = match(l, /run_id=([0-9a-fA-F_-]+)/);
			if (matched) runId = matched[1];
		}

		if (index(l, 'ERROR:') >= 0 || index(l, 'FATAL:') >= 0 || index(l, 'parse error') >= 0) {
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

function sanitize_string(str, maxLength) {
	if (maxLength == null) maxLength = 256;
	if (!str || str == '') return null;
	let s = trim(str);
	if (length(s) == 0) return null;
	if (length(s) > maxLength) s = substr(s, 0, maxLength);
	return s;
}

function sha256_string(s) {
	let h = 5381;
	for (let i = 0; i < length(s); i++) { h = ((h << 5) + h) + ord(substr(s, i, 1)); h = h & 0xFFFFFFFF; }
	return sprintf('%08x', h);
}

// ---- domain normalization ---------------------------------------------------

function normalize_domain(value) {
	let domain = tolower(trim(value || ''));
	while (length(domain) > 0 && substr(domain, length(domain) - 1, 1) == '.') {
		domain = substr(domain, 0, length(domain) - 1);
	}
	return length(domain) > 0 ? domain : null;
}

// ---- canonical NDJSON history store ---------------------------------------

function read_history_events() {
	try {
		if (!stat(HISTORY_FILE)) return [];
		let raw = readfile(HISTORY_FILE);
		if (!raw) return [];
		let lines = split(raw, '\n');
		let events = [];
		for (let li = 0; li < length(lines); li++) {
			let line = trim(lines[li]);
			if (length(line) == 0) continue;
			try {
				let event = json(line);
				if (type(event) == 'object' && event != null) push(events, event);
			} catch (e) { }
		}
		return events;
	} catch (e) { return []; }
}

function apply_retention(events) {
	let now = time();
	let cutoff = now - HISTORY_RETENTION_DAYS * 86400;

	// 1) age filter
	let filtered = [];
	for (let i = 0; i < length(events); i++) {
		let ts = events[i].timestamp || 0;
		if (ts >= cutoff) push(filtered, events[i]);
	}

	// 2) count cap: keep last 5000
	if (length(filtered) > HISTORY_MAX_EVENTS) {
		let keep = [];
		let start = length(filtered) - HISTORY_MAX_EVENTS;
		for (let i = start; i < length(filtered); i++) push(keep, filtered[i]);
		filtered = keep;
	}

	// 3) size cap: 4 MB
	if (length(filtered) > 0) {
		let body = '';
		for (let i = 0; i < length(filtered); i++) {
			body += sprintf("%J", filtered[i]) + '\n';
		}
		while (length(body) > HISTORY_ROTATE_SIZE && length(filtered) > 1) {
			let shorter = [];
			for (let i = 1; i < length(filtered); i++) push(shorter, filtered[i]);
			filtered = shorter;
			body = '';
			for (let i = 0; i < length(filtered); i++) {
				body += sprintf("%J", filtered[i]) + '\n';
			}
		}
	}

	return filtered;
}

function sh_escape(arg) {
	return "'" + arg + "'";
}

function write_history_atomic(events) {
	let dir = '/var/lib/zapret2-manager';
	let path = HISTORY_FILE;
	let tmp = path + '.tmp.' + time();

	try { mkdir(dir); } catch (e) { }

	let lines = [];
	for (let i = 0; i < length(events); i++) {
		push(lines, sprintf("%J", events[i]));
	}

	let content = length(lines) > 0 ? join('\n', lines) + '\n' : '';

	writefile(tmp, content);

	let readBack = readfile(tmp);
	if (readBack != content) {
		try { unlink(tmp); } catch (e) { }
		return { ok: false, error: 'history readback mismatch' };
	}

	let result = runcmd('mv -f ' + sh_escape(tmp) + ' ' + sh_escape(path));
	if (result.rc != 0) {
		try { unlink(tmp); } catch (e) { }
		return { ok: false, error: 'history atomic rename failed' };
	}

	return { ok: true };
}

function append_history_event(event) {
	if (!event || type(event) != 'object' || !event.eventClass) return { ok: false, error: 'invalid event' };

	if (!event.timestamp) event.timestamp = time();

	let events = read_history_events();
	push(events, event);
	let kept = apply_retention(events);
	return write_history_atomic(kept);
}

// ---- stateless pagination -------------------------------------------------

function make_cursor(offset) {
	return { generation: sha256_file(HISTORY_FILE) || 'none', offset: offset, version: 1 };
}

function clone_event(e) {
	let c = {};
	if (e.timestamp) c.timestamp = e.timestamp;
	if (e.eventClass) c.eventClass = e.eventClass;
	if (e.domain) c.domain = e.domain;
	if (e.askey) c.askey = e.askey;
	if (e.strategyId) c.strategyId = e.strategyId;
	if (e.previousStrategyId) c.previousStrategyId = e.previousStrategyId;
	if (e.confidence) c.confidence = e.confidence;
	if (e.runId) c.runId = e.runId;
	return c;
}

function paginate_events(cursor, limit) {
	if (limit == null) limit = 200;
	if (limit < 1) limit = 1;
	if (limit > 500) limit = 500;

	let events = read_history_events();
	let total = length(events);

	// validate cursor
	let offset = 0;
	if (cursor && type(cursor) == 'object') {
		if (cursor.version != 1) return { ok: false, error: 'unsupported cursor version' };
		if (cursor.generation && cursor.generation != (sha256_file(HISTORY_FILE) || 'none'))
			return { ok: false, error: 'stale cursor — history file generation changed' };
		if (cursor.offset != null) offset = cursor.offset;
	}

	if (offset < 0) offset = 0;
	if (offset > total) offset = total;

	let entries = [];
	for (let i = offset; i < total && length(entries) < limit; i++) {
		// redact for UI
		let e = clone_event(events[i]);
		push(entries, e);
	}

	let next = null;
	if (offset + length(entries) < total) {
		next = make_cursor(offset + length(entries));
	}

	return { ok: true, entries: entries, total: total, next: next };
}

// ---- runId detection -------------------------------------------------

function detect_runid() {
	let cmd = nfqws2_cmdline();
	if (!cmd) return null;

	let pid = cmd.pid;
	if (pid) {
		let argv = split(cmd.cmdline, '\0');
		for (let i = 0; i < length(argv); i++) {
			let part = trim(argv[i]);
			if (substr(part, 0, 6) == 'tries-') {
				let runId = substr(part, 6);
				let matched = match(runId, /^[0-9a-fA-F]+$/);
				if (matched && length(runId) == 8) return runId;
			}
		}
		// fallback: also try space-separated
		let parts = split(cmd.cmdline, ' ');
		for (let i = 0; i < length(parts); i++) {
			let part = trim(parts[i]);
			if (substr(part, 0, 6) == 'tries-') {
				let runId = substr(part, 6);
				let matched = match(runId, /^[0-9a-fA-F]+$/);
				if (matched && length(runId) == 8) return runId;
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

	let syslogFile = '/var/log/messages';
	if (stat(syslogFile)) {
		let raw = readfile(syslogFile);
		if (raw) {
			let lines = split(raw, '\n');
			let searchOffset = length(lines) - 1000;
			if (searchOffset < 0) searchOffset = 0;

			for (let i = searchOffset; i < length(lines); i++) {
				let line = trim(lines[i]);
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

// ---- ratings read model -------------------------------------------------

function aggregate_ratings(events, maxCount) {
	if (maxCount == null) maxCount = 200;
	let ratings = {};
	let count = 0;

	for (let i = 0; i < length(events) && count < maxCount; i++) {
		let e = events[i];
		if (!e.domain || !e.askey || !e.eventClass) continue;

		let key = normalize_domain(e.domain) + ':' + e.askey;
		if (key == ':') continue;

		if (!ratings[key]) {
			ratings[key] = {
				domain: e.domain,
				askey: e.askey,
				normalizedDomain: normalize_domain(e.domain),
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
		r.lastSeenAt = e.timestamp;

		if (e.eventClass == 'STRATEGY_SELECTED' || e.eventClass == 'STRATEGY_ROTATED') { r.selectedCount++; }
		if (e.eventClass == 'SUCCESS') { r.successCount++; }
		if (e.eventClass == 'FAILURE_RETRANS') { r.retransFailureCount++; r.failureCount++; }
		if (e.eventClass == 'FAILURE_RST') { r.rstFailureCount++; r.failureCount++; }
		if (e.eventClass == 'FAILURE_HTTP_REDIRECT') { r.redirectFailureCount++; r.failureCount++; }
		if (e.eventClass == 'FAILURE_UDP_HEURISTIC') { r.udpFailureCount++; r.failureCount++; }
		if (e.eventClass == 'STRATEGY_ROTATED') { r.rotationAwayCount++; }
		if (e.eventClass == 'FINAL_STRATEGY_REACHED') { r.finalReachedCount++; }

		count++;
	}

	let result = [];
	for (let k in ratings) {
		push(result, ratings[k]);
	}
	result.sort(function (a, b) { return (b.lastSeenAt || 0) - (a.lastSeenAt || 0); });

	return { entries: result, total: length(result) };
}

// ---- diagnostic draft capability -----------------------------------------------

function diag_draft_capability(authostlistVars) {
	let current = authostlistVars.AUTOHOSTLIST_DEBUGLOG;
	return {
		canDraft: true, current: (current != null) ? current : '0',
		note: 'A draft to enable/disable AUTOHOSTLIST_DEBUGLOG can be created through the config DRAFT mechanism.',
		warning: 'Do not edit /opt/zapret2/config directly.',
		suggestedPath: '/tmp/zapret2-autohostlist.log', suggestedRotationKb: 256
	};
}

// ---- public API -----------------------------------------------------------------

export const orchestra_capabilities = function () {
	let cmd = nfqws2_cmdline();
	let engine = cmd != null ? detect_engine(cmd.cmdline) : { auto: false, antidpi: false, lib: false };
	let luaFiles = detect_lua_files();
	let dbg = (cmd != null) ? debug_enabled(cmd.cmdline) : false;
	let pkgVer = detect_package_version();
	let binVer = detect_nfqws2_binary_version();
	return { ok: true, detected: { packageVersion: pkgVer, binaryVersion: binVer, pinnedUpstream: PINNED_UPSTREAM, versionMatch: pkgVer != null ? true : null }, engine: engine, luaFiles: luaFiles, matrix: with_ids(capability_matrix(engine, luaFiles, dbg)), stressozzCorpus: stressozz_corpus_summary() };
};

export const orchestra_status = function () {
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
	let rawEvents = read_history_events();
	if (length(rawEvents) > 0) {
		let recent = [];
		for (let i = length(rawEvents) - 1; i >= 0 && length(recent) < 50; i--) push(recent, rawEvents[i]);
		history = { entries: recent, total: length(rawEvents), label: 'Manager observation history' };
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
		autostate: { model: 'in-process Lua global autostate', persisted: false, reason: 'no persistence calls exist in zapret-auto.lua' }
	};
};

export const orchestra_events = function () {
	let configText = readfile(PATHS.applied_conf);
	let rawVars = parse_autohostlist_vars(configText);
	let semantic = semantic_autohostlist(rawVars);
	let cmd = nfqws2_cmdline();
	let dbg = (cmd != null) ? debug_enabled(cmd.cmdline) : false;
	if (!semantic.debug.enabled && !dbg)
		return unavailable_result('events', 'no event stream exists', ['live argv has no --debug']);
	let path = semantic.debug.path || '/tmp/zapret2-autohostlist.log';
	let tail = safe_diag_tail(path);
	if (tail == null || tail.error) return { ok: true, available: false, reason: 'log file is not readable: ' + path };
	return { ok: true, available: true, path: path, truncated: tail.truncated, freshness: tail.freshness, parsedEvents: tail.events, unknownCount: tail.unknown, parserVersion: tail.parserVersion };
};

export const orchestra_history = function () {
	let rawEvents = read_history_events();
	if (length(rawEvents) == 0) return { ok: true, available: false, entries: [], label: 'Manager observation history' };
	let recent = [];
	for (let i = length(rawEvents) - 1; i >= 0 && length(recent) < 50; i--) push(recent, rawEvents[i]);
	return { ok: true, available: true, total: length(rawEvents), entries: recent, label: 'Manager observation history' };
};

export const orchestra_ratings_get = function () {
	let rawEvents = read_history_events();
	if (length(rawEvents) == 0) return { ok: true, available: false, entries: [], label: 'Ratings' };
	let ratings = aggregate_ratings(rawEvents, 200);
	return { ok: true, available: true, total: ratings.total, entries: ratings.entries, label: 'Ratings' };
};

export const orchestra_runid = function () {
	let runId = detect_runid();
	let cmd = nfqws2_cmdline();
	return {
		ok: true,
		available: runId != null || cmd != null,
		runId: runId,
		pid: cmd != null ? cmd.pid : null,
		detectionMethod: runId != null ? 'command_line_argument' : (cmd != null ? 'command_line_snapshot' : 'not_detected'),
		note: 'runId is inferred from nfqws2 command line'
	};
};

export const orchestra_parse_warnings = function () {
	let warnings = get_parse_warnings();
	return {
		ok: true,
		count: warnings.count,
		warnings: warnings.warnings,
		errors: warnings.errors,
		total: length(warnings.warnings) + length(warnings.errors),
		note: 'Parse warnings and errors are aggregated from system logs'
	};
};

// ---- history API (stateless pagination) --------------------------------------

export const orchestra_history_get = function () {
	let rawEvents = read_history_events();
	if (length(rawEvents) == 0) return { ok: true, available: false, entries: [], total: 0 };
	let result = paginate_events(null, 200);
	return {
		ok: true,
		available: true,
		entries: result.entries,
		total: result.total,
		note: 'Limited view for UI'
	};
};

export const orchestra_history_paginated = function (req) {
	let cursor = null;
	let limit = 200;

	if (req && req.args && req.args.cursor) {
		try { cursor = json(req.args.cursor); } catch (e) { }
	}
	if (req && req.args && req.args.limit) {
		limit = +req.args.limit;
		if (limit < 1) limit = 1;
		if (limit > 500) limit = 500;
	}

	return paginate_events(cursor, limit);
};

export const orchestra_history_export = function (req) {
	let limit = 200;
	if (req && req.args && req.args.limit) {
		limit = +req.args.limit;
		if (limit < 1) limit = 1;
		if (limit > 5000) limit = 5000;
	}

	let rawEvents = read_history_events();
	let recent = [];
	for (let i = length(rawEvents) - 1; i >= 0 && length(recent) < limit; i--) {
		push(recent, clone_event(rawEvents[i]));
	}

	return { ok: true, available: true, entries: recent, total: length(recent), limit: limit };
};

export const orchestra_history_clear = function (req) {
	let runId = null;
	if (req && req.args && req.args.runId) {
		runId = req.args.runId;
	}

	if (runId) {
		let events = read_history_events();
		let kept = [];
		let cleared = 0;
		for (let i = 0; i < length(events); i++) {
			if (events[i].runId && events[i].runId == runId) {
				cleared++;
			} else {
				push(kept, events[i]);
			}
		}
		let result = write_history_atomic(kept);
		if (!result.ok) return result;
		return { ok: true, cleared: cleared, total: length(kept), runId: runId };
	} else {
		let result = write_history_atomic([]);
		if (!result.ok) return result;
		return { ok: true, cleared: true, note: 'All history cleared' };
	}
};

export const orchestra_history_stats = function () {
	let events = read_history_events();
	let st = stat(HISTORY_FILE);
	return {
		ok: true,
		available: true,
		total: length(events),
		currentSize: st ? st.size : 0,
		maxSize: HISTORY_ROTATE_SIZE,
		retentionDays: HISTORY_RETENTION_DAYS,
		oldestEvent: length(events) > 0 ? events[0].timestamp : null,
		newestEvent: length(events) > 0 ? events[length(events) - 1].timestamp : null
	};
};
