'use strict';

// Data is a leaf of the existing Z2K Core candidate.  This module owns only
// bounded validation and publication of data bytes; release/lifecycle/Registry
// authority remains in the existing Core modules.
import { popen, unlink, writefile, rename, mkdir, rmdir, readfile, stat } from 'fs';
import { z2k_release_valid } from './z2k-release.uc';
import { asset_registry_list } from './asset-registry.uc';
import { z2k_registry_receipt_state } from './z2k-installed-release.uc';
import * as runtime_composition from './runtime-composition.uc';
import { z2k_detect_status } from './z2k-detect.uc';

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
function unchanged_failed(code, message, details) { let result = { ok: false, state: 'unchanged', error: { code: code, message: message } }; if (details != null) result.error.details = details; return result; }
function rollback_failed(message, cleanup, details) {
	let result = { ok: false, state: 'uncertain', error: { code: 'EROLLBACK_FAILED', message: message, details: { rollback: cleanup } } };
	if (details != null) for (let key in details) result.error.details[key] = details[key];
	return result;
}
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return value; } }
function production_fs() {
	return {
		mkdir: function(path) { return mkdir(path); }, writefile: function(path, value) { return writefile(path, value); },
		readfile: function(path) { return readfile(path); }, stat: function(path) { return stat(path); },
		unlink: function(path) { return unlink(path); }, rmdir: function(path) { return rmdir(path); },
		rename: function(from, to) { return rename(from, to); }
	};
}
function filesystem(seams) { return object(seams) && object(seams.fs) ? seams.fs : production_fs(); }
function fs_failure(code, message) { return { ok: false, error: { code: code, message: message } }; }
function fs_fault(value) { return object(value) && value.__fs_error === true; }
function fs_mkdir(fs, path) {
	try {
		let result = fs.mkdir(path);
		if (fs_fault(result) || result === false) return fs_failure('EFS_MKDIR', 'filesystem directory creation failed');
		return { ok: true };
	} catch (e) { return fs_failure('EFS_MKDIR', 'filesystem directory creation failed'); }
}
function fs_write(fs, path, value) {
	try {
		let result = fs.writefile(path, value);
		if (fs_fault(result) || result === false) return fs_failure('EFS_WRITE', 'filesystem write failed');
		return { ok: true };
	} catch (e) { return fs_failure('EFS_WRITE', 'filesystem write failed'); }
}
function fs_read(fs, path) {
	try {
		let result = fs.readfile(path);
		if (fs_fault(result) || result == null) return fs_failure('EFS_READ', 'filesystem read could not be proven');
		return { ok: true, value: result };
	} catch (e) { return fs_failure('EFS_READ', 'filesystem read could not be proven'); }
}
function fs_stat(fs, path) {
	try {
		let result = fs.stat(path);
		if (fs_fault(result)) return fs_failure('EFS_STAT', 'filesystem stat could not be proven');
		if (result == null) return { ok: true, exists: false };
		return { ok: true, exists: true, value: result };
	} catch (e) { return fs_failure('EFS_STAT', 'filesystem stat could not be proven'); }
}
function fs_unlink(fs, path) {
	let before = fs_stat(fs, path);
	if (!before.ok) return before;
	if (!before.exists) return { ok: true, absent: true };
	try {
		let result = fs.unlink(path);
		if (fs_fault(result) || result === false) return fs_failure('EFS_UNLINK', 'filesystem unlink failed');
	} catch (e) { return fs_failure('EFS_UNLINK', 'filesystem unlink failed'); }
	let after = fs_stat(fs, path);
	if (!after.ok) return after;
	return after.exists ? fs_failure('EFS_UNLINK_VERIFY', 'filesystem unlink could not be proven') : { ok: true, absent: true };
}
function fs_rmdir(fs, path) {
	let before = fs_stat(fs, path);
	if (!before.ok) return before;
	if (!before.exists) return { ok: true, absent: true };
	try {
		let result = fs.rmdir(path);
		if (fs_fault(result) || result === false) return fs_failure('EFS_RMDIR', 'filesystem directory removal failed');
	} catch (e) { return fs_failure('EFS_RMDIR', 'filesystem directory removal failed'); }
	let after = fs_stat(fs, path);
	if (!after.ok) return after;
	return after.exists ? fs_failure('EFS_RMDIR_VERIFY', 'filesystem directory removal could not be proven') : { ok: true, absent: true };
}
function fs_rename(fs, from, to) {
	try {
		let result = fs.rename(from, to);
		if (fs_fault(result) || result === false) return fs_failure('EFS_RENAME', 'filesystem rename failed');
		return { ok: true };
	} catch (e) { return fs_failure('EFS_RENAME', 'filesystem rename failed'); }
}
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
function owner_data_identity(value) {
	if (!object(value)) return null;
	if (valid_digest(value.releaseDataIdentity)) return value.releaseDataIdentity;
	if (object(value.activationEvidence) && valid_digest(value.activationEvidence.releaseDataIdentity)) return value.activationEvidence.releaseDataIdentity;
	if (object(value.authority) && valid_digest(value.authority.releaseDataIdentity)) return value.authority.releaseDataIdentity;
	if (object(value.runtime) && valid_digest(value.runtime.releaseDataIdentity)) return value.runtime.releaseDataIdentity;
	if (object(value.installed) && valid_digest(value.installed.releaseDataIdentity)) return value.installed.releaseDataIdentity;
	return null;
}
function internal_authority(seams) {
	let hooks = object(seams) ? seams : {};
	if (type(hooks.owners) == 'function') {
		try {
			let value = hooks.owners();
			return object(value) ? value : fail('EAUTHORITY', 'authoritative lifecycle owners returned no identity');
		} catch (e) { return fail('EAUTHORITY', 'authoritative lifecycle owners could not be read'); }
	}
	let listed = null, receiptState = null, runtime = null, detect = null;
	try {
		listed = asset_registry_list(null);
		if (!object(listed) || listed.ok !== true) return fail('EAUTHORITY', 'Asset Registry authority is unavailable');
		receiptState = z2k_registry_receipt_state(listed);
		if (!object(receiptState) || receiptState.state != 'COHERENT_VERIFIED' || !object(receiptState.receipt)) return fail('EAUTHORITY', 'coherent activation receipt is unavailable');
		runtime = runtime_composition.resolveInstalled({ registry: listed, receipt: receiptState.receipt });
		detect = z2k_detect_status({ registry: function() { return listed; } });
	} catch (e) { return fail('EAUTHORITY', 'authoritative lifecycle owner read failed'); }
	if (!object(runtime) || runtime.ok !== true || runtime.coherenceStatus != 'coherent' || !object(detect) || detect.ok !== true || detect.coherent !== true) return fail('EAUTHORITY', 'authoritative runtime or Detect identity is unavailable');
	let receipt = receiptState.receipt, release = receipt.release || receipt.version, sourceCommit = lc(receipt.sourceCommit);
	let receiptIdentity = owner_data_identity(receipt), registryIdentity = owner_data_identity(listed), runtimeIdentity = owner_data_identity(runtime), detectIdentity = owner_data_identity(detect);
	if (!valid_digest(receiptIdentity) || !valid_digest(registryIdentity) || !valid_digest(runtimeIdentity) || !valid_digest(detectIdentity)
		|| receiptIdentity != registryIdentity || receiptIdentity != runtimeIdentity || receiptIdentity != detectIdentity) return fail('EAUTHORITY', 'authoritative release-owned data identity is unavailable or incoherent');
	let runtimeOwner = object(runtime.authority) ? runtime.authority : {}, detectRelease = detect.installed && detect.installed.release, detectSource = detect.installed && detect.installed.sourceCommit;
	if (!z2k_release_valid(release) || !valid_commit(sourceCommit) || (runtimeOwner.release != null && runtimeOwner.release != release)
		|| (runtimeOwner.sourceCommit != null && lc(runtimeOwner.sourceCommit) != sourceCommit) || detectRelease != release || lc(detectSource) != sourceCommit) return fail('EAUTHORITY', 'authoritative release/source identity is incoherent');
	return { ok: true, coherent: true,
		receipt: { schema: receipt.schema, release: release, sourceCommit: sourceCommit, releaseDataIdentity: receiptIdentity },
		registry: { ok: true, release: release, sourceCommit: sourceCommit, releaseDataIdentity: registryIdentity },
		runtime: { coherent: true, release: release, sourceCommit: sourceCommit, releaseDataIdentity: runtimeIdentity },
		detect: { coherent: true, release: release, sourceCommit: sourceCommit, releaseDataIdentity: detectIdentity } };
}
function coherence_gate(input, identity, authority) {
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

function remove_unpublished_revision(manifest, root, hooks, fs) {
	if (type(hooks.cleanup) == 'function') return hooks.cleanup(manifest, root);
	if (!string(root)) return { ok: true };
	let first = null, result = null;
	for (let entry in manifest.entries || []) {
		result = fs_unlink(fs, root + '/' + entry.path);
		if (!result.ok && first == null) first = result;
	}
	result = fs_unlink(fs, root + '/manifest.json');
	if (!result.ok && first == null) first = result;
	result = fs_rmdir(fs, root + '/release');
	if (!result.ok && first == null) first = result;
	result = fs_rmdir(fs, root + '/dynamic');
	if (!result.ok && first == null) first = result;
	result = fs_rmdir(fs, root);
	if (!result.ok && first == null) first = result;
	return first == null ? { ok: true } : fail('EROLLBACK_FAILED', 'unpublished dataset revision could not be removed', { cause: first });
}

function stage_abort(manifest, root, fs, message) {
	let cleanup = remove_unpublished_revision(manifest, root, {}, fs);
	if (!object(cleanup) || cleanup.ok !== true) return rollback_failed('data staging failed and cleanup could not be proven', cleanup, { stage: root });
	return unchanged_failed('EIO', message);
}
function internal_stage(identity, fs) {
	let manifest = dataset_manifest(identity), root = DATA_REVISION_ROOT + '.stage-' + time() + '-' + (++sequence);
	if (!manifest.ok) return manifest;
	let made = fs_mkdir(fs, DATA_ROOT);
	if (!made.ok) return stage_abort(manifest, root, fs, 'data staging directory could not be created');
	made = fs_mkdir(fs, DATA_REVISION_ROOT);
	if (!made.ok) return stage_abort(manifest, root, fs, 'data staging directory could not be created');
	made = fs_mkdir(fs, root);
	if (!made.ok) return stage_abort(manifest, root, fs, 'data staging directory could not be created');
	made = fs_mkdir(fs, root + '/release');
	if (!made.ok) return stage_abort(manifest, root, fs, 'data staging directory could not be created');
	made = fs_mkdir(fs, root + '/dynamic');
	if (!made.ok) return stage_abort(manifest, root, fs, 'data staging directory could not be created');
	for (let row in identity.releaseOwned) {
		let written = fs_write(fs, root + '/release/' + row.path, row.content);
		if (!written.ok) return stage_abort(manifest, root, fs, 'release-owned data staging failed');
	}
	for (let row in identity.dynamic) {
		let written = fs_write(fs, root + '/dynamic/' + row.id + '.json', sprintf('%J', row));
		if (!written.ok) return stage_abort(manifest, root, fs, 'dynamic data staging failed');
	}
	let written = fs_write(fs, root + '/manifest.json', sprintf('%J', manifest));
	if (!written.ok) return stage_abort(manifest, root, fs, 'dataset manifest staging failed');
	return { ok: true, root: root, manifest: manifest };
}
function pointer_snapshot(fs) {
	let pointer = fs_stat(fs, DATA_CURRENT);
	if (!pointer.ok) return pointer;
	if (!pointer.exists) return { ok: true, exists: false, content: null };
	let content = fs_read(fs, DATA_CURRENT);
	if (!content.ok) return content;
	return { ok: true, exists: true, content: content.value };
}
function restore_pointer(fs, snapshot) {
	if (!object(snapshot) || snapshot.ok !== true) return fail('EROLLBACK_FAILED', 'pointer snapshot was not proven');
	let current = fs_stat(fs, DATA_CURRENT);
	if (!current.ok) return current;
	let currentContent = null;
	if (current.exists) {
		let content = fs_read(fs, DATA_CURRENT);
		if (!content.ok) return content;
		currentContent = content.value;
	}
	if (snapshot.exists && current.exists && currentContent == snapshot.content) return { ok: true };
	if (!snapshot.exists && !current.exists) return { ok: true };
	if (!snapshot.exists) {
		let removed = fs_unlink(fs, DATA_CURRENT);
		return removed.ok ? { ok: true } : removed;
	}
	let restore = DATA_CURRENT + '.restore-' + time() + '-' + (++sequence);
	let written = fs_write(fs, restore, snapshot.content);
	if (!written.ok) return written;
	let renamed = fs_rename(fs, restore, DATA_CURRENT);
	if (!renamed.ok) {
		let removed = fs_unlink(fs, restore);
		return removed.ok ? renamed : fail('EROLLBACK_FAILED', 'pointer restore cleanup could not be proven', { cause: renamed, cleanup: removed });
	}
	let leftover = fs_stat(fs, restore);
	if (!leftover.ok) return leftover;
	if (leftover.exists) return fail('EROLLBACK_FAILED', 'pointer restore left a temporary file');
	let restored = fs_stat(fs, DATA_CURRENT);
	if (!restored.ok) return restored;
	if (!restored.exists) return fail('EROLLBACK_FAILED', 'pointer restore did not recreate the pointer');
	let content = fs_read(fs, DATA_CURRENT);
	if (!content.ok) return content;
	return content.value == snapshot.content ? { ok: true } : fail('EROLLBACK_FAILED', 'pointer restore content could not be proven');
}
function internal_publish(staged, identity, hooks) {
	let manifest = staged.manifest || dataset_manifest(identity);
	if (!manifest.ok) return manifest;
	let fs = filesystem(hooks), previousPointer = pointer_snapshot(fs);
	if (!previousPointer.ok) return rollback_failed('dataset pointer snapshot could not be proven', previousPointer, { boundary: DATA_CURRENT });
	let committed = null, finalRoot = DATA_REVISION_ROOT + manifest.revision;
	if (type(hooks.commit) == 'function') committed = hooks.commit(manifest, staged);
	else {
		let promoted = fs_rename(fs, staged.root, finalRoot);
		if (!promoted.ok) {
			let cleanup = remove_unpublished_revision(manifest, staged.root, hooks, fs);
			if (!object(cleanup) || cleanup.ok !== true) return rollback_failed('dataset revision rename failed and staging cleanup could not be proven', cleanup, { cause: promoted });
			return unchanged_failed('EWRITE', 'dataset revision rename failed');
		}
		let pointer = DATA_CURRENT + '.stage-' + time() + '-' + (++sequence);
		let pointerValue = fs_write(fs, pointer, sprintf('%J', { schema: 1, revision: manifest.revision, root: finalRoot, release: manifest.release, coreIdentity: manifest.coreIdentity, dynamicIdentity: manifest.dynamicIdentity }));
		if (!pointerValue.ok) {
			let pointerRemoved = fs_unlink(fs, pointer), cleanup = remove_unpublished_revision(manifest, finalRoot, hooks, fs), restored = restore_pointer(fs, previousPointer);
			if (!pointerRemoved.ok || !object(cleanup) || cleanup.ok !== true || !object(restored) || restored.ok !== true) return rollback_failed('dataset pointer failed and rollback could not be proven', cleanup, { pointerRemoved: pointerRemoved, restored: restored, cause: pointerValue });
			return unchanged_failed('EWRITE', 'dataset pointer staging failed');
		}
		let pointerCommit = fs_rename(fs, pointer, DATA_CURRENT);
		committed = pointerCommit.ok ? { ok: true, revision: manifest.revision } : null;
		if (committed == null) {
			let pointerRemoved = fs_unlink(fs, pointer), cleanup = remove_unpublished_revision(manifest, finalRoot, hooks, fs), restored = restore_pointer(fs, previousPointer);
			if (!pointerRemoved.ok || !object(cleanup) || cleanup.ok !== true || !object(restored) || restored.ok !== true) return rollback_failed('dataset pointer commit failed and rollback could not be proven', cleanup, { pointerRemoved: pointerRemoved, restored: restored, cause: pointerCommit });
			return unchanged_failed('EWRITE', 'dataset pointer commit failed');
		}
	}
	if (!object(committed) || committed.ok !== true) {
		let cleanup = remove_unpublished_revision(manifest, staged.root, hooks, fs);
		if (!object(cleanup) || cleanup.ok !== true) return rollback_failed('dataset commit failed and compensation failed', cleanup);
		return committed && committed.error ? { ok: false, state: 'unchanged', error: committed.error } : fail('EWRITE', 'dataset commit failed', { state: 'unchanged' });
	}
	return { ok: true, published: true, revision: committed.revision || manifest.revision, manifest: manifest };
}
export const z2k_data_publish = function(identity, seams) {
	if (!object(identity)) return fail('EINPUT', 'dataset identity is required');
	let hooks = object(seams) ? seams : {}, staged = { ok: true, root: null, manifest: dataset_manifest(identity) };
	if (type(hooks.commit) != 'function') staged = internal_stage(identity, filesystem(hooks));
	if (!staged.ok) return staged;
	return internal_publish(staged, identity, hooks);
};

export const z2k_data_refresh = function(input, seams) {
	if (!object(input)) return fail('EINPUT', 'data refresh request is invalid');
	if (input.authority != null) return fail('EAUTHORITY', 'caller-supplied authority is not accepted');
	let identity = z2k_data_identity(input);
	if (!identity.ok) return identity;
	let hooks = object(seams) ? seams : {}, authority = internal_authority(hooks);
	if (!object(authority) || authority.ok !== true) return authority && authority.error ? authority : fail('EAUTHORITY', 'authoritative lifecycle identity is unavailable');
	let coherent = coherence_gate(input, identity, authority);
	if (!coherent.ok) return coherent;
	let fs = filesystem(hooks), stage = type(hooks.stage) == 'function' ? hooks.stage : function(value) { return internal_stage(value, fs); }, publish = type(hooks.publish) == 'function' ? hooks.publish : function(staged, value) { return internal_publish(staged, value, hooks); };
	for (let row in identity.releaseOwned) if (!publication_valid(row, false)) return fail('ESAFETY', 'release-owned publication path is unsafe');
	for (let row in identity.dynamic) if (!publication_valid({ path: row.id + '.json' }, true)) return fail('ESAFETY', 'dynamic publication path is unsafe');
	let staged = stage(copy(identity));
	if (!object(staged) || staged.ok !== true || !string(staged.root)) return fail('EIO', 'data staging failed');
	let committed = publish(staged, copy(identity));
	if (!object(committed) || committed.ok !== true) return committed && committed.error ? committed : fail('EWRITE', 'data publication failed');
	return { ok: true, coreIdentity: identity.coreIdentity, dynamicIdentity: identity.dynamicIdentity, published: committed.published === true };
};
