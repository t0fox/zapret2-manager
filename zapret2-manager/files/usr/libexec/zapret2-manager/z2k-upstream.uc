'use strict';
import { readfile, stat, unlink, popen } from 'fs';
import { asset_registry_list } from './asset-registry.uc';
import { z2k_candidate_gate, z2k_state_persist_compat_raw } from './z2k-compat.uc';
import * as update_source from './update-source.uc';
import { z2k_dependency_graph, z2k_dependency_class } from './z2k-dependencies.uc';

const API_ROOT = 'https://api.github.com/repos/necronicle/z2k';
const BRANCH_REVISION_URL = API_ROOT + '/commits?sha=z2k-enhanced&per_page=1';
const CLASSIFICATION = getenv('Z2M_UPDATE_SOURCE_TEST') == '1' && getenv('Z2M_Z2K_CLASSIFICATION_PATH') ? getenv('Z2M_Z2K_CLASSIFICATION_PATH') : '/usr/share/zapret2-manager/upstreams/z2k-integration.json';
const ALLOW_UNTRUSTED = true;
const MAX_MANIFEST = 512 * 1024;
const MAX_FILES = 512;
const MAX_PATH = 256;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function fail(code, message, details) { let value = { ok: false, error: { code: code, message: message } }; if (details != null) value.error.details = details; return value; }
function run(command) { let p = popen(command + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function quote(value) { return type(value) == 'string' && index(value, "'") < 0 && index(value, '\n') < 0 && index(value, '\r') < 0 ? "'" + value + "'" : null; }
function read_json(path) { try { let raw = readfile(path); return raw ? json(raw) : null; } catch (e) { return null; } }
function temp_file() { let p = popen('umask 077; mktemp /tmp/z2m-z2k-upstream.XXXXXX 2>/dev/null', 'r'); if (!p) return null; let value = trim(p.read('all') || ''), rc = p.close(); return rc == 0 && match(value, /^\/tmp\/z2m-z2k-upstream\.[A-Za-z0-9]+$/) ? value : null; }
function cleanup(paths) { for (let p in paths) { try { unlink(p); } catch (e) {} } }
function source_url(base, nonce) { return base + '?z2m_pair=' + nonce; }
function fetch_file(url, path) { let qurl = quote(url), qpath = quote(path); if (qurl == null || qpath == null) return false; let r = run('uclient-fetch -q -T 20 -O ' + qpath + ' ' + qurl); return r.rc == 0 && stat(path) != null; }
function validate_path(value) { return type(value) == 'string' && length(value) > 0 && length(value) <= MAX_PATH && substr(value, 0, 1) != '/' && index(value, '\\') < 0 && index(value, '..') < 0 && match(value, /^[A-Za-z0-9._\/-]+$/); }
function validate_manifest(value, rawSize) {
	if (rawSize == null || rawSize < 2 || rawSize > MAX_MANIFEST) return fail('ESIZE', 'UPDATES.json exceeds the bounded manifest size.');
	if (type(value) != 'object' || value == null || value.schema != 1 || value.branch != 'z2k-enhanced' || type(value.seq) != 'int' || value.seq < 0 || type(value.current) != 'string' || length(value.current) > 96 || type(value.files_sha256) != 'object' || value.files_sha256 == null) return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json schema or branch is unsupported.');
	let names = keys(value.files_sha256); if (!length(names) || length(names) > MAX_FILES) return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json file count is invalid.');
	for (let name in names) { let path = name, digest = value.files_sha256[path]; if (!validate_path(path)) return fail('EVERIFY', 'UPDATES.json contains an unsafe path.', { path: path }); if (type(digest) != 'string' || !match(lc(digest), /^[a-f0-9]{64}$/)) return fail('EVERIFY', 'UPDATES.json contains an invalid SHA-256.', { path: path }); value.files_sha256[path] = lc(digest); }
	return { ok: true, manifest: value };
}
function classification() { let value = read_json(CLASSIFICATION); if (type(value) != 'object' || value == null || (value.schema != 'zapret2-manager.z2k-integration.v1' && value.schema != 'zapret2-manager.z2k-integration.v2') || type(value.files) != 'array') return null; return value; }
function class_for(value, path) {
	for (let item in value.files) if (item.sourcePath == path) return item;
	for (let item in value.historicalFiles || []) if (item.sourcePath == path) return item;
	return null;
}
function dependency_class(item) { return z2k_dependency_class(item); }
function registry_asset_for(path, assets) {
	if (type(assets) != 'array') return null;
	for (let i = 0; i < length(assets); i++) {
		let asset = assets[i];
		if (asset && asset.provenance && asset.provenance.sourcePath == path) return asset;
		// Fallback: match the stable Lua ID used by the Registry for package assets.
		let idFromPath = 'lua:' + substr(path, length('files/lua/'), length(path) - length('files/lua/') - 4);
		if (asset && asset.id == idFromPath) return asset;
	}
	return null;
}
function registry_assets() {
	try {
		let listed = asset_registry_list(null);
		return listed && listed.ok && type(listed.assets) == 'array' ? listed.assets : null;
	} catch (e) { return null; }
}
function installedShaFor(path, assets) {
	let listed = assets || registry_assets(), asset = registry_asset_for(path, listed);
	return asset && asset.contentSha256 || null;
}
function is_compatible_raw(raw) {
	// Deprecated wrapper — use z2k-compat.uc as authority.
	// Kept for backward compat; delegates to shared module.
	return z2k_state_persist_compat_raw(raw);
}
function is_state_persist_compatible(expectedDigest) {
	// Deprecated — plan is now pure, check-time uses content-bound candidate gate.
	// Kept for compat; not used in pure plan.
	return false;
}
function sha256_file(path) {
	// Local helper for check-time candidate verification (mirrors z2k-compat).
	let p = popen('sha256sum ' + quote(path) + " 2>/dev/null | awk '{print $1}'", 'r');
	if (!p) return null;
	let out = trim(p.read('all') || ''), rc = p.close();
	return rc == 0 && match(out, /^[a-f0-9]{64}$/) ? lc(out) : null;
}
function review_policy(item) {
	return item && item.reviewPolicy == 'advisory' ? 'advisory' : 'blocking';
}
function update_items_for_paths(items, paths) {
	let wanted = {}, result = [];
	for (let i = 0; i < length(paths || []); i++) wanted[paths[i]] = true;
	for (let i = 0; i < length(items || []); i++) if (items[i] && wanted[items[i].sourcePath]) push(result, items[i]);
	return result;
}
function plan_result(manifest, updates, rebases, reviews, advisoryReviews, blockingReviews, reviewDetails, blockingReasons, updateItems, removedItems, unknownUnconsumed, compilerInputs, dependencyGraph) {
	let pending = length(updates || []) + length(removedItems || []) + length(compilerInputs || []), updateState = pending > 0 ? 'update-available' : 'current';
	let attentionState = length(rebases) ? 'rebase-required' : length(blockingReviews) ? 'review-required' : length(compilerInputs || []) ? 'validation-required' : length(advisoryReviews) ? 'review-advisory' : 'none';
	let status = length(rebases) ? 'rebase-required' : length(blockingReviews) ? 'review-required' : pending > 0 ? 'update-available' : 'current';
	return {
		ok: true,
		status: status,
		updateState: updateState,
		attentionState: attentionState,
		canApply: pending > 0 && length(rebases) == 0 && length(blockingReviews) == 0 && length(compilerInputs || []) == 0,
		updates: updates,
		rebases: rebases,
		reviews: reviews,
		advisoryReviews: advisoryReviews,
		blockingReviews: blockingReviews,
		blockingReasons: blockingReasons,
		reviewDetails: reviewDetails,
		updateItems: updateItems || [],
		removedItems: removedItems || [],
		unknownUnconsumed: unknownUnconsumed || [],
		compilerInputs: compilerInputs || [],
		dependencyGraph: dependencyGraph || null,
		manifest: manifest
	};
}
function plan(value) {
	// PURE: deterministic from manifest + classification + registry. No network.
	let checked = validate_manifest(value, length(sprintf('%J', value))); if (!checked.ok) return checked;
	let map = classification(); if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let updates = [], updateItems = [], removedItems = [], targetPaths = {}, rebases = [], reviews = [], advisoryReviews = [], blockingReviews = [], reviewDetails = [], blockingReasons = [], unknownUnconsumed = [], compilerInputs = [], assets = registry_assets();
	let dependencies = z2k_dependency_graph({ classification: map, assets: assets });
	if (!dependencies.ok) return dependencies;
	let graph = dependencies.graph;
	if (graph.registryAvailable !== true) {
		let detail = { path: 'Asset Registry', reason: 'dependency-registry-unavailable', policy: 'blocking', message: 'Asset Registry is unavailable; Z2M cannot verify Z2K runtime ownership.' };
		push(blockingReviews, detail.path);
		push(blockingReasons, detail);
		push(reviewDetails, detail);
	}
	for (let path in keys(checked.manifest.files_sha256)) {
		let digest = checked.manifest.files_sha256[path], item = class_for(map, path) || graph.known[path], consumed = graph.consumed[path];
		if (item == null) {
			let detail = consumed && consumed.class == 'unknown-consumed'
				? { path: path, reason: 'unknown-consumed-dependency', policy: 'blocking', message: 'Новый upstream-файл уже используется активным Z2M dependency graph; ownership must be defined before update.' }
				: { path: path, reason: 'unknown-unconsumed', policy: 'advisory', message: 'Новый upstream-файл не используется активным Z2M dependency graph; изменение отмечено как advisory.' };
			push(reviews, path);
			if (detail.policy == 'blocking') push(blockingReviews, path);
			else { push(advisoryReviews, path); push(unknownUnconsumed, path); }
			push(reviewDetails, detail);
			if (detail.policy == 'blocking') push(blockingReasons, detail);
			continue;
		}
		let klass = dependency_class(item);
		if (klass == 'compiler-input' && item.basedOnSha256 != digest) {
			push(compilerInputs, { sourcePath: path, currentSha256: item.basedOnSha256 || null, targetSha256: digest, consumer: item.consumer || 'official Z2K compiler', action: 'compile-and-validate' });
		}
		else if (klass == 'adapted' && item.basedOnSha256 != digest) {
			let detail = { path: path, reason: 'adapted-upstream-file-changed', policy: 'blocking', message: 'Адаптированный upstream-файл изменился; требуется rebase.' };
			push(rebases, path);
			push(reviewDetails, detail);
			push(blockingReasons, detail);
		}
		else if (klass == 'runtime-exact') {
			targetPaths[path] = true;
			let installedAsset = registry_asset_for(path, assets), installed = installedAsset && installedAsset.contentSha256 || installedShaFor(path, assets);
			let needsUpdate = (installed == null) || (installed != digest);
			if (needsUpdate) {
				push(updates, path);
				push(updateItems, { sourcePath: path, currentSha256: installedAsset && installedAsset.contentSha256 || null, targetSha256: digest, registryKnown: assets != null, present: installedAsset != null,
					action: assets != null && installedAsset == null ? 'added' : 'modified' });
			}
		}
		else if (klass == 'watched' && item.basedOnSha256 != digest) {
			let policy = review_policy(item), detail = { path: path, reason: 'watched-upstream-file-changed', policy: policy, message: policy == 'advisory' ? 'Наблюдаемый upstream-файл изменился; Z2M не устанавливает его автоматически; изменение отмечено как advisory review.' : 'Наблюдаемый upstream-файл изменился; Z2M не устанавливает его автоматически; требуется semantic review.' };
			push(reviews, path);
			push(reviewDetails, detail);
			if (policy == 'advisory') push(advisoryReviews, path);
			else { push(blockingReviews, path); push(blockingReasons, detail); }
		}
		else if (klass == 'ignored-platform') { /* explicit no-op */ }
	}
	// The Registry may still contain an exact-managed Z2K asset from an older
	// release. It is a lifecycle removal when the selected target membership no
	// longer contains its canonical source path. Package-baseline files are not
	// Registry assets and therefore cannot become removals here.
	for (let i = 0; type(assets) == 'array' && i < length(assets); i++) {
		let asset = assets[i], provenance = asset && asset.provenance, sourcePath = provenance && provenance.sourcePath;
		if (!object(provenance) || provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua' || !string(sourcePath) || targetPaths[sourcePath]) continue;
		let historical = class_for(map, sourcePath);
		if (historical == null || dependency_class(historical) != 'runtime-exact' || !string(historical.runtimeTarget)) continue;
		push(removedItems, { id: asset.id, type: asset.type, name: asset.name || historical.localName || asset.id, sourcePath: sourcePath, runtimeTarget: historical.runtimeTarget,
			currentSha256: asset.contentSha256 || null, targetSha256: null, expectedRevision: asset.revision || 0, expectedByteSize: asset.byteSize || 0,
			bundleId: provenance.bundleId, version: provenance.version || null, sourceCommit: provenance.sourceCommit || null });
	}
	sort(removedItems, function(a, b) { return a.sourcePath == b.sourcePath ? 0 : (a.sourcePath < b.sourcePath ? -1 : 1); });
	return plan_result(checked.manifest, updates, rebases, reviews, advisoryReviews, blockingReviews, reviewDetails, blockingReasons, updateItems, removedItems, unknownUnconsumed, compilerInputs, graph);
}
function fetch_untrusted_manifest_once() {
	let revisionRequest = { sourceKey: 'z2k:necronicle/z2k:revision:z2k-enhanced', origin: 'github-rest', url: BRANCH_REVISION_URL, ttlSec: 900, maxBytes: 128 * 1024,
		validate: function(value) { let row = type(value) == 'array' ? value[0] : value; return object(row) && valid_commit(row.sha); },
		normalize: function(value) { let row = type(value) == 'array' ? value[0] : value; return { sourceCommit: lc(row.sha) }; } };
	let revision = update_source.update_source_fresh(revisionRequest);
	if (revision.ok !== true || !object(revision.payload) || !valid_commit(revision.payload.sourceCommit))
		return fail(revision.error && revision.error.code || 'EUNAVAILABLE', 'Не удалось разрешить точную ревизию ветки Z2K.', { source: 'github-rest' });
	let sourceCommit = lc(revision.payload.sourceCommit);
	let request = { sourceKey: 'z2k:necronicle/z2k:manifest:' + sourceCommit, origin: 'raw-content', url: 'https://raw.githubusercontent.com/necronicle/z2k/' + sourceCommit + '/UPDATES.json', ttlSec: 900, maxBytes: MAX_MANIFEST,
		validate: function(value) { return validate_manifest(value, length(sprintf('%J', value))); } };
	let result = update_source.update_source_fresh(request);
	if (result.ok !== true || result.payload == null) return fail(result.error && result.error.code || 'EUNAVAILABLE', 'Не удалось получить UPDATES.json.', { source: result.origin || 'raw-content' });
	return { ok: true, manifest: result.payload, sourceCommit: sourceCommit, trustMode: 'allow-untrusted', contentSha256: result.contentSha256 || null };
}
function fetch_untrusted_manifest() {
	// Kept for compat — single attempt. New check uses retry wrapper.
	return fetch_untrusted_manifest_once();
}

export const z2k_state_persist_compat_raw = function(raw) { return is_compatible_raw(raw); };
export const z2k_upstream_plan = function(remoteManifest) { return plan(remoteManifest); };
export const z2k_upstream_check = function() {
	if (!ALLOW_UNTRUSTED) return fail('EUNSUPPORTED', 'Signed Z2K verification is disabled in this build.');
	let lastErr = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		let remote = fetch_untrusted_manifest_once(); if (!remote.ok) { lastErr = remote; continue; }
		let checked = plan(remote.manifest); if (!checked.ok) return checked;
		// Content-bound preflight for state-persist if it is in updates
		let needGate = false; for (let i = 0; i < length(checked.updates); i++) if (checked.updates[i] == 'files/lua/z2k-state-persist.lua') needGate = true;
		if (needGate) {
			let expected = checked.manifest.files_sha256['files/lua/z2k-state-persist.lua'];
			let cand = temp_file(); if (cand == null) return fail('EIO', 'Не удалось создать private Z2K staging file.');
			let url = 'https://raw.githubusercontent.com/necronicle/z2k/' + remote.sourceCommit + '/files/lua/z2k-state-persist.lua';
			let nonce = '' + time() + '-' + attempt + '-' + expected;
			let ok = fetch_file(source_url(url, nonce), cand);
			if (!ok) { cleanup([cand]); lastErr = fail('EUNAVAILABLE', 'Не удалось получить candidate z2k-state-persist.lua'); continue; }
			let actual = sha256_file(cand);
			if (actual == null || lc(actual) != lc(expected)) { cleanup([cand]); lastErr = fail('ESTALE', 'candidate SHA does not match manifest', { sourcePath: 'files/lua/z2k-state-persist.lua', expectedSha256: expected, actualSha256: actual }); continue; }
			let gate = z2k_candidate_gate('files/lua/z2k-state-persist.lua', cand, expected);
			cleanup([cand]);
			if (!gate.ok) {
				// Move the gated candidate into a blocking review and recompute all canonical fields.
				let newUpdates = []; for (let i = 0; i < length(checked.updates); i++) if (checked.updates[i] != 'files/lua/z2k-state-persist.lua') push(newUpdates, checked.updates[i]);
				let newReviews = []; for (let i = 0; i < length(checked.reviews); i++) push(newReviews, checked.reviews[i]); push(newReviews, 'files/lua/z2k-state-persist.lua');
				let newAdvisory = []; for (let i = 0; i < length(checked.advisoryReviews || []); i++) push(newAdvisory, checked.advisoryReviews[i]);
				let newBlocking = []; for (let i = 0; i < length(checked.blockingReviews || []); i++) push(newBlocking, checked.blockingReviews[i]); push(newBlocking, 'files/lua/z2k-state-persist.lua');
				let detail = { path: 'files/lua/z2k-state-persist.lua', reason: gate.error && gate.error.code || 'candidate-gate-failed', policy: 'blocking', message: 'Кандидат z2k-state-persist не прошёл проверку совместимости; требуется review.' };
				let newDetails = []; for (let i = 0; i < length(checked.reviewDetails || []); i++) push(newDetails, checked.reviewDetails[i]); push(newDetails, detail);
				let newReasons = []; for (let i = 0; i < length(checked.blockingReasons || []); i++) push(newReasons, checked.blockingReasons[i]); push(newReasons, detail);
				checked = plan_result(checked.manifest, newUpdates, checked.rebases || [], newReviews, newAdvisory, newBlocking, newDetails, newReasons, update_items_for_paths(checked.updateItems, newUpdates), checked.removedItems || [], checked.unknownUnconsumed || [], checked.compilerInputs || [], checked.dependencyGraph || null);
			}
		}
		checked.sourceCommit = remote.sourceCommit;
		return { ok: true, status: checked.status, updateState: checked.updateState, attentionState: checked.attentionState, canApply: checked.canApply, updates: checked.updates, removedItems: checked.removedItems || [], rebases: checked.rebases, reviews: checked.reviews, advisoryReviews: checked.advisoryReviews, blockingReviews: checked.blockingReviews, blockingReasons: checked.blockingReasons, unknownUnconsumed: checked.unknownUnconsumed || [], compilerInputs: checked.compilerInputs || [], dependencyGraph: checked.dependencyGraph || null, release: checked.manifest.current, source: { repository: 'necronicle/z2k', branch: 'z2k-enhanced', commit: remote.sourceCommit }, sourceCommit: remote.sourceCommit, manifestRevision: remote.sourceCommit, trustMode: remote.trustMode, manifest: checked.manifest, manifestSha256: remote.contentSha256 || null, plan: checked };
	}
	return lastErr || fail('ESTALE', 'Z2K manifest/candidate race — retry limit exceeded');
};
