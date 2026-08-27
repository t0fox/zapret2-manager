'use strict';
import { readfile, stat, unlink, popen } from 'fs';
import { asset_registry_list } from './asset-registry.uc';
import { z2k_candidate_gate, z2k_state_persist_compat_raw } from './z2k-compat.uc';

const MANIFEST_URL = 'https://raw.githubusercontent.com/necronicle/z2k/z2k-enhanced/UPDATES.json';
const CLASSIFICATION = '/usr/share/zapret2-manager/upstreams/z2k-integration.json';
const ALLOW_UNTRUSTED = true;
const MAX_MANIFEST = 512 * 1024;
const MAX_FILES = 512;
const MAX_PATH = 256;

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
function classification() { let value = read_json(CLASSIFICATION); return type(value) == 'object' && value != null && value.schema == 'zapret2-manager.z2k-integration.v1' && type(value.files) == 'array' ? value : null; }
function class_for(value, path) { for (let item in value.files) if (item.sourcePath == path) return item; return null; }
function installedShaFor(path) {
	try {
		let listed = asset_registry_list(null);
		if (!listed || !listed.ok || type(listed.assets) != 'array') return null;
		for (let i = 0; i < length(listed.assets); i++) {
			let a = listed.assets[i];
			if (a.provenance && a.provenance.sourcePath == path) return a.contentSha256 || null;
			// Fallback: match by id derived from sourcePath (e.g., files/lua/z2k-alert.lua -> lua:z2k-alert)
			let idFromPath = 'lua:' + substr(path, length('files/lua/'), length(path) - length('files/lua/') - 4);
			if (a.id == idFromPath) return a.contentSha256 || null;
		}
	} catch (e) {}
	return null;
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
function plan_result(manifest, updates, rebases, reviews, advisoryReviews, blockingReviews, reviewDetails, blockingReasons) {
	let updateState = length(updates) ? 'update-available' : 'current';
	let attentionState = length(rebases) ? 'rebase-required' : length(blockingReviews) ? 'review-required' : length(advisoryReviews) ? 'review-advisory' : 'none';
	let status = length(rebases) ? 'rebase-required' : length(blockingReviews) ? 'review-required' : length(updates) ? 'update-available' : 'current';
	return {
		ok: true,
		status: status,
		updateState: updateState,
		attentionState: attentionState,
		canApply: length(updates) > 0 && length(rebases) == 0 && length(blockingReviews) == 0,
		updates: updates,
		rebases: rebases,
		reviews: reviews,
		advisoryReviews: advisoryReviews,
		blockingReviews: blockingReviews,
		blockingReasons: blockingReasons,
		reviewDetails: reviewDetails,
		manifest: manifest
	};
}
function plan(value) {
	// PURE: deterministic from manifest + classification + registry. No network.
	let checked = validate_manifest(value, length(sprintf('%J', value))); if (!checked.ok) return checked;
	let map = classification(); if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let updates = [], rebases = [], reviews = [], advisoryReviews = [], blockingReviews = [], reviewDetails = [], blockingReasons = [];
	for (let path in keys(checked.manifest.files_sha256)) {
		let digest = checked.manifest.files_sha256[path], item = class_for(map, path);
		if (item == null) {
			// Unknown future upstream file — fail closed into a blocking review.
			let detail = { path: path, reason: 'unclassified-upstream-file', policy: 'blocking', message: 'Новый upstream-файл не имеет явной политики интеграции; требуется проверка.' };
			push(reviews, path);
			push(blockingReviews, path);
			push(reviewDetails, detail);
			push(blockingReasons, detail);
			continue;
		}
		if (item.class == 'adapted' && item.basedOnSha256 != digest) {
			let detail = { path: path, reason: 'adapted-upstream-file-changed', policy: 'blocking', message: 'Адаптированный upstream-файл изменился; требуется rebase.' };
			push(rebases, path);
			push(reviewDetails, detail);
			push(blockingReasons, detail);
		}
		else if (item.class == 'exact-managed') {
			let installed = installedShaFor(path);
			let needsUpdate = (installed == null) || (installed != digest);
			if (needsUpdate) push(updates, path);
		}
		else if (item.class == 'watched' && item.basedOnSha256 != digest) {
			let policy = review_policy(item), detail = { path: path, reason: 'watched-upstream-file-changed', policy: policy, message: policy == 'advisory' ? 'Наблюдаемый upstream-файл изменился; Z2M не устанавливает его автоматически; изменение отмечено как advisory review.' : 'Наблюдаемый upstream-файл изменился; Z2M не устанавливает его автоматически; требуется semantic review.' };
			push(reviews, path);
			push(reviewDetails, detail);
			if (policy == 'advisory') push(advisoryReviews, path);
			else { push(blockingReviews, path); push(blockingReasons, detail); }
		}
		else if (item.class == 'ignored-platform' && false) { /* explicit no-op */ }
	}
	return plan_result(checked.manifest, updates, rebases, reviews, advisoryReviews, blockingReviews, reviewDetails, blockingReasons);
}
function fetch_untrusted_manifest_once() {
	let mf = temp_file(); if (mf == null) return fail('EIO', 'Не удалось создать private Z2K staging file.');
	let nonce = '' + time() + '-' + 0;
	if (!fetch_file(source_url(MANIFEST_URL, nonce), mf)) { cleanup([mf]); return fail('EUNAVAILABLE', 'Не удалось получить UPDATES.json.'); }
	let size = stat(mf), raw = readfile(mf), value = null;
	try { value = json(raw); } catch (e) { cleanup([mf]); return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json не является JSON.'); }
	let validated = validate_manifest(value, size && size.size); cleanup([mf]);
	if (!validated.ok) return validated;
	return { ok: true, manifest: validated.manifest, trustMode: 'allow-untrusted' };
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
			let url = 'https://raw.githubusercontent.com/necronicle/z2k/z2k-enhanced/files/lua/z2k-state-persist.lua';
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
				checked = plan_result(checked.manifest, newUpdates, checked.rebases || [], newReviews, newAdvisory, newBlocking, newDetails, newReasons);
			}
		}
		return { ok: true, status: checked.status, updateState: checked.updateState, attentionState: checked.attentionState, canApply: checked.canApply, updates: checked.updates, rebases: checked.rebases, reviews: checked.reviews, advisoryReviews: checked.advisoryReviews, blockingReviews: checked.blockingReviews, blockingReasons: checked.blockingReasons, release: checked.manifest.current, source: { repository: 'necronicle/z2k', branch: 'z2k-enhanced' }, trustMode: remote.trustMode, manifest: checked.manifest, plan: checked };
	}
	return lastErr || fail('ESTALE', 'Z2K manifest/candidate race — retry limit exceeded');
};
