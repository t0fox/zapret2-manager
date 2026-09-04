'use strict';
// Strategy Preview/Validate is a read-only RPC adapter. It resolves identity,
// catalog provenance, and runtime composition on the server, then delegates
// candidate construction to the shared Strategy compiler.

import { readfile, writefile, unlink, stat, readlink, lsdir, popen } from 'fs';
import { strategy_catalog_read_index, strategy_catalog_load, strategy_catalog_get_detail,
 strategy_catalog_status, strategy_catalog_reload, catalog_entry_to_strategy } from './strategy-catalog.uc';
import { strategy_user_list, strategy_user_get_readonly, strategy_duplicate,
 strategy_selection_get, strategy_apply_uncertain_get,
 strategy_apply_uncertain_record, strategy_apply_reconcile, strategy_apply_guard_status, strategy_apply_begin, strategy_apply_end } from './strategy-state.uc';
import * as strategy_state from './strategy-state.uc';
import { load_state } from './profiles-draft.uc';
import { read_var } from './apply.uc';
import { z2m_parse, z2m_validate, z2m_tokenize } from './profiles.uc';
import { avatar_tokenize, strategy_validate as model_validate, strategy_normalize } from './strategy-model.uc';
import { strategy_candidate, strategy_effective_argv } from './strategy-compiler.uc';
import { native_preflight } from './native-preflight.uc';
import { profiles_apply_candidate, profiles_config_hash, profiles_candidate_hash, profiles_candidate_digest, profiles_reconcile_evidence } from './profiles-apply.uc';
import { resolveInstalled } from './runtime-composition.uc';
import { runtime_target_path, runtime_argument_token } from './runtime-asset-paths.uc';
import { discord_autocircular_donor } from './discord-profile.uc';

const DEFAULT_CATALOG_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const ENGINE_PATH = '/opt/zapret2/nfq2/nfqws2';
const CONFIG_LOCK = getenv('Z2M_STRATEGY_CONFIG_LOCK') || '/opt/zapret2/config.lock';
const PROFILE_APPLY_MODULE = getenv('Z2M_STRATEGY_PROFILE_MODULE') || '/usr/libexec/zapret2-manager/profiles-apply.uc';
const STATE_MODULE = getenv('Z2M_STRATEGY_STATE_MODULE') || '/usr/libexec/zapret2-manager/strategy-state.uc';
const UCODE_BIN = getenv('Z2M_STRATEGY_UCODE_BIN') || '/usr/bin/ucode';
const MAX_REQUEST_BYTES = 524288;
const MAX_STRATEGY_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_STRATEGY_LIST_RESPONSE_BYTES = 768 * 1024;
const REQUEST_UID = getenv('Z2M_STRATEGY_REQUEST_UID') || '0';
const REQUEST_GID = getenv('Z2M_STRATEGY_REQUEST_GID') || '0';
const MAX_INLINE_BYTES = 262144;
const MAX_TEXT = 512;
const MAX_DIAGNOSTICS = 32;
const MAX_DEPENDENCIES = 256;
const MAX_OUTPUT_BYTES = 65536;
const MAX_OUTPUT_TEXT = 32768;
// Generated Z2K All-in-One commands can exceed a normal profile's raw args
// limit while still fitting inside the bounded RPC response.
const MAX_EFFECTIVE_COMMAND_TEXT = MAX_OUTPUT_BYTES;
const MAX_OUTPUT_ARG_BYTES = 4096;
const MAX_OUTPUT_ARRAY_ITEMS = 512;
const MAX_DEPENDENCY_TEXT = 256;
const MAX_DEPENDENCY_ITEMS = 32;
const MAX_DEPENDENCY_BYTES = 16384;
const MAX_IMPORT_PROFILES = 256;
const MAX_IMPORT_DIAGNOSTICS = 16;
const MAX_IMPORT_NAME = 256;
// rpcd-mod-ucode may reinitialize this module between calls. Keep one bounded
// Preview candidate in volatile /tmp so the immediately-following Validate can
// run native checks against the exact candidate instead of compiling the same
// large All-in-One command a second time. This is not persistent state or an
// authority: every hit is bound to the current catalog and runtime snapshot.
const STRATEGY_PREVIEW_CACHE_PATH = '/tmp/z2m-strategy-preview-cache.json';
const STRATEGY_PREVIEW_CACHE_SCHEMA = 'z2m.strategy-preview-cache.v1';
const ERROR_CODES = ['EINPUT', 'ENOENT', 'ECONFLICT', 'ESTALE', 'ENOENABLED', 'EDEPENDENCY',
	'EPREFLIGHT', 'EVERIFY', 'EINTERNAL', 'ELOCK', 'EUNCERTAIN', 'ERECONCILE', 'EIO',
	'EOUTPUT', 'ECHILD', 'EUNAVAILABLE'];

function is_object(value) { return type(value) == 'object' && value != null; }
function is_string(value) { return type(value) == 'string'; }
function is_integer(value) { return type(value) == 'int' && value >= 0; }
function starts_with(str, prefix) { return is_string(str) && is_string(prefix) && index(str, prefix) == 0; }
function bounded_text(value, maximum) {
	if (!is_string(value)) return '';
	return length(value) > maximum ? substr(value, 0, maximum) : value;
}
function bounded_identity(value, maximum) {
	return is_string(value) && length(value) <= maximum ? value : null;
}
function digest(value) { return is_string(value) && match(value, /^[a-f0-9]{64}$/); }
function error_code(value) {
	for (let allowed in ERROR_CODES) if (value == allowed) return value;
	return 'EINPUT';
}

function error_result(code, message, extra) {
	let result = { ok: false, error: { code: error_code(code), message: bounded_text(message, MAX_TEXT) } };
	if (is_object(extra)) for (let key in extra) result[key] = extra[key];
	return result;
}

let APPLY_HOOK = null, APPLY_HOOK_LOADED = false, APPLY_HOOK_CURSOR = {};

function apply_hook_value(section, name) {
	if (!APPLY_HOOK_LOADED) {
		APPLY_HOOK_LOADED = true;
		let raw = getenv('Z2M_STRATEGY_APPLY_HOOK');
		if (raw != null && length(raw) <= 65536) try { APPLY_HOOK = json(raw); } catch (e) { APPLY_HOOK = null; }
	}
	let group = is_object(APPLY_HOOK) ? APPLY_HOOK[section] : null;
	if (type(group) == 'array') {
		let cursor = APPLY_HOOK_CURSOR[section + ':' + (name || '__value')];
		if (type(cursor) != 'int') cursor = 0;
		let index = cursor < length(group) ? cursor : length(group) - 1;
		APPLY_HOOK_CURSOR[section + ':' + (name || '__value')] = cursor + 1;
		return index >= 0 ? group[index] : null;
	}
	if (name == null) return group;
	return is_object(group) && group[name] != null ? group[name] : null;
}

function shell_escape(value) {
	let result = "'";
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		result += c == "'" ? "'\\''" : c;
	}
	return result + "'";
}

function runtime_identity_digest(value) {
	if (!is_string(value)) return null;
	let maker = null, path = null;
	try { maker = popen('umask 077; mktemp /tmp/z2m-strategy-runtime-id.XXXXXX 2>/dev/null', 'r'); }
	catch (e) { maker = null; }
	if (!maker) return null;
	path = trim(maker.read('all') || '');
	let makerRc = maker.close();
	if (makerRc != 0 || !match(path, /^\/tmp\/z2m-strategy-runtime-id\.[A-Za-z0-9_-]+$/)) return null;
	try {
		if (!writefile(path, value)) { unlink(path); return null; }
	} catch (e) { try { unlink(path); } catch (ignored) { } return null; }
	let process = null;
	try { process = popen('sha256sum ' + shell_escape(path) + ' 2>/dev/null | awk \'{print $1}\'', 'r'); }
	catch (e) { try { unlink(path); } catch (ignored) { } return null; }
	if (!process) { try { unlink(path); } catch (ignored) { } return null; }
	let output = trim(process.read('all') || ''), rc = process.close();
	try { unlink(path); } catch (ignored) { }
	let fields = split(output, /[ \\t]+/);
	return rc == 0 && length(fields) && digest(fields[0]) ? fields[0] : null;
}

function safe_id(value) {
	return is_string(value) && length(value) > 0 && length(value) <= 128
		&& index(value, chr(0)) < 0 && index(value, '/') < 0 && index(value, '..') < 0;
}
function safe_strategy_id(value) {
	return is_string(value) && length(value) > 0 && length(value) <= 128
		&& index(value, chr(0)) < 0 && index(value, '/') < 0 && index(value, '..') < 0
		&& match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/) && value != '.' && value != '..';
}

function copy_array(value, limit) {
	let result = [];
	if (type(value) != 'array') return result;
	for (let i = 0; i < length(value) && i < limit; i++) push(result, value[i]);
	return result;
}

function bounded_diagnostics(value) {
	let result = [];
	if (type(value) != 'array') return result;
	for (let i = 0; i < length(value) && i < MAX_DIAGNOSTICS && i < 16; i++) {
		let item = value[i];
		if (!is_object(item)) continue;
		push(result, {
			severity: bounded_text(item.severity, 32),
			code: bounded_text(item.code, 64),
			message: bounded_text(item.message, MAX_DEPENDENCY_TEXT),
			tokenIndex: type(item.tokenIndex) == 'int' ? item.tokenIndex : null,
			profileIndex: type(item.profileIndex) == 'int' ? item.profileIndex : null
		});
	}
	return result;
}

function coverage(value) {
	let fields = ['cliSyntax', 'luaLoad', 'luaCompatibility', 'functionExistence',
		'blobExistence', 'runtimeArguments', 'executionPlan'];
	let result = {};
	for (let field in fields)
		result[field] = is_object(value) && is_string(value[field])
			? bounded_text(value[field], 32) : 'not_checked';
	return result;
}

function validation_record(value) {
	let record = is_object(value) ? value : {};
	return {
		status: bounded_text(record.status, 32) || 'unavailable',
		coverage: coverage(record.coverage),
		diagnostics: bounded_diagnostics(record.diagnostics)
	};
}

function dependencies_record(value) {
	let record = is_object(value) ? value : {};
	let items = [], missing = [];
	for (let item in copy_array(record.items, MAX_DEPENDENCY_ITEMS)) {
		if (!is_object(item)) continue;
		push(items, {
			key: bounded_text(item.key, MAX_DEPENDENCY_TEXT), kind: bounded_text(item.kind, 32),
			id: bounded_text(item.id, MAX_DEPENDENCY_TEXT), reference: bounded_text(item.reference, MAX_DEPENDENCY_TEXT),
			available: item.available == true,
			reason: item.available == true ? null : bounded_text(item.reason, MAX_DEPENDENCY_TEXT)
		});
	}
	for (let item in copy_array(record.missing, MAX_DEPENDENCY_ITEMS)) {
		if (!is_object(item)) continue;
		push(missing, {
			key: bounded_text(item.key, MAX_DEPENDENCY_TEXT), kind: bounded_text(item.kind, 32),
			id: bounded_text(item.id, MAX_DEPENDENCY_TEXT), reference: bounded_text(item.reference, MAX_DEPENDENCY_TEXT),
			available: false, reason: bounded_text(item.reason, MAX_DEPENDENCY_TEXT)
		});
	}
	let closure = null;
	if (is_object(record.dependencyClosure)) {
		let source = record.dependencyClosure, closureItems = [], closureMissing = [];
		for (let item in copy_array(source.items, MAX_DEPENDENCY_ITEMS)) {
			if (!is_object(item)) continue;
			push(closureItems, { class: bounded_text(item.class, 32), kind: bounded_text(item.kind, 32),
				reference: bounded_text(item.reference, MAX_DEPENDENCY_TEXT), id: bounded_text(item.id, MAX_DEPENDENCY_TEXT),
				available: item.available == true, owner: bounded_text(item.owner, 64), role: bounded_text(item.role, 64) });
		}
		for (let item in copy_array(source.missing, MAX_DEPENDENCY_ITEMS)) {
			if (!is_object(item)) continue;
			push(closureMissing, { class: bounded_text(item.class, 32), kind: bounded_text(item.kind, 32),
				reference: bounded_text(item.reference, MAX_DEPENDENCY_TEXT), id: bounded_text(item.id, MAX_DEPENDENCY_TEXT),
				available: false, reason: bounded_text(item.reason, MAX_DEPENDENCY_TEXT) });
		}
		closure = { schema: bounded_text(source.schema, 64), available: source.available == true,
			resolution: bounded_text(source.resolution, 32), items: closureItems, missing: closureMissing,
			counts: is_object(source.counts) ? source.counts : {},
			runtimeBundleDigest: digest(source.runtimeBundleDigest) ? source.runtimeBundleDigest : null };
	}
	return {
		available: record.available == true,
		items: items,
		missing: missing,
		structurallyCompilable: record.structurallyCompilable == true,
		nativeValidation: validation_record(record.nativeValidation),
		dependencyClosure: closure,
		runtimeBundleDigest: digest(record.runtimeBundleDigest) ? record.runtimeBundleDigest : null
	};
}

function serialize(value) {
	try { return sprintf('%J', value); } catch (e) { return null; }
}

function bounded_strategy_response(value, label, maximum) {
	let encoded = serialize(value);
	maximum = maximum == null ? MAX_STRATEGY_RESPONSE_BYTES : maximum;
	if (encoded == null || length(encoded) > maximum)
		return error_result('EOUTPUT', label + ' exceeds the safe response bound');
	return value;
}

function bounded_string_array(value) {
	if (type(value) != 'array' || length(value) > MAX_OUTPUT_ARRAY_ITEMS) return null;
	let result = [];
	for (let item in value) {
		if (!is_string(item) || length(item) > MAX_OUTPUT_ARG_BYTES) return null;
		push(result, item);
	}
	return result;
}

function effective_projection(value) {
	if (!is_object(value)) return null;
	let argv = bounded_string_array(value.effectiveArgv);
	if (argv == null || !is_string(value.effectiveCommand)
		|| length(value.effectiveCommand) > MAX_EFFECTIVE_COMMAND_TEXT) return null;
	return {
		effectiveCommand: value.effectiveCommand,
		effectiveArgv: argv,
		fullCommand: value.effectiveCommand,
		fullArgv: copy_array(argv, MAX_OUTPUT_ARRAY_ITEMS)
	};
}

function runtime_inputs_bounded(value) {
	if (!is_object(value)) return false;
	if (value.source != null && (!is_string(value.source) || length(value.source) > MAX_TEXT)) return false;
	for (let key in ['baseArgs', 'luaInit', 'hostlists']) {
		let values = value[key];
		if (type(values) != 'array' || length(values) > MAX_OUTPUT_ARRAY_ITEMS) return false;
		for (let item in values)
			if (!is_string(item) || length(item) > MAX_OUTPUT_ARG_BYTES) return false;
	}
	return true;
}

function runtime_path_root(target, kind) {
	if (kind == 'lua' && starts_with(target, '/opt/zapret2/lua/')) return '/opt/zapret2/lua';
	if (kind == 'blob' && starts_with(target, '/opt/zapret2/files/fake/')) return '/opt/zapret2/files/fake';
	if (kind == 'ipset' && starts_with(target, '/opt/zapret2/ipset/')) return '/opt/zapret2/ipset';
	if ((kind == 'hostlist' || kind == 'list') && starts_with(target, '/opt/zapret2/lists/')) return '/opt/zapret2/lists';
	return null;
}

function runtime_relative_path(target, root) {
	let prefix = root == null ? null : root + '/';
	return prefix != null && starts_with(target, prefix) ? substr(target, length(prefix)) : null;
}

function runtime_asset_descriptor(target, root, entry) {
	let relative = runtime_relative_path(target, root);
	if (!is_string(relative) || !length(relative)) return null;
	let descriptor = { path: relative, root: root, present: stat(target) != null, safe: true,
		runtimeAssetId: is_object(entry) ? entry.id : null };
	if (is_object(entry)) {
		for (let key in ['id', 'kind', 'type', 'owner', 'role', 'sourcePath', 'runtimeTarget', 'contentSha256', 'byteSize'])
			if (entry[key] != null) descriptor[key] = entry[key];
		if (entry.kind == 'blob' && entry.role == 'runtime-generated') descriptor.dependencyClass = 'blob-runtime';
		if (entry.kind == 'blob' && entry.role == 'engine-builtin') descriptor.dependencyClass = 'blob-engine-builtin';
	}
	return descriptor;
}

function runtime_descriptor_set(registry, key, descriptor) {
	if (is_object(registry) && is_string(key) && length(key) && is_object(descriptor)) registry[key] = descriptor;
}

function runtime_blob_aliases(blobs, target, entry, descriptor) {
	let root = runtime_path_root(target, 'blob'), relative = runtime_relative_path(target, root);
	if (relative == null) return;
	let leaf = substr(relative, rindex(relative, '/') + 1), stem = leaf;
	if (length(stem) > 4 && substr(stem, length(stem) - 4) == '.bin') stem = substr(stem, 0, length(stem) - 4);
	runtime_descriptor_set(blobs, leaf, descriptor);
	runtime_descriptor_set(blobs, stem, descriptor);
	if (is_object(entry) && is_string(entry.id) && starts_with(entry.id, 'blob:'))
		runtime_descriptor_set(blobs, substr(entry.id, 5), descriptor);
}

function runtime_list_aliases(lists, entry, target, descriptor) {
	let keys = [entry.runtimeTarget, target], root = descriptor.root, relative = descriptor.path;
	if (root == '/opt/zapret2/lists') {
		push(keys, 'lists/' + relative);
		push(keys, relative);
	} else if (root == '/opt/zapret2/ipset') {
		push(keys, 'ipset/' + relative);
		push(keys, relative);
	}
	for (let key in keys) runtime_descriptor_set(lists, key, descriptor);
}

function runtime_lua_aliases(lua, entry, target, descriptor) {
	let root = descriptor.root, relative = descriptor.path;
	runtime_descriptor_set(lua, entry.runtimeTarget, descriptor);
	runtime_descriptor_set(lua, target, descriptor);
	runtime_descriptor_set(lua, relative, descriptor);
	runtime_descriptor_set(lua, '@lua/' + relative, descriptor);
}

function add_manager_list_binding(lists, reference, target, role) {
	let root = starts_with(target, '/etc/zapret2-manager/lists/') ? '/etc/zapret2-manager/lists' : '/opt/zapret2/lists';
	let descriptor = runtime_asset_descriptor(target, root, { id: role });
	if (descriptor == null) return;
	descriptor.infrastructureRole = role;
	runtime_descriptor_set(lists, reference, descriptor);
	runtime_descriptor_set(lists, target, descriptor);
}

// Project the canonical resolver output into the descriptor shape consumed by
// strategy-compiler.  The resolver remains the only runtime membership
// authority; this function only adds references and never scans or writes a
// second inventory.
function runtime_environment_with_composition(environment, composition) {
	let result = {}, paths = {}, lists = {}, blobs = {}, lua = {};
	for (let key in environment || {}) result[key] = environment[key];
	for (let key in (environment && environment.paths) || {}) paths[key] = environment.paths[key];
	for (let key in (environment && environment.lists) || {}) lists[key] = environment.lists[key];
	for (let key in (environment && environment.blobs) || {}) blobs[key] = environment.blobs[key];
	for (let key in (environment && environment.lua) || {}) lua[key] = environment.lua[key];
	if (!is_object(composition) || type(composition.runtimeAssets) != 'array') {
		result.paths = paths; result.lists = lists; result.blobs = blobs; result.lua = lua;
		return result;
	}
	// These are stable Z2M-owned infrastructure bindings used by the official
	// compiler output but intentionally do not belong to Z2K lifecycle membership.
	add_manager_list_binding(lists, '/runtime-assets/lists/whitelist.txt',
		'/etc/zapret2-manager/lists/whitelist.txt', 'manager-whitelist');
	add_manager_list_binding(lists, '/runtime-assets/lists/discovered-domains.txt',
		'/opt/zapret2/lists/discovered-domains.txt', 'z2k-discovered-domains');
	for (let entry in composition.runtimeAssets) {
		if (!is_object(entry) || !is_string(entry.runtimeTarget) || !is_string(entry.kind)) continue;
		let target = runtime_target_path(entry.runtimeTarget), root = runtime_path_root(target, entry.kind);
		if (target == null || root == null) continue;
		let descriptor = runtime_asset_descriptor(target, root, entry);
		if (descriptor == null) continue;
		if (entry.kind == 'hostlist' || entry.kind == 'ipset') runtime_list_aliases(lists, entry, target, descriptor);
		else if (entry.kind == 'lua') runtime_lua_aliases(lua, entry, target, descriptor);
		else if (entry.kind == 'blob') runtime_blob_aliases(blobs, target, entry, descriptor);
	}
	result.paths = paths; result.lists = lists; result.blobs = blobs; result.lua = lua;
	result.runtimeComposition = composition;
	result.runtimeAssets = composition.runtimeAssets;
	return result;
}

function runtime_snapshot_valid(value) {
	return is_object(value) && value.ok == true && value.lifecycleState == 'installed'
		&& value.compositionStatus == 'canonical' && is_string(value.snapshotId)
		&& is_string(value.compositionSnapshotId) && is_string(value.membershipDigest)
		&& is_integer(value.observedRegistryRevision) && type(value.runtimeAssets) == 'array'
		&& type(value.luaInit) == 'array' && is_object(value.dependencyIndex);
}

function strategy_preview_cache_key(input, catalog, resolved, environment) {
	if (!is_object(input) || !is_string(input.strategy_id) || !is_integer(input.revision)
		|| !digest(input.catalog_digest) || !is_object(catalog) || !is_object(resolved)
		|| !is_object(environment) || !runtime_snapshot_valid(environment.runtimeComposition)) return null;
	let snapshot = environment.runtimeComposition;
	return serialize({ strategyId: input.strategy_id, revision: input.revision,
		catalogDigest: input.catalog_digest, resolvedOrigin: resolved.origin,
		snapshotId: snapshot.snapshotId, compositionSnapshotId: snapshot.compositionSnapshotId,
		membershipDigest: snapshot.membershipDigest,
		observedRegistryRevision: snapshot.observedRegistryRevision });
}

function strategy_preview_cache_put(key, candidate) {
	if (!is_string(key) || !is_object(candidate) || candidate.ok != true) return;
	let encoded = serialize({ schema: STRATEGY_PREVIEW_CACHE_SCHEMA, key: key, candidate: candidate });
	if (!is_string(encoded) || length(encoded) > MAX_INLINE_BYTES) return;
	let temporary = STRATEGY_PREVIEW_CACHE_PATH + '.tmp.' + time();
	try {
		if (!writefile(temporary, encoded + '\n')) { unlink(temporary); return; }
		let moved = popen('mv -f ' + shell_escape(temporary) + ' ' + shell_escape(STRATEGY_PREVIEW_CACHE_PATH) + ' 2>/dev/null', 'r');
		if (!moved || moved.close() != 0) { try { unlink(temporary); } catch (e) { } }
	} catch (e) { try { unlink(temporary); } catch (x) { } }
}

function strategy_preview_cache_get(key) {
	if (!is_string(key)) return null;
	let raw = null;
	try { raw = readfile(STRATEGY_PREVIEW_CACHE_PATH); } catch (e) { raw = null; }
	if (!is_string(raw) || length(raw) > MAX_INLINE_BYTES) return null;
	let envelope = null;
	try { envelope = json(raw); } catch (e) { return null; }
	if (!is_object(envelope) || envelope.schema != STRATEGY_PREVIEW_CACHE_SCHEMA
		|| envelope.key != key || !is_object(envelope.candidate)
		|| envelope.candidate.ok != true) return null;
	let encoded = serialize(envelope.candidate);
	return is_string(encoded) && length(encoded) <= MAX_INLINE_BYTES ? envelope.candidate : null;
}

function runtime_composition_for_apply() {
	let injected = apply_hook_value('runtimeComposition', null);
	if (injected != null) return injected;
	try { return resolveInstalled({}); }
	catch (e) { return error_result('ESTALE', 'installed runtime composition could not be resolved'); }
}

function runtime_snapshot_binding(snapshot) {
	if (!runtime_snapshot_valid(snapshot)) return null;
	let snapshotIdSha256 = runtime_identity_digest(snapshot.snapshotId);
	let compositionSnapshotIdSha256 = runtime_identity_digest(snapshot.compositionSnapshotId);
	let membershipDigestSha256 = runtime_identity_digest(snapshot.membershipDigest);
	if (!digest(snapshotIdSha256) || !digest(compositionSnapshotIdSha256) || !digest(membershipDigestSha256)) return null;
	return { snapshotIdSha256: snapshotIdSha256, compositionSnapshotIdSha256: compositionSnapshotIdSha256,
		membershipDigestSha256: membershipDigestSha256, observedRegistryRevision: snapshot.observedRegistryRevision };
}

function runtime_snapshot_error(value) {
	if (is_object(value) && value.error && value.error.code == 'RECONCILIATION_REQUIRED')
		return error_result('ERECONCILE', 'canonical Z2K runtime composition requires reconciliation');
	return error_result('ESTALE', 'installed runtime composition is unavailable or inconsistent', { resolver: value });
}

function composition_lua_inputs(snapshot) {
	if (!runtime_snapshot_valid(snapshot)) return null;
	let result = [];
	for (let entry in snapshot.luaInit) {
		let path = runtime_target_path(entry.runtimeTarget);
		if (!is_string(path) || !match(path, /\.lua$/)) return null;
		push(result, path);
	}
	return result;
}

function runtime_context_from_environment() {
	if (getenv('Z2M_STRATEGY_SERVER_TEST') != '1') return null;
	let runtime = null, environment = {};
	try { runtime = json(getenv('Z2M_STRATEGY_RUNTIME_INPUTS') || 'null'); } catch (e) { runtime = null; }
	try { environment = json(getenv('Z2M_STRATEGY_RUNTIME_ENVIRONMENT') || '{}'); } catch (e) { environment = {}; }
	if (!runtime_inputs_bounded(runtime) || runtime.source != 'live'
		|| runtime.enginePath != ENGINE_PATH) return error_result('EUNAVAILABLE', 'server runtime composition test evidence is unavailable');
	let composition = null;
	try { composition = json(getenv('Z2M_STRATEGY_RUNTIME_COMPOSITION') || 'null'); } catch (e) { composition = null; }
	if (is_object(environment)) environment = runtime_environment_with_composition(environment, composition);
	if (is_object(environment)) environment.runtimeComposition = composition;
	return { ok: true, environment: is_object(environment) ? environment : {}, runtimeInputs: runtime,
		runtimeComposition: composition };
}

function synthetic_environment_with_inputs(runtimeInputs) {
	let liveBlobs = {}, liveLua = {}, liveFunctions = {
		circular: { present: true }, fake: { present: true }, multidisorder: { present: true },
		multisplit: { present: true }, send: { present: true }, drop: { present: true },
		udplen: { present: true }, hostfakesplit: { present: true }, fakedsplit: { present: true },
		synack: { present: true }, synack_split: { present: true }, pktmod: { present: true },
		z2k_dynamic_ttl: { present: true }, z2k_quic_morph_v2: { present: true },
		z2k_timing_morph: { present: true }, z2k_range_rand: { present: true },
		z2k_nohost_key: { present: true },
		z2k_mid_stream_stall: { present: true }, z2k_http_success_positive_only: { present: true },
		z2k_ipfrag3_tiny: { present: true }, z2k_ipfrag3: { present: true }
	};
	let fakeFiles = [];
	try { fakeFiles = lsdir('/opt/zapret2/files/fake') || []; } catch (e) { fakeFiles = []; }
	for (let fn in fakeFiles) add_live_blob_descriptor(liveBlobs, fn);
	liveBlobs['fake_default_tls'] = { present: true, safe: true };
	liveBlobs['fake_default_http'] = { present: true, safe: true };
	liveBlobs['fake_default_quic'] = { present: true, safe: true };
	liveBlobs['tls_google'] = { path: 'tls_clienthello_www_google_com.bin', present: stat('/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin') != null, safe: true };
	liveBlobs['tls_max_ru'] = { path: 'tls_clienthello_max_ru.bin', present: stat('/opt/zapret2/files/fake/tls_clienthello_max_ru.bin') != null, safe: true };
	liveBlobs['quic_google'] = { path: 'quic_initial_www_google_com.bin', present: stat('/opt/zapret2/files/fake/quic_initial_www_google_com.bin') != null, safe: true };
	liveBlobs['quic_dbankcloud'] = { path: 'quic_initial_dbankcloud_ru.bin', present: stat('/opt/zapret2/files/fake/quic_initial_dbankcloud_ru.bin') != null, safe: true };
	liveBlobs['quic5'] = { path: 'quic_5.bin', present: stat('/opt/zapret2/files/fake/quic_5.bin') != null, safe: true };
	liveBlobs['quic4'] = { path: 'quic_4.bin', present: stat('/opt/zapret2/files/fake/quic_4.bin') != null, safe: true };
	liveBlobs['quic1'] = { path: 'quic_1.bin', present: stat('/opt/zapret2/files/fake/quic_1.bin') != null, safe: true };
	liveBlobs['quic6'] = { path: 'quic_6.bin', present: stat('/opt/zapret2/files/fake/quic_6.bin') != null, safe: true };
	let luaEntries = [];
	try { luaEntries = lsdir('/opt/zapret2/lua') || []; } catch (e) { luaEntries = []; }
	for (let lf in luaEntries)
		if (is_string(lf) && length(lf)) liveLua[lf] = { present: true };
	return { ok: true, environment: {
		listMode: 'none', paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/files/fake', listRoot: '/lists', ipsetRoot: '/lists' },
		functions: liveFunctions, blobs: liveBlobs, lua: liveLua, lists: {}
	}, runtimeInputs: runtimeInputs };
}

function synthetic_runtime_inputs() {
	// Cold-start Preview/Apply must be possible before any nfqws2 instance
	// exists. Synthesize a minimal environment from filesystem inventory
	// (blobs/lua/functions) with empty baseArgs so candidate compilation
	// can proceed without authoritative live composition.
	return synthetic_environment_with_inputs({ source: 'live', enginePath: ENGINE_PATH, baseArgs: [], luaInit: [], hostlists: [] });
}

function add_live_blob_descriptor(blobs, filename) {
	if (!is_object(blobs) || !is_string(filename) || !length(filename)) return;
	blobs[filename] = { path: filename, present: true };
	if (length(filename) > 4 && substr(filename, length(filename) - 4) == '.bin') {
		let stem = substr(filename, 0, length(filename) - 4);
		if (blobs[stem] == null) blobs[stem] = { path: filename, present: true };
	}
}

function live_runtime_inputs() {
	let entries = [], found = [];
	try { entries = lsdir('/proc') || []; } catch (e) { entries = []; }
	for (let name in entries) {
		if (!is_string(name) || !match(name, /^[0-9]+$/)) continue;
		let raw = null;
		try { raw = readfile('/proc/' + name + '/cmdline'); } catch (e) { raw = null; }
		if (!is_string(raw) || !length(raw)) continue;
		let argv = split(raw, chr(0)), cleaned = [];
		for (let value in argv) if (is_string(value) && length(value)) push(cleaned, value);
		if (length(cleaned) && cleaned[0] == ENGINE_PATH) push(found, cleaned);
	}
	if (length(found) != 1) return synthetic_runtime_inputs();
	let applied = null;
	try { applied = read_var('NFQWS2_OPT'); } catch (e) { applied = null; }
	if (!is_string(applied)) return error_result('EUNAVAILABLE', 'authoritative applied Strategy options are unavailable');
	let tokenized = null;
	try { tokenized = z2m_tokenize(applied); } catch (e) { tokenized = null; }
	if (!is_object(tokenized) || type(tokenized.tokens) != 'array') return error_result('EUNAVAILABLE', 'authoritative applied Strategy options are malformed');
	let configured = [];
	for (let token in tokenized.tokens || []) if (is_object(token) && is_string(token.value)) push(configured, token.value);
	let composition = runtime_composition_for_apply();
	if (!runtime_snapshot_valid(composition)) return runtime_snapshot_error(composition);
	let luaInit = composition_lua_inputs(composition), hostlists = [];
	if (luaInit == null) return error_result('ESTALE', 'installed runtime composition Lua closure is invalid');
	let used = [], baseArgs = [];
	for (let i = 0; i < length(configured); i++) used[i] = false;
	for (let i = 1; i < length(found[0]); i++) {
		let matched = -1;
		for (let j = 0; j < length(configured); j++)
			if (!used[j] && configured[j] == found[0][i]) { matched = j; break; }
		if (matched >= 0) used[matched] = true;
		else {
			// Lua-init is owned by the installed runtime composition below. The
			// process argv is only a compatibility observation and may use a
			// different spelling (for example @/path), so never copy Lua-init
			// entries into baseArgs where the canonical closure is authoritative.
			let processArg = found[0][i];
			if (!starts_with(processArg, '--lua-init=')) push(baseArgs, processArg);
		}
	}
	for (let value in configured)
		if (starts_with(value, '--hostlist=')) push(hostlists, substr(value, 11));
	if (length(baseArgs) + length(luaInit) + length(hostlists) == 0 && length(configured) == 0)
		return error_result('EUNAVAILABLE', 'authoritative live nfqws2 composition has no captured runtime inputs');

	let liveBlobs = {}, liveLua = {}, liveFunctions = {
		circular: { present: true }, fake: { present: true }, multidisorder: { present: true },
		multisplit: { present: true }, send: { present: true }, drop: { present: true },
		udplen: { present: true }, hostfakesplit: { present: true }, fakedsplit: { present: true },
		synack: { present: true }, synack_split: { present: true }, pktmod: { present: true },
		z2k_dynamic_ttl: { present: true }, z2k_quic_morph_v2: { present: true },
		z2k_timing_morph: { present: true }, z2k_range_rand: { present: true },
		z2k_nohost_key: { present: true }
	};
	let fakeFiles = [];
	try { fakeFiles = lsdir('/opt/zapret2/files/fake') || []; } catch (e) { fakeFiles = []; }
	for (let fn in fakeFiles) add_live_blob_descriptor(liveBlobs, fn);
	liveBlobs['fake_default_tls'] = { present: true, safe: true };
	liveBlobs['fake_default_http'] = { present: true, safe: true };
	liveBlobs['fake_default_quic'] = { present: true, safe: true };
	liveBlobs['tls_google'] = { path: 'tls_clienthello_www_google_com.bin', present: stat('/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin') != null, safe: true };
	liveBlobs['tls_max_ru'] = { path: 'tls_clienthello_max_ru.bin', present: stat('/opt/zapret2/files/fake/tls_clienthello_max_ru.bin') != null, safe: true };
	liveBlobs['quic_google'] = { path: 'quic_initial_www_google_com.bin', present: stat('/opt/zapret2/files/fake/quic_initial_www_google_com.bin') != null, safe: true };
	liveBlobs['quic_dbankcloud'] = { path: 'quic_initial_dbankcloud_ru.bin', present: stat('/opt/zapret2/files/fake/quic_initial_dbankcloud_ru.bin') != null, safe: true };
	liveBlobs['quic5'] = { path: 'quic_5.bin', present: stat('/opt/zapret2/files/fake/quic_5.bin') != null, safe: true };
	liveBlobs['quic4'] = { path: 'quic_4.bin', present: stat('/opt/zapret2/files/fake/quic_4.bin') != null, safe: true };
	liveBlobs['quic1'] = { path: 'quic_1.bin', present: stat('/opt/zapret2/files/fake/quic_1.bin') != null, safe: true };
	liveBlobs['quic6'] = { path: 'quic_6.bin', present: stat('/opt/zapret2/files/fake/quic_6.bin') != null, safe: true };

	let luaEntries = [];
	try { luaEntries = lsdir('/opt/zapret2/lua') || []; } catch (e) { luaEntries = []; }
	for (let lf in luaEntries)
		if (is_string(lf) && length(lf)) liveLua[lf] = { present: true };
	// Only Lua files actually present in the authoritative nfqws2 --lua-init
	// argv are part of the live function registry. Installed-but-unloaded files
	// are package inventory, not runtime compatibility evidence.
	for (let init in luaInit) {
		if (!is_string(init) || !length(init)) continue;
		let path = starts_with(init, '@') ? substr(init, 1) : init;
		if (!starts_with(path, '/opt/zapret2/lua/') || !match(path, /\.lua$/)) continue;
		let lf = substr(path, length('/opt/zapret2/lua/'));
		if (!length(lf) || liveLua[lf] == null) continue;
		let rawLua = null;
		try { rawLua = readfile(path); } catch (e) { rawLua = null; }
		if (!is_string(rawLua)) continue;
		for (let line in split(rawLua, '\n')) {
			let declaration = trim(line), prefix = 'function ';
			if (starts_with(declaration, 'local function ')) prefix = 'local function ';
			else if (!starts_with(declaration, prefix)) continue;
			let name = substr(declaration, length(prefix)), opening = index(name, '(');
			if (opening >= 1) name = substr(name, 0, opening);
			if (match(name, /^[A-Za-z0-9_]+$/)) liveFunctions[name] = { present: true, source: lf };
		}
	}

	let projectedEnvironment = runtime_environment_with_composition({
		listMode: 'none', paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/files/fake', listRoot: '/lists', ipsetRoot: '/lists' },
		functions: liveFunctions, blobs: liveBlobs, lua: liveLua, lists: {}
	}, composition);
	return { ok: true, runtimeComposition: composition, environment: projectedEnvironment,
		runtimeInputs: { source: 'live', enginePath: ENGINE_PATH, baseArgs: baseArgs, luaInit: luaInit, hostlists: hostlists } };
}

export const strategy_runtime_environment_from_composition = function(environment, composition) {
	return runtime_environment_with_composition(environment, composition);
};

// Scanner production planning uses the same server-owned live composition
// evidence as Strategy preview/validate. Keep this as an internal module
// boundary so Scanner never invents a second runtime inventory.
export const strategy_runtime_environment = function() {
	return live_runtime_inputs();
};

function server_context(context) {
	if (getenv('Z2M_STRATEGY_SERVER_TEST') == '1') {
		let testContext = runtime_context_from_environment();
		return testContext != null ? testContext : error_result('EUNAVAILABLE', 'server runtime composition test evidence is unavailable');
	}
	if (getenv('Z2M_STRATEGY_RPC') == '1') {
		return live_runtime_inputs();
	}
	// Direct module callers may supply an internal test context. RPC requests
	// never reach this branch and cannot provide runtime composition inputs.
	if (is_object(context)) {
		if (!is_object(context.runtimeInputs) || context.runtimeInputs.source != 'live'
			|| context.runtimeInputs.enginePath != ENGINE_PATH)
			return error_result('EINPUT', 'internal runtime composition evidence is invalid');
		let environment = {};
		if (is_object(context.environment)) for (let key in context.environment)
			if (key != 'executionAdmission' && key != 'validate') environment[key] = context.environment[key];
		return { ok: true, environment: environment, runtimeInputs: context.runtimeInputs };
	}
	return live_runtime_inputs();
}

function minimal_dependencies() {
	return {
		available: false, items: [], missing: [], structurallyCompilable: false,
		nativeValidation: validation_record(null)
	};
}

function catalog() {
	let root = getenv('Z2M_STRATEGY_CATALOG_ROOT');
	let loaded = null;
	try { loaded = root != null ? strategy_catalog_load(root) : strategy_catalog_read_index(null); } catch (e) { loaded = null; }
	if (!is_object(loaded) || loaded.ok != true || !is_object(loaded.catalog))
		return error_result('EVERIFY', 'verified Strategy catalog is unavailable: '
			+ (loaded && loaded.error && loaded.error.message || 'resolver returned no verified identity'));
	return loaded.catalog;
}

// A Discord composition is intentionally transient: it may be compiled and
// applied from the canonical source identity, but it must never be accepted as
// an arbitrary client-composed Apply candidate or written to strategies/.
function transient_composition_valid(strategy) {
	if (!is_object(strategy) || !safe_strategy_id(strategy.id)
		|| !safe_strategy_id(strategy.canonicalId) || strategy.id != strategy.canonicalId
		|| (strategy.sourceId != 'avatar' && strategy.sourceId != 'z2k')
		|| strategy.origin != 'derived' || strategy.is_builtin != false
		|| type(strategy.profiles) != 'array') return false;
	let metadata = strategy.metadata, provenance = is_object(metadata) ? metadata.provenance : null;
	let donor = is_object(provenance) ? provenance.donor : null;
	return is_object(metadata) && is_object(provenance) && provenance.composition == 'discord'
		&& is_object(donor) && safe_strategy_id(donor.canonicalStrategyId)
		&& (donor.sourceId == 'avatar' || donor.sourceId == 'z2k')
		&& is_string(donor.sourceSnapshotId) && is_string(donor.sourceCommit)
		&& digest(donor.donorProfileDigest);
}

function input_shape(input, requireSource) {
	if (!is_object(input)) return error_result('EINPUT', 'Strategy request must be an object');
	let forbidden = ['candidate', 'command', 'argv', 'effectiveCommand', 'effectiveArgv', 'strategyArgs', 'args',
		'runtimeInputs', 'environment', 'context'];
	let inputKeys = keys(input);
	for (let key in inputKeys) for (let fi in forbidden)
		if (key == fi)
			return error_result('EINPUT', 'client-composed candidate or command is not accepted');
	if (input.validate != null && input.validate != true && input.validate != false)
		return error_result('EINPUT', 'validate must be boolean', 'validate');
	let hasId = exists(input, 'strategy_id'), hasData = exists(input, 'strategy_data');
	if ((hasId ? 1 : 0) + (hasData ? 1 : 0) != 1)
		return error_result('EINPUT', 'exactly one Strategy source is required', 'strategy_id');
	if (hasId) {
		if (!safe_strategy_id(input.strategy_id) || !is_integer(input.revision) || !digest(input.catalog_digest))
			return error_result('EINPUT', 'persisted Strategy source requires bounded id, revision, and catalog digest');
	} else {
		if (!is_object(input.strategy_data) || type(input.strategy_data) == 'array')
			return error_result('EINPUT', 'inline strategy_data must be an object');
		let encoded = serialize(input.strategy_data);
		if (encoded == null || length(encoded) > MAX_INLINE_BYTES)
			return error_result('EINPUT', 'inline strategy_data exceeds the safe size limit');
		if (input.catalog_digest != null && !digest(input.catalog_digest))
			return error_result('EINPUT', 'catalog_digest must be a SHA-256 digest', 'catalog_digest');
	}
	if (requireSource == true && !hasId && !transient_composition_valid(input.strategy_data))
		return error_result('EINPUT', 'Apply requires a canonical Strategy identity or a verified transient composition');
	return { ok: true, hasId: hasId };
}

function resolve_strategy(input, currentCatalog) {
	let shape = input_shape(input, false);
	if (!shape.ok) return shape;
	if (!is_object(currentCatalog) || !digest(currentCatalog.aggregateDigest))
		return error_result('EVERIFY', 'verified Avatar catalog digest is unavailable');
	if (input.catalog_digest != null && input.catalog_digest != currentCatalog.aggregateDigest)
		return error_result('ECONFLICT', 'Avatar catalog revision is stale');
	if (shape.hasId) {
		let user = null;
		try { user = strategy_user_get_readonly({ id: input.strategy_id }); } catch (e) { user = null; }
		if (is_object(user) && user.ok == true) {
			if (!is_object(user.strategy) || user.strategy.revision != input.revision)
				return error_result('ECONFLICT', 'Strategy revision is stale');
			return { ok: true, strategy: user.strategy, id: input.strategy_id, origin: 'user',
				sourceId: 'user', canonicalStrategyId: input.strategy_id, sourceSnapshotId: null, sourceCommit: null };
		}
		// Namespaced catalog IDs (avatar:/z2k:) are intentionally not valid
		// user-record IDs. The readonly user lookup reports EINPUT for those
		// values, which must fall through to the verified catalog authority.
		if (is_object(user) && user.error && user.error.code != 'ENOENT'
			&& !(starts_with(input.strategy_id, 'avatar:') || starts_with(input.strategy_id, 'z2k:')))
			return error_result(user.error.code, user.error.message);
		let entry = is_object(currentCatalog.winners) ? currentCatalog.winners[input.strategy_id] : null;
		if (entry == null)
			return error_result('ENOENT', 'Strategy was not found');
		if (input.revision != 0) return error_result('ECONFLICT', 'catalog Strategy revision is stale');
		let strategy = catalog_entry_to_strategy(entry);
		if (strategy == null) return error_result('EVERIFY', 'catalog Strategy normalization failed');
		let sourceId = strategy.sourceId || (starts_with(input.strategy_id, 'z2k:') ? 'z2k' : 'avatar');
		strategy.sourceId = sourceId;
		let sourceOrigin = sourceId == 'z2k' ? 'z2k_builtin' : 'avatar_builtin';
		strategy.origin = sourceOrigin;
		let sourceSnapshotId = strategy.sourceSnapshotId || sourceId + '-' + currentCatalog.aggregateDigest;
		let sourceCommit = strategy.sourceCommit || currentCatalog.source && (currentCatalog.source.sourceCommit || currentCatalog.source.commit) || null;
		return { ok: true, strategy: strategy, id: input.strategy_id, origin: sourceOrigin,
			sourceId: sourceId, canonicalStrategyId: strategy.canonicalId || input.strategy_id,
			sourceSnapshotId: sourceSnapshotId, sourceCommit: sourceCommit };
	}
	let inline = input.strategy_data, sourceId = inline.sourceId;
	if (transient_composition_valid(inline)) {
		let baseEntry = is_object(currentCatalog.winners) ? currentCatalog.winners[inline.canonicalId] : null;
		if (!is_object(baseEntry) || baseEntry.sourceId != sourceId)
			return error_result('EVERIFY', 'Transient composition base Strategy is not in the verified catalog');
		let base = null;
		try { base = catalog_entry_to_strategy(baseEntry); } catch (e) { base = null; }
		if (!is_object(base)) return error_result('EVERIFY', 'Transient composition base Strategy could not be normalized');
		let sourceOrigin = sourceId == 'z2k' ? 'z2k_builtin' : 'avatar_builtin';
		return { ok: true, strategy: inline, id: inline.id, origin: sourceOrigin,
			sourceId: sourceId, canonicalStrategyId: inline.canonicalId,
			sourceSnapshotId: base.sourceSnapshotId || sourceId + '-' + currentCatalog.aggregateDigest,
			sourceCommit: base.sourceCommit || currentCatalog.source && (currentCatalog.source.sourceCommit || currentCatalog.source.commit) || null };
	}
	return { ok: true, strategy: inline, id: inline.id, origin: 'inline',
		sourceId: 'user', canonicalStrategyId: inline.canonicalId || inline.id,
		sourceSnapshotId: null, sourceCommit: null };
}

function complete_validation(value) {
	let record = is_object(value) ? value : {}, c = record.coverage;
	return record.status == 'verified' && is_object(c)
		&& c.cliSyntax == 'passed' && c.luaLoad == 'passed'
		&& c.luaCompatibility == 'passed' && c.functionExistence == 'passed'
		&& c.blobExistence == 'passed' && c.runtimeArguments == 'passed'
		&& c.executionPlan == 'passed';
}

function bounded_error_projection(resolved, candidate, validation, code, message) {
	let count = candidate && type(candidate.profilesCount) == 'int' && candidate.profilesCount >= 0
		? (candidate.profilesCount > MAX_OUTPUT_ARRAY_ITEMS ? MAX_OUTPUT_ARRAY_ITEMS : candidate.profilesCount) : 0;
	let args = count == 0 ? [] : '';
	return {
		ok: false, strategyId: resolved && resolved.id != null ? bounded_identity(resolved.id, 128) : null,
		origin: resolved && resolved.origin != null ? bounded_identity(resolved.origin, 32) : null,
		strategyArgs: args, args: args, effectiveCommand: '', effectiveArgv: [],
		fullCommand: '', fullArgv: [], profiles_count: count, profilesCount: count,
		dependencies: minimal_dependencies(),
		digest: candidate && digest(candidate.digest) ? candidate.digest : null,
		applicable: false, validation: validation,
		error: { code: error_code(code), message: bounded_text(message, MAX_TEXT) }
	};
}

function final_projection(value, fallback) {
	let encoded = serialize(value);
	return encoded != null && length(encoded) <= MAX_OUTPUT_BYTES ? value : fallback;
}

function candidate_projection_base(resolved, candidate, effective, validation, includeValidation) {
	let empty = candidate.profilesCount == 0;
	let args = empty ? [] : candidate.strategyArgs;
	let effectiveValue = effective_projection(effective);
	if (effectiveValue == null) return null;
	let dependencies = dependencies_record(candidate.dependencies), dependencyText = serialize(dependencies);
	if (dependencies == null || dependencyText == null || length(dependencyText) > MAX_DEPENDENCY_BYTES) return null;
	let result = {
		strategyId: bounded_identity(resolved.id, 128), origin: bounded_identity(resolved.origin, 32),
		strategyArgs: args,
		effectiveCommand: effectiveValue.effectiveCommand, effectiveArgv: effectiveValue.effectiveArgv,
		profiles_count: candidate.profilesCount, profilesCount: candidate.profilesCount,
		dependencies: dependencies, digest: candidate.digest,
		applicable: candidate.applicable == true
	};
	if (includeValidation == true) result.validation = validation;
	return result;
}

function candidate_projection(resolved, candidate, effective, validation, includeValidation) {
	let empty = candidate.profilesCount == 0;
	let args = empty ? [] : candidate.strategyArgs;
	if (!is_string(resolved.id) || length(resolved.id) > 128
		|| !is_string(resolved.origin) || length(resolved.origin) > 32) return null;
	if (!empty && (!is_string(args) || length(args) > MAX_OUTPUT_TEXT)) return null;
	let result = candidate_projection_base(resolved, candidate, effective, validation, includeValidation);
	if (result == null) return null;
	result.args = args;
	result.fullCommand = result.effectiveCommand;
	result.fullArgv = copy_array(result.effectiveArgv, MAX_OUTPUT_ARRAY_ITEMS);
	let encoded = serialize(result);
	if (encoded != null && length(encoded) <= MAX_OUTPUT_BYTES) return result;

	// Preserve every canonical executable field and dependencies, but omit only
	// legacy aliases that duplicate those fields. This is a presentation shape,
	// not a truncated candidate: Validate and Apply still use the full candidate.
	let compact = candidate_projection_base(resolved, candidate, effective, validation, includeValidation);
	if (compact == null) return null;
	compact.presentation = {
		mode: 'compact', canonicalComplete: true,
		omittedAliases: ['args', 'fullCommand', 'fullArgv']
	};
	encoded = serialize(compact);
	if (encoded != null && length(encoded) <= MAX_OUTPUT_BYTES) return compact;

	// A large generated command legitimately duplicates the raw strategy args
	// and effective argv in the compatibility projection. Preserve the complete
	// server-owned command/argv and admission metadata, omitting only fields the
	// Preview UI does not consume.
	let minimal = {
		strategyId: bounded_identity(resolved.id, 128), origin: bounded_identity(resolved.origin, 32),
		effectiveCommand: effective.effectiveCommand, effectiveArgv: effective.effectiveArgv,
		profiles_count: candidate.profilesCount, profilesCount: candidate.profilesCount,
		dependencies: dependencies_record(candidate.dependencies), digest: candidate.digest,
		applicable: candidate.applicable == true,
		presentation: {
			mode: 'compact', canonicalComplete: true,
			omittedFields: ['strategyArgs', 'args', 'fullCommand', 'fullArgv']
		}
	};
	if (includeValidation == true) minimal.validation = validation;
	encoded = serialize(minimal);
	if (encoded != null && length(encoded) <= MAX_OUTPUT_BYTES) return minimal;

	// A complete effective command is still useful when argv would push the
	// transport over its hard bound.  Keep that command and all admission
	// metadata, while omitting only the derived argv presentation; the command
	// remains the canonical executable projection and Apply never consumes this
	// response shape.
	let commandOnly = {
		strategyId: bounded_identity(resolved.id, 128), origin: bounded_identity(resolved.origin, 32),
		effectiveCommand: effective.effectiveCommand, effectiveArgv: [],
		profiles_count: candidate.profilesCount, profilesCount: candidate.profilesCount,
		dependencies: dependencies_record(candidate.dependencies), digest: candidate.digest,
		applicable: candidate.applicable == true,
		presentation: {
			mode: 'compact', canonicalComplete: true,
			omittedFields: ['strategyArgs', 'args', 'fullCommand', 'fullArgv', 'effectiveArgv']
		}
	};
	if (includeValidation == true) commandOnly.validation = validation;
	encoded = serialize(commandOnly);
	return encoded != null && length(encoded) <= MAX_OUTPUT_BYTES ? commandOnly : null;
}

function validation_error(resolved, candidate, effective, validation, code, message) {
	let result = candidate_projection(resolved, candidate, effective, validation, true);
	if (result == null) return bounded_error_projection(resolved, candidate, validation, 'EINPUT',
		'Strategy validation projection exceeds the safe output bound');
	result.ok = false;
	result.applicable = false;
	result.error = { code: error_code(code), message: bounded_text(message, MAX_TEXT) };
	return final_projection(result, bounded_error_projection(resolved, candidate, validation, 'EINPUT',
		'Strategy validation projection exceeds the safe output bound'));
}

function evaluated(input, context, requireValidation, requireAdmission) {
	let shape = input_shape(input, false);
	if (!shape.ok) return shape;
	let currentCatalog = catalog();
	if (!is_object(currentCatalog) || currentCatalog.ok == false) return currentCatalog;
	let resolved = resolve_strategy(input, currentCatalog);
	if (!resolved.ok) return resolved;
	let trusted = server_context(context);
	if (!trusted.ok) return trusted;
	let environment = trusted.environment;
	environment.validate = requireValidation == true || input.validate == true;
	let previewCacheKey = strategy_preview_cache_key(input, currentCatalog, resolved, environment);
	// A cache hit is an exact, volatile compiler result bound to the current
	// server snapshot. Reuse it for both Preview and Validate; Validate still
	// replaces its native result with a fresh preflight below.
	let candidate = strategy_preview_cache_get(previewCacheKey);
	if (candidate == null) {
		try { candidate = strategy_candidate(resolved.strategy, environment); }
		catch (e) { return error_result('EINTERNAL', 'Strategy compilation failed'); }
	} else if (requireValidation == true) {
		// The cached candidate is reused only after server_context() resolved the
		// current catalog/runtime identity. Native validation is always fresh for
		// that exact snapshot; no cached PASS is accepted as validation evidence.
		let nativeValidation = null;
		try { nativeValidation = native_preflight(candidate.strategyArgs, environment.runtimeComposition, candidate.dependencies); }
		catch (e) { nativeValidation = { status: 'unavailable', coverage: {}, diagnostics: [{ severity: 'error', code: 'NATIVE_PREFLIGHT_FAILED', message: 'native preflight could not be completed' }] }; }
		candidate.nativeValidation = nativeValidation;
		if (is_object(candidate.dependencies)) candidate.dependencies.nativeValidation = nativeValidation;
		let nativeVerified = complete_validation(nativeValidation);
		candidate.applicable = candidate.dependencies.available == true && nativeVerified;
		candidate.executable = candidate.dependencies.available == true && nativeVerified;
	}
	if (!is_object(candidate) || candidate.ok != true)
		return error_result(candidate && candidate.error ? candidate.error.code : 'EINPUT',
			candidate && candidate.error ? candidate.error.message : 'Strategy compilation failed');
	let validation = validation_record(candidate.nativeValidation);
	if (type(candidate.profilesCount) != 'int' || candidate.profilesCount < 0
		|| candidate.profilesCount > MAX_OUTPUT_ARRAY_ITEMS ||
		(candidate.profilesCount > 0 && (!is_string(candidate.strategyArgs)
			|| length(candidate.strategyArgs) > MAX_OUTPUT_TEXT)))
		return bounded_error_projection(resolved, candidate, validation, 'EINPUT',
			'Strategy Preview output exceeds the safe bound');
	let effective = null;
	let trustedRuntime = trusted.runtimeInputs;
	if (!runtime_inputs_bounded(trustedRuntime))
		return bounded_error_projection(resolved, candidate, validation, 'EINPUT',
			'authoritative runtime inputs exceed the safe bound');
	try { effective = strategy_effective_argv(candidate.strategyArgs, trusted.runtimeInputs); }
	catch (e) { effective = null; }
	if (!is_object(effective) || effective.ok != true || effective_projection(effective) == null)
		return bounded_error_projection(resolved, candidate, validation, 'EINPUT',
			'authoritative effective command exceeds the safe bound');
	let empty = candidate.profilesCount == 0;
	if (requireAdmission == true) {
		if (empty) return validation_error(resolved, candidate, effective, validation,
			'ENOENABLED', 'Strategy requires at least one enabled Profile');
		if (!candidate.dependencies.available)
			return validation_error(resolved, candidate, effective, validation,
				'EDEPENDENCY', 'Strategy dependencies are unavailable');
		if (!complete_validation(candidate.nativeValidation))
			return validation_error(resolved, candidate, effective, validation,
				'EPREFLIGHT', 'complete native Strategy preflight is required');
	}
	let result = candidate_projection(resolved, candidate, effective, validation,
		requireValidation == true || input.validate == true);
	if (result == null) return bounded_error_projection(resolved, candidate, validation, 'EINTERNAL',
		'Strategy Preview projection exceeds the safe output bound');
	result.ok = true;
	if (requireValidation != true && input.validate !== true) strategy_preview_cache_put(previewCacheKey, candidate);
	return final_projection(result, bounded_error_projection(resolved, candidate, validation, 'EINTERNAL',
		'Strategy Preview projection exceeds the safe output bound'));
}

export const strategy_preview = function(input, context) {
	return evaluated(input, context, false, false);
};

export const strategy_validate = function(input, context) {
	return evaluated(input, context, true, true);
};

function strategy_apply_projection(resolved, input, candidate, selection, configHash, runtimeSnapshot) {
	let sourceId = resolved.sourceId || (resolved.origin == 'user' || resolved.origin == 'inline' ? 'user' : 'avatar');
	let sourceSnapshotId = resolved.sourceSnapshotId || sourceId + '-' + candidate.digest;
	let sourceCommit = resolved.sourceCommit || null;
	let canonicalStrategyId = resolved.canonicalStrategyId || resolved.strategy.canonicalId || resolved.id;
	return {
		candidateSha256: candidate.digest,
		callerContext: 'strategy_apply', operationNonce: selection.operationNonce,
		strategyId: resolved.id, strategyOrigin: resolved.origin, strategyRevision: input.revision == null ? 0 : input.revision,
		catalogDigest: input.catalog_digest,
		expectedRevision: selection.revision,
		selectionRevision: selection.revision, expectedSelected: selection.selected,
		previousCandidateSha256: selection.previousCandidateSha256,
		expectedConfigSha256: configHash,
		runtimeBinding: runtime_snapshot_binding(runtimeSnapshot),
		previousSelected: selection.selected,
		selected: {
			id: resolved.id, origin: resolved.origin, revision: input.revision == null ? 0 : input.revision,
			candidateSha256: candidate.digest, canonicalStrategyId: canonicalStrategyId,
			sourceId: sourceId, sourceSnapshotId: sourceSnapshotId, sourceCommit: sourceCommit,
			strategyDigest: candidate.digest
		}
	};
}

function strategy_apply_candidate(resolved, environment, input, currentCatalog) {
	let injected = apply_hook_value('candidate', null);
	if (is_object(injected)) return injected;
	let cacheKey = strategy_preview_cache_key(input, currentCatalog, resolved, environment);
	let cached = strategy_preview_cache_get(cacheKey);
	if (cached == null) return strategy_candidate(resolved.strategy, environment);
	// Apply may consume only the compiled candidate from Preview. Native
	// validation is deliberately not reused here: the locked profile writer is
	// the sole Apply authority and performs one final preflight on the live
	// installed composition immediately before CAS.
	cached.nativeValidation = { status: 'not_checked', coverage: {}, diagnostics: [] };
	if (is_object(cached.dependencies)) cached.dependencies.nativeValidation = cached.nativeValidation;
	cached.applicable = cached.dependencies.available == true;
	cached.executable = false;
	return cached;
}

function bind_executable_candidate(candidate) {
	if (!is_object(candidate) || !is_string(candidate.candidate) || !length(candidate.candidate)) return null;
	let tokenized = z2m_tokenize(candidate.candidate);
	if (!is_object(tokenized) || tokenized.ok == false || type(tokenized.tokens) != 'array') return null;
	let tokens = [];
	for (let token in tokenized.tokens) {
		if (!is_object(token) || !is_string(token.value)) return null;
		push(tokens, runtime_argument_token(token.value));
	}
	let executable = join(' ', tokens), digestValue = profiles_candidate_digest(executable);
	if (!is_string(digestValue) || !digest(digestValue)) return null;
	let result = {};
	for (let key in candidate) result[key] = candidate[key];
	result.candidate = executable;
	if (is_string(result.strategyArgs)) result.strategyArgs = executable;
	if (is_string(result.args)) result.args = executable;
	result.digest = digestValue;
	result.candidateSha256 = digestValue;
	result.expectedHash = digestValue;
	return result;
}

export const strategy_runtime_bind_candidate = function(candidate) {
	return bind_executable_candidate(candidate);
};

function strategy_apply_release_evidence(result, projection, operationNonce) {
	if (!is_object(projection) || !is_object(result) || !is_object(result.applied)
		|| !digest(projection.expectedConfigSha256) || !digest(projection.previousCandidateSha256)
		|| !digest(result.applied.configSha256) || !digest(projection.candidateSha256))
		return error_result('EIO', 'successful Strategy Apply guard release lacks bounded recovery evidence');
	let checks = is_object(result.verify) && is_object(result.verify.checks) ? result.verify.checks : {
		processPresent: false, singleInstance: false, rulesPresent: false, queueRegistered: false, ownerMatch: false
	};
	let saved = null;
	try { saved = strategy_apply_uncertain_record({
		oldConfigSha256: projection.expectedConfigSha256, newConfigSha256: result.applied.configSha256,
		oldCandidateSha256: projection.previousCandidateSha256, newCandidateSha256: projection.candidateSha256,
		catalogDigest: projection.catalogDigest, oldIdentity: projection.previousSelected,
		newIdentity: projection.selected, runtimeOutcome: {
			initial: checks, rollback: checks, restartRc: 0, rollbackRestartRc: 0,
			configRestored: true, identityRestored: true
		}, reason: 'successful Apply guard release failed', applyNonce: operationNonce });
	} catch (e) { saved = null; }
	return saved || error_result('EIO', 'successful Strategy Apply guard recovery evidence could not be persisted');
}

function strategy_apply_finish(result, operationNonce, projection) {
	if (result == null) return error_result('EINTERNAL', 'Strategy transaction returned no result');
	if (result.uncertain == true || (result.error && result.error.code == 'EUNCERTAIN')) return result;
	let ended = null;
	try { ended = strategy_apply_end({ applyNonce: operationNonce }); } catch (e) { ended = null; }
	if (!is_object(ended) || ended.ok != true) {
		let evidence = strategy_apply_release_evidence(result, projection, operationNonce);
		return error_result('EUNCERTAIN', 'Strategy Apply guard could not be released; explicit reconciliation is required.', {
			blocked: true, uncertain: true, transaction: result, guard: ended, uncertaintyPersistence: evidence
		});
	}
	return result;
}

export const strategy_apply = function(input, context) {
	let shape = input_shape(input, true);
	if (!shape.ok) return shape;
	let guard = null;
	try { guard = strategy_apply_guard_status(); } catch (e) { guard = null; }
	if (!is_object(guard) || guard.ok != true || guard.blocked == true)
		return error_result('EUNCERTAIN', 'Strategy Apply is blocked until explicit reconciliation.');
	let pending = null;
	try { pending = strategy_apply_uncertain_get(); } catch (e) { pending = null; }
	if (!is_object(pending) || pending.ok != true)
		return error_result('EUNCERTAIN', 'Strategy Apply uncertainty state is unreadable; explicit reconciliation is required.');
	if (is_object(pending) && pending.ok == true && pending.record != null)
		return error_result('EUNCERTAIN', 'Strategy Apply is blocked until explicit reconciliation.');
	let oldConfigSha256 = null, oldCandidateSha256 = null;
	try { oldConfigSha256 = profiles_config_hash(); oldCandidateSha256 = profiles_candidate_hash(); }
	catch (e) { oldConfigSha256 = null; oldCandidateSha256 = null; }
	let begun = null;
	let requestStrategyId = shape.hasId ? input.strategy_id : input.strategy_data.id;
	let requestRevision = shape.hasId ? input.revision : 0;
	try { begun = strategy_apply_begin({ strategyId: requestStrategyId, strategyRevision: requestRevision, catalogDigest: input.catalog_digest,
		oldConfigSha256: oldConfigSha256, oldCandidateSha256: oldCandidateSha256 }); }
	catch (e) { begun = null; }
	if (!is_object(begun) || begun.ok != true)
		return error_result(begun && begun.error ? begun.error.code : 'EUNCERTAIN', begun && begun.error ? begun.error.message : 'Strategy Apply guard could not be established.');
	let currentCatalog = catalog();
	if (!is_object(currentCatalog) || currentCatalog.ok == false) return strategy_apply_finish(currentCatalog, begun.operationNonce);
	let resolved = resolve_strategy(input, currentCatalog);
	if (!resolved.ok) return strategy_apply_finish(resolved, begun.operationNonce);
	let trusted = server_context(context);
	if (!trusted.ok && apply_hook_value('candidate', null) == null)
		return strategy_apply_finish(trusted, begun.operationNonce);
	if (!trusted.ok) trusted = { ok: true, environment: {} };
	// RPC server_context already carries the canonical installed composition.
	// Reuse it instead of resolving the same Registry/receipt twice. Test and
	// direct-module contexts may omit it, so they use the existing hook/fallback;
	// a present but invalid composition is never silently replaced.
	let installedSnapshot = trusted.runtimeComposition;
	if (installedSnapshot == null) installedSnapshot = runtime_composition_for_apply();
	// A client snapshotId is deliberately not consulted here.
	if (!runtime_snapshot_valid(installedSnapshot))
		return strategy_apply_finish(runtime_snapshot_error(installedSnapshot), begun.operationNonce);
	trusted.environment.validate = false;
	trusted.environment.executionAdmission = false;
	trusted.environment.runtimeComposition = installedSnapshot;
	let candidate = null;
	try { candidate = strategy_apply_candidate(resolved, trusted.environment, input, currentCatalog); }
	catch (e) { return strategy_apply_finish(error_result('EINTERNAL', 'Strategy compilation failed'), begun.operationNonce); }
	if (!is_object(candidate) || candidate.ok != true)
		return strategy_apply_finish(error_result(candidate && candidate.error ? candidate.error.code : 'EINTERNAL',
			candidate && candidate.error ? candidate.error.message : 'Strategy compilation failed'), begun.operationNonce);
	if (candidate.profilesCount == 0)
		return strategy_apply_finish(error_result('ENOENABLED', 'Strategy requires at least one enabled Profile'), begun.operationNonce);
	if (!is_object(candidate.dependencies) || candidate.dependencies.available != true)
		return strategy_apply_finish(error_result('EDEPENDENCY', 'Strategy dependencies are unavailable'), begun.operationNonce);
	if (resolved.sourceId == 'z2k' && (!is_object(candidate.dependencies.dependencyClosure)
		|| candidate.dependencies.dependencyClosure.available != true
		|| !digest(candidate.dependencies.dependencyClosure.runtimeBundleDigest)))
		return strategy_apply_finish(error_result('EDEPENDENCY', 'Z2K runtime dependency closure is unavailable or incomplete'), begun.operationNonce);
	if (!digest(candidate.digest)) return strategy_apply_finish(error_result('EINTERNAL', 'Strategy candidate digest is unavailable'), begun.operationNonce);
	let executableCandidate = bind_executable_candidate(candidate);
	if (!is_object(executableCandidate))
		return strategy_apply_finish(error_result('EINTERNAL', 'executable Strategy candidate could not be bound to runtime assets'), begun.operationNonce);
	candidate = executableCandidate;
	if (!digest(oldConfigSha256) || !digest(oldCandidateSha256))
		return strategy_apply_finish(error_result('EVERIFY', 'authoritative pre-Apply config and candidate hashes are unavailable'), begun.operationNonce);
	let selection = { revision: begun.selectionRevision, selected: begun.selected,
		operationNonce: begun.operationNonce, previousCandidateSha256: begun.oldCandidateSha256 };
	// The authoritative final resolve and preflight now happen inside the
	// config.lock transaction. The compact binding below lets that locked
	// resolver reject Registry/receipt/membership/composition drift without
	// copying the full runtime snapshot into the sidecar.
	let projection = strategy_apply_projection(resolved, input, candidate, selection, begun.oldConfigSha256, installedSnapshot);
	let applied = null;
	try { applied = profiles_apply_candidate(candidate.candidate, candidate.digest, projection); }
	catch (e) { return strategy_apply_finish(error_result('EINTERNAL', 'Strategy transaction failed before returning a bounded result'), begun.operationNonce, projection); }
	if (!is_object(applied)) return strategy_apply_finish(error_result('EINTERNAL', 'Strategy transaction returned no result'), begun.operationNonce);
	if (applied.ok != true) {
		return strategy_apply_finish(applied, begun.operationNonce, projection);
	}
	// Return the exact identity projection committed by the transaction state
	// writer.  Keeping this response identical to persisted `selected` avoids
	// making callers reconstruct source provenance from a second authority.
	applied.strategy = { id: resolved.id, origin: resolved.origin, revision: requestRevision,
		candidateSha256: candidate.digest, canonicalStrategyId: projection.selected.canonicalStrategyId,
		sourceId: projection.selected.sourceId, sourceSnapshotId: projection.selected.sourceSnapshotId,
		sourceCommit: projection.selected.sourceCommit, strategyDigest: projection.selected.strategyDigest };
	return strategy_apply_finish(applied, begun.operationNonce, projection);
};

function strategy_reconcile_locked() {
	let evidence = null;
	try { evidence = profiles_reconcile_evidence(); } catch (e) { evidence = null; }
	if (!is_object(evidence) || evidence.ok != true) return evidence || error_result('EVERIFY', 'verified runtime reconciliation evidence is unavailable');
	return strategy_apply_reconcile(evidence);
}

function strategy_reconcile_with_config_lock() {
	let profileMetadata = null;
	try { profileMetadata = stat(PROFILE_APPLY_MODULE); } catch (e) { profileMetadata = null; }
	if (profileMetadata == null) return error_result('EVERIFY', 'authoritative reconciliation adapter is unavailable');
	let source = 'import { profiles_reconcile_evidence } from ' + sprintf('%J', PROFILE_APPLY_MODULE)
		+ '; import { strategy_apply_reconcile } from ' + sprintf('%J', STATE_MODULE)
		+ '; let evidence = profiles_reconcile_evidence(); let result = evidence.ok == true ? strategy_apply_reconcile(evidence) : evidence; print(sprintf("%J", result));';
	let inner = shell_escape(UCODE_BIN) + ' -e ' + shell_escape(source);
	let p = null;
	try { p = popen('Z2M_CONFIG_LOCKED=1 flock -x ' + shell_escape(CONFIG_LOCK) + ' -c ' + shell_escape(inner) + ' 2>&1', 'r'); }
	catch (e) { p = null; }
	if (!p) return error_result('EIO', 'authoritative reconciliation lock could not be acquired');
	let output = p.read('all') || '', rc = p.close();
	if (rc != 0 && !length(output)) return error_result('EIO', 'authoritative reconciliation process failed');
	try { return json(output); } catch (e) { return error_result('EIO', 'authoritative reconciliation response is malformed'); }
}

export const strategy_reconcile = function(input, context) {
	return getenv('Z2M_CONFIG_LOCKED') == '1' ? strategy_reconcile_locked() : strategy_reconcile_with_config_lock();
};

function import_diagnostic(diagnostics, profile, profileIndex, code, message, tokenIndex) {
	if (length(diagnostics) >= MAX_IMPORT_DIAGNOSTICS) return;
	push(diagnostics, {
		severity: 'error', code: bounded_text(code, 64), message: bounded_text(message, MAX_DEPENDENCY_TEXT),
		tokenIndex: type(tokenIndex) == 'int' ? tokenIndex : null,
		profileIndex: profileIndex,
		profileId: is_object(profile) && is_string(profile.id) ? bounded_text(profile.id, MAX_TEXT) : null
	});
}

function import_parser_errors(diagnostics, profile, profileIndex, model, validation) {
	for (let item in model.diagnostics || [])
		if (is_object(item) && item.severity == 'error')
			import_diagnostic(diagnostics, profile, profileIndex, item.code, item.message, item.tokenIndex);
	for (let item in validation || [])
		if (is_object(item) && item.severity == 'error')
			import_diagnostic(diagnostics, profile, profileIndex, item.code, item.message, item.tokenIndex);
}

function import_profile(profile, profileIndex, seen, diagnostics) {
	if (!is_object(profile)) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_PROFILE_SHAPE', 'Profile record is not an object', null);
		return null;
	}
	if (!is_string(profile.id) || length(profile.id) == 0 || length(profile.id) > MAX_TEXT) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_PROFILE_ID', 'Profile id is invalid', null);
		return null;
	}
	if (seen[profile.id]) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_DUPLICATE_PROFILE_ID', 'Profile id is duplicated', null);
		return null;
	}
	seen[profile.id] = true;
	if (!is_string(profile.opt) || length(profile.opt) == 0 || length(profile.opt) > MAX_INLINE_BYTES) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_PROFILE_ARGS', 'Profile args are missing or oversized', null);
		return null;
	}
	let fragment = trim(profile.opt);
	if (fragment == '' || index(fragment, '\n') >= 0 || index(fragment, '\r') >= 0) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_FRAGMENT_SHAPE', 'Profile args must be one non-empty fragment', null);
		return null;
	}

	let model = null, validation = null, tokenized = null;
	try {
		model = z2m_parse(fragment);
		validation = z2m_validate(model);
		tokenized = avatar_tokenize(fragment);
	} catch (e) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_PARSE_FAILURE', 'Profile args could not be parsed', null);
		return null;
	}
	import_parser_errors(diagnostics, profile, profileIndex, model, validation);
	if (!tokenized.ok) {
		import_diagnostic(diagnostics, profile, profileIndex, tokenized.error.code, tokenized.error.message, null);
		return null;
	}
	for (let token in tokenized.tokens)
		if (match(token.value, /^--new(=|$)/))
			import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_FRAGMENT_SEPARATOR', 'Profile args contain a second Profile separator', token.start);
	if (length(model.profiles) != 1 || length(model.trailingTokens) > 0) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_FRAGMENT_SHAPE', 'Profile args must contain exactly one Profile', null);
		return null;
	}
	for (let item in model.diagnostics || []) if (item.severity == 'error') return null;
	for (let item in validation || []) if (item.severity == 'error') return null;
	if (length(diagnostics) >= MAX_IMPORT_DIAGNOSTICS) return null;

	let profileInput = {
		id: profile.id,
		name: is_string(profile.name) && length(profile.name) > 0 ? profile.name : profile.id,
		args: fragment,
		enabled: model.profiles[0].enabled == false ? false : true
	};
	let normalized = strategy_normalize({
		id: 'legacy-profile-drafts', name: 'Imported Profile Drafts', profiles: [profileInput]
	}, 'user');
	if (!normalized.ok || !length(normalized.strategy.profiles)) {
		import_diagnostic(diagnostics, profile, profileIndex, 'MANAGER_NORMALIZE_FAILURE', 'Profile args could not be normalized', null);
		return null;
	}
	return normalized.strategy.profiles[0];
}

function import_request_identity(input) {
	let source = is_object(input) && is_object(input.strategy) ? input.strategy : input;
	if (!is_object(source)) source = {};
	let id = source.id == null ? 'legacy-profile-drafts' : source.id;
	let name = source.name == null ? 'Imported Profile Drafts' : source.name;
	if (!safe_id(id) || !is_string(name) || length(name) == 0 || length(name) > MAX_IMPORT_NAME)
		return error_result('EINPUT', 'Profile import requires a safe Strategy id and name');
	return { ok: true, id: id, name: name };
}

export const strategy_import_profiles_from_state = function(draft, input) {
	let identity = import_request_identity(input);
	if (!identity.ok) return identity;
	if (!is_object(draft) || type(draft.profiles) != 'array')
		return error_result('EINPUT', 'Legacy Profile draft state is malformed');
	if (length(draft.profiles) > MAX_IMPORT_PROFILES)
		return error_result('EINPUT', 'Legacy Profile draft set exceeds the import bound');

	let profiles = [], diagnostics = [], seen = {};
	for (let i = 0; i < length(draft.profiles); i++) {
		let converted = import_profile(draft.profiles[i], i, seen, diagnostics);
		if (converted != null) push(profiles, converted);
	}
	if (length(diagnostics)) return error_result('EINPUT', 'Legacy Profile drafts contain invalid fragments', { diagnostics: diagnostics });
	if (!length(profiles)) return error_result('EINPUT', 'At least one valid Profile draft is required');

	let strategy = {
		id: identity.id, name: identity.name, origin: 'user', is_builtin: false,
		metadata: { source: 'legacy-profile-drafts' }, profiles: profiles
	};
	let valid = model_validate(strategy, 'create');
	if (!valid.ok) return error_result('EINPUT', 'Imported Profile drafts do not form a valid Strategy');
	return {
		ok: true, mode: 'preview', strategy: strategy,
		runtimeMutation: false,
		source: { kind: 'legacy-profile-drafts', profileCount: length(profiles) }
	};
};

const SERVER_TEST_MARKER = 'Z2M_STRATEGY_SERVER_TEST';

function import_draft_source(context, allowTestContext) {
	if (allowTestContext == true) {
		if (getenv(SERVER_TEST_MARKER) != '1')
			return error_result('EINPUT', 'server-test import context is unavailable');
		if (!is_object(context) || !is_object(context.importProfiles)
			|| !exists(context.importProfiles, 'draftState'))
			return error_result('EINPUT', 'server-test import context is malformed');
		return { ok: true, state: context.importProfiles.draftState };
	}
	let loaded = null;
	try { loaded = load_state(); } catch (e) { loaded = null; }
	if (!is_object(loaded) || loaded.ok != true)
		return error_result('EINPUT', 'Legacy Profile draft state is unavailable');
	return { ok: true, state: loaded.state };
}

function import_profiles_from_source(input, context, allowTestContext) {
	let source = import_draft_source(context, allowTestContext);
	if (!source.ok) return source;
	let preview = strategy_import_profiles_from_state(source.state, input);
	if (!preview.ok || !is_object(input) || input.mode != 'create') return preview;
	let created = strategy_state['strategy_' + 'user_create']({ strategy: preview.strategy });
	if (!is_object(created)) return error_result('EINTERNAL', 'User Strategy creation returned no result');
	if (!created.ok) return created;
	created.mode = 'create';
	created.runtimeMutation = false;
	created.source = preview.source;
	return created;
}

export const strategy_import_profiles = function(input) {
	return import_profiles_from_source(input, null, false);
};

export const strategy_import_profiles_test = function(input, context) {
	return import_profiles_from_source(input, context, true);
};

function catalog_root() {
	return getenv('Z2M_STRATEGY_CATALOG_ROOT') || DEFAULT_CATALOG_ROOT;
}

function load_request_catalog() {
	let loaded = null;
	try { loaded = strategy_catalog_read_index(null); } catch (e) { loaded = null; }
	return is_object(loaded) && loaded.ok == true && is_object(loaded.catalog)
		? loaded.catalog : error_result('EVERIFY', 'verified Strategy catalog is unavailable: '
			+ (loaded && loaded.error && loaded.error.message || 'resolver returned no verified identity'));
}

function catalog_strategy(entry) {
	let strategy = null;
	if (is_object(entry) && entry.indexEntry == true) strategy = entry;
	else try { strategy = catalog_entry_to_strategy(entry); } catch (e) { strategy = null; }
	if (!is_object(strategy)) return null;
	let sourceId = strategy.sourceId || 'avatar';
	strategy.sourceId = sourceId;
	if (sourceId == 'user') {
		// User entries may be embedded in the active generation. Preserve their
		// mutable identity instead of projecting every generation row as Avatar.
		strategy.origin = 'user';
		strategy.is_builtin = false;
		return strategy;
	}
	strategy.origin = sourceId == 'z2k' ? 'z2k_builtin' : 'avatar_builtin';
	strategy.is_builtin = strategy.is_builtin === true;
	strategy.revision = 0;
	return strategy;
}

function catalog_wire_metadata(strategy, current, compact) {
	if (compact == true)
		return { catalogDigest: current.aggregateDigest };
	let metadata = {};
	if (is_object(strategy.metadata)) for (let key in strategy.metadata) metadata[key] = strategy.metadata[key];
	for (let key in ['description', 'type', 'version', 'is_builtin', 'source', 'level', 'label',
		'author', 'protocol', 'featured', 'blobs'])
		if (strategy[key] != null && metadata[key] == null) metadata[key] = strategy[key];
	metadata.catalogDigest = current.aggregateDigest;
	metadata.provenance = {
		source: current.source, aggregateDigest: current.aggregateDigest,
		aggregateDigestAlgorithm: current.aggregateDigestAlgorithm || null,
		sourceId: strategy.sourceId || null, sourceSnapshotId: strategy.sourceSnapshotId || null,
		sourceCommit: strategy.sourceCommit || current.source && (current.source.sourceCommit || current.source.commit) || null,
		sourceFile: strategy.sourceFile || null, sourceOrdinal: strategy.sourceOrdinal || null,
		cacheKey: strategy.cacheKey || null, cacheOrdinal: strategy.cacheOrdinal || null,
		duplicateGroup: strategy.duplicateGroup || null, effectiveOrdinal: strategy.effectiveOrdinal || null,
		winner: strategy.winner === true
	};
	metadata.catalog = {
		schema: current.schema || 1, source: current.source, aggregateDigest: current.aggregateDigest,
		aggregateDigestAlgorithm: current.aggregateDigestAlgorithm || null,
		physicalFileCount: current.physicalFileCount, physicalEntryCount: current.physicalEntryCount,
		uniqueStrategyIdCount: current.uniqueStrategyIdCount, duplicateIdGroupCount: current.duplicateIdGroupCount,
		levelEntryCounts: current.levelEntryCounts, protocolEntryCounts: current.protocolEntryCounts,
		featuredIds: current.featuredIds
	};
	return metadata;
}

function wire_strategy(strategy, current, selection, compact) {
	if (!is_object(strategy)) return null;
	let result = {};
	if (compact == true) {
		for (let key in ['id', 'name', 'description', 'is_builtin', 'source', 'level',
			'label', 'author', 'protocol', 'featured', 'recommended', 'pinned', 'origin', 'revision', 'canonicalId', 'sourceId',
			'sourceSnapshotId', 'sourceCommit', 'contentDigest', 'poolKey', 'entryKind',
			'strategyNumber', 'aggregateId'])
			if (strategy[key] != null) result[key] = key == 'description'
				? bounded_text(strategy[key], 256) : strategy[key];
		result.profiles = [];
		for (let profile in strategy.profiles || []) {
			let summary = {};
			for (let key in ['id', 'name', 'enabled'])
				if (profile[key] != null) summary[key] = profile[key];
			summary.argsTruncated = true;
			push(result.profiles, summary);
		}
	} else {
		for (let key in strategy) result[key] = strategy[key];
	}
	// Legacy user records predate explicit source provenance. Normalize their
	// transport identity at the canonical Strategy boundary so source filters
	// count every user entry without rewriting the persisted record.
	if (result.origin == 'user') {
		result.sourceId = 'user';
		if (result.canonicalId == null) result.canonicalId = result.id;
	}
	let selected = selection && selection.selected;
	let revision = type(result.revision) == 'int' ? result.revision : 0;
	result.revision = revision;
	result.is_active = is_object(selected) && selected.id == result.id
		&& selected.origin == result.origin && selected.revision == revision;
	result.is_favorite = type(selection.favorites) == 'array' && index(selection.favorites, result.id) >= 0;
	result.metadata = (result.origin == 'avatar_builtin' || result.origin == 'z2k_builtin')
		? catalog_wire_metadata(result, current, compact) : (is_object(result.metadata) ? result.metadata : {});
	return result;
}

function wire_strategy_for_list(strategy, current, selection) {
	return wire_strategy(strategy, current, selection, true);
}

function strategy_list() {
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	let selection = null;
	try { selection = strategy_selection_get(); } catch (e) { selection = null; }
	if (!is_object(selection) || selection.ok != true || type(selection.favorites) != 'array')
		return error_result('EIO', 'Strategy favorites state is unavailable');
	let strategies = [];
	let generatedIds = {};
	let order = is_object(current.winners) && type(current.winnerOrder) == 'array'
		? current.winnerOrder : keys(current.winners || {});
	for (let id in order) {
		let strategy = catalog_strategy(current.winners[id]);
		if (strategy == null) return error_result('EVERIFY', 'catalog Strategy normalization failed');
		generatedIds[strategy.id] = true;
		push(strategies, wire_strategy_for_list(strategy, current, selection));
	}
	let users = null;
	try { users = strategy_user_list(); } catch (e) { users = null; }
	if (!is_object(users) || users.ok != true) return users || error_result('EIO', 'User Strategy list is unavailable');
	// A published generation can already contain the user projection. Keep the
	// direct state reader only for user records that are newer than that
	// projection, and never emit the same canonical ID twice.
	for (let strategy in users.strategies)
		if (!generatedIds[strategy.id]) push(strategies, wire_strategy_for_list(strategy, current, selection));
	return bounded_strategy_response({ ok: true, strategies: strategies,
		state: { revision: selection.revision, favorites: selection.favorites },
		favoritesRevision: selection.revision }, 'Strategy list', MAX_STRATEGY_LIST_RESPONSE_BYTES);
}

function strategy_recommendations() {
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	let order = is_object(current.winners) && type(current.winnerOrder) == 'array'
		? current.winnerOrder : keys(current.winners || {});
	let featured = [], recommended = [];
	for (let id in order) {
		let entry = current.winners[id], metadata = is_object(entry) && is_object(entry.metadata) ? entry.metadata : {};
		let strategy = catalog_strategy(entry);
		if (strategy == null || (metadata.label != 'recommended' && strategy.label != 'recommended')) continue;
		let item = { id: strategy.id, name: strategy.name, description: strategy.description,
			protocol: strategy.protocol, featured: strategy.featured === true,
			upstreamRecommended: true, catalogDigest: current.aggregateDigest, profiles: [] };
		for (let profile in strategy.profiles || []) {
			let summary = {};
			for (let key in ['id', 'name', 'enabled', 'protocol', 'tcpPorts', 'udpPorts'])
				if (profile[key] != null) summary[key] = profile[key];
			push(item.profiles, summary);
		}
		if (item.featured) push(featured, item); else push(recommended, item);
	}
	let bounded = [];
	for (let item in featured) { if (length(bounded) >= 3) break; push(bounded, item); }
	for (let item in recommended) { if (length(bounded) >= 3) break; push(bounded, item); }
	return { ok: true, recommendations: bounded,
		source: { kind: 'catalog', digest: current.aggregateDigest, upstreamRecommended: true,
			localEvidence: { scanner: false, learned: false, health: false } } };
}

function strategy_get(input) {
	if (!is_object(input) || !safe_strategy_id(input.id)) return error_result('EINPUT', 'Strategy get requires a safe id');
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	let selection = null;
	try { selection = strategy_selection_get(); } catch (e) { selection = null; }
	if (!is_object(selection) || selection.ok != true || type(selection.favorites) != 'array')
		return error_result('EIO', 'Strategy favorites state is unavailable');
	// The active generation is the normal read authority. This also avoids
	// letting an older user-file projection shadow a published generation row.
	let generated = is_object(current.winners) ? current.winners[input.id] : null;
	if (generated != null) {
		let generatedStrategy = catalog_strategy(generated);
		return generatedStrategy == null
			? error_result('EVERIFY', 'catalog Strategy normalization failed')
			: bounded_strategy_response({ ok: true, strategy: wire_strategy(generatedStrategy, current, selection) }, 'Strategy detail');
	}
	let user = null;
	try { user = strategy_user_get_readonly({ id: input.id }); } catch (e) { user = null; }
	if (is_object(user) && user.ok == true)
		return bounded_strategy_response({ ok: true, strategy: wire_strategy(user.strategy, current, selection) }, 'Strategy detail');
	if (is_object(user) && user.error && user.error.code != 'ENOENT') return user;
	let entry = null;
	try { entry = strategy_catalog_get_detail(input.id); } catch (e) { entry = null; }
	if (is_object(entry) && entry.error) return entry;
	let strategy = catalog_strategy(entry);
	return strategy == null ? error_result('ENOENT', 'Strategy was not found')
		: bounded_strategy_response({ ok: true, strategy: wire_strategy(strategy, current, selection) }, 'Strategy detail');
}

function strategy_catalog_status_request() {
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	try { return strategy_catalog_status(); }
	catch (e) { return error_result('EVERIFY', 'verified Avatar catalog status is unavailable'); }
}

function strategy_catalog_reload_request() {
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	try { return strategy_catalog_reload(); }
	catch (e) { return error_result('EVERIFY', 'verified Avatar catalog reload failed'); }
}

function strategy_discord_donor_request(input) {
	let filter = is_object(input) ? input.sourceFilter : null;
	if (filter != null && filter != 'all' && filter != 'avatar' && filter != 'z2k')
		return error_result('EINPUT', 'Discord donor sourceFilter is invalid');
	try { return discord_autocircular_donor(filter); }
	catch (e) { return error_result('EVERIFY', 'verified Discord donor could not be loaded'); }
}

function request(path) {
	if (!is_string(path) || length(path) == 0 || length(path) > 256) return error_result('EINPUT', 'request path is invalid');
	function metadata_same(left, right) {
		if (left == null || right == null) return false;
		for (let field in ['type', 'size', 'mode', 'uid', 'gid', 'inode'])
			if (left[field] != null || right[field] != null)
				if (left[field] != right[field]) return false;
		if (left.dev != null || right.dev != null) {
			if (left.dev == null || right.dev == null
				|| left.dev.major != right.dev.major || left.dev.minor != right.dev.minor) return false;
		}
		return true;
	}
	function metadata_valid(value) {
		let link = null;
		try { link = readlink(path); } catch (e) { return false; }
		if (!is_object(value) || value.type != 'file' || type(value.size) != 'int'
			|| value.size < 0 || value.size > MAX_REQUEST_BYTES || link != null) return false;
		// RPC-created request files carry this exact private path/mode/owner
		// invariant. Direct module tests may use another bounded path.
		if (match(path, /^\/tmp\/z2m-strategy-edit\./))
			return value.mode % 512 == 384 && '' + value.uid == REQUEST_UID
				&& '' + value.gid == REQUEST_GID;
		return true;
	}
	let first = null, beforeRead = null, afterRead = null, raw = null;
	try { first = stat(path); } catch (e) { first = null; }
	if (!metadata_valid(first)) return error_result('EINPUT', 'request file is not a bounded private regular file');
	try { beforeRead = stat(path); } catch (e) { beforeRead = null; }
	if (!metadata_same(first, beforeRead) || !metadata_valid(beforeRead))
		return error_result('EINPUT', 'request file identity changed before read');
	try { raw = readfile(path); } catch (e) { raw = null; }
	try { afterRead = stat(path); } catch (e) { afterRead = null; }
	let finalLink = null;
	try { finalLink = readlink(path); } catch (e) { finalLink = 'error'; }
	if (!is_string(raw) || !metadata_same(beforeRead, afterRead) || finalLink != null
		|| length(raw) != beforeRead.size)
		return error_result('EINPUT', 'request file changed during read');
	let value = null;
	try { value = json(raw); } catch (e) { return error_result('EINPUT', 'request JSON is malformed'); }
	if (is_object(value) && is_object(value.args)) return value.args;
	return value;
}

function dispatch_result(mode, input, context, testContext) {
	if (mode == 'reconcile') return strategy_reconcile(input, context);
	if (mode == 'list') return strategy_list();
	if (mode == 'recommendations') return strategy_recommendations();
	if (mode == 'get') return strategy_get(input);
	if (mode == 'discord_donor') return strategy_discord_donor_request(input);
	if (mode == 'create') return strategy_state['strategy_' + 'user_create'](input);
	if (mode == 'update') return strategy_state['strategy_' + 'user_update'](input);
	if (mode == 'delete') return strategy_state['strategy_' + 'user_delete'](input);
	if (mode == 'duplicate') return strategy_duplicate(input);
	if (mode == 'favorite') return strategy_state['strategy_' + 'favorite'](input);
	if (mode == 'catalog_status') return strategy_catalog_status_request();
	if (mode == 'catalog_reload') return strategy_catalog_reload_request();
	if (mode == 'preview') return strategy_preview(input, context);
	if (mode == 'validate') return strategy_validate(input, context);
	if (mode == 'apply') {
		let shape = input_shape(input, true);
		if (!shape.ok) return shape;
		return strategy_apply(input, context);
	}
	if (mode == 'import_profiles')
		return testContext == true ? strategy_import_profiles_test(input, context) : strategy_import_profiles(input);
	return error_result('EINPUT', 'unknown Strategy operation');
}

export const strategy_cli_dispatch = function(mode, input, context) {
	return dispatch_result(mode, input, context, false);
};

export const strategy_cli_dispatch_test = function(mode, input, context) {
	if (getenv(SERVER_TEST_MARKER) != '1')
		return error_result('EINPUT', 'server-test dispatcher is unavailable');
	return dispatch_result(mode, input, context, true);
};

export const strategy_cli_request = function(mode, path) {
	if (mode == 'reconcile') return dispatch_result(mode, null);
	let input = request(path);
	return dispatch_result(mode, input);
};
