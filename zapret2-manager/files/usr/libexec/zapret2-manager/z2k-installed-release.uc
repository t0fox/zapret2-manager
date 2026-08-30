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
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function valid_sha(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function asset_by_id(assets, id) { for (let i = 0; i < length(assets || []); i++) if (assets[i] && assets[i].id == id) return assets[i]; return null; }
function receipt_valid(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v1' || receipt.bundleId != 'z2k-curated-lua' || parse_release(receipt.version) == null || !valid_commit(receipt.sourceCommit) || type(receipt.assets) != 'array' || !length(receipt.assets)) return false;
	let seen = {};
	let mode = null;
	for (let i = 0; i < length(receipt.assets); i++) {
		let expected = receipt.assets[i], fields = object(expected) ? { sourceCommit: expected.sourceCommit != null, sourcePath: expected.sourcePath != null, bundleId: expected.bundleId != null, version: expected.version != null } : null;
		let currentMode = fields == null ? null : (fields.sourceCommit || fields.sourcePath || fields.bundleId || fields.version ? (fields.sourceCommit && fields.sourcePath && fields.bundleId && fields.version ? 'new' : null) : 'legacy');
		if (currentMode == null || (mode != null && mode != currentMode)) return false;
		mode = currentMode;
		let current = object(expected) ? asset_by_id(listed.assets, expected.id) : null, provenance = current && current.provenance;
		if (!object(expected) || !string(expected.id) || seen[expected.id] || current == null || !object(provenance)
			|| expected.type != current.type || expected.sha256 != current.contentSha256 || expected.byteSize != current.byteSize
			|| provenance.kind != 'catalog/upstream' || !string(provenance.sourcePath) || !length(provenance.sourcePath)
			|| provenance.bundleId != receipt.bundleId || provenance.version != receipt.version || provenance.sourceCommit != receipt.sourceCommit) return false;
		if (mode == 'new' && (expected.sourceCommit != receipt.sourceCommit || expected.bundleId != receipt.bundleId || expected.version != receipt.version
			|| !string(expected.sourcePath) || !length(expected.sourcePath) || expected.sourcePath != provenance.sourcePath)) return false;
		seen[expected.id] = true;
	}
	for (let i = 0; i < length(listed.assets || []); i++) {
		let current = listed.assets[i], provenance = current && current.provenance;
		if (object(provenance) && provenance.kind == 'catalog/upstream' && provenance.bundleId == receipt.bundleId && !seen[current.id]) return false;
	}
	return true;
}

function v2_receipt_valid(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v2' || receipt.bundleId != 'z2k-curated-lua'
		|| parse_release(receipt.version) == null || !valid_commit(receipt.sourceCommit) || !valid_sha(receipt.manifestSha256)
		|| !valid_sha(receipt.classificationSha256) || type(receipt.installedAuthorityRevision) != 'int'
		|| !object(listed) || type(listed.revision) != 'int' || receipt.installedAuthorityRevision != listed.revision
		|| type(receipt.z2kMembership) != 'array' || !length(receipt.z2kMembership)) return false;
	let seen = {}, current = [];
	for (let i = 0; i < length(listed.assets || []); i++) {
		let asset = listed.assets[i], provenance = asset && asset.provenance;
		if (object(provenance) && provenance.kind == 'catalog/upstream' && provenance.bundleId == receipt.bundleId) push(current, asset);
	}
	for (let i = 0; i < length(receipt.z2kMembership); i++) {
		let expected = receipt.z2kMembership[i], found = null;
		for (let j = 0; j < length(current); j++) if (current[j].id == expected.id) { found = current[j]; break; }
		let provenance = found && found.provenance;
		if (!object(expected) || !string(expected.id) || seen[expected.id] || found == null || expected.type != 'lifecycle-managed'
			|| expected.kind != found.type || expected.contentSha256 != found.contentSha256 || expected.byteSize != found.byteSize
			|| !string(expected.sourcePath) || expected.sourcePath != provenance.sourcePath || expected.version != receipt.version
			|| expected.sourceCommit != receipt.sourceCommit || provenance.version != receipt.version || provenance.sourceCommit != receipt.sourceCommit) return false;
		seen[expected.id] = true;
	}
	return length(current) == length(receipt.z2kMembership);
}

export const z2k_registry_installed_release = function(listed) {
	let value = listed || asset_registry_list(null);
	if (!object(value) || value.ok !== true || type(value.activationReceipts) != 'array' || type(value.assets) != 'array') return { value: null, confidence: 'unknown', authority: null };
	for (let i = length(value.activationReceipts) - 1; i >= 0; i--) {
		let receipt = value.activationReceipts[i];
		if (v2_receipt_valid(receipt, value)) return { value: receipt.version, confidence: 'confirmed', authority: 'activation-receipt-v2' };
		if (receipt_valid(receipt, value)) return { value: receipt.version, confidence: 'confirmed', authority: 'activation-receipt' };
	}
	return { value: null, confidence: 'unknown', authority: null };
};

export const z2k_registry_receipt_valid = function(receipt, listed) {
	let value = listed || asset_registry_list(null);
	return object(value) && value.ok === true && (receipt_valid(receipt, value) || v2_receipt_valid(receipt, value));
};

export const z2k_registry_receipt_state = function(listed) {
	let value = listed || asset_registry_list(null);
	if (!object(value) || value.ok !== true || type(value.activationReceipts) != 'array' || type(value.assets) != 'array') return { state: 'unknown', receipt: null };
	for (let i = length(value.activationReceipts) - 1; i >= 0; i--) {
		let receipt = value.activationReceipts[i];
		if (v2_receipt_valid(receipt, value)) return { state: 'confirmed', receipt: receipt, version: receipt.version };
		if (receipt_valid(receipt, value)) return { state: 'V1_VERIFIED_MEMBERSHIP', reconciliationRequired: true, receipt: receipt, version: receipt.version };
	}
	return { state: 'unknown', receipt: null };
};
