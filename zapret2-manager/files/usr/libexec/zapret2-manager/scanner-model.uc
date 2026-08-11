'use strict';

const MAX_TARGET = 253;
const MAX_DPI = 64;
const MAX_STATUS_TEXT = 256;
const REQUEST_FIELDS = { target: true, protocol: true, mode: true, resume: true, dpi_type: true };

function is_object(value) { return type(value) == 'object' && value != null; }
function is_string(value) { return type(value) == 'string'; }

function error_result(code, message, path) {
	let result = { ok: false, error: { code: code, message: message } };
	if (path != null) result.error.path = path;
	return result;
}

function lower(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1);
	}
	return result;
}

function copy_value(value) {
	if (type(value) == 'array') {
		let result = [];
		for (let i in value) push(result, copy_value(value[i]));
		return result;
	}
	if (is_object(value)) {
		let result = {};
		for (let key in value) result[key] = copy_value(value[key]);
		return result;
	}
	return value;
}

function valid_label(label) {
	if (length(label) < 1 || length(label) > 63
		|| substr(label, 0, 1) == '-' || substr(label, -1) == '-') return false;
	for (let i = 0; i < length(label); i++) {
		let code = ord(substr(label, i, 1));
		if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code == 45)) return false;
	}
	return true;
}

function normalize_hostname(value) {
	if (!is_string(value)) return null;
	let host = lower(trim(value));
	if (substr(host, -1) == '.') host = substr(host, 0, -1);
	if (length(host) < 1 || length(host) > MAX_TARGET || index(host, ':') >= 0
		|| match(host, /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)) return null;
	let labels = split(host, '.');
	if (length(labels) < 2) return null;
	for (let i in labels) if (!valid_label(labels[i])) return null;
	return host;
}

function valid_dpi(value) {
	return match(value, /^[a-z0-9][a-z0-9_-]{0,63}$/);
}

function request_fields_valid(input) {
	for (let key in input) if (!REQUEST_FIELDS[key]) return false;
	return true;
}

export const scanner_request_validate = function(input) {
	if (!is_object(input) || !request_fields_valid(input))
		return error_result('EINPUT', 'Scanner request is an object with only public fields.');

	let target = normalize_hostname(input.target);
	if (target == null) return error_result('EINPUT', 'Scanner target must be a strict hostname.', 'target');

	let protocol = input.protocol == null ? 'tcp' : lower(trim('' + input.protocol));
	if (protocol != 'tcp' && protocol != 'udp')
		return error_result('EINPUT', 'Scanner protocol must be tcp or udp.', 'protocol');

	let mode = input.mode == null ? 'quick' : lower(trim('' + input.mode));
	if (mode != 'quick' && mode != 'standard' && mode != 'full')
		return error_result('EINPUT', 'Scanner mode must be quick, standard, or full.', 'mode');

	let resume = input.resume == null ? false : input.resume;
	if (type(resume) != 'bool') return error_result('EINPUT', 'Scanner resume must be boolean.', 'resume');

	let dpi = input.dpi_type;
	if (dpi == null) dpi = null;
	else {
		if (!is_string(dpi)) return error_result('EINPUT', 'Scanner dpi_type must be bounded text.', 'dpi_type');
		dpi = lower(trim(dpi));
		if (dpi == '') dpi = null;
		else if (length(dpi) > MAX_DPI || !valid_dpi(dpi))
			return error_result('EINPUT', 'Scanner dpi_type has invalid bounded syntax.', 'dpi_type');
	}

	return { ok: true, value: {
		target: target, protocol: protocol, mode: mode, resume: resume, dpi_type: dpi
	} };
};

function recovery_state(value) {
	if (!is_object(value) || !is_string(value.state)) return null;
	return value.state;
}

function state_error(message) { return error_result('ESTATE', message); }

function terminal_valid(record) {
	if (!is_object(record)) return false;
	let status = record.status;
	let recovery = recovery_state(record.recovery);
	if (status == 'cancelled' && recovery == 'uncertain') return false;
	if (status == 'completed' || status == 'cancelled') return recovery == 'verified';
	if (status == 'error') return recovery == 'uncertain';
	return true;
}

export const scanner_state_create = function(request, plan) {
	let candidates = is_object(plan) && type(plan.candidates) == 'array' ? plan.candidates : [];
	return {
		schema: 1,
		request: copy_value(request),
		plan: copy_value(plan),
		status: 'idle',
		phase: 'idle',
		progress: 0,
		total: length(candidates),
		currentCandidate: null,
		counts: { working: 0, failed: 0, infrastructure: 0 },
		results: [],
		baselineOpen: false,
		baselineByAddressFamily: {},
		elapsedSeconds: 0,
		error: null,
		recovery: { state: 'not_required' },
		cancellationRequested: false,
	};
};

function event_recovery(event, fallback) {
	let nested = is_object(event) ? recovery_state(event.recovery) : null;
	if (nested != null) return nested;
	if (is_object(event) && is_string(event.recoveryState)) return event.recoveryState;
	return fallback;
}

export const scanner_state_transition = function(record, event) {
	if (!is_object(record) || !terminal_valid(record)) return state_error('Scanner record has an illegal terminal state.');
	if (!is_object(event) || !is_string(event.type)) return state_error('Scanner state event is invalid.');
	if (record.status != 'idle' && record.status != 'running') return state_error('Scanner state is already terminal.');

	let next = copy_value(record), kind = event.type;
	if (record.status == 'idle') {
		if (kind != 'start') return state_error('Only start is legal from idle.');
		next.status = 'running';
		next.phase = 'validating';
		return { ok: true, state: next };
	}

	if (kind == 'progress') {
		if (type(event.progress) == 'int' && event.progress >= 0) next.progress = event.progress;
		if (type(event.total) == 'int' && event.total >= 0) next.total = event.total;
		if (is_string(event.phase) && length(event.phase) <= MAX_STATUS_TEXT) next.phase = event.phase;
		if (is_string(event.currentCandidate) && length(event.currentCandidate) <= MAX_STATUS_TEXT)
			next.currentCandidate = event.currentCandidate;
		return { ok: true, state: next };
	}

	if (kind == 'complete' || kind == 'cancel' || kind == 'stop') {
		let recovery = event_recovery(event, 'verified');
		if (kind == 'complete') {
			if (recovery != 'verified') {
				next.status = 'error';
				next.phase = 'recovery';
				next.recovery = { state: 'uncertain' };
				next.error = 'Scanner completion recovery is uncertain.';
				return { ok: true, state: next };
			}
			next.status = 'completed';
			next.phase = 'completed';
			next.recovery = { state: 'verified' };
		} else if (recovery != 'verified') {
			next.status = 'error';
			next.phase = 'recovery';
			next.recovery = { state: 'uncertain' };
			next.error = 'Scanner cancellation recovery is uncertain.';
		} else if (recovery == 'verified') {
			next.status = 'cancelled';
			next.phase = 'cancelled';
			next.recovery = { state: 'verified' };
		} else return state_error('Cancelled Scanner state requires verified recovery.');
		return { ok: true, state: next };
	}

	if (kind == 'error') {
		next.status = 'error';
		next.phase = 'error';
		next.recovery = { state: 'uncertain' };
		if (is_string(event.message) && length(event.message) <= MAX_STATUS_TEXT) next.error = event.message;
		return { ok: true, state: next };
	}

	return state_error('Scanner state event is not legal from running.');
};

function bounded_text(value) {
	if (!is_string(value)) return null;
	return length(value) > MAX_STATUS_TEXT ? substr(value, 0, MAX_STATUS_TEXT) : value;
}

function count_value(counts, name) {
	return is_object(counts) && type(counts[name]) == 'int' && counts[name] >= 0 ? counts[name] : 0;
}

export const scanner_status_view = function(record) {
	let counts = is_object(record) ? record.counts : {};
	let working = count_value(counts, 'working');
	let failed = count_value(counts, 'failed');
	let totalDone = working + failed;
	let successRate = totalDone > 0 ? working * 100 / totalDone : 0;
	let request = is_object(record) && is_object(record.request) ? record.request : {};
	let recovery = is_object(record) && is_object(record.recovery) ? record.recovery : { state: 'not_required' };
	return {
		status: record && record.status != null ? record.status : 'idle',
		progress: record && type(record.progress) == 'int' && record.progress >= 0 ? record.progress : 0,
		total: record && type(record.total) == 'int' && record.total >= 0 ? record.total : 0,
		phase: bounded_text(record && record.phase) || 'idle',
		current_strategy: bounded_text(record && record.currentCandidate),
		target: bounded_text(request.target),
		protocol: request.protocol == 'udp' ? 'udp' : 'tcp',
		mode: request.mode == 'standard' || request.mode == 'full' ? request.mode : 'quick',
		error: bounded_text(record && record.error),
		working_count: working,
		failed_count: failed,
		infrastructure_count: count_value(counts, 'infrastructure'),
		success_rate: successRate,
		elapsed_seconds: record && (type(record.elapsedSeconds) == 'int' || type(record.elapsedSeconds) == 'double') ? record.elapsedSeconds : 0,
		baseline_open: record && record.baselineOpen == true,
		baseline_by_af: copy_value(record && record.baselineByAddressFamily || {}),
		recovery: { state: recovery.state == 'uncertain' ? 'uncertain' : recovery.state == 'verified' ? 'verified' : 'not_required' },
	};
};
