'use strict';
import { readfile, stat, unlink, popen } from 'fs';
import { asset_registry_list } from './asset-registry.uc';

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
function plan(value) {
	let checked = validate_manifest(value, length(sprintf('%J', value))); if (!checked.ok) return checked;
	let map = classification(); if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let updates = [], rebases = [], reviews = [];
	for (let path in keys(checked.manifest.files_sha256)) {
		let digest = checked.manifest.files_sha256[path], item = class_for(map, path);
		if (item == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Новый Z2K файл отсутствует в integration classification.', { path: path });
		if (item.class == 'adapted' && item.basedOnSha256 != digest) push(rebases, path);
		else if (item.class == 'exact-managed') {
			let installed = installedShaFor(path);
			if (installed == null) push(updates, path);
			else if (installed != digest) push(updates, path);
		}
		else if (item.class == 'watched' && item.basedOnSha256 != digest) push(reviews, path);
		else if (item.class == 'ignored-platform' && false) { /* explicit no-op, never auto-update */ }
	}
	if (length(rebases)) return { ok: true, status: 'rebase-required', updates: updates, rebases: rebases, reviews: reviews, manifest: checked.manifest };
	if (length(reviews)) return { ok: true, status: 'review-required', updates: updates, rebases: rebases, reviews: reviews, manifest: checked.manifest };
	return { ok: true, status: length(updates) ? 'update-available' : 'current', updates: updates, rebases: [], reviews: [], manifest: checked.manifest };
}
function fetch_untrusted_manifest() {
	let manifest = temp_file(); if (manifest == null) return fail('EIO', 'Не удалось создать private Z2K staging file.');
	let last = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		cleanup([manifest]);
		let nonce = '' + time() + '-' + attempt;
		if (!fetch_file(source_url(MANIFEST_URL, nonce), manifest)) { last = fail('EUNAVAILABLE', 'Не удалось получить UPDATES.json.'); continue; }
		let size = stat(manifest), raw = readfile(manifest), value = null;
		try { value = json(raw); } catch (e) { cleanup([manifest]); return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json не является JSON.'); }
		let validated = validate_manifest(value, size && size.size); cleanup([manifest]);
		if (!validated.ok) return validated;
		return { ok: true, manifest: validated.manifest, trustMode: 'allow-untrusted' };
	}
	cleanup([manifest]); return last || fail('EUNAVAILABLE', 'Z2K manifest unavailable.');
}

export const z2k_upstream_plan = function(remoteManifest) { return plan(remoteManifest); };
export const z2k_upstream_check = function() {
	if (!ALLOW_UNTRUSTED) return fail('EUNSUPPORTED', 'Signed Z2K verification is disabled in this build.');
	let remote = fetch_untrusted_manifest(); if (!remote.ok) return remote;
	let checked = plan(remote.manifest); if (!checked.ok) return checked;
	return { ok: true, status: checked.status, source: { repository: 'necronicle/z2k', branch: 'z2k-enhanced' }, trustMode: remote.trustMode, manifest: checked.manifest, plan: checked };
};
