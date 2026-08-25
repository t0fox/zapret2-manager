'use strict';

import { stat, readfile, writefile, mkdir, unlink, popen, readlink, lsdir } from 'fs';
import * as native from './core/native-helper.uc';

const ROOT = '/tmp/zapret2-manager/runtime/scanner';
const MAX_RECORD_BYTES = 98304;
const MAX_RESULTS = 128;
const MAX_EVENTS = 32;
const MAX_HISTORY = 50;
const MAX_TEXT = 256;
const ACTIVE = 'active.json';
const HISTORY_INDEX = '.history.json';
const JOURNAL_STATES = ['PREPARED', 'TABLE_CREATED', 'RULES_READY', 'PROCESS_BOUND', 'ACTIVE', 'CLEANING', 'CLEANED'];
let sequence = 0;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function safe_id(value) { return string(value) && match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/); }
function text(value) { return string(value) ? (length(value) > MAX_TEXT ? substr(value, 0, MAX_TEXT) : value) : null; }
function copy(value) {
	if (type(value) == 'array') { let out = []; for (let i = 0; i < length(value); i++) push(out, copy(value[i])); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = copy(value[key]); return out; }
	return value;
}
function sanitize_numbers(value) {
	if (type(value) == 'double') {
		try { let p=popen('printf \"sanitize top double %s\\n\" '+shell(sprintf('%J', value))+' >> /tmp/sanitize.log 2>&1', 'r'); if(p) p.close(); } catch(e) {}
		return int(value);
	}
	if (type(value) == 'array') { let out=[]; for(let i=0;i<length(value);i++) push(out, sanitize_numbers(value[i])); return out; }
	if (object(value)) { let out={}; for(let k in value) { let v=value[k]; if (type(v)=='double') {
		try { let p=popen('printf \"sanitize double key=%s val=%s\\n\" '+shell(k)+' '+shell(sprintf('%J', v))+' >> /tmp/sanitize.log 2>&1', 'r'); if(p) p.close(); } catch(e) {}
		if (k=='successRate' || k=='coverage' || k=='success_rate') v=int(v*1000); else v=int(v);
	} else v=sanitize_numbers(v); out[k]=v; } return out; }
	return value;
}
function root() { return getenv('Z2M_SCANNER_SERVER_TEST') == '1' ? (getenv('Z2M_SCANNER_STATE_ROOT') || ROOT) : ROOT; }
function path(id, suffix) { return root() + '/' + id + suffix; }
function test_mode() { return getenv('Z2M_SCANNER_SERVER_TEST') == '1'; }
function native_path(id, suffix) { return 'scanner/' + (id ? id + suffix : suffix); }
function shell(value) {
	let out = "'";
	for (let i = 0; i < length(value); i++) out += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1);
	return out + "'";
}
function ensure_root() {
	try { mkdir(root()); } catch (e) { }
	let metadata = null;
	try { metadata = stat(root()); } catch (e) { metadata = null; }
	if (test_mode()) return object(metadata) && metadata.type == 'directory' && readlink(root()) == null;
	if (object(metadata) && metadata.type == 'directory' && readlink(root()) == null && metadata.uid == 0 && metadata.gid == 0) {
		if (metadata.mode % 512 != 448) {
			try { let p = popen('chmod 0700 ' + shell(root()) + ' 2>/dev/null', 'r'); if (p) p.close(); metadata = stat(root()); } catch (e) {}
		}
		return object(metadata) && metadata.type == 'directory' && readlink(root()) == null && metadata.uid == 0 && metadata.gid == 0 && metadata.mode % 512 == 448;
	}
	return false;
}
function atomic(file, value) {
	if (!ensure_root()) return false;
	let tmp = file + '.tmp.' + time() + '.' + (++sequence);
	try { if (!writefile(tmp, sprintf('%J', value) + '\n')) return false; } catch (e) { return false; }
	let move = null;
	try { move = popen('mv -f ' + shell(tmp) + ' ' + shell(file) + ' 2>/dev/null', 'r'); } catch (e) { move = null; }
	let ok = move != null && move.close() == 0;
	if (!ok) try { unlink(tmp); } catch (e) { }
	return ok;
}
function read_json(file) {
	let raw = null;
	try { raw = readfile(file); } catch (e) { return null; }
	if (!string(raw) || length(raw) > MAX_RECORD_BYTES) return null;
	try { let value = json(raw); return object(value) ? value : null; } catch (e) { return null; }
}
function native_read(id, suffix) {
	let result = native.read_regular('runtime', native_path(id, suffix), MAX_RECORD_BYTES);
	if (!result.ok) return null;
	try { return json(b64dec(result.data.content)); } catch (e) { return null; }
}
function native_digest(id, suffix) {
	let result = native.sha256_regular('runtime', native_path(id, suffix), MAX_RECORD_BYTES);
	return result.ok ? result.data.sha256 : null;
}
function publish_json(id, suffix, value, expected) {
	if (test_mode()) return atomic(path(id, suffix), value);
	let made = native.mkdir_private('runtime', 'scanner', true);
	if (!made.ok) return false;
	if (id != '') {
		made = native.mkdir_private('runtime', 'scanner/' + id, true);
		if (!made.ok) return false;
	}
	let result = native.atomic_write_json('runtime', native_path(id, suffix), value, expected == null, expected);
	return result.ok;
}
function publish_revision(id, suffix, value, revision) {
	if (test_mode()) {
		let current = read_json(path(id, suffix));
		if (revision < 0 ? current != null : (current == null || current.revision != revision)) return false;
		return atomic(path(id, suffix), value);
	}
	let made = native.mkdir_private('runtime', 'scanner', true);
	if (!made.ok) {
		try { let p = popen('printf %s\\n ' + shell(sprintf('mkdir_private scanner failed: %J', made)) + ' >> /tmp/scanner-publish.log 2>&1', 'r'); if (p) p.close(); } catch (e) {}
		return false;
	}
	if (id != '') { made = native.mkdir_private('runtime', 'scanner/' + id, true); if (!made.ok) {
		try { let p = popen('printf %s\\n ' + shell(sprintf('mkdir_private scanner/%s failed: %J', id, made)) + ' >> /tmp/scanner-publish.log 2>&1', 'r'); if (p) p.close(); } catch (e) {}
		return false;
	} }
	let result = native.atomic_write_json_revision('runtime', native_path(id, suffix), value, revision < 0, revision);
	if (!result.ok) {
		try { let p = popen('printf %s\\n ' + shell(sprintf('atomic_write_json_revision %s%s rev %s failed: %J len %d', id, suffix, revision, result, length(sprintf('%J', value)))) + ' >> /tmp/scanner-publish.log 2>&1', 'r'); if (p) p.close(); } catch (e) {}
		try { let raw=sprintf('%J', value); let snippet=substr(raw,0,4000); let p2=popen('printf \"FAIL_JSON rev %s len %d snippet: %s\\n\" '+shell(''+revision)+' '+shell(''+length(raw))+' '+shell(snippet)+' >> /tmp/publish_fail.json 2>&1', 'r'); if(p2) p2.close(); } catch(e2) {}
	}
	return result.ok;
}
function publish_cancel(id) {
	if (test_mode()) return atomic(path(id, '.cancel'), { id, stopRequested: true, updatedAt: time() });
	return native.atomic_write_json('runtime', native_path(id, '.cancel'), { id, stopRequested: true, updatedAt: time() }, true, null).ok;
}
function read_record(id) { return test_mode() ? read_json(path(id, '.record.json')) : native_read(id, '.record.json'); }
function read_control(id) { return test_mode() ? read_json(path(id, '.control.json')) : native_read(id, '.control.json'); }
function read_journal(id) { return test_mode() ? read_json(path(id, '.journal.json')) : native_read(id, '.journal.json'); }
function hash(value) {
	if (!ensure_root()) return null;
	let file = root() + '/.digest.' + time() + '.' + (++sequence), result = null, process = null;
	try { writefile(file, value); process = popen('sha256sum ' + shell(file) + ' 2>/dev/null', 'r'); result = process ? trim(process.read('all') || '') : ''; if (process) process.close(); unlink(file); } catch (e) { try { unlink(file); } catch (ignored) { } }
	let fields = split(result, /[[:space:]]+/);
	return length(fields) && digest(fields[0]) ? fields[0] : null;
}
function process_starttime(pid) {
	let raw = null;
	try { raw = readfile('/proc/' + pid + '/stat'); } catch (e) { return null; }
	let fields = split(trim(raw || ''), ' ');
	return length(fields) > 21 ? +fields[21] : null;
}
function live_identity(pid, startTime) {
	return integer(pid) && pid > 1 && integer(startTime) && process_starttime(pid) == startTime;
}
function error(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	if (object(extra)) for (let key in extra) result[key] = extra[key];
	return result;
}
function canonical_escape(value) {
	let out = '';
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1), code = ord(c);
		if (c == '\\') out += '\\\\';
		else if (c == chr(34)) out += '\\' + chr(34);
		else if (code < 32) out += sprintf('\\u%04x', code);
		else out += c;
	}
	return out;
}
function canonical_json(value) {
	let t = type(value);
	if (value == null) return 'null';
	if (t == 'boolean') return value ? 'true' : 'false';
	if (t == 'int' || t == 'double') return '' + value;
	if (t == 'string') return chr(34) + canonical_escape(value) + chr(34);
	if (t == 'array') { let out = '['; for (let i = 0; i < length(value); i++) out += (i ? ',' : '') + canonical_json(value[i]); return out + ']'; }
	if (t == 'object') {
		let names = keys(value);
		for (let i = 1; i < length(names); i++) { let item = names[i], j = i - 1; while (j >= 0 && names[j] > item) { names[j + 1] = names[j]; j--; } names[j + 1] = item; }
		let out = '{';
		for (let i = 0; i < length(names); i++) out += (i ? ',' : '') + canonical_json(names[i]) + ':' + canonical_json(value[names[i]]);
		return out + '}';
	}
	return 'null';
}
function request_digest(request) { return hash(canonical_json(request)); }
function plan_digest(plan) { return hash(canonical_json({ schema: plan?.schema, request: plan?.request, targetProfile: plan?.targetProfile, catalogDigest: plan?.catalogDigest, compilerDigest: plan?.compilerDigest, candidates: plan?.candidates })); }
function result_projection(value) {
	if (!object(value)) return null;
	let sanitizedScore = type(value.score) == 'int' ? value.score : (type(value.score) == 'double' ? int(value.score) : null);
	let rawEvidence = object(value.evidence) ? copy(value.evidence) : null;
	let sanitizedEvidence = object(rawEvidence) ? sanitize_numbers(rawEvidence) : null;
	// Trim evidence for failed/infra to stay under helper 1024-member limit (keep minimal)
	if (object(sanitizedEvidence) && value.success !== true) {
		let minimal = {};
		if (object(sanitizedEvidence.metrics) && sanitizedEvidence.metrics.successRate != null) minimal.metrics = {successRate: 0};
		if (sanitizedEvidence.failureClass) minimal.failureClass = sanitizedEvidence.failureClass;
		if (sanitizedEvidence.infrastructure) minimal.infrastructure = true;
		sanitizedEvidence = minimal;
	}
	let out = {
		candidateId: text(value.candidateId), ordinal: integer(value.ordinal) ? value.ordinal : 0,
		verdict: text(value.verdict) || 'infrastructure', success: value.success == true,
		score: sanitizedScore,
		reason: text(value.reason), evidence: sanitizedEvidence,
		planDigest: digest(value.planDigest) ? value.planDigest : null,
		evidenceIdentity: digest(value.evidenceIdentity) ? value.evidenceIdentity : null,
	};
	// Avatar parity: expose throughput, body_passed, success_rate, per_host, score, latency for report compatibility
	// Keep Z2M canonical identity where stricter: preserve strategyId/revision/saveRequired etc.
	let metrics = object(value.evidence) && object(value.evidence.metrics) ? sanitize_numbers(copy(value.evidence.metrics)) : {};
	let kbpsRaw = metrics.averageKbps != null ? metrics.averageKbps : (metrics.kbps != null ? metrics.kbps : 0);
	let srRaw = metrics.successRate != null ? metrics.successRate : (value.success === true ? 1 : 0);
	let perHost = metrics.perHost || metrics.perProbe;
	if (type(perHost) != 'array') {
		if (object(value.evidence) && type(value.evidence.perHost) == 'array') perHost = sanitize_numbers(copy(value.evidence.perHost));
		else perHost = [];
	} else perHost = sanitize_numbers(copy(perHost));
	let latencyRaw = metrics.averageLatencyMs != null ? metrics.averageLatencyMs : (metrics.latencyMs != null ? metrics.latencyMs : (metrics.stunLatencyMs != null ? metrics.stunLatencyMs : 0));
	let kbps = type(kbpsRaw)=='double'?int(kbpsRaw):kbpsRaw;
	let sr = type(srRaw)=='double'?(srRaw>1?int(srRaw):int(srRaw*1000)):srRaw;
	let latency = type(latencyRaw)=='double'?int(latencyRaw):latencyRaw;
	out.throughput_kbps = kbps;
	out.body_passed = value.success === true;
	if (object(metrics) && metrics.bodyPassed === false) out.body_passed = false;
	else if (length(perHost) && value.success === true) {
		let anyBody = false;
		for (let i=0;i<length(perHost);i++) {
			let h = perHost[i];
			if (object(h) && object(h.body) && h.body.success === true) anyBody = true;
		}
		if (length(perHost) && !anyBody) out.body_passed = false;
	}
	out.success_rate = sr;
	out.latency_ms = latency;
	out.per_host = copy(perHost);
	// raw_data alias for Avatar scan.js (strategy_scanner compatibility)
	out.raw_data = {};
	if (type(value.compiledTokens) == 'array' && length(value.compiledTokens)) out.raw_data.args_preview = join(' ', value.compiledTokens);
	else if (object(value.evidence) && type(value.evidence.argsPreview) == 'string') out.raw_data.args_preview = value.evidence.argsPreview;
	else out.raw_data.args_preview = '';
	out.raw_data.source_file = value.sourcePath || value.source || '';
	out.raw_data.probe_per_host = copy(perHost);
	for (let key in ['identityKind', 'strategyId', 'strategyRevision', 'saveRequired', 'source',
		'sourcePath', 'protocol', 'candidateCatalogDigest', 'candidateCompilerDigest'])
		if (value[key] != null) out[key] = copy(value[key]);
	if (type(value.compiledTokens) == 'array') out.compiledTokens = copy(value.compiledTokens);
	if (digest(value.compiledDigest)) out.compiledDigest = value.compiledDigest;
	if (digest(value.dependencyDigest)) out.dependencyDigest = value.dependencyDigest;
	if (object(value.dependencyClosure)) out.dependencyClosure = copy(value.dependencyClosure);
	return out;
}
function bounded_results(value) {
	let out = [];
	if (type(value) != 'array') return out;
	for (let i = 0; i < length(value) && i < MAX_RESULTS; i++) {
		let item = result_projection(value[i]);
		if (item != null) push(out, item);
	}
	return out;
}
function bounded_events(value) {
	let out = [];
	if (type(value) != 'array') return out;
	let start = length(value) > MAX_EVENTS ? length(value) - MAX_EVENTS : 0;
	for (let i = start; i < length(value); i++) {
		let event = value[i];
		if (object(event)) push(out, { type: text(event.type) || 'event', message: text(event.message), at: integer(event.at) ? event.at : time() });
	}
	return out;
}
function public_record(value) {
	let out = {
		schema: 1, id: safe_id(value.id) ? value.id : null, revision: integer(value.revision) ? value.revision : 0,
		request: object(value.request) ? copy(value.request) : null, requestDigest: digest(value.requestDigest) ? value.requestDigest : null,
		catalogDigest: digest(value.catalogDigest) ? value.catalogDigest : null, compilerDigest: digest(value.compilerDigest) ? value.compilerDigest : null,
		planDigest: digest(value.planDigest) ? value.planDigest : null, status: text(value.status) || 'error', phase: text(value.phase) || 'error',
		progress: integer(value.progress) ? value.progress : 0, total: integer(value.total) ? value.total : 0,
		cursor: { nextCandidate: integer(value.cursor?.nextCandidate) ? value.cursor.nextCandidate : 0 },
		currentCandidate: text(value.currentCandidate), counts: object(value.counts) ? sanitize_numbers(copy(value.counts)) : { working: 0, failed: 0, infrastructure: 0 },
		results: bounded_results(value.results), baseline: object(value.baseline) ? sanitize_numbers(copy(value.baseline)) : null,
		baselineIdentity: digest(value.baselineIdentity) ? value.baselineIdentity : null,
		baselineExecutorCalls: integer(value.baselineExecutorCalls) ? value.baselineExecutorCalls : 0,
		error: text(value.error), recovery: object(value.recovery) ? sanitize_numbers(copy(value.recovery)) : { state: 'not_required' },
		cancellationRequested: value.cancellationRequested == true, worker: object(value.worker) ? copy(value.worker) : null,
		heartbeatAt: integer(value.heartbeatAt) ? value.heartbeatAt : time(), startedAt: integer(value.startedAt) ? value.startedAt : null,
		finishedAt: integer(value.finishedAt) ? value.finishedAt : null, events: bounded_events(value.events),
	};
	if (index(['completed','cancelled','error'], out.status) >= 0 && object(value.planAuthority) && type(value.planAuthority.candidates) == 'array') out.planAuthority = sanitize_numbers(copy(value.planAuthority));
	else if (object(value.planAuthority)) {
		let pa = {};
		if (digest(value.planAuthority.catalogDigest)) pa.catalogDigest = value.planAuthority.catalogDigest;
		if (digest(value.planAuthority.compilerDigest)) pa.compilerDigest = value.planAuthority.compilerDigest;
		if (digest(value.planDigest)) pa.planDigest = value.planDigest;
		if (integer(value.planAuthority.execution?.candidatesCompiled)) pa.candidatesCompiled = value.planAuthority.execution.candidatesCompiled;
		if (integer(value.planAuthority.execution?.candidatesShortlisted)) pa.candidatesShortlisted = value.planAuthority.execution.candidatesShortlisted;
		out.planAuthority = sanitize_numbers(pa);
	}
	// Avatar parity: expose elapsed_seconds for get_status compatibility (strategy_scanner.get_status elapsed)
	if (out.startedAt != null && out.finishedAt != null) out.elapsed_seconds = out.finishedAt - out.startedAt;
	else if (out.startedAt != null && out.heartbeatAt != null) out.elapsed_seconds = out.heartbeatAt - out.startedAt;
	else out.elapsed_seconds = 0;
	return sanitize_numbers(out);
}
function valid_record(value) {
	return object(value) && value.schema == 1 && safe_id(value.id) && integer(value.revision)
		&& object(value.request) && digest(value.requestDigest) && digest(value.planDigest)
		&& digest(value.catalogDigest) && digest(value.compilerDigest)
		&& index(['idle', 'running', 'completed', 'cancelled', 'error'], value.status) >= 0
		&& type(value.results) == 'array' && length(value.results) <= MAX_RESULTS;
}
function valid_journal(value, id) {
	if (!object(value) || value.schema != 1 || value.id != id || type(value.entries) != 'array' || !length(value.entries)) return false;
	let previous = -1;
	let previousState = null;
	for (let entry in value.entries) {
		let stateIndex = index(JOURNAL_STATES, entry?.state);
		let startsNextCandidate = previousState == 'CLEANED' && entry?.state == 'PREPARED';
		if (!object(entry) || stateIndex < 0 || (!startsNextCandidate && stateIndex < previous)
			|| !object(entry.evidence)) return false;
		previous = stateIndex;
		previousState = entry.state;
	}
	return true;
}
function new_id() { return 'scan-' + time() + '-' + (++sequence); }

export const scanner_state_create = function(request, plan) {
	let candidates = object(plan) && type(plan.candidates) == 'array' ? plan.candidates : [];
	let normalized = object(request) ? copy(request) : {};
	return {
		schema: 1, id: null, revision: 0, request: normalized,
		requestDigest: request_digest(normalized), catalogDigest: plan?.catalogDigest,
		compilerDigest: plan?.compilerDigest, planDigest: plan_digest(plan || {}), status: 'idle', phase: 'idle',
		progress: 0, total: length(candidates), cursor: { nextCandidate: 0 }, currentCandidate: null,
		counts: { working: 0, failed: 0, infrastructure: 0 }, results: [], baseline: null, baselineIdentity: null, baselineExecutorCalls: 0, error: null,
		recovery: { state: 'not_required' }, cancellationRequested: false, worker: null,
		heartbeatAt: time(), startedAt: null, finishedAt: null, events: [], planAuthority: copy(plan || {}),
	};
};

export const scanner_state_digest = function(value) { return hash(canonical_json(value)); };
export const scanner_profile_digest = function(value) { return hash(sprintf('%J', value)); };

export const scanner_journal_load = function(id) {
	if (!safe_id(id)) return error('EINPUT', 'Scanner journal identity is invalid.');
	let value = read_journal(id);
	return valid_journal(value, id) ? { ok: true, journal: value } : error('ENOENT', 'Scanner journal is unavailable.');
};

export const scanner_journal_write = function(id, state, evidence) {
	if (!safe_id(id) || index(JOURNAL_STATES, state) < 0 || !object(evidence)) return error('EINPUT', 'Scanner journal entry is invalid.');
	let loaded = scanner_journal_load(id), journal;
	if (loaded.ok) journal = loaded.journal;
	else if (loaded.error.code == 'ENOENT') journal = { schema: 1, id, entries: [] };
	else return loaded;
	let previous = length(journal.entries) ? journal.entries[length(journal.entries) - 1] : null;
	let next = index(JOURNAL_STATES, state);
	let startsNextCandidate = previous != null && previous.state == 'CLEANED' && state == 'PREPARED';
	if (previous != null && !startsNextCandidate && next < index(JOURNAL_STATES, previous.state)) return error('ECONFLICT', 'Scanner journal state regressed.');
	if (state == 'TABLE_CREATED' && (evidence.tableCreated != true || evidence.ownerVerified != true || evidence.kernelReadBack != true))
		return error('EOWNER', 'TABLE_CREATED requires verified kernel ownership evidence.');
	let updated = { schema: 1, id, entries: copy(journal.entries) };
	push(updated.entries, { state, evidence: copy(evidence), at: time() });
	return publish_json(id, '.journal.json', updated, null) ? { ok: true, journal: updated } : error('EIO', 'Scanner journal could not be durably published.');
};

export const scanner_state_load = function(id) {
	if (!safe_id(id)) return error('EINPUT', 'Scanner id is invalid.');
	let value = read_record(id);
	return valid_record(value) ? { ok: true, state: value } : error('ENOENT', 'Scanner record is unavailable.');
};

function history_projection(value) {
	return {
		id: safe_id(value.id) ? value.id : null,
		revision: integer(value.revision) ? value.revision : 0,
		request: object(value.request) ? copy(value.request) : null,
		status: text(value.status) || 'error', phase: text(value.phase) || 'error',
		progress: integer(value.progress) ? value.progress : 0, total: integer(value.total) ? value.total : 0,
		currentCandidate: text(value.currentCandidate), counts: object(value.counts) ? copy(value.counts) : {},
		error: text(value.error), recovery: object(value.recovery) ? copy(value.recovery) : {},
		startedAt: integer(value.startedAt) ? value.startedAt : null,
		finishedAt: integer(value.finishedAt) ? value.finishedAt : null,
		heartbeatAt: integer(value.heartbeatAt) ? value.heartbeatAt : null
	};
}

function history_id(name) {
	if (!string(name) || substr(name, -12) != '.record.json') return null;
	name = substr(name, 0, length(name) - 12);
	return safe_id(name) ? name : null;
}

// History is a read-only projection.  Use one bounded, locally validated read
// per record instead of invoking the private helper transport once per file;
// the latter made a 50-row history serially spend ~20 seconds on the target.
// The canonical writer keeps these records as root-owned 0600 regular files
// below the root-owned 0700 scanner directory.  Reject anything else before
// parsing so the fast path does not widen the readable state boundary.
function history_read_record(id) {
	if (!safe_id(id)) return null;
	let file = path(id, '.record.json'), metadata = null;
	try { metadata = stat(file); } catch (e) { return null; }
	if (!object(metadata) || metadata.type != 'file' || metadata.uid != 0 || metadata.gid != 0
		|| metadata.mode != 384 || readlink(file) != null) return null;
	return read_json(file);
}

function history_index_items() {
	let value = test_mode() ? read_json(path('', HISTORY_INDEX)) : native_read('', HISTORY_INDEX);
	if (!object(value) || value.schema != 1 || type(value.items) != 'array') return null;
	return value.items;
}

function history_index_write(items) {
	let raw = sprintf('%J', { schema: 1, items: slice(items, 0, MAX_HISTORY) }) + '\n';
	if (length(raw) > 521028) return false;
	let result = test_mode() ? atomic(path('', HISTORY_INDEX), { schema: 1, items: slice(items, 0, MAX_HISTORY) })
		: native.atomic_write('runtime', native_path('', HISTORY_INDEX), b64enc(raw), true);
	return test_mode() ? result : result.ok;
}

function history_index_upsert(candidate) {
	let items = history_index_items();
	if (items == null) return false;
	let next = [];
	for (let item in items) if (object(item) && item.id != candidate.id) push(next, item);
	push(next, history_projection(candidate));
	for (let i = 0; i < length(next); i++) for (let j = i + 1; j < length(next); j++) {
		let left = next[i].finishedAt || next[i].startedAt || 0, right = next[j].finishedAt || next[j].startedAt || 0;
		if (right > left) { let swap = next[i]; next[i] = next[j]; next[j] = swap; }
	}
	return history_index_write(next);
}

export const scanner_state_history_list = function(input) {
	let requested = object(input) && integer(input.limit) && input.limit > 0 ? input.limit : MAX_HISTORY;
	let limit = requested > MAX_HISTORY ? MAX_HISTORY : requested, names = null, rows = [];
	if (!test_mode() && !ensure_root()) return { ok: true, items: [], limit: limit };
	let indexed = history_index_items();
	if (indexed != null) return { ok: true, items: slice(indexed, 0, limit), limit: limit, source: 'compact-index' };
	try { names = lsdir(root()); } catch (e) { names = null; }
	if (type(names) != 'array') return { ok: true, items: [], limit: limit };
	for (let name in names) {
		let id = history_id(name);
		if (!id) continue;
		let loaded = history_read_record(id);
		loaded = loaded != null && valid_record(loaded) ? { ok: true, state: loaded } : { ok: false };
		if (loaded.ok) push(rows, history_projection(loaded.state));
	}
	for (let i = 0; i < length(rows); i++) for (let j = i + 1; j < length(rows); j++) {
		let left = rows[i].finishedAt || rows[i].startedAt || 0, right = rows[j].finishedAt || rows[j].startedAt || 0;
		if (right > left) { let swap = rows[i]; rows[i] = rows[j]; rows[j] = swap; }
	}
	history_index_write(rows);
	return { ok: true, items: slice(rows, 0, limit), limit: limit };
};

export const scanner_state_history_get = function(id) {
	let loaded = scanner_state_load(id);
	return loaded.ok ? { ok: true, record: public_record(loaded.state) } : loaded;
};

export const scanner_state_save = function(input) {
	let candidate = public_record(input || {});
	if (!safe_id(candidate.id)) candidate.id = new_id();
	let current = scanner_state_load(candidate.id), previous = current.ok ? current.state : null;
	if (!current.ok && current.error.code != 'ENOENT') return current;
	if (previous != null && candidate.revision != previous.revision)
		return error('ECONFLICT', 'Scanner record revision is stale.', { revision: previous.revision });
	if (previous == null) candidate.revision = 1;
	else candidate.revision = previous.revision + 1;
	if (!digest(candidate.requestDigest) || !digest(candidate.planDigest) || !digest(candidate.catalogDigest) || !digest(candidate.compilerDigest))
		return error('ESCHEMA', 'Scanner record digests are incomplete.');
	if (length(sprintf('%J', candidate)) > MAX_RECORD_BYTES) return error('EOUTPUT', 'Scanner record exceeds volatile bounds.');
	let expected = previous == null ? -1 : previous.revision;
	let published = test_mode() ? publish_json(candidate.id, '.record.json', candidate, null) : publish_revision(candidate.id, '.record.json', candidate, expected);
	if (!published) return error('EIO', 'Scanner record could not be atomically published.');
	if (index(['completed', 'cancelled', 'error'], candidate.status) >= 0) history_index_upsert(candidate);
	return { ok: true, id: candidate.id, revision: candidate.revision, state: candidate };
};

export const scanner_control_load = function(id) {
	if (!safe_id(id)) return error('EINPUT', 'Scanner id is invalid.');
	let value = read_control(id);
	return value != null && value.id == id ? { ok: true, control: value, present: true } : { ok: true, present: false, control: { id, revision: 0, stopRequested: false, updatedAt: time() } };
};

export const scanner_control_request = function(id, command, input) {
	let loaded = scanner_state_load(id);
	if (!loaded.ok) return loaded;
	if (command != 'stop') return error('EINPUT', 'Only stop control is supported.');
	let loadedControl = scanner_control_load(id), old = loadedControl.control;
	if (old.stopRequested === true) {
		if (!object(input) || (input.expectedRevision != loaded.state.revision && input.expectedRevision != old.revision))
			return error('ECONFLICT', 'Scanner control revision is stale.', { revision: loaded.state.revision });
		return { ok: true, control: old, idempotent: true };
	}
	if (loaded.state.status != 'running' && loaded.state.status != 'idle') {
		let terminal = { id, revision: (integer(old.revision) ? old.revision : 0) + 1, stopRequested: true, updatedAt: time(), terminal: true };
		let expected = loadedControl.present ? old.revision : -1;
		let publishedTerminal = publish_revision(id, '.control.json', terminal, expected);
		if (publishedTerminal) return { ok: true, control: terminal, result: loaded.state, idempotent: true };
		let retry = scanner_control_load(id);
		if (retry.ok && retry.control.stopRequested === true) return { ok: true, control: retry.control, result: loaded.state, idempotent: true };
		return error('ECONFLICT', 'Scanner terminal control changed.');
	}
	if (!object(input) || input.expectedRevision != loaded.state.revision)
		return error('ECONFLICT', 'Scanner control revision is stale.', { revision: loaded.state.revision });
	let control = { id, revision: (integer(old.revision) ? old.revision : 0) + 1, stopRequested: true, updatedAt: time() };
	let expected = loadedControl.present ? old.revision : -1;
	if (publish_revision(id, '.control.json', control, expected)) {
		if (!publish_cancel(id)) return error('EDEPENDENCY', 'Scanner cancellation token could not be published.');
		return { ok: true, control };
	}
	let retry = scanner_control_load(id);
	if (retry.ok && retry.control.stopRequested === true) return { ok: true, control: retry.control, idempotent: true };
	return error('ECONFLICT', 'Scanner control revision is stale.');
};

export const scanner_state_claim = function(id, identity, continuation) {
	if (!safe_id(id) || !object(identity) || !integer(identity.pid) || !integer(identity.startTime)) return error('EINPUT', 'Scanner worker identity is invalid.');
	let active = test_mode() ? read_json(path('', ACTIVE)) : native_read('', ACTIVE), availableRevision = null;
	if (active != null) {
		if (active.absent === true || active.released === true) { availableRevision = integer(active.revision) ? active.revision : null; active = null; }
	}
	if (active != null) {
		if (!safe_id(active.id) || !integer(active.pid) || !integer(active.startTime)) return error('EIO', 'Scanner active marker is malformed.');
		if ((test_mode() && active.pid == identity.pid && active.startTime == identity.startTime) || live_identity(active.pid, active.startTime)) {
			if (continuation === true && active.id == id && active.pid == identity.pid && active.startTime == identity.startTime) return { ok: true, continued: true };
			return error('EBUSY', 'Another Scanner is active.');
		}
		let staleDigest = test_mode() ? null : native_digest('', ACTIVE);
		if (!test_mode() && !staleDigest) return error('ESTALE', 'Scanner active marker cannot be reclaimed without a verified digest.');
		active._staleDigest = staleDigest;
	}
	let marker = { id, pid: identity.pid, startTime: identity.startTime, claimedAt: time(), revision: availableRevision != null ? availableRevision + 1 : (active != null && integer(active.revision) ? active.revision + 1 : 1) };
	let expected = availableRevision != null ? availableRevision : (active != null && integer(active.revision) ? active.revision : -1);
	let published = publish_revision('', ACTIVE, marker, expected);
	return published ? { ok: true } : error('EBUSY', 'Scanner active marker could not be claimed.');
};

export const scanner_state_release = function(id, identity) {
	let active = test_mode() ? read_json(path('', ACTIVE)) : native_read('', ACTIVE);
	if (active == null) return { ok: true };
	if (active.absent === true || active.released === true) return { ok: true, idempotent: true };
	if (active.id != id || active.pid != identity?.pid || active.startTime != identity?.startTime) return error('ESTALE', 'Scanner active marker identity changed.');
	if (!test_mode()) {
		if (!integer(active.revision)) return error('EDEPENDENCY', 'Scanner active marker revision is unavailable.');
		return publish_revision('', ACTIVE, { absent: true, releasedAt: time(), revision: active.revision + 1 }, active.revision)
			? { ok: true, retained: true } : error('EDEPENDENCY', 'Scanner active marker release is uncertain.');
	}
	try { unlink(path('', ACTIVE)); } catch (e) { return error('EIO', 'Scanner active marker could not be removed.'); }
	try { unlink(path(id, '.cancel')); } catch (e) { }
	return { ok: true };
};
