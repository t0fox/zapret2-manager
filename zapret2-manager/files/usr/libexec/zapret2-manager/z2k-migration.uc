'use strict';

// Z2K migration is an evidence contract inside the existing Resource Center
// transaction. It does not write receipts, Registry state, runtime bytes, or
// user data. Asset Registry finalization and the existing pending-activation
// rollback remain the only mutation authorities.

import { asset_registry_list } from './asset-registry.uc';
import { z2k_registry_receipt_state } from './z2k-installed-release.uc';

function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int'; }
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

// This is deliberately stricter than the state label used by older code. A
// V3 schema/bundle pair without its release, digest, runtime, Detect, and
// authority identity is not coherent and must not authorize migration state.
function v3_shape(receipt) {
	return object(receipt) && receipt.schema == 'asset-activation-receipt.v3' && receipt.bundleId == 'z2k-curated-lua'
		&& release(receipt.release) && receipt.version == receipt.release && commit(receipt.sourceCommit)
		&& integer(receipt.manifestSeq) && digest(receipt.manifestSha256) && digest(receipt.classificationSha256)
		&& digest(receipt.runtimeBundleDigest) && digest(receipt.compilerInputsDigest) && digest(receipt.catalogDigest)
		&& digest(receipt.compatibilityIdentity) && array(receipt.runtimeMembership) && length(receipt.runtimeMembership)
		&& object(receipt.detect) && string(receipt.detect.arch) && digest(receipt.detect.digest)
		&& integer(receipt.detect.size) && receipt.detect.size >= 0
		&& (receipt.detect.sourceCommit == null || lc(receipt.detect.sourceCommit) == lc(receipt.sourceCommit));
}
function legacy_shape(receipt) {
	return object(receipt) && (receipt.schema == 'asset-activation-receipt.v1' || receipt.schema == 'asset-activation-receipt.v2')
		&& receipt.bundleId == 'z2k-curated-lua';
}

// Canonical state classifier. V1/V2 are evidence for the legacy contract;
// only a complete V3 receipt proves the coherent contract. Malformed V3 is
// NONE, not legacy and never an implicit migration success.
export const z2k_migration_state = function(input) {
	let receipt = receipt_from(input);
	if (v3_shape(receipt)) return 'COHERENT_Z2K';
	if (legacy_shape(receipt)) return 'LEGACY_Z2K';
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
	let value = object(input) ? input : {};
	return {
		discoveredDomains: copy(value.discoveredDomains == null ? [] : value.discoveredDomains),
		sourceSelection: copy(value.sourceSelection == null ? null : value.sourceSelection),
		exclusions: copy(value.exclusions == null ? [] : value.exclusions),
		userStrategies: copy(value.userStrategies == null ? [] : value.userStrategies),
		runtimeData: copy(value.runtimeData == null ? {} : value.runtimeData)
	};
}
function same_value(left, right) { return sprintf('%J', left) == sprintf('%J', right); }
function preserved_equal(left, right) {
	return object(left) && object(right)
		&& same_value(left.discoveredDomains, right.discoveredDomains)
		&& same_value(left.sourceSelection, right.sourceSelection)
		&& same_value(left.exclusions, right.exclusions)
		&& same_value(left.userStrategies, right.userStrategies)
		&& same_value(left.runtimeData, right.runtimeData);
}
function prepared_shape(value) {
	return object(value) && value.schema == 'z2k-migration-prepared.v1' && object(value.preserved)
		&& ((value.required === true && legacy_shape(value.legacyReceipt)) || (value.required === false && string(value.state)));
}

// Prepare captures the legacy receipt and every user/runtime preservation
// field before the transaction starts. It is pure and can be persisted in the
// ordinary target/pending records without creating another authority.
export const z2k_migration_prepare = function(input) {
	if (!object(input)) return fail('EINPUT', 'Z2K migration prepare input is incomplete.');
	let before = receipt_from(input), state = z2k_migration_state({ activeReceipt: before });
	if (state == 'COHERENT_Z2K') return { ok: true, migration: { schema: 'z2k-migration-prepared.v1', required: false, state: state, preserved: preserved(input) } };
	if (state != 'LEGACY_Z2K') return { ok: true, migration: { schema: 'z2k-migration-prepared.v1', required: false, state: state, preserved: preserved(input) } };
	return { ok: true, migration: { schema: 'z2k-migration-prepared.v1', required: true, state: state, legacyReceipt: copy(before), preserved: preserved(input) } };
};

// Commit verifies the receipt already written by Asset Registry finalization.
// It never constructs or writes a V3 receipt; a candidate that is not a strict
// V3 shape is a blocking failure.
export const z2k_migration_commit = function(input) {
	if (!object(input) || !prepared_shape(input.prepared)) return fail('EINPUT', 'Z2K migration commit has no prepared legacy evidence.');
	let prepared = input.prepared;
	if (prepared.required !== true) return { ok: true, required: false, state: prepared.state, preserved: copy(prepared.preserved) };
	let finalReceipt = object(input.finalReceipt) ? input.finalReceipt : input.activeReceipt;
	if (!v3_shape(finalReceipt)) return fail('EVERIFY', 'Asset Registry finalization did not produce a complete V3 receipt.', { blocking: true, state: 'LEGACY_Z2K' });
	let actual = object(input.preserved) ? input.preserved : preserved(input);
	if (!preserved_equal(prepared.preserved, actual)) return fail('EVERIFY', 'Legacy user/runtime preservation evidence changed during coherent activation.', { blocking: true });
	return { ok: true, required: true, state: 'COHERENT_Z2K', activeReceipt: copy(finalReceipt), preserved: copy(prepared.preserved) };
};

// Rollback is evidence only. The caller invokes the existing pending
// activation rollback, which restores the captured Registry receipt, runtime,
// Detect, source/catalog, and config authorities.
export const z2k_migration_rollback = function(input) {
	if (!object(input) || !prepared_shape(input.prepared)) return fail('EINPUT', 'Z2K migration rollback has no prepared legacy evidence.');
	return { ok: false, mutated: false, rolledBack: true, state: 'LEGACY_Z2K',
		activeReceipt: copy(input.prepared.legacyReceipt), preserved: copy(input.prepared.preserved),
		error: { code: 'EMIGRATION', message: input.reason || 'Coherent activation did not commit; the legacy receipt remains active.' } };
};
