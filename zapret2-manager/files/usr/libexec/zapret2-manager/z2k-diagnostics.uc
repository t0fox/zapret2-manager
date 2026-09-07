'use strict';

// A read-only projection.  Each provider is an existing authority or a
// fixed status seam; this module never persists lifecycle truth.
const IDS = ['release_identity', 'activation_receipt', 'runtime_composition', 'lua_function_closure', 'runtime_assets', 'runtime_lists', 'compiler_snapshot', 'strategy_catalog', 'compatibility_identity', 'detect_binary', 'detect_json_contract', 'autodiscovery', 'discovered_domains', 'autocircular', 'tcp16', 'nfqueue', 'firewall', 'nfqws2'];
const MAX_EVIDENCE_BYTES = 8192;
import { z2k_registry_receipt_state } from './z2k-installed-release.uc';
import * as runtime_composition from './runtime-composition.uc';
import { asset_registry_list } from './asset-registry.uc';
import { strategy_catalog_status } from './strategy-catalog.uc';
import { z2k_detect_status, z2k_detect_discovery_status } from './z2k-detect.uc';
import { z2k_autocircular_identity_load } from './z2k-autocircular-identity.uc';

function object(value) { return type(value) == 'object' && value != null && type(value) != 'array'; }
function string(value) { return type(value) == 'string'; }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
function bounded(value) { try { return length(sprintf('%J', value)) <= MAX_EVIDENCE_BYTES; } catch (e) { return false; } }
function row(id, value) {
	if (!object(value) || !string(value.status) || index(['ok', 'warning', 'error', 'unavailable'], value.status) < 0 || (value.evidence != null && !object(value.evidence)) || !bounded(value.evidence)) return { id: id, status: 'error', evidence: null, error: { code: 'ESCHEMA', message: 'diagnostic projection is malformed' } };
	let error = value.error == null ? null : value.error;
	if (error != null && !object(error)) return { id: id, status: 'error', evidence: null, error: { code: 'ESCHEMA', message: 'diagnostic error is malformed' } };
	return { id: id, status: value.status, evidence: value.evidence == null ? null : value.evidence, error: error };
}
function projected(fn) {
	try {
		let value = fn();
		if (object(value) && value.ok === false) return { status: 'error', evidence: { authority: 'existing' }, error: value.error || { code: 'EUNAVAILABLE', message: 'authority returned no evidence' } };
		return { status: 'ok', evidence: object(value) ? value : { value: value } };
	} catch (e) { return { status: 'unavailable', evidence: { authority: 'existing' }, error: { code: 'EUNAVAILABLE', message: 'authority could not be read' } }; }
}
function authority_values() {
	let values = {};
	values.release_identity = projected(function() { return z2k_registry_receipt_state(); });
	values.activation_receipt = projected(function() { return z2k_registry_receipt_state(); });
	values.runtime_composition = projected(function() { return runtime_composition.resolveInstalled(null); });
	values.lua_function_closure = projected(function() { return runtime_composition.resolveInstalled(null); });
	values.runtime_assets = projected(function() { return asset_registry_list(null); });
	values.runtime_lists = projected(function() { return asset_registry_list('list'); });
	values.compiler_snapshot = projected(function() { return strategy_catalog_status(); });
	values.strategy_catalog = projected(function() { return strategy_catalog_status(); });
	values.compatibility_identity = projected(function() { return runtime_composition.resolveInstalled(null); });
	values.detect_binary = projected(function() { return z2k_detect_status(); });
	values.detect_json_contract = projected(function() { return z2k_detect_status(); });
	values.autodiscovery = projected(function() { return z2k_detect_discovery_status(); });
	values.discovered_domains = projected(function() { return z2k_detect_discovery_status(); });
	values.autocircular = projected(function() { return z2k_autocircular_identity_load(); });
	for (let id in ['tcp16', 'nfqueue', 'firewall', 'nfqws2']) values[id] = { status: 'unavailable', evidence: { authority: 'runtime' }, error: { code: 'EUNAVAILABLE', message: 'runtime evidence is not available in this projection' } };
	return values;
}

export const z2k_diagnostics_ids = function() { return IDS; };
export const z2k_diagnostics_run = function(seams) {
	let hooks = object(seams) ? seams : {}, values = object(hooks.values) ? hooks.values : authority_values(), entries = [], invalid = false;
	for (let id in IDS) {
		let name = string(id) ? id : IDS[id];
		let value = values[name];
		if (value == null) value = { status: 'unavailable', evidence: null, error: { code: 'EUNAVAILABLE', message: 'diagnostic authority unavailable' } };
		let entry = row(name, value);
		if (entry.status == 'error' && entry.error && entry.error.code == 'ESCHEMA') invalid = true;
		push(entries, entry);
	}
	return { ok: !invalid, schema: 1, entries: entries };
};
