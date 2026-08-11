'use strict';
// Strategy Preview/Validate is a read-only RPC adapter. It resolves identity,
// catalog provenance, and runtime composition on the server, then delegates
// candidate construction to the shared Strategy compiler.

import { readfile, stat, readlink, popen } from 'fs';
import { strategy_catalog_load, strategy_catalog_get,
 strategy_catalog_status, strategy_catalog_reload, catalog_entry_to_strategy } from './strategy-catalog.uc';
import { strategy_user_list, strategy_user_get_readonly, strategy_duplicate,
 strategy_selection_get, strategy_apply_uncertain_get,
 strategy_apply_uncertain_record, strategy_apply_reconcile, strategy_apply_guard_status, strategy_apply_begin, strategy_apply_end } from './strategy-state.uc';
import * as strategy_state from './strategy-state.uc';
import { strategy_candidate, strategy_effective_argv } from './strategy-compiler.uc';
import { profiles_apply_candidate, profiles_config_hash, profiles_candidate_hash, profiles_reconcile_evidence } from './profiles-apply.uc';

const DEFAULT_CATALOG_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const ENGINE_PATH = '/opt/zapret2/nfq2/nfqws2';
const CONFIG_LOCK = getenv('Z2M_STRATEGY_CONFIG_LOCK') || '/opt/zapret2/config.lock';
const PROFILE_APPLY_MODULE = getenv('Z2M_STRATEGY_PROFILE_MODULE') || '/usr/libexec/zapret2-manager/profiles-apply.uc';
const STATE_MODULE = getenv('Z2M_STRATEGY_STATE_MODULE') || '/usr/libexec/zapret2-manager/strategy-state.uc';
const UCODE_BIN = getenv('Z2M_STRATEGY_UCODE_BIN') || '/usr/bin/ucode';
const MAX_REQUEST_BYTES = 524288;
const MAX_STRATEGY_RESPONSE_BYTES = 4 * 1024 * 1024;
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
const ERROR_CODES = ['EINPUT', 'ENOENT', 'ECONFLICT', 'ENOENABLED', 'EDEPENDENCY',
	'EPREFLIGHT', 'EVERIFY', 'EINTERNAL', 'ELOCK', 'EUNCERTAIN', 'ERECONCILE', 'EIO',
	'EOUTPUT', 'ECHILD'];

function is_object(value) { return type(value) == 'object' && value != null; }
function is_string(value) { return type(value) == 'string'; }
function is_integer(value) { return type(value) == 'int' && value >= 0; }
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

let APPLY_HOOK = null, APPLY_HOOK_LOADED = false;

function apply_hook_value(section, name) {
	if (!APPLY_HOOK_LOADED) {
		APPLY_HOOK_LOADED = true;
		let raw = getenv('Z2M_STRATEGY_APPLY_HOOK');
		if (raw != null && length(raw) <= 65536) try { APPLY_HOOK = json(raw); } catch (e) { APPLY_HOOK = null; }
	}
	let group = is_object(APPLY_HOOK) ? APPLY_HOOK[section] : null;
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

function bounded_strategy_response(value, label) {
	let encoded = serialize(value);
	if (encoded == null || length(encoded) > MAX_STRATEGY_RESPONSE_BYTES)
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

function minimal_dependencies() {
	return {
		available: false, items: [], missing: [], structurallyCompilable: false,
		nativeValidation: validation_record(null)
	};
}

function catalog() {
	let root = getenv('Z2M_STRATEGY_CATALOG_ROOT') || DEFAULT_CATALOG_ROOT;
	let loaded = null;
	try { loaded = strategy_catalog_load(root); } catch (e) { loaded = null; }
	if (!is_object(loaded) || loaded.ok != true || !is_object(loaded.catalog))
		return error_result('EVERIFY', 'verified Avatar catalog is unavailable');
	return loaded.catalog;
}

function input_shape(input, requireSource) {
	if (!is_object(input)) return error_result('EINPUT', 'Strategy request must be an object');
	let forbidden = ['candidate', 'command', 'argv', 'effectiveCommand', 'effectiveArgv', 'strategyArgs', 'args'];
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

function trusted_context(context) {
	let result = {
		environment: {},
		runtimeInputs: {
			source: 'live', enginePath: ENGINE_PATH, baseArgs: [], luaInit: [], hostlists: []
		},
		reconciliation: null
	};
	// This second argument is an internal server context, never request data.
	// Admission is intentionally not accepted here: this CLI's only native gate
	// is the explicit request validate=true flag.
	if (!is_object(context)) return result;
	if (is_object(context.environment)) {
		for (let key in context.environment)
			if (key != 'executionAdmission' && key != 'validate') result.environment[key] = context.environment[key];
	}
	if (is_object(context.runtimeInputs)) result.runtimeInputs = context.runtimeInputs;
	if (is_object(context.reconciliation)) result.reconciliation = context.reconciliation;
	return result;
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
	let trusted = trusted_context(context), environment = trusted.environment;
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

function strategy_apply_projection(resolved, input, candidate, selection, configHash) {
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
	let currentCatalog = catalog();
	if (!is_object(currentCatalog) || currentCatalog.ok == false) return strategy_apply_finish(currentCatalog, begun.operationNonce);
	let resolved = resolve_strategy(input, currentCatalog);
	if (!resolved.ok) return strategy_apply_finish(resolved, begun.operationNonce);
	let trusted = trusted_context(context);
	trusted.environment.validate = true;
	trusted.environment.executionAdmission = true;
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
	let projection = strategy_apply_projection(resolved, input, candidate, selection, begun.oldConfigSha256);
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

function catalog_root() {
	return getenv('Z2M_STRATEGY_CATALOG_ROOT') || DEFAULT_CATALOG_ROOT;
}

function load_request_catalog() {
	let loaded = null;
	try { loaded = strategy_catalog_load(catalog_root()); } catch (e) { loaded = null; }
	return is_object(loaded) && loaded.ok == true && is_object(loaded.catalog)
		? loaded.catalog : error_result('EVERIFY', 'verified Avatar catalog is unavailable');
}

function catalog_strategy(entry) {
	let strategy = null;
	try { strategy = catalog_entry_to_strategy(entry); } catch (e) { strategy = null; }
	if (!is_object(strategy)) return null;
	strategy.origin = 'avatar_builtin';
	strategy.is_builtin = true;
	return strategy;
}

function strategy_list() {
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	let strategies = [];
	let order = is_object(current.winners) && type(current.winnerOrder) == 'array'
		? current.winnerOrder : keys(current.winners || {});
	for (let id in order) {
		let strategy = catalog_strategy(current.winners[id]);
		if (strategy == null) return error_result('EVERIFY', 'catalog Strategy normalization failed');
		push(strategies, strategy);
	}
	let users = null;
	try { users = strategy_user_list(); } catch (e) { users = null; }
	if (!is_object(users) || users.ok != true) return users || error_result('EIO', 'User Strategy list is unavailable');
	for (let strategy in users.strategies) push(strategies, strategy);
	return bounded_strategy_response({ ok: true, strategies: strategies }, 'Strategy list');
}

function strategy_get(input) {
	if (!is_object(input) || !safe_id(input.id)) return error_result('EINPUT', 'Strategy get requires a safe id');
	let user = null;
	try { user = strategy_user_get_readonly({ id: input.id }); } catch (e) { user = null; }
	if (is_object(user) && user.ok == true) return bounded_strategy_response(user, 'Strategy detail');
	if (is_object(user) && user.error && user.error.code != 'ENOENT') return user;
	let current = load_request_catalog();
	if (!is_object(current) || current.ok == false) return current;
	let entry = null;
	try { entry = strategy_catalog_get(input.id); } catch (e) { entry = null; }
	if (is_object(entry) && entry.error) return entry;
	let strategy = catalog_strategy(entry);
	return strategy == null ? error_result('ENOENT', 'Strategy was not found')
		: bounded_strategy_response({ ok: true, strategy: strategy }, 'Strategy detail');
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

function dispatch_result(mode, input, context) {
	if (mode == 'reconcile') return strategy_reconcile(input, context);
	if (mode == 'list') return strategy_list();
	if (mode == 'get') return strategy_get(input);
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
	// Profile-to-Strategy import is intentionally owned by the next task. Keep
	// the RPC route explicit without accepting or interpreting a client command.
	if (mode == 'import_profiles') return error_result('EINPUT', 'Profile import is not available');
	return error_result('EINPUT', 'unknown Strategy operation');
}

export const strategy_cli_dispatch = dispatch_result;

export const strategy_cli_request = function(mode, path) {
	if (mode == 'reconcile') return dispatch_result(mode, null);
	let input = request(path);
	return dispatch_result(mode, input);
};
