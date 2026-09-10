'use strict';

// Canonical runtime composition.  This module is deliberately pure: callers
// may provide test seams, but resolution never downloads, writes, or repairs
// runtime state.  Registry/receipt authority and a FRESH prepared target are
// the only lifecycle inputs accepted by the two resolver entry points.
import { asset_registry_list } from './asset-registry.uc';
import { readfile } from 'fs';
import { z2k_candidate_identity_gate } from './z2k-compat.uc';
import { z2k_compatibility_identity_valid } from './z2k-compatibility.uc';
import { z2k_candidate_build } from './z2k-coherent-candidate.uc';
import { z2k_release_parse, z2k_release_valid } from './z2k-release.uc';
import { z2k_lua_function_closure } from './z2k-migration.uc';
import { z2k_registry_repair_release } from './z2k-installed-release.uc';

const BUNDLE_ID = 'z2k-curated-lua';
const MAX_ENTRIES = 128;
const MAX_IDENTITY_BYTES = 256 * 1024;
const KINDS = ['lua', 'blob', 'hostlist', 'ipset', 'binary', 'config', 'other'];
const ENTRY_TYPES = ['package-static', 'lifecycle-managed', 'bootstrap'];
const PACKAGE_COMPOSITION = '/usr/share/zapret2-manager/runtime-composition-package.json';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int'; }
function array(value) { return type(value) == 'array'; }
function fail(code, message, extra) {
	let out = { ok: false, error: { code: code, message: message } };
	for (let key in extra || {}) out.error[key] = extra[key];
	return out;
}
function copy(value) { let out = {}; for (let key in value || {}) out[key] = value[key]; return out; }
function copy_array(value) { let out = []; for (let i = 0; array(value) && i < length(value); i++) push(out, value[i]); return out; }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function contains(arrayValue, wanted) { for (let i = 0; array(arrayValue) && i < length(arrayValue); i++) if (arrayValue[i] == wanted) return true; return false; }
function valid_kind(value) { return contains(KINDS, value); }
function valid_entry_type(value) { return contains(ENTRY_TYPES, value); }
function safe_source_path(value) { return string(value) && length(value) > 0 && length(value) <= 512 && substr(value, 0, 1) != '/' && index(value, '..') < 0 && index(value, sprintf('%c', 0)) < 0 && !match(value, /[\r\n]/); }
function safe_runtime_target(value) { return string(value) && length(value) > 0 && length(value) <= 512 && substr(value, 0, 1) == '/' && index(value, '..') < 0 && index(value, sprintf('%c', 0)) < 0 && !match(value, /[\r\n]/); }
function entry_field(entry, name, fallback) { return object(entry) && entry[name] != null ? entry[name] : fallback; }

function normalized_entry(raw, expectedType) {
	if (!object(raw) || !string(raw.id) || !length(raw.id) || length(raw.id) > 128 || !string(raw.kind) || !valid_kind(raw.kind)) return fail('EINPUT', 'runtime entry kind or id is invalid');
	let entry = copy(raw);
	if (expectedType && raw.type != expectedType) return fail('EINPUT', 'runtime entry type is not explicit or does not match its boundary', { id: raw.id });
	entry.type = expectedType || raw.type;
	if (!valid_entry_type(entry.type) || !string(entry.owner) || !string(entry.role) || !length(entry.role)
		|| !safe_source_path(entry.sourcePath) || !safe_runtime_target(entry.runtimeTarget)
		|| !valid_digest(entry.contentSha256) || !integer(entry.byteSize) || entry.byteSize < 0) return fail('EINPUT', 'runtime entry schema is invalid', { id: raw.id });
	if (entry.type == 'package-static' && entry.owner != 'package') return fail('EOWNERSHIP', 'package-static entry has a non-package owner', { id: raw.id });
	if (entry.type == 'lifecycle-managed' && entry.owner != 'z2k-core') return fail('EOWNERSHIP', 'lifecycle-managed entry has a non-Z2K owner', { id: raw.id });
	if (entry.type == 'lifecycle-managed' && ((entry.kind == 'lua' && entry.role != 'lua-init')
		|| (entry.kind != 'lua' && entry.role != 'dependency'))) return fail('EINPUT', 'lifecycle entry role is not canonical for its kind', { id: raw.id });
	if (entry.type == 'lifecycle-managed' && (!z2k_release_valid(entry.version) || !valid_commit(entry.sourceCommit)
		|| !valid_digest(entry.manifestSha256) || !valid_digest(entry.classificationSha256))) return fail('EINPUT', 'lifecycle entry identity is incomplete', { id: raw.id });
	if (entry.z2kCompatibilityIdentity != null &&
		(!z2k_compatibility_identity_valid(entry.z2kCompatibilityIdentity)
			|| entry.compatibilityIdentity != entry.z2kCompatibilityIdentity.digest
			|| entry.z2kCompatibilityIdentity.release != entry.version
			|| entry.z2kCompatibilityIdentity.sourceCommit != lc(entry.sourceCommit)
			|| entry.z2kCompatibilityIdentity.runtimeBundleDigest != entry.runtimeBundleDigest)) return fail('EINPUT', 'lifecycle entry compatibility identity is invalid', { id: raw.id });
	if (entry.type == 'package-static' && (entry.version != null || entry.sourceCommit != null || entry.manifestSha256 != null || entry.classificationSha256 != null)) return fail('EINPUT', 'package-static entry contains lifecycle identity', { id: raw.id });
	if (entry.role == 'lua-init' && entry.kind != 'lua') return fail('EINPUT', 'only Lua entries may have the lua-init role', { id: raw.id });
	if (entry.role == 'lua-init' && (!integer(entry.runtimeOrder) || entry.runtimeOrder < 0)) return fail('EINPUT', 'ordered Lua entry has no runtimeOrder', { id: raw.id });
	if (entry.runtimeOrder != null && (!integer(entry.runtimeOrder) || entry.runtimeOrder < 0)) return fail('EINPUT', 'runtimeOrder is invalid', { id: raw.id });
	if (array(entry.references) && length(entry.references) > MAX_ENTRIES) return fail('EINPUT', 'runtime entry references are too large', { id: raw.id });
	return { ok: true, entry: entry };
}

function normalize_entries(rawEntries, expectedType) {
	if (!array(rawEntries) || length(rawEntries) > MAX_ENTRIES) return fail('EINPUT', 'runtime entry collection is invalid');
	let entries = [], seen = {};
	for (let i = 0; i < length(rawEntries); i++) {
		let result = normalized_entry(rawEntries[i], expectedType);
		if (!result.ok) return result;
		let entry = result.entry;
		if (seen[entry.id]) return fail('EINPUT', 'runtime entry id is duplicated', { id: entry.id });
		seen[entry.id] = true;
		push(entries, entry);
	}
	return { ok: true, entries: entries };
}

function package_static_entries() {
	let path = PACKAGE_COMPOSITION;
	if (getenv('Z2M_UPDATE_SOURCE_TEST') == '1' && string(getenv('Z2M_RUNTIME_PACKAGE_COMPOSITION')))
		path = getenv('Z2M_RUNTIME_PACKAGE_COMPOSITION');
	let raw = null, value = null;
	try { raw = readfile(path); value = raw == null ? null : json(raw); } catch (e) { value = null; }
	if (!object(value) || value.schema != 1 || !array(value.entries)) return fail('EUNAVAILABLE', 'verified package runtime composition is unavailable');
	return normalize_entries(value.entries, 'package-static');
}

function package_static_input(value) {
	if (value != null) return normalize_entries(value, 'package-static');
	return package_static_entries();
}

function sort_by_id(left, right) { return left.id == right.id ? 0 : (left.id < right.id ? -1 : 1); }
function sort_by_order(left, right) {
	if (left.runtimeOrder == null && right.runtimeOrder == null) return sort_by_id(left, right);
	if (left.runtimeOrder == null) return 1;
	if (right.runtimeOrder == null) return -1;
	return left.runtimeOrder == right.runtimeOrder ? sort_by_id(left, right) : left.runtimeOrder - right.runtimeOrder;
}
function sorted_copy(entries, comparator) { let out = copy_array(entries); sort(out, comparator || sort_by_id); return out; }

// Prepare-only runtime input for the official compiler/dependency snapshot.
// This deliberately does not create a candidate identity or expose mutation
// authority; resolveCandidate remains the only boundary that can claim a
// coherent mutation candidate after its complete candidateInput is bound.
export const resolveTargetRuntimeInput = function(preparedTarget) {
	if (!object(preparedTarget) || (preparedTarget.schema != 'z2k-target-v2' && preparedTarget.schema != 2)
		|| !z2k_release_valid(preparedTarget.targetVersion)
		|| !valid_commit(preparedTarget.targetCommit || preparedTarget.targetCommitSha)
		|| !valid_digest(preparedTarget.manifestSha256) || !valid_digest(preparedTarget.classificationSha256)
		|| !integer(preparedTarget.baseRegistryRevision) || preparedTarget.baseRegistryRevision < 0)
		return fail('EINPUT', 'prepared Z2K target runtime input is incomplete');
	let lifecycle = normalize_entries(preparedTarget.assets, 'lifecycle-managed');
	if (!lifecycle.ok) return lifecycle;
	let staticResult = package_static_input(preparedTarget.staticBase);
	if (!staticResult.ok) return staticResult;
	let all = [], runtimeAssets;
	for (let entry in staticResult.entries) push(all, entry);
	for (let entry in lifecycle.entries) push(all, entry);
	runtimeAssets = sorted_copy(all);
	return { ok: true, runtimeAssets: runtimeAssets, lifecycleAssets: lifecycle.entries, packageAssets: staticResult.entries };
};

// Repair target resolution is pure and authority-bound.  The caller still
// reuses the ordinary prepare/apply transaction for all writes.
export const resolveRepairTarget = function(registry) {
	return z2k_registry_repair_release(registry || asset_registry_list(null));
};

function identity_authority(authority) {
	if (!object(authority)) return {};
	let result = { kind: authority.kind };
	if (authority.kind == 'installed') {
		result.release = authority.release;
		result.sourceCommit = authority.sourceCommit;
		result.manifestSha256 = authority.manifestSha256;
		result.classificationSha256 = authority.classificationSha256;
		result.manifestSeq = authority.manifestSeq;
		result.runtimeBundleDigest = authority.runtimeBundleDigest;
		result.detect = authority.detect || null;
		result.compilerInputsDigest = authority.compilerInputsDigest;
		result.catalogDigest = authority.catalogDigest;
		result.receiptId = authority.receiptId || null;
		result.installedAuthorityRevision = authority.installedAuthorityRevision;
		result.z2kCompatibilityIdentity = authority.z2kCompatibilityIdentity || null;
		result.compatibilityIdentity = authority.compatibilityIdentity || null;
		result.coherentCandidate = authority.coherentCandidate || null;
		result.coherenceStatus = authority.coherenceStatus || 'unverified';
	} else if (authority.kind == 'candidate') {
		// observedRegistryRevision and committedAssetRevision are transport/CAS
		// observations. The candidate's semantic identity must survive its own
		// expected N -> N+1 Registry transition.
		result.targetVersion = authority.targetVersion;
		result.targetCommit = authority.targetCommit;
		result.manifestSha256 = authority.manifestSha256;
		result.classificationSha256 = authority.classificationSha256;
		result.planToken = authority.planToken;
		result.baseRegistryRevision = authority.baseRegistryRevision;
		result.contentIdentity = authority.contentIdentity || null;
		result.z2kCompatibilityIdentity = authority.z2kCompatibilityIdentity || null;
		result.compatibilityIdentity = authority.compatibilityIdentity || null;
		result.coherentCandidate = authority.coherentCandidate || null;
		result.coherenceStatus = authority.coherenceStatus || 'unverified';
	}
	return result;
}

function identity_entry(entry) {
	return entry.id + '|' + entry.owner + '|' + entry.role + '|' + entry.sourcePath + '|' + entry.runtimeTarget + '|' + entry.contentSha256
		+ '|' + entry.byteSize + '|' + (entry.runtimeOrder == null ? '' : entry.runtimeOrder) + '|' + entry.kind + '|' + entry.type
		+ '|' + (entry.version || '') + '|' + (entry.sourceCommit || '') + '|' + (entry.manifestSha256 || '') + '|' + (entry.classificationSha256 || '');
}
function identity_text(prefix, authority, entries, lua, removals) {
	let rows = [], sortedEntries = sorted_copy(entries), sortedLua = sorted_copy(lua, sort_by_order), sortedRemovals = sorted_copy(removals || [], function(a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
	for (let i = 0; i < length(sortedEntries); i++) push(rows, 'asset|' + identity_entry(sortedEntries[i]));
	for (let i = 0; i < length(sortedLua); i++) push(rows, 'lua|' + identity_entry(sortedLua[i]));
	for (let i = 0; i < length(sortedRemovals); i++) push(rows, 'remove|' + sortedRemovals[i]);
	let text = prefix + '|' + (authority || '') + '|' + join('\n', rows);
	return length(text) <= MAX_IDENTITY_BYTES ? text : null;
}

function dependency_index(entries) {
	let index = {};
	for (let i = 0; i < length(entries); i++) {
		let refs = array(entries[i].references) ? entries[i].references : (array(entries[i].dependencies) ? entries[i].dependencies : []);
		index[entries[i].id] = copy_array(refs);
	}
	return index;
}
function lua_subset(entries) {
	let lua = [];
	for (let i = 0; i < length(entries); i++) if (entries[i].kind == 'lua' && entries[i].role == 'lua-init') push(lua, entries[i]);
	return sorted_copy(lua, sort_by_order);
}
function remove_ids(value) {
	if (value == null) return { ok: true, ids: [] };
	if (!array(value) || length(value) > MAX_ENTRIES) return fail('EINPUT', 'candidate removals are invalid');
	let ids = [], seen = {};
	for (let i = 0; i < length(value); i++) {
		if (!string(value[i]) || !length(value[i]) || length(value[i]) > 128 || seen[value[i]]) return fail('EINPUT', 'candidate removal id is invalid');
		seen[value[i]] = true;
		push(ids, value[i]);
	}
	return { ok: true, ids: ids };
}

function compose(state, authority, lifecycleEntries, staticEntries, removals) {
	let all = [], staticResult = package_static_input(staticEntries);
	if (!staticResult.ok) return staticResult;
	for (let i = 0; i < length(staticResult.entries); i++) push(all, staticResult.entries[i]);
	for (let i = 0; i < length(lifecycleEntries || []); i++) push(all, lifecycleEntries[i]);
	let runtimeAssets = sorted_copy(all), luaInit = lua_subset(all);
	let lifecycleIdentity = identity_text('z2k-lifecycle-v2', sprintf('%J', identity_authority(authority)), lifecycleEntries || [], luaInit, removals || []);
	let compositionIdentity = identity_text('z2k-composition-v2', lifecycleIdentity, runtimeAssets, luaInit, removals || []);
	let membershipIdentity = identity_text('z2k-membership-v2', '', lifecycleEntries || [], luaInit, removals || []);
	if (lifecycleIdentity == null || compositionIdentity == null || membershipIdentity == null) return fail('EINPUT', 'runtime composition identity is too large');
	let result = {
		ok: true, schemaVersion: 2, snapshotId: lifecycleIdentity, compositionSnapshotId: compositionIdentity,
		lifecycleState: state, state: state, compositionStatus: 'canonical',
		coherenceStatus: authority.coherenceStatus || (authority.coherentCandidate ? 'coherent' : 'unverified'),
		lifecycleIdentity: authority, receiptIdentity: authority.receiptId || null,
		z2kCompatibilityIdentity: authority.z2kCompatibilityIdentity || null,
		compatibilityIdentity: authority.compatibilityIdentity || null,
		observedRegistryRevision: authority.observedRegistryRevision == null ? null : authority.observedRegistryRevision,
		runtimeAssets: runtimeAssets, luaInit: luaInit, dependencyIndex: dependency_index(runtimeAssets),
		membershipDigest: membershipIdentity,
		authority: authority,
	};
	if (state == 'installed') result.installedAuthorityRevision = authority.installedAuthorityRevision;
	if (state == 'candidate') {
		result.baseRegistryRevision = authority.baseRegistryRevision;
		result.committedAssetRevision = authority.committedAssetRevision == null ? null : authority.committedAssetRevision;
	}
	return result;
}

function registry_z2k_assets(listed) {
	let assets = [];
	for (let i = 0; object(listed) && array(listed.assets) && i < length(listed.assets); i++) {
		let asset = listed.assets[i], provenance = asset && asset.provenance;
		if (object(provenance) && provenance.kind == 'catalog/upstream' && provenance.bundleId == BUNDLE_ID) push(assets, asset);
	}
	return assets;
}
function physical_registry_type(entry) {
	if (!object(entry) || !string(entry.kind) || !string(entry.id)) return null;
	if (entry.kind == 'lua') return 'lua';
	// The Registry stores blob:* bytes as blob even when composition gives
	// them a semantic hostlist/ipset kind for runtime consumers.
	if (substr(entry.id, 0, 5) == 'blob:') return 'blob';
	return entry.kind;
}
function registry_match_membership(membership, listed, receipt) {
	if (!array(membership) || !length(membership)) return fail('EINCONSISTENT', 'installed Z2K membership is missing');
	let normalized = normalize_entries(membership, 'lifecycle-managed');
	if (!normalized.ok) return normalized;
	let current = registry_z2k_assets(listed), byId = {}, seen = {};
	for (let i = 0; i < length(current); i++) byId[current[i].id] = current[i];
	for (let i = 0; i < length(normalized.entries); i++) {
		let expected = normalized.entries[i], actual = byId[expected.id], provenance = actual && actual.provenance;
		if (actual == null || seen[expected.id] || actual.type != physical_registry_type(expected) || actual.contentSha256 != expected.contentSha256 || actual.byteSize != expected.byteSize
			|| !object(provenance) || provenance.sourcePath != expected.sourcePath || provenance.version != expected.version
			|| provenance.sourceCommit != expected.sourceCommit || provenance.bundleId != BUNDLE_ID
			|| (expected.compatibilityIdentity != null && provenance.compatibilityIdentity != expected.compatibilityIdentity)) return fail('EINCONSISTENT', 'installed Z2K membership does not match Registry', { id: expected.id });
		seen[expected.id] = true;
	}
	if (length(current) != length(normalized.entries)) return fail('EINCONSISTENT', 'Registry contains an extra active Z2K asset');
	return { ok: true, entries: normalized.entries };
}
function latest_receipt(listed) {
	if (!object(listed) || !array(listed.activationReceipts)) return null;
	for (let i = length(listed.activationReceipts) - 1; i >= 0; i--) return listed.activationReceipts[i];
	return null;
}
function v2_authority(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v2' || receipt.bundleId != BUNDLE_ID
		|| !z2k_release_valid(receipt.version) || !valid_commit(receipt.sourceCommit) || !valid_digest(receipt.manifestSha256)
		|| !valid_digest(receipt.classificationSha256) || !integer(receipt.installedAuthorityRevision)
		|| !object(listed) || !integer(listed.revision) || receipt.installedAuthorityRevision > listed.revision) return fail('EINCONSISTENT', 'v2 installed authority identity is invalid');
	if (receipt.z2kCompatibilityIdentity != null &&
		(!z2k_compatibility_identity_valid(receipt.z2kCompatibilityIdentity)
			|| receipt.compatibilityIdentity != receipt.z2kCompatibilityIdentity.digest
			|| receipt.z2kCompatibilityIdentity.release != receipt.version
			|| receipt.z2kCompatibilityIdentity.sourceCommit != lc(receipt.sourceCommit))) return fail('EINCONSISTENT', 'v2 installed Z2K compatibility identity is invalid');
	let membership = registry_match_membership(receipt.z2kMembership, listed, receipt);
	if (!membership.ok) return membership;
	return { ok: true, receipt: receipt, entries: membership.entries };
}

function v3_authority(receipt, listed) {
	let release = receipt && (receipt.release || receipt.version), membership = receipt && receipt.runtimeMembership;
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v3' || receipt.bundleId != BUNDLE_ID
		|| !z2k_release_valid(release) || receipt.version != release || !valid_commit(receipt.sourceCommit)
		|| !integer(receipt.manifestSeq) || !valid_digest(receipt.manifestSha256) || !valid_digest(receipt.classificationSha256)
		|| !valid_digest(receipt.runtimeBundleDigest) || !valid_digest(receipt.compilerInputsDigest) || !valid_digest(receipt.catalogDigest)
		|| !valid_digest(receipt.compatibilityIdentity) || !integer(receipt.installedAuthorityRevision)
		|| !object(listed) || !integer(listed.revision) || receipt.installedAuthorityRevision > listed.revision
		|| !object(receipt.detect) || !string(receipt.detect.arch) || !valid_digest(receipt.detect.digest) || !integer(receipt.detect.size)
		|| (receipt.detect.sourceCommit != null && lc(receipt.detect.sourceCommit) != lc(receipt.sourceCommit))
		|| !array(membership) || !length(membership)) return fail('EINCONSISTENT', 'v3 installed authority identity is invalid');
	if (receipt.detectIdentity != null && (!object(receipt.detectIdentity) || receipt.detectIdentity.digest != receipt.detect.digest
		|| receipt.detectIdentity.arch != receipt.detect.arch || receipt.detectIdentity.size != receipt.detect.size)) return fail('EINCONSISTENT', 'v3 Detect identity is invalid');
	if (object(receipt.activationEvidence) && receipt.activationEvidence.detectDigest != null && receipt.activationEvidence.detectDigest != receipt.detect.digest) return fail('EINCONSISTENT', 'v3 Detect digest evidence is invalid');
	let membershipResult = registry_match_membership(membership, listed, receipt);
	if (!membershipResult.ok) return membershipResult;
	return { ok: true, receipt: receipt, entries: membershipResult.entries };
}
function v1_membership(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v1' || receipt.bundleId != BUNDLE_ID
		|| !z2k_release_valid(receipt.version) || !valid_commit(receipt.sourceCommit) || !array(receipt.assets) || !length(receipt.assets)) return fail('RECONCILIATION_REQUIRED', 'V1 installed membership is not verified');
	let current = registry_z2k_assets(listed), byId = {}, seen = {}, recorded = [];
	for (let i = 0; i < length(current); i++) byId[current[i].id] = current[i];
	for (let i = 0; i < length(receipt.assets); i++) {
		let expected = receipt.assets[i], actual = byId[expected && expected.id], provenance = actual && actual.provenance;
		if (!object(expected) || !string(expected.id) || seen[expected.id] || actual == null || expected.type != actual.type
			|| expected.sha256 != actual.contentSha256 || expected.byteSize != actual.byteSize || !object(provenance)
			|| provenance.kind != 'catalog/upstream' || provenance.bundleId != BUNDLE_ID || provenance.version != receipt.version
			|| provenance.sourceCommit != receipt.sourceCommit || (expected.sourcePath != null && expected.sourcePath != provenance.sourcePath)) return fail('RECONCILIATION_REQUIRED', 'V1 receipt membership does not match Registry');
		let item = { id: expected.id, kind: expected.type, contentSha256: expected.sha256, byteSize: expected.byteSize,
			sourcePath: expected.sourcePath || provenance.sourcePath, version: receipt.version, sourceCommit: receipt.sourceCommit };
		push(recorded, item); seen[expected.id] = true;
	}
	if (length(current) != length(recorded)) return fail('RECONCILIATION_REQUIRED', 'Registry contains an unrecorded V1 Z2K asset');
	return { ok: true, recorded: recorded };
}

function input_registry(input) { return object(input) && object(input.registry) ? input.registry : asset_registry_list(null); }

export const resolveInstalled = function(input) {
	let source = object(input) ? input : {}, listed = input_registry(source);
	if (!object(listed) || listed.ok !== true || !integer(listed.revision)) return fail('EINCONSISTENT', 'Asset Registry is unavailable');
	let receipt = source.receipt || latest_receipt(listed), staticBase = source.staticBase;
	if (receipt && receipt.schema == 'asset-activation-receipt.v1') {
		let legacy = v1_membership(receipt, listed);
		if (!legacy.ok) return legacy;
		return { ok: true, schemaVersion: 2, lifecycleState: 'V1_VERIFIED_MEMBERSHIP', state: 'V1_VERIFIED_MEMBERSHIP', compositionStatus: 'incomplete',
			reconciliationRequired: true, receiptIdentity: receipt, observedRegistryRevision: listed.revision,
			legacyMembership: legacy.recorded, dependencyIndex: {},
			blockingReasons: ['RECONCILIATION_REQUIRED'], reconciliation: { required: true, mode: 'same-release FRESH', operation: 'reinstall' },
			authority: { kind: 'installed', release: receipt.version, sourceCommit: receipt.sourceCommit, receiptId: receipt.receiptId || null, observedRegistryRevision: listed.revision } };
	}
	let coherent = v3_authority(receipt, listed);
	if (coherent.ok) {
		let installedAuthority = { kind: 'installed', release: receipt.release, sourceCommit: receipt.sourceCommit,
			manifestSeq: receipt.manifestSeq, manifestSha256: receipt.manifestSha256, classificationSha256: receipt.classificationSha256,
			runtimeBundleDigest: receipt.runtimeBundleDigest, detect: receipt.detect,
			compilerInputsDigest: receipt.compilerInputsDigest, catalogDigest: receipt.catalogDigest,
			receiptId: receipt.receiptId || null, installedAuthorityRevision: receipt.installedAuthorityRevision,
			observedRegistryRevision: listed.revision, z2kMembership: coherent.entries,
			z2kCompatibilityIdentity: receipt.z2kCompatibilityIdentity || null,
			compatibilityIdentity: receipt.compatibilityIdentity || null, coherenceStatus: 'coherent' };
		return compose('installed', installedAuthority, coherent.entries, staticBase, []);
	}
	let authority = v2_authority(receipt, listed);
	if (!authority.ok) return authority;
	let installedAuthority = { kind: 'installed', release: receipt.version, sourceCommit: receipt.sourceCommit,
		manifestSha256: receipt.manifestSha256, classificationSha256: receipt.classificationSha256,
		receiptId: receipt.receiptId || null, installedAuthorityRevision: receipt.installedAuthorityRevision,
		observedRegistryRevision: listed.revision, z2kMembership: authority.entries,
		z2kCompatibilityIdentity: receipt.z2kCompatibilityIdentity || null,
		compatibilityIdentity: receipt.compatibilityIdentity || null };
	return compose('installed', installedAuthority, authority.entries, staticBase, []);
};

function resource_center_target(value) {
	return object(value) && (value.targetSchema == 'z2k-target-v2'
		|| (value.schema == 2 && string(value.operation) && string(value.localFingerprint)
			&& array(value.targetBlockingReasons) && array(value.targetReviewDetails) && value.targetCanApply != null));
}

export const resolveCandidate = function(preparedTarget, context) {
	let preparing = object(context) && context.phase == 'prepare';
	if (!object(preparedTarget) || (preparedTarget.schema != 'z2k-target-v2' && preparedTarget.schema != 2) || !z2k_release_valid(preparedTarget.targetVersion)
		|| !valid_commit(preparedTarget.targetCommit || preparedTarget.targetCommitSha) || !valid_digest(preparedTarget.manifestSha256)
		|| !valid_digest(preparedTarget.classificationSha256) || (!preparing && (!string(preparedTarget.planToken) || !length(preparedTarget.planToken)))
		|| !integer(preparedTarget.baseRegistryRevision) || preparedTarget.baseRegistryRevision < 0) return fail('EINPUT', 'prepared Z2K target is incomplete');
	// A complete candidateInput is required before the mutation identity is
	// claimed; the Resource Center target remains the only production authority.
	let coherent = null;
	if (object(preparedTarget.candidateInput)) {
		let candidateInput = copy(preparedTarget.candidateInput);
		if (candidateInput.luaFunctionClosure != null) {
			let closure = z2k_lua_function_closure(candidateInput.luaFunctionClosure);
			if (!closure.ok) return closure;
		}
		candidateInput.release = candidateInput.release || preparedTarget.targetVersion;
		candidateInput.sourceCommit = candidateInput.sourceCommit || preparedTarget.targetCommit || preparedTarget.targetCommitSha;
		candidateInput.manifestSeq = candidateInput.manifestSeq == null ? (preparedTarget.manifestSeq == null ? preparedTarget.manifestRevision : preparedTarget.manifestSeq) : candidateInput.manifestSeq;
		candidateInput.manifestSha256 = candidateInput.manifestSha256 || preparedTarget.manifestSha256;
		candidateInput.classificationSha256 = candidateInput.classificationSha256 || preparedTarget.classificationSha256;
		let built = z2k_candidate_build(candidateInput);
		if (!built.ok) return built;
		let gated = z2k_candidate_identity_gate(built);
		if (!gated.ok) return gated;
		built.compatibilityIdentity = gated.compatibilityIdentity;
		coherent = built;
	} else if (resource_center_target(preparedTarget)) {
		// Resource Center targets are mutation authorities. They may not use the
		// fixture-only unverified composition seam while staging or activating.
		// Detect/compiler tasks must provide the complete canonical input first.
		return fail('ECOHERENCE', 'canonical coherent candidate input is required before Z2K mutation');
	}
	let current = object(context) && integer(context.observedRegistryRevision) ? context.observedRegistryRevision : preparedTarget.baseRegistryRevision;
	let committed = object(context) && integer(context.committedAssetRevision) ? context.committedAssetRevision : preparedTarget.committedAssetRevision;
	let ownCommit = object(context) && context.phase == 'post-commit' && committed != null && current == committed;
	if (current != preparedTarget.baseRegistryRevision && !ownCommit) return fail('ESTALE', 'prepared Z2K candidate is stale before commit', { expectedRevision: preparedTarget.baseRegistryRevision, observedRegistryRevision: current });
	let normalized = normalize_entries(preparedTarget.assets, 'lifecycle-managed');
	if (!normalized.ok) return normalized;
	let removals = remove_ids(preparedTarget.removeIds || preparedTarget.removals);
	if (!removals.ok) return removals;
	let authority = { kind: 'candidate', targetVersion: preparedTarget.targetVersion, targetCommit: preparedTarget.targetCommit || preparedTarget.targetCommitSha,
		manifestSha256: preparedTarget.manifestSha256, classificationSha256: preparedTarget.classificationSha256,
		planToken: preparedTarget.planToken, baseRegistryRevision: preparedTarget.baseRegistryRevision,
		observedRegistryRevision: current, committedAssetRevision: committed == null ? null : committed,
		removeIds: removals.ids, contentIdentity: preparedTarget.contentIdentity || null, receiptIdentity: null,
		z2kCompatibilityIdentity: preparedTarget.z2kCompatibilityIdentity || null,
		compatibilityIdentity: coherent ? coherent.compatibilityIdentity : null,
		coherentCandidate: coherent, coherenceStatus: coherent ? 'coherent' : 'unverified' };
	return compose('candidate', authority, normalized.entries, preparedTarget.staticBase, removals.ids);
};

function evidence_file(evidence, entry) {
	let files = object(evidence) && object(evidence.files) ? evidence.files : {};
	return files[entry.id] || files[entry.runtimeTarget] || null;
}
function verify_file_set(snapshot, evidence) {
	if (!object(snapshot) || snapshot.ok !== true || !array(snapshot.runtimeAssets)) return fail('EINPUT', 'runtime snapshot is invalid');
	for (let i = 0; i < length(snapshot.runtimeAssets); i++) {
		let expected = snapshot.runtimeAssets[i], actual = evidence_file(evidence, expected);
		if (!object(actual) || actual.exists === false || actual.present === false) return fail('EVERIFY', 'expected runtime asset is missing', { id: expected.id, expectedSha256: expected.contentSha256 });
		if (actual.sha256 != null && actual.sha256 != expected.contentSha256) return fail('EVERIFY', 'runtime asset SHA does not match snapshot', { id: expected.id, expectedSha256: expected.contentSha256, actualSha256: actual.sha256 });
		if (actual.byteSize != null && actual.byteSize != expected.byteSize) return fail('EVERIFY', 'runtime asset size does not match snapshot', { id: expected.id });
		if (actual.owner != null && actual.owner != expected.owner && actual.ownership != expected.owner) return fail('EOWNERSHIP', 'runtime asset owner does not match snapshot', { id: expected.id });
	}
	return { ok: true };
}
function expected_lua_ids(snapshot) { let ids = []; for (let i = 0; array(snapshot.luaInit) && i < length(snapshot.luaInit); i++) push(ids, snapshot.luaInit[i].id); return ids; }
function equal_array(left, right) { if (!array(left) || !array(right) || length(left) != length(right)) return false; for (let i = 0; i < length(left); i++) if (left[i] != right[i]) return false; return true; }
function verify_process(snapshot, evidence, activation) {
	if (!object(snapshot) || snapshot.ok !== true || !array(snapshot.luaInit) || (activation ? snapshot.lifecycleState != 'candidate' : snapshot.lifecycleState != 'installed')) return fail('EINPUT', 'process snapshot is invalid');
	if (!object(evidence) || evidence.snapshotId != snapshot.snapshotId || evidence.queueReady !== true || evidence.membershipDigest != snapshot.membershipDigest) return fail('EVERIFY', 'process evidence is not bound to the runtime snapshot');
	if (activation && evidence.createdForActivation !== true) return fail('EVERIFY', 'process predates this activation');
	let configHash = evidence.activeConfigHash || evidence.configHash;
	if (!string(configHash) || configHash != evidence.configHash) return fail('EVERIFY', 'active config hash evidence is missing or inconsistent');
	if (object(snapshot.authority) && snapshot.authority.configHash != null && configHash != snapshot.authority.configHash) return fail('EVERIFY', 'active config hash does not match snapshot');
	if (evidence.pid == null || evidence.processStarttime == null || !string(evidence.processGeneration)) return fail('EVERIFY', 'process identity or generation evidence is missing');
	if (activation && array(evidence.previousProcesses)) for (let i = 0; i < length(evidence.previousProcesses); i++) if (evidence.previousProcesses[i].pid == evidence.pid && evidence.previousProcesses[i].starttime == evidence.processStarttime) return fail('EVERIFY', 'activation process identity predates this activation');
	if (object(evidence.runtimeHashes)) {
		for (let i = 0; i < length(snapshot.runtimeAssets); i++)
			if (evidence.runtimeHashes[snapshot.runtimeAssets[i].id] != snapshot.runtimeAssets[i].contentSha256) return fail('EVERIFY', 'process runtime hash does not match snapshot', { id: snapshot.runtimeAssets[i].id });
	} else return fail('EVERIFY', 'process runtime hashes are missing');
	if (!equal_array(evidence.luaInitIds || evidence.luaInit || [], expected_lua_ids(snapshot))) return fail('EVERIFY', 'process Lua init order does not match snapshot');
	if (activation && (evidence.processGeneration == null || evidence.processStarttime == null)) return fail('EVERIFY', 'activation process generation evidence is missing');
	return { ok: true, snapshotId: snapshot.snapshotId, processPid: evidence.pid == null ? null : evidence.pid, historical: activation ? false : true };
}

export const verifyMaterialized = function(snapshot, evidence) {
	if (!object(evidence) || evidence.snapshotId != snapshot.snapshotId || evidence.membershipDigest != snapshot.membershipDigest) return fail('EVERIFY', 'materialization evidence is not bound to the runtime snapshot');
	let result = verify_file_set(snapshot, evidence || {});
	if (!result.ok) return result;
	if (!string(evidence.configHash)) return fail('EVERIFY', 'generated active config hash is missing');
	let removals = object(snapshot.authority) && array(snapshot.authority.removeIds) ? snapshot.authority.removeIds : [];
	for (let i = 0; i < length(removals); i++) if (object(evidence) && object(evidence.removalsPresent) && evidence.removalsPresent[removals[i]] === true) return fail('EVERIFY', 'candidate-declared removal is still present', { id: removals[i] });
	return { ok: true, snapshotId: snapshot.snapshotId, membershipDigest: snapshot.membershipDigest };
};
export const verifyActivationProcess = function(candidate, activationEvidence) { return verify_process(candidate, activationEvidence, true); };
export const verifyInstalledProcess = function(installedSnapshot, processEvidence) { return verify_process(installedSnapshot, processEvidence, false); };

// Test and coordinator seam for the pre-commit CAS.  A candidate's own
// expected N -> N+1 Registry transition is accepted only with commit evidence.
export const runtime_composition_candidate_cas = function(candidate, observedRegistryRevision, phase, committedAssetRevision) {
	if (!object(candidate) || candidate.lifecycleState != 'candidate' || !integer(candidate.baseRegistryRevision) || !integer(observedRegistryRevision)) return fail('EINPUT', 'candidate CAS input is invalid');
	if (observedRegistryRevision == candidate.baseRegistryRevision) return { ok: true, committedAssetRevision: committedAssetRevision == null ? null : committedAssetRevision };
	if (phase == 'post-commit' && integer(committedAssetRevision) && committedAssetRevision == observedRegistryRevision) return { ok: true, committedAssetRevision: committedAssetRevision };
	return fail('ESTALE', 'candidate Registry revision changed before commit');
};

// Candidate strategy selection is part of the Core transaction preflight.  A
// catalog may change only after this gate has accepted the exact candidate
// runtime; callers must not silently replace the user's selected strategy.
function runtime_strategy_source_contract(sourceId) {
	if (sourceId == 'z2k') return { origin: 'z2k_builtin', owner: 'z2k-core', strategyClass: 'official-z2k', repository: 'necronicle/z2k', prefix: 'z2k:', kinds: ['official-top-level-profile', 'strategy-catalog-import'] };
	if (sourceId == 'avatar') return { origin: 'avatar_builtin', owner: 'avatar', strategyClass: 'avatar', repository: 'avatarDD/zapret-gui', prefix: 'avatar:', kinds: ['strategy-catalog'] };
	if (sourceId == 'user') return { origin: 'user', owner: 'user', strategyClass: 'user', repository: null, prefix: null, kinds: ['user-strategy'] };
	return null;
}
function runtime_strategy_catalog_entries(catalog) {
	if (!object(catalog)) return null;
	if (array(catalog.entries)) return catalog.entries;
	if (array(catalog.canonicalEntries)) return catalog.canonicalEntries;
	return null;
}
function runtime_strategy_entry_matches(selected, entry, contract, selectedId) {
	if (!object(entry) || entry.id != selectedId || entry.canonicalId != selectedId
		|| entry.sourceId != selected.sourceId || entry.origin != contract.origin
		|| entry.owner != contract.owner || entry.strategyClass != contract.strategyClass) return false;
	if (contract.prefix != null && substr(selectedId, 0, length(contract.prefix)) != contract.prefix) return false;
	let provenance = entry.provenance;
	if (!object(provenance) || provenance.sourceId != selected.sourceId
		|| provenance.repository != contract.repository || !contains(contract.kinds, provenance.kind)) return false;
	if (selected.sourceId != 'user' && (!string(entry.sourceSnapshotId) || entry.sourceSnapshotId == ''
		|| provenance.sourceSnapshotId != entry.sourceSnapshotId)) return false;
	if (selected.sourceId != 'user' && selected.sourceSnapshotId != null && selected.sourceSnapshotId != entry.sourceSnapshotId) return false;
	if (selected.sourceCommit != null && selected.sourceCommit != entry.sourceCommit) return false;
	return true;
}
export const runtime_strategy_preflight = function(input) {
	if (!object(input)) return fail('EINPUT', 'strategy preflight input is invalid');
	let selected = input.activeStrategy || null;
	if (selected == null) return { ok: true, skipped: true, reason: 'no-active-strategy' };
	if (!string(selected.id) || selected.selected !== true || !string(selected.canonicalStrategyId) || selected.canonicalStrategyId != selected.id)
		return fail('ECOMPATIBILITY', 'active strategy selection is not canonical or not preserved');
	let sourceId = selected.sourceId;
	let contract = runtime_strategy_source_contract(sourceId);
	if (!contract || selected.origin != contract.origin)
		return fail('ECOMPATIBILITY', 'active strategy source is unknown or missing; candidate validation cannot be proven', { sourceId: sourceId == null ? null : sourceId });
	let selectedId = selected.canonicalStrategyId, entries = runtime_strategy_catalog_entries(input.candidateCatalog), found = null;
	for (let i = 0; array(entries) && i < length(entries); i++) if (runtime_strategy_entry_matches(selected, entries[i], contract, selectedId)) { found = entries[i]; break; }
	if (found == null) return fail('ECOMPATIBILITY', 'active strategy canonical ID is not bound to verified candidate provenance', { sourceId: sourceId, id: selectedId });
	if (!object(input.candidateRuntime) || input.candidateRuntime.closureReady !== true || input.candidateRuntime.nativeReady !== true)
		return fail('ECOMPATIBILITY', 'active strategy does not close over the candidate runtime or pass native preflight', { sourceId: sourceId, id: selectedId });
	return { ok: true, selectedId: selectedId, sourceId: sourceId, origin: contract.origin, owner: contract.owner, strategyClass: contract.strategyClass };
};
