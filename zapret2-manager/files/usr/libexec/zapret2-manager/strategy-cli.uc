'use strict';
// Strategy Preview/Validate is a read-only RPC adapter. It resolves identity,
// catalog provenance, and runtime composition on the server, then delegates
// candidate construction to the shared Strategy compiler.

import { readfile, stat, readlink } from 'fs';
import { strategy_catalog_load, catalog_entry_to_strategy } from './strategy-catalog.uc';
import { strategy_user_get } from './strategy-state.uc';
import { strategy_candidate, strategy_effective_argv } from './strategy-compiler.uc';

const DEFAULT_CATALOG_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const ENGINE_PATH = '/opt/zapret2/nfq2/nfqws2';
const MAX_REQUEST_BYTES = 524288;
const MAX_INLINE_BYTES = 262144;
const MAX_TEXT = 512;
const MAX_DIAGNOSTICS = 32;
const MAX_DEPENDENCIES = 256;
const ERROR_CODES = ['EINPUT', 'ENOENT', 'ECONFLICT', 'ENOENABLED', 'EDEPENDENCY',
	'EPREFLIGHT', 'EVERIFY', 'EINTERNAL'];

function is_object(value) { return type(value) == 'object' && value != null; }
function is_string(value) { return type(value) == 'string'; }
function is_integer(value) { return type(value) == 'int' && value >= 0; }
function bounded_text(value, maximum) {
	if (!is_string(value)) return '';
	return length(value) > maximum ? substr(value, 0, maximum) : value;
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
	for (let i = 0; i < length(value) && i < MAX_DIAGNOSTICS; i++) {
		let item = value[i];
		if (!is_object(item)) continue;
		push(result, {
			severity: bounded_text(item.severity, 32),
			code: bounded_text(item.code, 64),
			message: bounded_text(item.message, MAX_TEXT),
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
	for (let item in copy_array(record.items, MAX_DEPENDENCIES)) {
		if (!is_object(item)) continue;
		push(items, {
			key: bounded_text(item.key, MAX_TEXT), kind: bounded_text(item.kind, 32),
			id: bounded_text(item.id, MAX_TEXT), reference: bounded_text(item.reference, MAX_TEXT),
			available: item.available == true,
			reason: item.available == true ? null : bounded_text(item.reason, MAX_TEXT)
		});
	}
	for (let item in copy_array(record.missing, MAX_DEPENDENCIES)) {
		if (!is_object(item)) continue;
		push(missing, {
			key: bounded_text(item.key, MAX_TEXT), kind: bounded_text(item.kind, 32),
			id: bounded_text(item.id, MAX_TEXT), reference: bounded_text(item.reference, MAX_TEXT),
			available: false, reason: bounded_text(item.reason, MAX_TEXT)
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
		try { user = strategy_user_get({ id: input.strategy_id }); } catch (e) { user = null; }
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
		}
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

function candidate_projection(resolved, candidate, effective, validation, includeValidation) {
	let empty = candidate.profilesCount == 0;
	let args = empty ? [] : candidate.strategyArgs;
	let result = {
		strategyId: resolved.id, origin: resolved.origin,
		strategyArgs: args, args: args,
		effectiveCommand: effective.effectiveCommand, effectiveArgv: effective.effectiveArgv,
		profiles_count: candidate.profilesCount, profilesCount: candidate.profilesCount,
		dependencies: dependencies_record(candidate.dependencies), digest: candidate.digest,
		applicable: candidate.applicable == true
	};
	if (includeValidation == true) result.validation = validation;
	return result;
}

function validation_error(resolved, candidate, effective, validation, code, message) {
	let result = candidate_projection(resolved, candidate, effective, validation, true);
	result.ok = false;
	result.applicable = false;
	result.error = { code: error_code(code), message: bounded_text(message, MAX_TEXT) };
	return result;
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
	let effective = null;
	try { effective = strategy_effective_argv(candidate.strategyArgs, trusted.runtimeInputs); }
	catch (e) { effective = null; }
	if (!is_object(effective) || effective.ok != true)
		return error_result('EINPUT', 'authoritative effective command inputs are unavailable');
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
	result.ok = true;
	return result;
}

export const strategy_preview = function(input, context) {
	return evaluated(input, context, false, false);
};

export const strategy_validate = function(input, context) {
	return evaluated(input, context, true, true);
};

function request(path) {
	if (!is_string(path) || length(path) == 0 || length(path) > 256) return error_result('EINPUT', 'request path is invalid');
	let metadata = null;
	try { metadata = stat(path); } catch (e) { metadata = null; }
	if (!metadata || metadata.type != 'file' || type(metadata.size) != 'int' || metadata.size < 0
		|| readlink(path) != null || metadata.size > MAX_REQUEST_BYTES)
		return error_result('EINPUT', 'request file is not a bounded regular file');
	let raw = null;
	try { raw = readfile(path); } catch (e) { raw = null; }
	if (!is_string(raw) || length(raw) > MAX_REQUEST_BYTES) return error_result('EINPUT', 'request file is unreadable or oversized');
	let value = null;
	try { value = json(raw); } catch (e) { return error_result('EINPUT', 'request JSON is malformed'); }
	if (is_object(value) && is_object(value.args)) return value.args;
	return value;
}

function dispatch_result(mode, input) {
	let shape = input_shape(input, false);
	if (!shape.ok) return shape;
	if (mode == 'preview') return strategy_preview(input);
	if (mode == 'validate') return strategy_validate(input);
	return error_result('EINPUT', 'unknown Strategy operation');
}

export const strategy_cli_dispatch = dispatch_result;

export const strategy_cli_request = function(mode, path) {
	let input = request(path);
	return dispatch_result(mode, input);
};
