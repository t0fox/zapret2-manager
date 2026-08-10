'use strict';

import * as native from './native-helper.uc';
import { result_error, result_ok } from './result.uc';

const ROOT = 'persistent_state';
const PATH = 'manager-state.json';
const MAX_BYTES = 521028;

function exact_fields(value, names) {
	if (type(value) != 'object' || value == null || length(value) != length(names)) return false;
	for (let name in names) if (!exists(value, name)) return false;
	return true;
}

function integer(value) { return type(value) == 'int' && value >= 0; }
function string(value) { return type(value) == 'string'; }
function timestamp(value) {
	return string(value) && match(value,
		/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/);
}
function sha(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function string_array(value) {
	if (type(value) != 'array') return false;
	for (let item in value) if (!string(item)) return false;
	return true;
}

function process_valid(value) {
	return exact_fields(value, ['pid', 'startTime', 'exe', 'argvSha256', 'owner', 'generation']) &&
		integer(value.pid) && integer(value.startTime) && string(value.exe) && length(value.exe) > 0 &&
		substr(value.exe, 0, 1) == '/' && sha(value.argvSha256) && string(value.owner) &&
		length(value.owner) > 0 && integer(value.generation);
}

function namespace_valid(value) {
	return exact_fields(value, ['namespace', 'owner', 'generation', 'acquiredAt', 'process']) &&
		string(value.namespace) && match(value.namespace, /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/) &&
		string(value.owner) && length(value.owner) > 0 && integer(value.generation) &&
		timestamp(value.acquiredAt) && (value.process == null || process_valid(value.process));
}

function rpc_error_valid(value) {
	let fields = ['code', 'message'];
	if (type(value) != 'object' || value == null) return false;
	if (exists(value, 'details')) push(fields, 'details');
	return exact_fields(value, fields) && string(value.code) && length(value.code) > 0 &&
		string(value.message) && length(value.message) > 0 &&
		(!exists(value, 'details') || (type(value.details) == 'object' && value.details != null));
}

function transaction_valid(value) {
	let phases = ['queued', 'validating', 'snapshotting', 'rendering', 'checking', 'installing',
		'activating', 'verifying', 'committing', 'succeeded', 'failed', 'rolling_back', 'rolled_back'];
	return exact_fields(value, ['id', 'kind', 'phase', 'generation', 'namespaces',
		'createdAt', 'updatedAt', 'error']) && string(value.id) && length(value.id) > 0 &&
		string(value.kind) && length(value.kind) > 0 && index(phases, value.phase) >= 0 &&
		integer(value.generation) && string_array(value.namespaces) && timestamp(value.createdAt) &&
		timestamp(value.updatedAt) && (value.error == null || rpc_error_valid(value.error));
}

function job_valid(value) {
	let states = ['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled',
		'rolling_back', 'rolled_back'];
	return exact_fields(value, ['id', 'kind', 'state', 'generation', 'owner', 'createdAt',
		'updatedAt', 'result', 'error']) && string(value.id) && length(value.id) > 0 &&
		string(value.kind) && length(value.kind) > 0 && index(states, value.state) >= 0 &&
		integer(value.generation) && string(value.owner) && length(value.owner) > 0 &&
		timestamp(value.createdAt) && timestamp(value.updatedAt) &&
		(value.result == null || (type(value.result) == 'object' && value.result != null)) &&
		(value.error == null || rpc_error_valid(value.error));
}

function warning_valid(value) {
	return exact_fields(value, ['code', 'message']) && string(value.code) && length(value.code) > 0 &&
		string(value.message) && length(value.message) > 0;
}

function schema_error(message) {
	return { ok: false, error: { code: 'ESCHEMA', message, retryable: false } };
}

export const state_validate = function(value) {
	let services = ['engine_missing', 'running', 'stopped', 'partial', 'error', 'paused', 'passthrough'];
	if (!exact_fields(value, ['schemaVersion', 'generation', 'generatedAt', 'serviceState',
		'runtime', 'transactions', 'jobs', 'warnings']) || value.schemaVersion !== 1 ||
		!integer(value.generation) || !timestamp(value.generatedAt) ||
		index(services, value.serviceState) < 0 ||
		!exact_fields(value.runtime, ['processes', 'namespaces']) ||
		type(value.runtime.processes) != 'array' || type(value.runtime.namespaces) != 'array' ||
		type(value.transactions) != 'array' || type(value.jobs) != 'array' ||
		type(value.warnings) != 'array') return schema_error('Persisted state does not match native backend v1.');
	for (let item in value.runtime.processes) if (!process_valid(item)) return schema_error('Persisted process identity is invalid.');
	for (let item in value.runtime.namespaces) if (!namespace_valid(item)) return schema_error('Persisted namespace ownership is invalid.');
	for (let item in value.transactions) if (!transaction_valid(item)) return schema_error('Persisted transaction is invalid.');
	for (let item in value.jobs) if (!job_valid(item)) return schema_error('Persisted job is invalid.');
	for (let item in value.warnings) if (!warning_valid(item)) return schema_error('Persisted warning is invalid.');
	return { ok: true, state: value };
};

function helper_details(error) { return type(error?.details) == 'object' ? error.details : {}; }
function helper_code(error) { return helper_details(error).helperCode; }
function read_failure(error, generation) {
	return result_error(generation || 0, error?.code || 'EDEPENDENCY',
		error?.message || 'Native state could not be read.', helper_details(error), error?.retryable === true);
}

function decode_read(read) {
	if (!read.ok) return read_failure(read.error, 0);
	let bytes;
	try { bytes = b64dec(read.data.content); } catch (e) {
		return result_error(0, 'ESCHEMA', 'Persisted state encoding is invalid.');
	}
	if (length(bytes) != read.data.byteLength || length(bytes) > MAX_BYTES)
		return result_error(0, 'ESCHEMA', 'Persisted state size is invalid.');
	let value;
	try { value = json(bytes); } catch (e) {
		return result_error(0, 'ESCHEMA', 'Persisted state JSON is invalid.');
	}
	let validated = state_validate(value);
	if (!validated.ok) return result_error(integer(value?.generation) ? value.generation : 0,
		validated.error.code, validated.error.message);
	return result_ok(value.generation, { state: value });
}

export const state_read = function() {
	return decode_read(native.read_regular(ROOT, PATH, MAX_BYTES));
};

function now() {
	let seconds = clock()[0], days = int(seconds / 86400), remain = seconds % 86400;
	let year = 1970;
	function leap(value) { return value % 4 == 0 && (value % 100 != 0 || value % 400 == 0); }
	while (days >= (leap(year) ? 366 : 365)) { days -= leap(year) ? 366 : 365; year++; }
	let months = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	let month = 0;
	while (days >= months[month]) { days -= months[month]; month++; }
	let hour = int(remain / 3600); remain %= 3600;
	return sprintf('%04d-%02d-%02dT%02d:%02d:%02dZ', year, month + 1, days + 1,
		hour, int(remain / 60), remain % 60);
}

function zero_state() {
	return {
		schemaVersion: 1, generation: 0, generatedAt: now(), serviceState: 'stopped',
		runtime: { processes: [], namespaces: [] }, transactions: [], jobs: [], warnings: []
	};
}

function uncertain(error) {
	return error?.commitState == 'unknown' || helper_code(error) == 'ECOMMITUNKNOWN';
}

function public_state(read, reconciled) {
	let data = { state: read.data.state };
	if (reconciled) data.reconciled = true;
	return result_ok(read.generation, data);
}

function reconcile(candidate, previous, write_error) {
	let observed = state_read();
	let details = {
		reconciliation: 'unreadable', helperCode: helper_code(write_error),
		helperStage: helper_details(write_error).helperStage,
		helperDurability: helper_details(write_error).helperDurability,
		transportCommitState: write_error?.commitState
	};
	if (!observed.ok) return result_error(previous?.generation || 0, 'EDEPENDENCY',
		'Native state publication could not be reconciled.', details);
	if (sprintf('%J', observed.data.state) == sprintf('%J', candidate)) return public_state(observed, true);
	if (previous != null && sprintf('%J', observed.data.state) == sprintf('%J', previous)) {
		details.reconciliation = 'previous_visible';
		return result_error(previous.generation, 'EAPPLY', 'Native state publication was not observed.', details);
	}
	details.reconciliation = 'third_state';
	return result_error(observed.generation, 'ECONFLICT', 'Another state was observed after uncertain publication.', details);
}

export const state_initialize = function() {
	let read = state_read();
	if (read.ok) return public_state(read, false);
	if (helper_code(read.error) != 'ENOENT') return read;
	let candidate = zero_state();
	let write = native.atomic_write_json(ROOT, PATH, candidate, true);
	if (write.ok) return result_ok(0, { state: candidate });
	if (write.error?.code == 'ECONFLICT') {
		let winner = state_read();
		return winner.ok ? public_state(winner, false) : winner;
	}
	if (uncertain(write.error)) return reconcile(candidate, null, write.error);
	return read_failure(write.error, 0);
};

export const state_mutate = function(expected_generation, mutation) {
	let read = state_read();
	if (!read.ok) return read;
	let previous = read.data.state;
	if (!integer(expected_generation) || previous.generation != expected_generation)
		return result_error(previous.generation, 'ECONFLICT', 'State generation does not match.',
			{ expectedGeneration: expected_generation });
	if (type(mutation) != 'function')
		return result_error(previous.generation, 'EINPUT', 'State mutation callback is invalid.');
	let candidate = json(sprintf('%J', previous));
	let schema = candidate.schemaVersion, generation = candidate.generation, generated = candidate.generatedAt;
	try { candidate = mutation(candidate); } catch (e) {
		return result_error(previous.generation, 'EINPUT', 'State mutation callback failed.');
	}
	if (type(candidate) != 'object' || candidate == null || candidate.schemaVersion !== schema ||
		candidate.generation !== generation || candidate.generatedAt !== generated)
		return result_error(previous.generation, 'EINPUT', 'State mutation cannot change reserved metadata.');
	candidate.generation = previous.generation + 1;
	candidate.generatedAt = now();
	let valid = state_validate(candidate);
	if (!valid.ok) return result_error(previous.generation, 'ESCHEMA', valid.error.message);
	let digest = native.sha256_regular(ROOT, PATH, MAX_BYTES);
	let expected = digest.ok ? digest.data.sha256 : null;
	if (expected == null) return result_error(previous.generation, 'EDEPENDENCY',
		'Native state CAS identity could not be read.');
	let write = native.atomic_write_json(ROOT, PATH, candidate, false, expected);
	if (write.ok) return result_ok(candidate.generation, { state: candidate });
	if (uncertain(write.error)) return reconcile(candidate, previous, write.error);
	return read_failure(write.error, previous.generation);
};
