#!/usr/bin/ucode
'use strict';

import { stat, readlink, readfile } from 'fs';
import * as state from './scanner-state.uc';
import { scanner_worker_run, scanner_worker_resume } from './scanner-worker.uc';

const COMMANDS = { start: true, status: true, results: true, stop: true, resume: true, 'save-generated': true };
const MAX_REQUEST_BYTES = 65536;
const MAX_OUTPUT_BYTES = 131072;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function safe_id(value) { return string(value) && match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/); }
function result(code, message, extra) { let out = { ok: false, error: { code, message } }; for (let key in extra || {}) out[key] = extra[key]; return out; }
function request_file(path) {
	if (!string(path) || length(path) < 1 || length(path) > 256 || index(path, '..') >= 0 || index(path, '\n') >= 0) return result('EINPUT', 'Private request path is invalid.');
	let link = null, metadata = null, before = null, after = null, raw = null;
	try { link = readlink(path); metadata = stat(path); before = stat(path); raw = readfile(path); after = stat(path); } catch (e) { return result('EINPUT', 'Private request file is unavailable.'); }
	if (link != null || !object(metadata) || metadata.type != 'file' || metadata.size < 0 || metadata.size > MAX_REQUEST_BYTES
		|| before.inode != after.inode || before.size != after.size || length(raw) != before.size) return result('EINPUT', 'Private request file identity is unsafe.');
	try { return json(raw); } catch (e) { return result('EINPUT', 'Private request JSON is malformed.'); }
}
function bounded(value) {
	try { let raw = sprintf('%J', value); return length(raw) <= MAX_OUTPUT_BYTES ? value : result('EOUTPUT', 'Scanner response exceeds the safe bound.'); } catch (e) { return result('EOUTPUT', 'Scanner response is not serializable.'); }
}
function dispatch(command, input, seams) {
	if (!COMMANDS[command]) return result('EINPUT', 'Unknown Scanner command.');
	if (command == 'status' || command == 'results') {
		if (!object(input) || !safe_id(input.id)) return result('EINPUT', 'Scanner id is required.');
		let loaded = state.scanner_state_load(input.id);
		if (!loaded.ok) return loaded;
		if (command == 'results') return bounded({ ok: true, id: input.id, results: loaded.state.results, status: loaded.state.status, progress: loaded.state.progress, total: loaded.state.total });
		return bounded({ ok: true, id: input.id, status: loaded.state.status, phase: loaded.state.phase, progress: loaded.state.progress, total: loaded.state.total, currentCandidate: loaded.state.currentCandidate, counts: loaded.state.counts, recovery: loaded.state.recovery, error: loaded.state.error, heartbeatAt: loaded.state.heartbeatAt });
	}
	if (command == 'stop') {
		if (!object(input) || !safe_id(input.id)) return result('EINPUT', 'Scanner id is required.');
		return state.scanner_control_request(input.id, 'stop', input);
	}
	if (command == 'save-generated') return result('EAPPLY', 'Generated Strategies are not persisted by Scanner Task 6.');
	if (!object(input) || !object(input.request)) return result('EINPUT', 'Scanner request is required.');
	if (command == 'resume') return scanner_worker_resume(input, seams);
	return scanner_worker_run({ id: input.id, request: checked.value }, seams);
}

export const scanner_cli_dispatch = function(command, input, seams) { return dispatch(command, input, seams); };
export const scanner_cli_request = function(command, requestPath) {
	let input = command == 'status' || command == 'results' || command == 'stop' ? request_file(requestPath) : request_file(requestPath);
	return input && input.ok === false && input.error ? input : dispatch(command, input, null);
};

if (ARGV[0] != null) {
	let output = scanner_cli_request(ARGV[0], ARGV[1]);
	print(sprintf('%J', bounded(output)));
}
