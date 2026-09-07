'use strict';

// Typed wire boundary for the canonical z2k_data_refresh RPC.  This module
// accepts data values only; executable names, commands, caller paths and
// environment are never part of the refresh contract.
const MAX_BYTES = 32768;
const MAX_ROWS = 65536;
const TOP_LEVEL = ['release', 'sourceCommit', 'releaseOwned', 'dynamic', 'currentCoreIdentity'];
const FORBIDDEN = ['executable', 'executableName', 'argv', 'command', 'commandLine', 'raw', 'shell', 'shellCommand', 'cwd', 'env', 'environment', 'workingDirectory', 'path', 'callerPath', 'sourcePath'];

function object(value) { return type(value) == 'object' && value != null && type(value) != 'array'; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
function safe_name(value) { return string(value) && length(value) > 0 && length(value) <= 128 && match(value, /^[A-Za-z0-9._-]+$/) && index(value, '..') < 0; }
function has_forbidden(value) {
	if (array(value)) {
		for (let item in value) if (has_forbidden(item)) return true;
		return false;
	}
	if (!object(value)) return false;
	let names = keys(value);
	for (let key in names) {
		let name = string(key) ? key : names[key];
		if (index(FORBIDDEN, name) >= 0 || has_forbidden(value[name])) return true;
	}
	return false;
}
function allowed_top_level(value) {
	let names = keys(value);
	for (let key in names) {
		let name = string(key) ? key : names[key];
		if (index(TOP_LEVEL, name) < 0) return false;
	}
	return true;
}
function request_edit(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return fail('EINPUT', 'missing edit param');
	if (!string(edit)) return fail('EINPUT', 'edit must be a JSON string');
	if (length(edit) > MAX_BYTES) return fail('E2BIG', 'data refresh JSON is too large');
	try {
		let parsed = json(edit);
		if (!object(parsed)) return fail('EINPUT', 'data refresh JSON must be an object');
		return { ok: true, value: parsed };
	} catch (e) { return fail('EINPUT', 'data refresh JSON is malformed'); }
}

export const z2k_data_refresh_input = function(req) {
	let request = request_edit(req);
	if (!request.ok) return request;
	let input = request.value;
	if (!allowed_top_level(input) || has_forbidden(input)) return fail('EINPUT', 'data refresh contains an unsupported field');
	if (!string(input.release) || length(input.release) == 0 || length(input.release) > 64) return fail('EINPUT', 'release must be a bounded string');
	if (!string(input.sourceCommit) || !match(input.sourceCommit, /^[a-fA-F0-9]{40}$/)) return fail('EINPUT', 'sourceCommit must be a commit digest');
	if (input.currentCoreIdentity != null && (!string(input.currentCoreIdentity) || length(input.currentCoreIdentity) > 64)) return fail('EINPUT', 'currentCoreIdentity is invalid');
	if (!array(input.releaseOwned) || length(input.releaseOwned) > 64) return fail('EINPUT', 'releaseOwned must be a bounded array');
	let releaseOwned = [];
	for (let row in input.releaseOwned) {
		if (!object(row) || !safe_name(row.name) || !string(row.content) || length(row.content) > MAX_BYTES) return fail('EINPUT', 'releaseOwned entries require name and content');
		push(releaseOwned, { path: row.name, content: row.content });
	}
	if (!array(input.dynamic) || length(input.dynamic) > 64) return fail('EINPUT', 'dynamic must be a bounded array');
	let dynamic = [];
	for (let row in input.dynamic) {
		if (!object(row) || !safe_name(row.id) || row.schema !== 1 || (type(row.revision) != 'int' && !string(row.revision)) || !array(row.entries) || length(row.entries) > MAX_ROWS) return fail('ESCHEMA', 'dynamic entries have an invalid schema');
		for (let entry in row.entries) if (!string(entry) || length(entry) > 512) return fail('ESCHEMA', 'dynamic entry is invalid');
		push(dynamic, { id: row.id, schema: 1, revision: row.revision, entries: row.entries });
	}
	return { valid: true, value: { release: input.release, sourceCommit: input.sourceCommit, releaseOwned: releaseOwned, dynamic: dynamic, currentCoreIdentity: input.currentCoreIdentity } };
};
