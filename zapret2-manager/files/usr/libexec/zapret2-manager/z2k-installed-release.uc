'use strict';

// One Registry-backed installed-release authority shared by catalog browsing
// and Resource Center status.  A receipt is only authoritative while every
// recorded asset still matches the live Registry record and its provenance;
// an extra active asset from the same managed bundle invalidates the receipt.
import { asset_registry_list } from './asset-registry.uc';
import { z2k_compatibility_identity_valid } from './z2k-compatibility.uc';
import { z2k_release_parse, z2k_release_valid } from './z2k-release.uc';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function copy_array(value) { let result = []; for (let i = 0; type(value) == 'array' && i < length(value); i++) push(result, value[i]); return result; }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function valid_sha(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_integer(value) { return type(value) == 'int' && value >= 0; }
function valid_source_path(value) { return string(value) && length(value) > 0 && length(value) <= 512 && substr(value, 0, 1) != '/' && index(value, '..') < 0 && index(value, sprintf('%c', 0)) < 0 && !match(value, /[\r\n]/); }
function valid_runtime_target(value) { return string(value) && length(value) > 0 && length(value) <= 512 && substr(value, 0, 1) == '/' && index(value, '..') < 0 && index(value, sprintf('%c', 0)) < 0 && !match(value, /[\r\n]/); }
function asset_by_id(assets, id) { for (let i = 0; i < length(assets || []); i++) if (assets[i] && assets[i].id == id) return assets[i]; return null; }
function receipt_valid(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v1' || receipt.bundleId != 'z2k-curated-lua' || !z2k_release_valid(receipt.version) || !valid_commit(receipt.sourceCommit) || type(receipt.assets) != 'array' || !length(receipt.assets)) return false;
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

function physical_registry_type(entry) {
	if (!object(entry) || !string(entry.kind) || !string(entry.id)) return null;
	if (entry.kind == 'lua') return 'lua';
	// Registry stores blob:* bytes as blob even when runtime composition gives
	// them the semantic hostlist/ipset kind consumed by the engine.
	if (substr(entry.id, 0, 5) == 'blob:') return 'blob';
	return entry.kind;
}

function v2_receipt_valid(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v2' || receipt.bundleId != 'z2k-curated-lua'
		|| z2k_release_parse(receipt.version) == null || !valid_commit(receipt.sourceCommit) || !valid_sha(receipt.manifestSha256)
		|| !valid_sha(receipt.classificationSha256) || type(receipt.installedAuthorityRevision) != 'int'
		|| !object(listed) || type(listed.revision) != 'int' || receipt.installedAuthorityRevision > listed.revision
		|| type(receipt.z2kMembership) != 'array' || !length(receipt.z2kMembership)) return false;
	if (receipt.z2kCompatibilityIdentity != null &&
		(!z2k_compatibility_identity_valid(receipt.z2kCompatibilityIdentity)
			|| receipt.compatibilityIdentity != receipt.z2kCompatibilityIdentity.digest
			|| receipt.z2kCompatibilityIdentity.release != receipt.version
			|| receipt.z2kCompatibilityIdentity.sourceCommit != lc(receipt.sourceCommit))) return false;
	let seen = {}, current = [];
	for (let i = 0; i < length(listed.assets || []); i++) {
		let asset = listed.assets[i], provenance = asset && asset.provenance;
		if (object(provenance) && provenance.kind == 'catalog/upstream' && provenance.bundleId == receipt.bundleId) push(current, asset);
	}
	for (let i = 0; i < length(receipt.z2kMembership); i++) {
		let expected = receipt.z2kMembership[i], found = null;
		if (!object(expected) || !string(expected.id)) return false;
		for (let j = 0; j < length(current); j++) if (current[j].id == expected.id) { found = current[j]; break; }
		let provenance = found && found.provenance;
		if (seen[expected.id] || found == null || expected.type != 'lifecycle-managed'
			|| expected.owner != 'z2k-core' || !string(expected.role) || !string(expected.kind) || !valid_source_path(expected.sourcePath)
			|| !valid_runtime_target(expected.runtimeTarget) || (expected.role == 'lua-init' && (expected.kind != 'lua' || type(expected.runtimeOrder) != 'int'))
			|| physical_registry_type(expected) != found.type || !valid_sha(expected.contentSha256) || expected.contentSha256 != found.contentSha256 || expected.byteSize != found.byteSize
			|| expected.sourcePath != provenance.sourcePath || expected.version != receipt.version
			|| expected.sourceCommit != receipt.sourceCommit || provenance.version != receipt.version || provenance.sourceCommit != receipt.sourceCommit) return false;
		seen[expected.id] = true;
	}
	return length(current) == length(receipt.z2kMembership);
}

function v3_detect_valid(receipt) {
	let detect = receipt && receipt.detect, evidence = receipt && receipt.activationEvidence;
	if (!object(detect) || !string(detect.arch) || !valid_sha(detect.digest) || !valid_integer(detect.size)) return false;
	if (detect.sourceCommit != null && lc(detect.sourceCommit) != lc(receipt.sourceCommit)) return false;
	if (receipt.detectIdentity != null && (!object(receipt.detectIdentity) || receipt.detectIdentity.arch != detect.arch
		|| receipt.detectIdentity.digest != detect.digest || receipt.detectIdentity.size != detect.size)) return false;
	if (object(evidence) && evidence.detectDigest != null && evidence.detectDigest != detect.digest) return false;
	return true;
}

function v3_membership_valid(receipt, listed) {
	let expectedMembers = receipt.runtimeMembership || receipt.z2kMembership;
	if (type(expectedMembers) != 'array' || !length(expectedMembers)) return false;
	let current = [], byId = {}, seen = {};
	for (let i = 0; i < length(listed.assets || []); i++) {
		let asset = listed.assets[i], provenance = asset && asset.provenance;
		if (object(provenance) && provenance.kind == 'catalog/upstream' && provenance.bundleId == receipt.bundleId) { push(current, asset); byId[asset.id] = asset; }
	}
	if (length(current) != length(expectedMembers)) return false;
	for (let i = 0; i < length(expectedMembers); i++) {
		let expected = expectedMembers[i], actual = expected && byId[expected.id], provenance = actual && actual.provenance;
		if (!object(expected) || !string(expected.id) || seen[expected.id] || actual == null || expected.type != 'lifecycle-managed'
			|| physical_registry_type(expected) != actual.type || !valid_sha(expected.contentSha256) || expected.contentSha256 != actual.contentSha256
			|| expected.byteSize != actual.byteSize || !valid_source_path(expected.sourcePath) || !valid_runtime_target(expected.runtimeTarget)
			|| expected.version != receipt.release || expected.sourceCommit != receipt.sourceCommit
			|| !object(provenance) || provenance.sourcePath != expected.sourcePath || provenance.version != receipt.release
			|| provenance.sourceCommit != receipt.sourceCommit || provenance.bundleId != receipt.bundleId) return false;
		seen[expected.id] = true;
	}
	return true;
}

function v3_receipt_valid(receipt, listed) {
	let release = receipt && (receipt.release || receipt.version);
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v3' || receipt.bundleId != 'z2k-curated-lua'
		|| !z2k_release_valid(release) || receipt.version != release || !valid_commit(receipt.sourceCommit)
		|| !valid_integer(receipt.manifestSeq) || !valid_sha(receipt.manifestSha256) || !valid_sha(receipt.classificationSha256)
		|| !valid_sha(receipt.compilerInputsDigest) || !valid_sha(receipt.catalogDigest) || !valid_sha(receipt.runtimeBundleDigest)
		|| !valid_sha(receipt.compatibilityIdentity) || !valid_integer(receipt.installedAuthorityRevision)
		|| !object(listed) || !valid_integer(listed.revision) || receipt.installedAuthorityRevision > listed.revision
		|| !v3_detect_valid(receipt) || !v3_membership_valid(receipt, listed)) return false;
	return true;
}

export const z2k_registry_installed_release = function(listed) {
	let value = listed || asset_registry_list(null);
	if (!object(value) || value.ok !== true || type(value.activationReceipts) != 'array' || type(value.assets) != 'array') return { value: null, confidence: 'unknown', authority: null };
	for (let i = length(value.activationReceipts) - 1; i >= 0; i--) {
		let receipt = value.activationReceipts[i];
		if (v3_receipt_valid(receipt, value)) return { value: receipt.release, confidence: 'confirmed', authority: 'activation-receipt-v3' };
		if (v2_receipt_valid(receipt, value)) return { value: receipt.version, confidence: 'confirmed', authority: 'activation-receipt-v2' };
		if (receipt_valid(receipt, value)) return { value: receipt.version, confidence: 'confirmed', authority: 'activation-receipt' };
	}
	return { value: null, confidence: 'unknown', authority: null };
};

export const z2k_registry_receipt_valid = function(receipt, listed) {
	let value = listed || asset_registry_list(null);
	return object(value) && value.ok === true && (v3_receipt_valid(receipt, value) || receipt_valid(receipt, value) || v2_receipt_valid(receipt, value));
};

export const z2k_registry_receipt_state = function(listed) {
	let value = listed || asset_registry_list(null);
	if (!object(value) || value.ok !== true || type(value.activationReceipts) != 'array' || type(value.assets) != 'array') return { state: 'unknown', receipt: null };
	for (let i = length(value.activationReceipts) - 1; i >= 0; i--) {
		let receipt = value.activationReceipts[i];
		if (v3_receipt_valid(receipt, value)) return { state: 'COHERENT_VERIFIED', receipt: receipt, version: receipt.release };
		if (v2_receipt_valid(receipt, value)) return { state: 'LEGACY_VERIFIED', receipt: receipt, version: receipt.version };
		if (receipt_valid(receipt, value)) return { state: 'LEGACY_VERIFIED', reconciliationRequired: true, receipt: receipt, version: receipt.version };
	}
	return { state: 'unknown', receipt: null };
};
