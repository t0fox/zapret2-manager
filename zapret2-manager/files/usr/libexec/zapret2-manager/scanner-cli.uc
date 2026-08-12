'use strict';

import { stat, readlink, readfile } from 'fs';
import * as state from './scanner-state.uc';
import { scanner_worker_run, scanner_worker_resume } from './scanner-worker.uc';

const COMMANDS = { start: true, status: true, results: true, stop: true, resume: true, 'save-generated': true };
const MAX_REQUEST_BYTES = 65536;
const MAX_OUTPUT_BYTES = 131072;
const SCHEMA_VERSION = 1;
const REQUEST_ROOT = '/tmp/zapret2-manager/runtime/requests/';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function safe_id(value) { return string(value) && match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/); }
function result(code, message, extra) { let out = { schemaVersion: SCHEMA_VERSION, ok: false, error: { code, message } }; for (let key in extra || {}) out[key] = extra[key]; return out; }
function response(value) {
	if (object(value) && value.schemaVersion == null) value.schemaVersion = SCHEMA_VERSION;
	return value;
}
function request_file(path) {
	if (!string(path) || length(path) < length(REQUEST_ROOT) || length(path) > length(REQUEST_ROOT) + 128
		|| substr(path, 0, length(REQUEST_ROOT)) != REQUEST_ROOT || index(path, '..') >= 0
		|| !match(substr(path, length(REQUEST_ROOT)), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\.json$/)) return result('EINPUT', 'Private request path is invalid.');
	let link = null, metadata = null, before = null, after = null, raw = null, requestRoot = null;
	try { requestRoot = stat(substr(REQUEST_ROOT, 0, length(REQUEST_ROOT) - 1)); link = readlink(path); metadata = stat(path); before = stat(path); raw = readfile(path); after = stat(path); } catch (e) { return result('EINPUT', 'Private request file is unavailable.'); }
	if (!object(requestRoot) || requestRoot.type != 'directory' || readlink(substr(REQUEST_ROOT, 0, length(REQUEST_ROOT) - 1)) != null
		|| requestRoot.uid != 0 || requestRoot.gid != 0 || requestRoot.mode % 512 != 448) return result('EINPUT', 'Private request directory is unsafe.');
	if (link != null || !object(metadata) || metadata.type != 'file' || metadata.uid != 0 || metadata.gid != 0 || metadata.mode % 512 != 384 || metadata.size < 0 || metadata.size > MAX_REQUEST_BYTES
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
		if (command == 'results') return bounded(response({ ok: true, id: input.id, results: loaded.state.results, status: loaded.state.status, progress: loaded.state.progress, total: loaded.state.total }));
		return bounded(response({ ok: true, id: input.id, status: loaded.state.status, phase: loaded.state.phase, progress: loaded.state.progress, total: loaded.state.total, currentCandidate: loaded.state.currentCandidate, counts: loaded.state.counts, recovery: loaded.state.recovery, error: loaded.state.error, heartbeatAt: loaded.state.heartbeatAt }));
	}
	if (command == 'stop') {
		if (!object(input) || !safe_id(input.id)) return result('EINPUT', 'Scanner id is required.');
		return state.scanner_control_request(input.id, 'stop', input);
	}
	if (command == 'save-generated') return result('EAPPLY', 'Generated Strategies are not persisted by Scanner Task 6.');
	if (!object(input) || !object(input.request)) return result('EINPUT', 'Scanner request is required.');
	if (command == 'resume') return scanner_worker_resume(input, seams);
	let checked = input.request;
	return scanner_worker_run({ id: input.id, request: checked }, seams);
}

export const scanner_cli_dispatch = function(command, input, seams) { return response(dispatch(command, input, seams)); };
export const scanner_cli_request = function(command, requestPath) {
	let input = command == 'status' || command == 'results' || command == 'stop' ? request_file(requestPath) : request_file(requestPath);
	return input && input.ok === false && input.error ? response(input) : response(dispatch(command, input, null));
};

if (ARGV[0] != null) {
	let output = scanner_cli_request(ARGV[0], ARGV[1]);
	print(sprintf('%J', bounded(output)));
}
