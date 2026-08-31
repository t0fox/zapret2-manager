'use strict';

// Canonical runtime composition.  This module is deliberately pure: callers
// may provide test seams, but resolution never downloads, writes, or repairs
// runtime state.  Registry/receipt authority and a FRESH prepared target are
// the only lifecycle inputs accepted by the two resolver entry points.
import { asset_registry_list } from './asset-registry.uc';
import { readfile } from 'fs';

const BUNDLE_ID = 'z2k-curated-lua';
const MAX_ENTRIES = 128;
const MAX_IDENTITY_BYTES = 256 * 1024;
const KINDS = ['lua', 'blob', 'hostlist', 'ipset', 'binary', 'config', 'other'];
const ENTRY_TYPES = ['package-static', 'lifecycle-managed', 'bootstrap', 'scanner-overlay'];
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
function valid_release(value) { return string(value) && match(value, /^r-[0-9]+(\.[0-9]+)?$/); }
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
	if (entry.type == 'scanner-overlay' && entry.owner != 'scanner') return fail('EOWNERSHIP', 'scanner overlay has a non-scanner owner', { id: raw.id });
	if (entry.type == 'lifecycle-managed' && (!valid_release(entry.version) || !valid_commit(entry.sourceCommit)
		|| !valid_digest(entry.manifestSha256) || !valid_digest(entry.classificationSha256))) return fail('EINPUT', 'lifecycle entry identity is incomplete', { id: raw.id });
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

function identity_authority(authority) {
	if (!object(authority)) return {};
	let result = { kind: authority.kind };
	if (authority.kind == 'installed') {
		result.release = authority.release;
		result.sourceCommit = authority.sourceCommit;
		result.manifestSha256 = authority.manifestSha256;
		result.classificationSha256 = authority.classificationSha256;
		result.receiptId = authority.receiptId || null;
		result.installedAuthorityRevision = authority.installedAuthorityRevision;
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
function scanner_overlay(input) {
	if (!array(input)) return { ok: true, entries: [] };
	return normalize_entries(input, 'scanner-overlay');
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

function compose(state, authority, lifecycleEntries, staticEntries, scannerEntries, removals) {
	let all = [], staticResult = package_static_input(staticEntries);
	if (!staticResult.ok) return staticResult;
	for (let i = 0; i < length(staticResult.entries); i++) push(all, staticResult.entries[i]);
	for (let i = 0; i < length(lifecycleEntries || []); i++) push(all, lifecycleEntries[i]);
	let runtimeAssets = sorted_copy(all), luaInit = lua_subset(all), overlay = scannerEntries || [];
	let lifecycleIdentity = identity_text('z2k-lifecycle-v2', sprintf('%J', identity_authority(authority)), lifecycleEntries || [], luaInit, removals || []);
	let compositionIdentity = identity_text('z2k-composition-v2', lifecycleIdentity, runtimeAssets, luaInit, removals || []);
	let membershipIdentity = identity_text('z2k-membership-v2', '', lifecycleEntries || [], luaInit, removals || []);
	if (lifecycleIdentity == null || compositionIdentity == null || membershipIdentity == null) return fail('EINPUT', 'runtime composition identity is too large');
	let result = {
		ok: true, schemaVersion: 2, snapshotId: lifecycleIdentity, compositionSnapshotId: compositionIdentity,
		lifecycleState: state, state: state, compositionStatus: 'canonical',
		lifecycleIdentity: authority, receiptIdentity: authority.receiptId || null,
		observedRegistryRevision: authority.observedRegistryRevision == null ? null : authority.observedRegistryRevision,
		runtimeAssets: runtimeAssets, luaInit: luaInit, dependencyIndex: dependency_index(runtimeAssets),
		scannerOverlay: overlay, membershipDigest: membershipIdentity,
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
function registry_match_membership(membership, listed, receipt) {
	if (!array(membership) || !length(membership)) return fail('EINCONSISTENT', 'installed Z2K membership is missing');
	let normalized = normalize_entries(membership, 'lifecycle-managed');
	if (!normalized.ok) return normalized;
	let current = registry_z2k_assets(listed), byId = {}, seen = {};
	for (let i = 0; i < length(current); i++) byId[current[i].id] = current[i];
	for (let i = 0; i < length(normalized.entries); i++) {
		let expected = normalized.entries[i], actual = byId[expected.id], provenance = actual && actual.provenance;
		if (actual == null || seen[expected.id] || actual.type != expected.kind || actual.contentSha256 != expected.contentSha256 || actual.byteSize != expected.byteSize
			|| !object(provenance) || provenance.sourcePath != expected.sourcePath || provenance.version != expected.version
			|| provenance.sourceCommit != expected.sourceCommit || provenance.bundleId != BUNDLE_ID) return fail('EINCONSISTENT', 'installed Z2K membership does not match Registry', { id: expected.id });
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
		|| !valid_release(receipt.version) || !valid_commit(receipt.sourceCommit) || !valid_digest(receipt.manifestSha256)
		|| !valid_digest(receipt.classificationSha256) || !integer(receipt.installedAuthorityRevision)
		|| !object(listed) || !integer(listed.revision) || receipt.installedAuthorityRevision > listed.revision) return fail('EINCONSISTENT', 'v2 installed authority identity is invalid');
	let membership = registry_match_membership(receipt.z2kMembership, listed, receipt);
	if (!membership.ok) return membership;
	return { ok: true, receipt: receipt, entries: membership.entries };
}
function v1_membership(receipt, listed) {
	if (!object(receipt) || receipt.schema != 'asset-activation-receipt.v1' || receipt.bundleId != BUNDLE_ID
		|| !valid_release(receipt.version) || !valid_commit(receipt.sourceCommit) || !array(receipt.assets) || !length(receipt.assets)) return fail('RECONCILIATION_REQUIRED', 'V1 installed membership is not verified');
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
	let receipt = source.receipt || latest_receipt(listed), staticBase = source.staticBase, scanner = scanner_overlay(source.scannerOverlay);
	if (!scanner.ok) return scanner;
	if (receipt && receipt.schema == 'asset-activation-receipt.v1') {
		let legacy = v1_membership(receipt, listed);
		if (!legacy.ok) return legacy;
		return { ok: true, schemaVersion: 2, lifecycleState: 'V1_VERIFIED_MEMBERSHIP', state: 'V1_VERIFIED_MEMBERSHIP', compositionStatus: 'incomplete',
			reconciliationRequired: true, receiptIdentity: receipt, observedRegistryRevision: listed.revision,
			legacyMembership: legacy.recorded, dependencyIndex: {}, scannerOverlay: scanner.entries,
			blockingReasons: ['RECONCILIATION_REQUIRED'], reconciliation: { required: true, mode: 'same-release FRESH', operation: 'reinstall' },
			authority: { kind: 'installed', release: receipt.version, sourceCommit: receipt.sourceCommit, receiptId: receipt.receiptId || null, observedRegistryRevision: listed.revision } };
	}
	let authority = v2_authority(receipt, listed);
	if (!authority.ok) return authority;
	let installedAuthority = { kind: 'installed', release: receipt.version, sourceCommit: receipt.sourceCommit,
		manifestSha256: receipt.manifestSha256, classificationSha256: receipt.classificationSha256,
		receiptId: receipt.receiptId || null, installedAuthorityRevision: receipt.installedAuthorityRevision,
		observedRegistryRevision: listed.revision, z2kMembership: authority.entries };
	return compose('installed', installedAuthority, authority.entries, staticBase, scanner.entries, []);
};

export const resolveCandidate = function(preparedTarget, context) {
	if (!object(preparedTarget) || (preparedTarget.schema != 'z2k-target-v2' && preparedTarget.schema != 2) || !valid_release(preparedTarget.targetVersion)
		|| !valid_commit(preparedTarget.targetCommit || preparedTarget.targetCommitSha) || !valid_digest(preparedTarget.manifestSha256)
		|| !valid_digest(preparedTarget.classificationSha256) || !string(preparedTarget.planToken) || !length(preparedTarget.planToken)
		|| !integer(preparedTarget.baseRegistryRevision) || preparedTarget.baseRegistryRevision < 0) return fail('EINPUT', 'prepared Z2K target is incomplete');
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
		removeIds: removals.ids, contentIdentity: preparedTarget.contentIdentity || null, receiptIdentity: null };
	return compose('candidate', authority, normalized.entries, preparedTarget.staticBase, preparedTarget.scannerOverlay || [], removals.ids);
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
