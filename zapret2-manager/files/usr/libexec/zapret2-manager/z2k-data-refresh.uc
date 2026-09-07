'use strict';

// Data is a leaf of the existing Z2K Core candidate.  This module owns only
// bounded validation and publication of data bytes; release/lifecycle/Registry
// authority remains in the existing Core modules.
import { popen, unlink, writefile, rename, mkdir, readfile } from 'fs';
import { z2k_release_valid } from './z2k-release.uc';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 65536;
const DATA_ROOT = '/opt/zapret2/state/z2k-data/';
const DATA_REVISION_ROOT = DATA_ROOT + 'revisions/';
const DATA_CURRENT = DATA_ROOT + 'current.json';
let sequence = 0;

function object(value) { return type(value) == 'object' && value != null && type(value) != 'array'; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function fail(code, message, details) { let result = { ok: false, error: { code: code, message: message } }; if (details != null) result.error.details = details; return result; }
function rollback_failed(message, cleanup, details) {
	let result = { ok: false, state: 'uncertain', error: { code: 'EROLLBACK_FAILED', message: message, details: { rollback: cleanup } } };
	if (details != null) for (let key in details) result.error.details[key] = details[key];
	return result;
}
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return value; } }
function canonical(value) {
	if (value == null || string(value) || type(value) == 'int' || type(value) == 'double' || type(value) == 'bool') return sprintf('%J', value);
	if (array(value)) { let parts = []; for (let item in value) push(parts, canonical(item)); return '[' + join(',', parts) + ']'; }
	if (object(value)) { let names = keys(value); sort(names); let parts = []; for (let name in names) push(parts, sprintf('%J', name) + ':' + canonical(value[name])); return '{' + join(',', parts) + '}'; }
	return sprintf('%J', text(value));
}
function digest(value) {
	let path = '/tmp/z2m-data-refresh.' + time() + '.' + (++sequence), process = null, result = null;
	try { if (!writefile(path, text(value))) return null; process = popen("sha256sum '" + path + "' 2>/dev/null | awk '{print $1}'", 'r'); if (process) result = trim(process.read('all') || ''); if (process) process.close(); } catch (e) { result = null; }
	try { unlink(path); } catch (e) {}
	return string(result) && match(result, /^[a-f0-9]{64}$/) ? result : null;
}
function safe_name(value) { return string(value) && length(value) > 0 && length(value) <= 128 && match(value, /^[A-Za-z0-9._-]+$/) && index(value, '..') < 0; }
function release_rows(rows) {
	if (!array(rows) || length(rows) > MAX_ROWS) return fail('EINPUT', 'release-owned data rows are invalid');
	let normalized = [];
	for (let row in rows) {
		if (!object(row) || !safe_name(row.path) || !string(row.content) || length(row.content) > MAX_BYTES) return fail('EINPUT', 'release-owned data entry is invalid');
		push(normalized, { path: row.path, content: row.content });
	}
	sort(normalized, function(a, b) { return a.path == b.path ? 0 : (a.path < b.path ? -1 : 1); });
	return { ok: true, value: normalized };
}
function dynamic_rows(rows) {
	if (!array(rows) || length(rows) > 64) return fail('EINPUT', 'dynamic data rows are invalid');
	let normalized = [];
	for (let row in rows) {
		if (!object(row) || !safe_name(row.id) || row.schema !== 1 || !array(row.entries) || length(row.entries) > MAX_ROWS || (type(row.revision) != 'int' && !string(row.revision))) return fail('ESCHEMA', 'dynamic dataset schema is invalid');
		for (let entry in row.entries) if (!string(entry) || length(entry) > 512) return fail('ESCHEMA', 'dynamic dataset entry is invalid');
		push(normalized, { id: row.id, schema: 1, revision: row.revision, entries: row.entries });
	}
	sort(normalized, function(a, b) { return a.id == b.id ? 0 : (a.id < b.id ? -1 : 1); });
	return { ok: true, value: normalized };
}

export const z2k_data_identity = function(input) {
	if (!object(input) || !string(input.release)) return fail('EINPUT', 'release identity is required');
	let release = release_rows(input.releaseOwned), dynamic = dynamic_rows(input.dynamic);
	if (!release.ok) return release;
	if (!dynamic.ok) return dynamic;
	let releaseIdentity = digest('z2k-release-data-v1\n' + canonical({ release: input.release, rows: release.value }) + '\n');
	let dynamicIdentity = digest('z2k-dynamic-data-v1\n' + canonical(dynamic.value) + '\n');
	if (releaseIdentity == null || dynamicIdentity == null) return fail('EIO', 'data identity digest unavailable');
	return { ok: true, release: input.release, releaseOwned: release.value, dynamic: dynamic.value,
		releaseIdentity: releaseIdentity, dynamicIdentity: dynamicIdentity, coreIdentity: releaseIdentity };
};
export const z2k_data_refresh_identity = z2k_data_identity;

function publication_path(row, dynamic) { return (dynamic ? 'dynamic/' : 'release/') + row.path; }
function publication_valid(row, dynamic) { return object(row) && safe_name(row.path) && index(publication_path(row, dynamic), dynamic ? 'dynamic/' : 'release/') == 0; }
function coherence_gate(input, identity) {
	let authority = input.authority;
	if (!object(authority)) return fail('EAUTHORITY', 'authoritative receipt, Registry, runtime, and Detect identity are required');
	if (authority.ok !== true || authority.coherent !== true) return fail('EZ2K_INCOHERENT', 'Z2K Core authority is not coherent');
	if (!z2k_release_valid(input.release) || !valid_commit(input.sourceCommit)) return fail('EAUTHORITY', 'submitted release/source identity is incomplete');
	let required = ['receipt', 'registry', 'runtime', 'detect'];
	for (let name in required) {
		let key = string(name) ? name : required[name], part = authority[key];
		if (!object(part)) return fail('EAUTHORITY', 'authoritative ' + key + ' identity is missing');
		if (part.release != input.release || part.sourceCommit != lc(input.sourceCommit)) return fail('ECOMPATIBILITY', key + ' identity does not match the submitted Core release');
		if (!valid_digest(part.releaseDataIdentity) || part.releaseDataIdentity != identity.coreIdentity) return fail('ECOMPATIBILITY', key + ' identity does not match release-owned data');
	}
	if (authority.receipt.schema != 'asset-activation-receipt.v3' || authority.registry.ok !== true || authority.runtime.coherent !== true || authority.detect.coherent !== true) return fail('EZ2K_INCOHERENT', 'authoritative identity is incomplete or legacy');
	if (authority.detect.sourceCommit != lc(input.sourceCommit)) return fail('EDETECT_INCOMPATIBLE', 'Detect identity does not match the submitted Core release');
	if (input.currentCoreIdentity != null && input.currentCoreIdentity != identity.coreIdentity) return fail('ECONFLICT', 'data refresh was prepared from a stale Core identity');
	return { ok: true };
}

function dataset_manifest(identity) {
	let entries = [];
	for (let row in identity.releaseOwned) push(entries, { kind: 'release-owned', path: publication_path(row, false), content: row.content });
	for (let row in identity.dynamic) push(entries, { kind: 'dynamic', path: publication_path({ path: row.id + '.json' }, true), content: sprintf('%J', row), revision: row.revision });
	sort(entries, function(a, b) { return a.path == b.path ? 0 : (a.path < b.path ? -1 : 1); });
	let revision = digest('z2k-dataset-v1\n' + canonical({ release: identity.release, coreIdentity: identity.coreIdentity, dynamicIdentity: identity.dynamicIdentity, entries: entries }) + '\n');
	if (revision == null) return fail('EIO', 'dataset revision digest unavailable');
	return { ok: true, schema: 1, revision: revision, release: identity.release, coreIdentity: identity.coreIdentity, dynamicIdentity: identity.dynamicIdentity, entries: entries };
}
export const z2k_data_dataset_manifest = function(identity) { return object(identity) ? dataset_manifest(identity) : fail('EINPUT', 'dataset identity is required'); };

function internal_stage(identity) {
	let root = DATA_REVISION_ROOT + '.stage-' + time() + '-' + (++sequence);
	try { mkdir(DATA_ROOT); mkdir(DATA_REVISION_ROOT); mkdir(root); mkdir(root + '/release'); mkdir(root + '/dynamic'); } catch (e) { return fail('EIO', 'data staging directory could not be created'); }
	for (let row in identity.releaseOwned) if (!writefile(root + '/release/' + row.path, row.content)) return fail('EIO', 'release-owned data staging failed');
	for (let row in identity.dynamic) if (!writefile(root + '/dynamic/' + row.id + '.json', sprintf('%J', row))) return fail('EIO', 'dynamic data staging failed');
	let manifest = dataset_manifest(identity);
	if (!manifest.ok || !writefile(root + '/manifest.json', sprintf('%J', manifest))) return fail('EIO', 'dataset manifest staging failed');
	return { ok: true, root: root, manifest: manifest };
}
function remove_unpublished_revision(manifest, root, hooks) {
	if (type(hooks.cleanup) == 'function') return hooks.cleanup(manifest, root);
	return { ok: true };
}
function unlink_checked(path) {
	try { return unlink(path) !== false; } catch (e) { return false; }
}
function internal_publish(staged, identity, hooks) {
	let manifest = staged.manifest || dataset_manifest(identity);
	if (!manifest.ok) return manifest;
	let committed = null, finalRoot = DATA_REVISION_ROOT + manifest.revision;
	if (type(hooks.commit) == 'function') committed = hooks.commit(manifest, staged);
	else {
		try { if (!rename(staged.root, finalRoot)) return fail('EWRITE', 'dataset revision rename failed', { state: 'unchanged' }); } catch (e) { return fail('EWRITE', 'dataset revision rename failed', { state: 'unchanged' }); }
		let pointer = DATA_CURRENT + '.stage-' + time() + '-' + (++sequence);
		if (!writefile(pointer, sprintf('%J', { schema: 1, revision: manifest.revision, root: finalRoot, release: manifest.release, coreIdentity: manifest.coreIdentity, dynamicIdentity: manifest.dynamicIdentity }))) {
			let cleanup = remove_unpublished_revision(manifest, finalRoot, hooks);
			if (!unlink_checked(pointer) || !object(cleanup) || cleanup.ok !== true) return rollback_failed('dataset pointer failed and revision cleanup failed', cleanup);
			return fail('EWRITE', 'dataset pointer staging failed', { state: 'unchanged' });
		}
		try { committed = rename(pointer, DATA_CURRENT) === false ? null : { ok: true, revision: manifest.revision }; } catch (e) { committed = null; }
		if (committed == null) {
			let pointerRemoved = unlink_checked(pointer);
			let cleanup = remove_unpublished_revision(manifest, finalRoot, hooks);
			if (!pointerRemoved || !object(cleanup) || cleanup.ok !== true) return rollback_failed('dataset pointer commit failed and revision cleanup failed', cleanup, { pointerRemoved: pointerRemoved });
			return fail('EWRITE', 'dataset pointer commit failed', { state: 'unchanged' });
		}
	}
	if (!object(committed) || committed.ok !== true) {
		let cleanup = remove_unpublished_revision(manifest, staged.root, hooks);
		if (!object(cleanup) || cleanup.ok !== true) return rollback_failed('dataset commit failed and compensation failed', cleanup);
		return committed && committed.error ? { ok: false, state: 'unchanged', error: committed.error } : fail('EWRITE', 'dataset commit failed', { state: 'unchanged' });
	}
	return { ok: true, published: true, revision: committed.revision || manifest.revision, manifest: manifest };
}
export const z2k_data_publish = function(identity, seams) {
	if (!object(identity)) return fail('EINPUT', 'dataset identity is required');
	let hooks = object(seams) ? seams : {}, staged = { ok: true, root: null, manifest: dataset_manifest(identity) };
	if (type(hooks.commit) != 'function') staged = internal_stage(identity);
	if (!staged.ok) return staged;
	return internal_publish(staged, identity, hooks);
};

export const z2k_data_refresh = function(input, seams) {
	if (!object(input)) return fail('EINPUT', 'data refresh request is invalid');
	let identity = z2k_data_identity(input);
	if (!identity.ok) return identity;
	let coherent = coherence_gate(input, identity);
	if (!coherent.ok) return coherent;
	let hooks = object(seams) ? seams : {}, stage = type(hooks.stage) == 'function' ? hooks.stage : internal_stage, publish = type(hooks.publish) == 'function' ? hooks.publish : function(staged, value) { return internal_publish(staged, value, hooks); };
	for (let row in identity.releaseOwned) if (!publication_valid(row, false)) return fail('ESAFETY', 'release-owned publication path is unsafe');
	for (let row in identity.dynamic) if (!publication_valid({ path: row.id + '.json' }, true)) return fail('ESAFETY', 'dynamic publication path is unsafe');
	let staged = stage(copy(identity));
	if (!object(staged) || staged.ok !== true || !string(staged.root)) return fail('EIO', 'data staging failed');
	let committed = publish(staged, copy(identity));
	if (!object(committed) || committed.ok !== true) return committed && committed.error ? committed : fail('EWRITE', 'data publication failed');
	return { ok: true, coreIdentity: identity.coreIdentity, dynamicIdentity: identity.dynamicIdentity, published: committed.published === true };
};
