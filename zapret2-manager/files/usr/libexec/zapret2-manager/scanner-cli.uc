'use strict';

// Compatibility entry point for older callers. Detection authority is typed
// z2k-detect only; this shell never imports or falls back to the retired
// Manager-owned scanner implementation.
import { stat, readlink, readfile } from 'fs';
import { z2k_detect_status, z2k_detect_probe, z2k_detect_classify, z2k_detect_quic,
	z2k_detect_voice, z2k_detect_tcp16, z2k_detect_discovery_status, z2k_detect_discovery_control } from './z2k-detect.uc';

const SCHEMA_VERSION = 2;
const REQUEST_ROOT = '/tmp/zapret2-manager/runtime/requests/';
const MAX_REQUEST_BYTES = 65536;
const ACTIONS = { probe: true, classify: true, quic: true, voice: true, tcp16: true };

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function result(code, message, extra) { let out = { schemaVersion: SCHEMA_VERSION, ok: false, error: { code: code, message: message } }; for (let key in extra || {}) out[key] = extra[key]; return out; }
function response(value) { if (object(value) && value.schemaVersion == null) value.schemaVersion = SCHEMA_VERSION; return value; }
function request_file(path) {
	if (!string(path) || length(path) < length(REQUEST_ROOT) || length(path) > length(REQUEST_ROOT) + 128
		|| substr(path, 0, length(REQUEST_ROOT)) != REQUEST_ROOT || index(path, '..') >= 0
		|| !match(substr(path, length(REQUEST_ROOT)), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)) return result('EINPUT', 'Private request path is invalid.');
	let root = null, metadata = null, before = null, after = null, raw = null;
	try { root = stat(substr(REQUEST_ROOT, 0, length(REQUEST_ROOT) - 1)); metadata = stat(path); before = stat(path); raw = readfile(path); after = stat(path); } catch (e) { return result('EINPUT', 'Private Detect request file is unavailable.'); }
	if (!object(root) || root.type != 'directory' || readlink(substr(REQUEST_ROOT, 0, length(REQUEST_ROOT) - 1)) != null
		|| root.uid != 0 || root.gid != 0 || root.mode % 512 != 448
		|| readlink(path) != null || !object(metadata) || metadata.type != 'file' || metadata.uid != 0 || metadata.gid != 0
		|| metadata.mode % 512 != 384 || metadata.size < 0 || metadata.size > MAX_REQUEST_BYTES
		|| before.inode != after.inode || before.size != after.size || length(raw) != before.size) return result('EINPUT', 'Private Detect request file identity is unsafe.');
	try { return json(raw); } catch (e) { return result('EINPUT', 'Private Detect request JSON is malformed.'); }
}
function actionResult(action, input) {
	if (!ACTIONS[action]) return result('EINPUT', 'Unknown typed Detect action.');
	if (!object(input)) return result('EINPUT', 'Typed Detect request is required.');
	if (action == 'probe') return z2k_detect_probe(input);
	if (action == 'classify') return z2k_detect_classify(input);
	if (action == 'quic') return z2k_detect_quic(input);
	if (action == 'voice') return z2k_detect_voice(input);
	return z2k_detect_tcp16(input);
}
function dispatch(command, input) {
	if (command == 'status') return z2k_detect_status();
	if (command == 'discovery-status') return z2k_detect_discovery_status();
	if (command == 'discovery-enable' || command == 'discovery-disable' || command == 'discovery-restart')
		return z2k_detect_discovery_control(replace(command, 'discovery-', ''), input || {});
	if (command == 'start' || command == 'run') {
		let action = object(input) && string(input.action) ? input.action : 'probe';
		return actionResult(action, object(input) && object(input.request) ? input.request : input);
	}
	return actionResult(command, input);
}

export const scanner_cli_dispatch = function(command, input) { return response(dispatch(command, input)); };
export const scanner_cli_request = function(command, requestPath) {
	let input = request_file(requestPath);
	return input && input.ok === false && input.error ? response(input) : response(dispatch(command, input));
};
