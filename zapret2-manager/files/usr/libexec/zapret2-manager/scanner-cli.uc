'use strict';

import { stat, readlink, readfile } from 'fs';
import * as state from './scanner-state.uc';
import { scanner_worker_run, scanner_worker_resume } from './scanner-worker.uc';
import { scanner_report_from_record, scanner_save_generated_validate } from './scanner-results.uc';
import { strategy_user_create } from './strategy-state.uc';

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
	try { requestRoot = stat(substr(REQUEST_ROOT, 0, length(REQUEST_ROOT) - 1)); } catch (e) { return result('EINPUT', 'Private request directory is unavailable.'); }
	if (!object(requestRoot) || requestRoot.type != 'directory' || readlink(substr(REQUEST_ROOT, 0, length(REQUEST_ROOT) - 1)) != null
		|| requestRoot.uid != 0 || requestRoot.gid != 0 || requestRoot.mode % 512 != 448) return result('EINPUT', 'Private request directory is unsafe.');
	let ancestors = ['/tmp/zapret2-manager', '/tmp/zapret2-manager/runtime', '/tmp/zapret2-manager/runtime/requests'];
	for (let parent in ancestors) {
		let parentStat = null;
		try { parentStat = stat(parent); } catch (e) { return result('EINPUT', 'Private request ancestor is unavailable.'); }
		if (!object(parentStat) || parentStat.type != 'directory' || readlink(parent) != null || parentStat.uid != 0 || parentStat.gid != 0 || parentStat.mode % 512 != 448)
			return result('EINPUT', 'Private request ancestor is unsafe.');
	}
	try { link = readlink(path); metadata = stat(path); before = stat(path); raw = readfile(path); after = stat(path); } catch (e) { return result('EINPUT', 'Private request file is unavailable.'); }
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
		if (command == 'results') {
			let report = scanner_report_from_record(loaded.state);
			if (!report.ok) return report;
			return bounded(response({ ok: true, id: input.id, report: report.report }));
		}
		return bounded(response({ ok: true, id: input.id, status: loaded.state.status, phase: loaded.state.phase, progress: loaded.state.progress, total: loaded.state.total, currentCandidate: loaded.state.currentCandidate, counts: loaded.state.counts, recovery: loaded.state.recovery, error: loaded.state.error, heartbeatAt: loaded.state.heartbeatAt }));
	}
	if (command == 'stop') {
		if (!object(input) || !safe_id(input.id)) return result('EINPUT', 'Scanner id is required.');
		return state.scanner_control_request(input.id, 'stop', input);
	}
	if (command == 'save-generated') {
		if (!object(input) || !safe_id(input.scanId) || !safe_id(input.candidateId))
			return result('EINPUT', 'scanId and candidateId are required');
		let loaded = state.scanner_state_load(input.scanId);
		if (!loaded.ok) return loaded;
		let rec = loaded.state;
		let cand = null;
		let rows = rec.results || [];
		for (let i = 0; i < length(rows); i++) {
			let r = rows[i];
			if (r.candidateId == input.candidateId || r.identity?.candidate == input.candidateId) { cand = r; break; }
		}
	if (!object(cand)) return result('ENOENT', 'candidate not found in scan results');
	if (cand.success !== true || (cand.saveRequired !== true && cand.identityKind != 'generated'))
		return result('EBOUNDARY', 'only a successful unmatched generated candidate can be saved');
	if (cand.saveRequired !== true && cand.identityKind != 'generated')
		return result('EBOUNDARY', 'catalog and user Strategies use the existing Strategy reference');
	let authority = rec.planAuthority && type(rec.planAuthority.candidates) == 'array' ? rec.planAuthority.candidates : null;
	let bound = null;
	if (authority != null) for (let item in authority)
		if (item.scannerId == cand.candidateId) { bound = item; break; }
	if (!object(bound) || bound.identityKind != 'generated' || bound.saveRequired !== true
		|| sprintf('%J', bound.compiledTokens) != sprintf('%J', cand.compiledTokens)
		|| bound.compiledDigest != cand.compiledDigest || bound.dependencyDigest != cand.dependencyDigest
		|| sprintf('%J', bound.dependencyClosure) != sprintf('%J', cand.dependencyClosure))
		return result('ECONFLICT', 'candidate no longer matches the retained server-owned plan');
    let compiler = { version: rec.compilerDigest };
    let catalog = { version: rec.catalogDigest };
    let deps = cand.dependencyClosure || [];
		let prov = { scanId: input.scanId, candidateId: input.candidateId, generatedAt: time() };
		let validated = scanner_save_generated_validate({ candidate: cand, compiler, catalog, deps, provenance: prov });
		if (!validated.ok) return validated;
	let generated = { id: 'scan-' + input.scanId + '-' + replace(input.candidateId, /[^A-Za-z0-9_-]/g, '-'),
		name: '[Scan] ' + input.candidateId, origin: 'user', is_builtin: false,
		profiles: [{ id: 'p1', args: join(' ', cand.compiledTokens || []), enabled: true }],
		metadata: { source: 'scanner', scanId: input.scanId, candidateId: input.candidateId,
			compilerDigest: rec.compilerDigest, catalogDigest: rec.catalogDigest,
			dependencyClosure: sprintf('%J', cand.dependencyClosure || {}), provenance: sprintf('%J', prov) } };
    let saved = strategy_user_create({ strategy: generated });
    if (!saved.ok) return saved;
    return { ok: true, validated: true, strategy: saved.strategy, payload: validated.savePayload, scanId: input.scanId, candidateId: input.candidateId };
	}
	if (command == 'resume') return scanner_worker_resume(input, seams);
	if (!object(input)) return result('EINPUT', 'Scanner request is required.');
	let checked = object(input.request) ? input.request : input;
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
