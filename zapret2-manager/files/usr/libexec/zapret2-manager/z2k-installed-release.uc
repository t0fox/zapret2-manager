'use strict';

// One Registry-backed installed-release authority shared by catalog browsing
// and Resource Center status.  A receipt is only authoritative while every
// recorded asset still matches the live Registry record and its provenance;
// an extra active asset from the same managed bundle invalidates the receipt.
import { asset_registry_list } from './asset-registry.uc';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function copy_array(value) { let result = []; for (let i = 0; type(value) == 'array' && i < length(value); i++) push(result, value[i]); return result; }
function parse_release(value) { return string(value) && match(value, /^r-[0-9]+(\.[0-9]+)?$/) ? value : null; }
function asset_by_id(assets, id) { for (let i = 0; i < length(assets || []); i++) if (assets[i] && assets[i].id == id) return assets[i]; return null; }
function receipt_valid(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v1' || receipt.bundleId != 'z2k-curated-lua' || parse_release(receipt.version) == null || !string(receipt.sourceCommit) || type(receipt.assets) != 'array' || !length(receipt.assets)) return false;
	let seen = {};
	for (let i = 0; i < length(receipt.assets); i++) {
		let expected = receipt.assets[i], current = object(expected) ? asset_by_id(listed.assets, expected.id) : null, provenance = current && current.provenance;
		if (!object(expected) || !string(expected.id) || seen[expected.id] || current == null || !object(provenance)
			|| expected.type != current.type || expected.sha256 != current.contentSha256 || expected.byteSize != current.byteSize
			|| expected.sourceCommit != receipt.sourceCommit || expected.bundleId != receipt.bundleId || expected.version != receipt.version
			|| !string(expected.sourcePath) || expected.sourcePath != provenance.sourcePath || provenance.kind != 'catalog/upstream'
			|| provenance.bundleId != receipt.bundleId || provenance.version != receipt.version || provenance.sourceCommit != receipt.sourceCommit) return false;
		seen[expected.id] = true;
	}
	for (let i = 0; i < length(listed.assets || []); i++) {
		let current = listed.assets[i], provenance = current && current.provenance;
		if (object(provenance) && provenance.kind == 'catalog/upstream' && provenance.bundleId == receipt.bundleId && !seen[current.id]) return false;
	}
	return true;
}

export const z2k_registry_installed_release = function(listed) {
	let value = listed || asset_registry_list(null);
	if (!object(value) || value.ok !== true || type(value.activationReceipts) != 'array' || type(value.assets) != 'array') return { value: null, confidence: 'unknown', authority: null };
	for (let i = length(value.activationReceipts) - 1; i >= 0; i--) {
		let receipt = value.activationReceipts[i];
		if (receipt_valid(receipt, value)) return { value: receipt.version, confidence: 'confirmed', authority: 'activation-receipt' };
	}
	return { value: null, confidence: 'unknown', authority: null };
};

export const z2k_registry_receipt_valid = function(receipt, listed) {
	let value = listed || asset_registry_list(null);
	return object(value) && value.ok === true && receipt_valid(receipt, value);
};
