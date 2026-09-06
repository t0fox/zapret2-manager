'use strict';

// Legacy-to-coherent migration is a projection over the existing Registry /
// receipt transaction. It never mutates an active owner by itself. The normal
// Resource Center transaction supplies the commit and rollback authorities.

import { asset_registry_list } from './asset-registry.uc';
import { z2k_registry_receipt_state } from './z2k-installed-release.uc';

function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int'; }
function text(value) { return value == null ? '' : '' + value; }
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return value; } }
function fail(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	for (let key in extra || {}) result.error[key] = extra[key];
	return result;
}
function digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function release(value) { return string(value) && match(value, /^[rp]-[0-9]+(\.[0-9]+)?$/); }

function receipt_from(input) {
	if (object(input) && object(input.activeReceipt)) return input.activeReceipt;
	if (object(input) && object(input.receipt)) return input.receipt;
	if (object(input) && object(input.registry)) {
		let state = z2k_registry_receipt_state(input.registry);
		return state && state.receipt;
	}
	try {
		let state = z2k_registry_receipt_state(asset_registry_list(null));
		return state && state.receipt;
	} catch (e) { return null; }
}

function v3_shape(receipt) {
	return object(receipt) && receipt.schema == 'asset-activation-receipt.v3' && receipt.bundleId == 'z2k-curated-lua'
		&& release(receipt.release || receipt.version) && commit(receipt.sourceCommit)
		&& array(receipt.runtimeMembership) && length(receipt.runtimeMembership)
		&& object(receipt.detect) && string(receipt.detect.arch) && digest(receipt.detect.digest);
}

// Canonical state classifier. V1/V2 are evidence for the legacy contract;
// only a complete V3 receipt proves the coherent contract.
export const z2k_migration_state = function(input) {
	let receipt = receipt_from(input);
	if (object(receipt) && receipt.schema == 'asset-activation-receipt.v3' && receipt.bundleId == 'z2k-curated-lua') return 'COHERENT_Z2K';
	if (object(receipt) && (receipt.schema == 'asset-activation-receipt.v1' || receipt.schema == 'asset-activation-receipt.v2')) return 'LEGACY_Z2K';
	return 'NONE';
};

export const z2k_lua_function_closure = function(input) {
	if (!object(input) || !array(input.references) || !array(input.available)) return fail('EINPUT', 'Lua closure evidence is incomplete.');
	let available = {}, missing = [];
	for (let name in input.available) if (string(name)) available[name] = true;
	for (let reference in input.references) {
		let name = object(reference) ? reference.functionName : null;
		if (!string(name) || available[name]) continue;
		return fail('ECOMPATIBILITY', 'Z2K candidate references a missing Lua function.', {
			functionName: name, strategyId: reference.strategyId || null, profile: reference.profile || null,
			blocking: true, reason: 'lua-function-closure'
		});
	}
	return { ok: true, missing: missing };
};

function preserved(input) {
	return { discoveredDomains: copy(input.discoveredDomains || []), sourceSelection: copy(input.sourceSelection || null),
		exclusions: copy(input.exclusions || []), userStrategies: copy(input.userStrategies || []) };
}
function equal_array(left, right) {
	if (!array(left) || !array(right) || length(left) != length(right)) return false;
	for (let i = 0; i < length(left); i++) if (text(left[i]) != text(right[i])) return false;
	return true;
}

export const z2k_migration_apply = function(input) {
	if (!object(input) || input.testOnly !== true) return fail('EINPUT', 'Migration projection is restricted to the lifecycle transaction.');
	let before = receipt_from(input), data = preserved(input);
	if (z2k_migration_state({ activeReceipt: before }) != 'LEGACY_Z2K') return fail('EINCONSISTENT', 'Only V1/V2 active Z2K receipts can be migrated.');
	if (input.migrationCommit !== true) return { ok: false, mutated: false, activeReceipt: copy(before), preserved: data, error: { code: 'EMIGRATION', message: 'Coherent activation did not commit; legacy LKG remains active.' } };
	let candidate = input.candidate;
	if (!object(candidate) || !array(candidate.runtimeMembership) || !length(candidate.runtimeMembership) || !object(candidate.detect))
		return { ok: false, mutated: false, activeReceipt: copy(before), preserved: data, error: { code: 'EINPUT', message: 'Coherent candidate evidence is incomplete.' } };
	let after = copy(candidate);
	after.schema = 'asset-activation-receipt.v3'; after.bundleId = 'z2k-curated-lua'; after.version = candidate.release;
	after.release = candidate.release; after.z2kMembership = copy(candidate.runtimeMembership);
	return { ok: true, mutated: true, activeReceipt: after, preserved: data,
		discoveredDomainsPreserved: array(data.discoveredDomains) && array(input.discoveredDomains || []) };
};
