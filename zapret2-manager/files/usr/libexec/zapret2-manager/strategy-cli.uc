'use strict';
// Strategy Preview/Validate is a read-only RPC adapter. It resolves identity,
// catalog provenance, and runtime composition on the server, then delegates
// candidate construction to the shared Strategy compiler.

import { readfile, stat, readlink, lsdir, popen } from 'fs';
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
import { profiles_apply_candidate, profiles_config_hash, profiles_candidate_hash, profiles_reconcile_evidence } from './profiles-apply.uc';
import { resolveInstalled } from './runtime-composition.uc';
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
const MAX_OUTPUT_ARG_BYTES = 4096;
const MAX_OUTPUT_ARRAY_ITEMS = 256;
const MAX_DEPENDENCY_TEXT = 256;
const MAX_DEPENDENCY_ITEMS = 32;
const MAX_DEPENDENCY_BYTES = 16384;
const MAX_IMPORT_PROFILES = 256;
const MAX_IMPORT_DIAGNOSTICS = 16;
const MAX_IMPORT_NAME = 256;
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

function safe_id(value) {
	return is_string(value) && length(value) > 0 && length(value) <= 128
		&& index(value, chr(0)) < 0 && index(value, '/') < 0 && index(value, '..') < 0;
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
	return {
		available: record.available == true,
		items: items,
		missing: missing,
		structurallyCompilable: record.structurallyCompilable == true,
		nativeValidation: validation_record(record.nativeValidation)
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
		|| length(value.effectiveCommand) > MAX_OUTPUT_TEXT) return null;
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

function runtime_target_path(target) {
	if (!is_string(target)) return null;
	if (starts_with(target, '/opt/zapret2/')) return target;
	if (starts_with(target, '/runtime-assets/lua/')) return '/opt/zapret2/lua/' + substr(target, length('/runtime-assets/lua/'));
	if (starts_with(target, '/runtime-assets/bin/')) return '/opt/zapret2/files/fake/' + substr(target, length('/runtime-assets/bin/'));
	if (starts_with(target, '/runtime-assets/lists/')) return '/opt/zapret2/lists/' + substr(target, length('/runtime-assets/lists/'));
	if (starts_with(target, '/runtime-assets/ipset/')) return '/opt/zapret2/ipset/' + substr(target, length('/runtime-assets/ipset/'));
	return null;
}

function runtime_snapshot_valid(value) {
	return is_object(value) && value.ok == true && value.lifecycleState == 'installed'
		&& value.compositionStatus == 'canonical' && is_string(value.snapshotId)
		&& is_string(value.compositionSnapshotId) && is_string(value.membershipDigest)
		&& is_integer(value.observedRegistryRevision) && type(value.runtimeAssets) == 'array'
		&& type(value.luaInit) == 'array' && is_object(value.dependencyIndex);
}

function runtime_composition_for_apply() {
	let injected = apply_hook_value('runtimeComposition', null);
	if (injected != null) return injected;
	try { return resolveInstalled({}); }
	catch (e) { return error_result('ESTALE', 'installed runtime composition could not be resolved'); }
}

function runtime_snapshot_equal(left, right) {
	if (!runtime_snapshot_valid(left) || !runtime_snapshot_valid(right)) return false;
	for (let key in ['snapshotId', 'compositionSnapshotId', 'membershipDigest', 'observedRegistryRevision'])
		if (left[key] != right[key]) return false;
	for (let key in ['lifecycleIdentity', 'receiptIdentity', 'runtimeAssets', 'luaInit', 'dependencyIndex'])
		if (sprintf('%J', left[key]) != sprintf('%J', right[key])) return false;
	return true;
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
	for (let fn in fakeFiles) {
		if (!is_string(fn) || !length(fn)) continue;
		liveBlobs[fn] = { path: fn, present: true };
	}
	liveBlobs['fake_default_tls'] = { present: true, safe: true };
	liveBlobs['fake_default_http'] = { present: true, safe: true };
	liveBlobs['fake_default_quic'] = { present: true, safe: true };
	liveBlobs['tls_google'] = { path: 'tls_clienthello_www_google_com.bin', present: stat('/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin') != null, safe: true };
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
	let used = [], baseArgs = [];
	for (let i = 0; i < length(configured); i++) used[i] = false;
	for (let i = 1; i < length(found[0]); i++) {
		let matched = -1;
		for (let j = 0; j < length(configured); j++)
			if (!used[j] && configured[j] == found[0][i]) { matched = j; break; }
		if (matched >= 0) used[matched] = true;
		else push(baseArgs, found[0][i]);
	}
	let composition = runtime_composition_for_apply();
	if (!runtime_snapshot_valid(composition)) return runtime_snapshot_error(composition);
	let luaInit = composition_lua_inputs(composition), hostlists = [];
	if (luaInit == null) return error_result('ESTALE', 'installed runtime composition Lua closure is invalid');
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
	for (let fn in fakeFiles) {
		if (!is_string(fn) || !length(fn)) continue;
		liveBlobs[fn] = { path: fn, present: true };
	}
	liveBlobs['fake_default_tls'] = { present: true, safe: true };
	liveBlobs['fake_default_http'] = { present: true, safe: true };
	liveBlobs['fake_default_quic'] = { present: true, safe: true };
	liveBlobs['tls_google'] = { path: 'tls_clienthello_www_google_com.bin', present: stat('/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin') != null, safe: true };
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

	return { ok: true, runtimeComposition: composition, environment: {
		listMode: 'none', paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/files/fake', listRoot: '/lists', ipsetRoot: '/lists' },
		functions: liveFunctions, blobs: liveBlobs, lua: liveLua, lists: {}, runtimeComposition: composition
	}, runtimeInputs: { source: 'live', enginePath: ENGINE_PATH, baseArgs: baseArgs, luaInit: luaInit, hostlists: hostlists } };
}

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
		if (!safe_id(input.strategy_id) || !is_integer(input.revision) || !digest(input.catalog_digest))
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
	if (requireSource == true && !hasId) return error_result('EINPUT', 'this operation requires persisted Strategy identity');
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
			return { ok: true, strategy: user.strategy, id: input.strategy_id, origin: 'user' };
		}
		if (is_object(user) && user.error && user.error.code != 'ENOENT')
			return error_result(user.error.code, user.error.message);
		let entry = is_object(currentCatalog.winners) ? currentCatalog.winners[input.strategy_id] : null;
		if (entry == null)
			return error_result('ENOENT', 'Strategy was not found');
		if (input.revision != 0) return error_result('ECONFLICT', 'catalog Strategy revision is stale');
		let strategy = catalog_entry_to_strategy(entry);
		if (strategy == null) return error_result('EVERIFY', 'catalog Strategy normalization failed');
		strategy.origin = 'avatar_builtin';
		return { ok: true, strategy: strategy, id: input.strategy_id, origin: 'avatar_builtin' };
	}
	return { ok: true, strategy: input.strategy_data, id: input.strategy_data.id, origin: 'inline' };
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

function candidate_projection(resolved, candidate, effective, validation, includeValidation) {
	let empty = candidate.profilesCount == 0;
	let args = empty ? [] : candidate.strategyArgs;
	if (!is_string(resolved.id) || length(resolved.id) > 128
		|| !is_string(resolved.origin) || length(resolved.origin) > 32) return null;
	if (!empty && (!is_string(args) || length(args) > MAX_OUTPUT_TEXT)) return null;
	let effectiveValue = effective_projection(effective);
	if (effectiveValue == null) return null;
	let dependencies = dependencies_record(candidate.dependencies), dependencyText = serialize(dependencies);
	if (dependencies == null || dependencyText == null || length(dependencyText) > MAX_DEPENDENCY_BYTES) return null;
	let result = {
		strategyId: bounded_identity(resolved.id, 128), origin: bounded_identity(resolved.origin, 32),
		strategyArgs: args, args: args,
		effectiveCommand: effectiveValue.effectiveCommand, effectiveArgv: effectiveValue.effectiveArgv,
		fullCommand: effectiveValue.fullCommand, fullArgv: effectiveValue.fullArgv,
		profiles_count: candidate.profilesCount, profilesCount: candidate.profilesCount,
		dependencies: dependencies, digest: candidate.digest,
		applicable: candidate.applicable == true
	};
	if (includeValidation == true) result.validation = validation;
	return result;
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
	let candidate = null;
	try { candidate = strategy_candidate(resolved.strategy, environment); }
	catch (e) { return error_result('EINTERNAL', 'Strategy compilation failed'); }
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
	return {
		candidateSha256: candidate.digest,
		callerContext: 'strategy_apply', operationNonce: selection.operationNonce,
		strategyId: resolved.id, strategyOrigin: resolved.origin, strategyRevision: input.revision,
		catalogDigest: input.catalog_digest,
		expectedRevision: selection.revision,
		selectionRevision: selection.revision, expectedSelected: selection.selected,
		previousCandidateSha256: selection.previousCandidateSha256,
		expectedConfigSha256: configHash,
		previousSelected: selection.selected,
		selected: {
			id: resolved.id, origin: resolved.origin, revision: input.revision,
			candidateSha256: candidate.digest
		}
	};
}

function strategy_apply_candidate(resolved, environment) {
	let injected = apply_hook_value('candidate', null);
	return is_object(injected) ? injected : strategy_candidate(resolved.strategy, environment);
}

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
	try { begun = strategy_apply_begin({ strategyId: input.strategy_id, strategyRevision: input.revision, catalogDigest: input.catalog_digest,
		oldConfigSha256: oldConfigSha256, oldCandidateSha256: oldCandidateSha256 }); }
	catch (e) { begun = null; }
	if (!is_object(begun) || begun.ok != true)
		return error_result(begun && begun.error ? begun.error.code : 'EUNCERTAIN', begun && begun.error ? begun.error.message : 'Strategy Apply guard could not be established.');
	// Validate the installed runtime authority independently of the request and
	// retain it for the compiler/preflight transaction. A client snapshotId is
	// deliberately not consulted here.
	let installedSnapshot = runtime_composition_for_apply();
	if (!runtime_snapshot_valid(installedSnapshot))
		return strategy_apply_finish(runtime_snapshot_error(installedSnapshot), begun.operationNonce);
	let currentCatalog = catalog();
	if (!is_object(currentCatalog) || currentCatalog.ok == false) return strategy_apply_finish(currentCatalog, begun.operationNonce);
	let resolved = resolve_strategy(input, currentCatalog);
	if (!resolved.ok) return strategy_apply_finish(resolved, begun.operationNonce);
	let trusted = server_context(context);
	if (!trusted.ok && apply_hook_value('candidate', null) == null)
		return strategy_apply_finish(trusted, begun.operationNonce);
	if (!trusted.ok) trusted = { ok: true, environment: {} };
	trusted.environment.validate = true;
	trusted.environment.executionAdmission = true;
	trusted.environment.runtimeComposition = installedSnapshot;
	let candidate = null;
	try { candidate = strategy_apply_candidate(resolved, trusted.environment); }
	catch (e) { return strategy_apply_finish(error_result('EINTERNAL', 'Strategy compilation failed'), begun.operationNonce); }
	if (!is_object(candidate) || candidate.ok != true)
		return strategy_apply_finish(error_result(candidate && candidate.error ? candidate.error.code : 'EINTERNAL',
			candidate && candidate.error ? candidate.error.message : 'Strategy compilation failed'), begun.operationNonce);
	if (candidate.profilesCount == 0)
		return strategy_apply_finish(error_result('ENOENABLED', 'Strategy requires at least one enabled Profile'), begun.operationNonce);
	if (!is_object(candidate.dependencies) || candidate.dependencies.available != true)
		return strategy_apply_finish(error_result('EDEPENDENCY', 'Strategy dependencies are unavailable'), begun.operationNonce);
	if (!complete_validation(candidate.nativeValidation))
		return strategy_apply_finish(error_result('EPREFLIGHT', 'complete native Strategy preflight is required'), begun.operationNonce);
	if (!digest(candidate.digest)) return strategy_apply_finish(error_result('EINTERNAL', 'Strategy candidate digest is unavailable'), begun.operationNonce);
	if (!digest(oldConfigSha256) || !digest(oldCandidateSha256))
		return strategy_apply_finish(error_result('EVERIFY', 'authoritative pre-Apply config and candidate hashes are unavailable'), begun.operationNonce);
	let selection = { revision: begun.selectionRevision, selected: begun.selected,
		operationNonce: begun.operationNonce, previousCandidateSha256: begun.oldCandidateSha256 };
	// Resolve the authority again immediately before handing control to the
	// existing profile transaction. Any Registry, receipt, membership, order,
	// or composition change is ESTALE; profiles_apply_candidate is never called.
	let finalSnapshot = runtime_composition_for_apply();
	if (!runtime_snapshot_valid(finalSnapshot) || !runtime_snapshot_equal(installedSnapshot, finalSnapshot))
		return strategy_apply_finish(error_result('ESTALE', 'installed runtime composition changed during Strategy Apply', {
			before: installedSnapshot, after: finalSnapshot
		}), begun.operationNonce);
	let projection = strategy_apply_projection(resolved, input, candidate, selection, begun.oldConfigSha256, installedSnapshot);
	let applied = profiles_apply_candidate(candidate.candidate, candidate.digest, projection);
	if (!is_object(applied)) return strategy_apply_finish(error_result('EINTERNAL', 'Strategy transaction returned no result'), begun.operationNonce);
	if (applied.ok != true) {
		return strategy_apply_finish(applied, begun.operationNonce, projection);
	}
	applied.strategy = { id: resolved.id, origin: resolved.origin, revision: input.revision,
		candidateSha256: candidate.digest };
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
	strategy.origin = 'avatar_builtin';
	strategy.is_builtin = true;
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
			'label', 'author', 'protocol', 'featured', 'origin', 'revision'])
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
	let selected = selection && selection.selected;
	let revision = type(result.revision) == 'int' ? result.revision : 0;
	result.revision = revision;
	result.is_active = is_object(selected) && selected.id == result.id
		&& selected.origin == result.origin && selected.revision == revision;
	result.is_favorite = type(selection.favorites) == 'array' && index(selection.favorites, result.id) >= 0;
	result.metadata = result.origin == 'avatar_builtin'
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
	let order = is_object(current.winners) && type(current.winnerOrder) == 'array'
		? current.winnerOrder : keys(current.winners || {});
	for (let id in order) {
		let strategy = catalog_strategy(current.winners[id]);
		if (strategy == null) return error_result('EVERIFY', 'catalog Strategy normalization failed');
		push(strategies, wire_strategy_for_list(strategy, current, selection));
	}
	let users = null;
	try { users = strategy_user_list(); } catch (e) { users = null; }
	if (!is_object(users) || users.ok != true) return users || error_result('EIO', 'User Strategy list is unavailable');
	for (let strategy in users.strategies) push(strategies, wire_strategy_for_list(strategy, current, selection));
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
	if (!is_object(input) || !safe_id(input.id)) return error_result('EINPUT', 'Strategy get requires a safe id');
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	let selection = null;
	try { selection = strategy_selection_get(); } catch (e) { selection = null; }
	if (!is_object(selection) || selection.ok != true || type(selection.favorites) != 'array')
		return error_result('EIO', 'Strategy favorites state is unavailable');
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

function strategy_discord_donor_request() {
	try { return discord_autocircular_donor(); }
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
	if (mode == 'discord_donor') return strategy_discord_donor_request();
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
