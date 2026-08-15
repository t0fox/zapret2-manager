'use strict';

import { stat, readfile, writefile, mkdir, unlink, popen, readlink } from 'fs';
import * as native from './core/native-helper.uc';

const ROOT = '/tmp/zapret2-manager/runtime/scanner';
const MAX_RECORD_BYTES = 98304;
const MAX_RESULTS = 128;
const MAX_EVENTS = 32;
const MAX_TEXT = 256;
const ACTIVE = 'active.json';
const DOUBLE_TAG = '__z2m_double__';
let sequence = 0;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function safe_id(value) { return string(value) && match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/); }
function text(value) { return string(value) ? (length(value) > MAX_TEXT ? substr(value, 0, MAX_TEXT) : value) : null; }
function copy(value) {
	if (type(value) == 'array') { let out = []; for (let item in value) push(out, copy(item)); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = copy(value[key]); return out; }
	return value;
}
function storage_copy(value) {
	if (type(value) == 'double') { let tagged = {}; tagged[DOUBLE_TAG] = sprintf('%J', value); return tagged; }
	if (type(value) == 'array') { let out = []; for (let item in value) push(out, storage_copy(item)); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = storage_copy(value[key]); return out; }
	return value;
}
function restore_storage(value) {
	if (object(value) && length(value) == 1 && type(value[DOUBLE_TAG]) == 'string') return +value[DOUBLE_TAG];
	if (type(value) == 'array') { let out = []; for (let item in value) push(out, restore_storage(item)); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = restore_storage(value[key]); return out; }
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
	return object(metadata) && metadata.type == 'directory' && readlink(root()) == null
		&& (test_mode() || (metadata.uid == 0 && metadata.gid == 0 && metadata.mode % 512 == 448));
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
function restore_plan_authority(value) {
	if (!object(value) || object(value.planAuthority) || !string(value.planAuthorityBlob)) return value;
	try {
		let decoded = json(b64dec(value.planAuthorityBlob));
		if (object(decoded) && type(decoded.candidates) == 'array') value.planAuthority = decoded;
	} catch (e) { }
	return value;
}
function read_json(file) {
	let raw = null;
	try { raw = readfile(file); } catch (e) { return null; }
	if (!string(raw) || length(raw) > MAX_RECORD_BYTES) return null;
	try { let value = json(raw); return object(value) ? restore_plan_authority(restore_storage(value)) : null; } catch (e) { return null; }
}
function native_read(id, suffix) {
	let result = native.read_regular('runtime', native_path(id, suffix), MAX_RECORD_BYTES);
	if (!result.ok) return null;
	try { return restore_plan_authority(restore_storage(json(b64dec(result.data.content)))); } catch (e) { return null; }
}
function native_digest(id, suffix) {
	let result = native.sha256_regular('runtime', native_path(id, suffix), MAX_RECORD_BYTES);
	return result.ok ? result.data.sha256 : null;
}
function publish_json(id, suffix, value, expected) {
	value = storage_copy(value);
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
	value = storage_copy(value);
	if (test_mode()) {
		let current = read_json(path(id, suffix));
		if (revision < 0 ? current != null : (current == null || current.revision != revision)) return false;
		return atomic(path(id, suffix), value);
	}
	let made = native.mkdir_private('runtime', 'scanner', true);
	if (!made.ok) return false;
	if (id != '') { made = native.mkdir_private('runtime', 'scanner/' + id, true); if (!made.ok) return false; }
	let result = native.atomic_write_json_revision('runtime', native_path(id, suffix), value, revision < 0, revision);
	return result.ok;
}
function publish_cancel(id) {
	if (test_mode()) return atomic(path(id, '.cancel'), { id, stopRequested: true, updatedAt: time() });
	return native.atomic_write_json('runtime', native_path(id, '.cancel'), { id, stopRequested: true, updatedAt: time() }, true, null).ok;
}
function read_record(id) { return test_mode() ? read_json(path(id, '.record.json')) : native_read(id, '.record.json'); }
function read_control(id) { return test_mode() ? read_json(path(id, '.control.json')) : native_read(id, '.control.json'); }
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
function request_digest(request) { return hash(sprintf('%J', request)); }
function plan_digest(plan) { return hash(sprintf('%J', { schema: plan?.schema, request: plan?.request, targetProfile: plan?.targetProfile, catalogDigest: plan?.catalogDigest, compilerDigest: plan?.compilerDigest, candidates: plan?.candidates })); }
function result_projection(value) {
	if (!object(value)) return null;
	return {
		candidateId: text(value.candidateId), ordinal: integer(value.ordinal) ? value.ordinal : 0,
		verdict: text(value.verdict) || 'infrastructure', success: value.success == true,
		score: type(value.score) == 'double' || type(value.score) == 'int' ? value.score : null,
		reason: text(value.reason), evidence: object(value.evidence) ? copy(value.evidence) : null,
		planDigest: digest(value.planDigest) ? value.planDigest : null,
		evidenceIdentity: digest(value.evidenceIdentity) ? value.evidenceIdentity : null,
	};
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
		currentCandidate: text(value.currentCandidate), counts: object(value.counts) ? copy(value.counts) : { working: 0, failed: 0, infrastructure: 0 },
		results: bounded_results(value.results), baseline: object(value.baseline) ? copy(value.baseline) : null,
		baselineIdentity: digest(value.baselineIdentity) ? value.baselineIdentity : null,
		baselineExecutorCalls: integer(value.baselineExecutorCalls) ? value.baselineExecutorCalls : 0,
		error: text(value.error), recovery: object(value.recovery) ? copy(value.recovery) : { state: 'not_required' },
		cancellationRequested: value.cancellationRequested == true, worker: object(value.worker) ? copy(value.worker) : null,
		heartbeatAt: integer(value.heartbeatAt) ? value.heartbeatAt : time(), startedAt: integer(value.startedAt) ? value.startedAt : null,
		finishedAt: integer(value.finishedAt) ? value.finishedAt : null, events: bounded_events(value.events),
	};
	if (object(value.planAuthority) && type(value.planAuthority.candidates) == 'array') {
		let serialized = sprintf('%J', value.planAuthority);
		let blob = b64enc(serialized);
		if (string(blob) && length(blob) <= 70000) out.planAuthorityBlob = blob;
	}
	return out;
}
function valid_record(value) {
	return object(value) && value.schema == 1 && safe_id(value.id) && integer(value.revision)
		&& object(value.request) && digest(value.requestDigest) && digest(value.planDigest)
		&& digest(value.catalogDigest) && digest(value.compilerDigest)
		&& index(['idle', 'running', 'completed', 'cancelled', 'error'], value.status) >= 0
		&& type(value.results) == 'array' && length(value.results) <= MAX_RESULTS;
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

export const scanner_state_digest = function(value) { return hash(sprintf('%J', value)); };

export const scanner_state_load = function(id) {
	if (!safe_id(id)) return error('EINPUT', 'Scanner id is invalid.');
	let value = read_record(id);
	return valid_record(value) ? { ok: true, state: value } : error('ENOENT', 'Scanner record is unavailable.');
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
	// Keep the authoritative plan in the in-process save result as well as the
	// bounded persisted blob; resume callers must be able to continue from the
	// same result without depending on a second projection pass.
	let state = copy(candidate);
	if (object(input) && object(input.planAuthority)) state.planAuthority = copy(input.planAuthority);
	return { ok: true, id: candidate.id, revision: candidate.revision, state: state };
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
