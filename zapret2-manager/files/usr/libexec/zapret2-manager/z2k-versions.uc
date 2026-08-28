'use strict';

// Z2K release catalog and lazy release detail resolver. The catalog is
// intentionally metadata-only: UPDATES.json is fetched only after a user
// selects a release or a target prepare explicitly asks for it.
import { readfile, writefile, stat, unlink, popen } from 'fs';
import { asset_registry_list } from './asset-registry.uc';

const REPOSITORY = 'necronicle/z2k';
const BRANCH = 'z2k-enhanced';
const API_ROOT = 'https://api.github.com/repos/' + REPOSITORY;
const RAW_ROOT = 'https://raw.githubusercontent.com/' + REPOSITORY;
const TAGS_URL = API_ROOT + '/git/refs/tags?per_page=100';
const CLASSIFICATION = '/usr/share/zapret2-manager/upstreams/z2k-integration.json';
const CACHE_FILE = '/etc/zapret2-manager/z2k-version-catalog.json';
const MAX_VERSIONS = 10;
const MAX_TAGS = 256;
const MAX_MANIFEST = 512 * 1024;
const MAX_API_RESPONSE = 512 * 1024;
const MAX_PATH = 256;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function fail(code, message, details) { let out = { ok: false, error: { code: code, message: message } }; for (let k in details || {}) out.error[k] = details[k]; return out; }
function quote(value) { let raw = text(value); if (index(raw, "'") >= 0 || index(raw, '\n') >= 0 || index(raw, '\r') >= 0) return null; return "'" + raw + "'"; }
function command(value) { let p = popen(value + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function regular(path) { try { let value = stat(path); return object(value) && value.type == 'file' && type(value.size) == 'int'; } catch (e) { return false; } }
function temp_file(prefix) { let safe = prefix || 'z2m-z2k'; let p = popen('umask 077; mktemp /tmp/' + safe + '.XXXXXX 2>/dev/null', 'r'); if (!p) return null; let value = trim(p.read('all') || ''), rc = p.close(); return rc == 0 && match(value, /^\/tmp\/[A-Za-z0-9._-]+$/) ? value : null; }
function cleanup(path) { if (path != null) try { unlink(path); } catch (e) {} }
function fetch_text(url, limit, prefix) {
	let qurl = quote(url), path = temp_file(prefix); if (qurl == null || path == null) { cleanup(path); return null; }
	let result = command('uclient-fetch -q -T 20 -O ' + quote(path) + ' ' + qurl);
	let size = stat(path), raw = result.rc == 0 && size != null && size.size <= (limit || MAX_API_RESPONSE) ? readfile(path) : null;
	cleanup(path); return raw == null || length(raw) > (limit || MAX_API_RESPONSE) ? null : raw;
}
function fetch_json(url, limit) { let raw = fetch_text(url, limit, 'z2m-z2k-version'); if (raw == null) return null; try { return json(raw); } catch (e) { return null; } }
function valid_sha(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function parse_release(value) {
	if (!string(value) || !match(value, /^r-[0-9]+(\.[0-9]+)?$/)) return null;
	let body = substr(value, 2), dot = index(body, '.');
	return { version: value, major: + (dot < 0 ? body : substr(body, 0, dot)), minor: dot < 0 ? 0 : +substr(body, dot + 1) };
}
function release_compare(a, b) { let left = parse_release(a.version || a), right = parse_release(b.version || b); if (left.major != right.major) return right.major - left.major; if (left.minor != right.minor) return right.minor - left.minor; return text(left.version) == text(right.version) ? 0 : (text(left.version) < text(right.version) ? -1 : 1); }
function tag_name(ref) { if (!object(ref) || !string(ref.ref)) return null; let prefix = 'refs/tags/'; if (substr(ref.ref, 0, length(prefix)) != prefix) return null; let value = substr(ref.ref, length(prefix)); return parse_release(value) == null ? null : value; }
function resolve_tag_commit(version, tagSha, objectType) {
	if (parse_release(version) == null || !valid_sha(tagSha)) return null;
	if (objectType == 'commit') return { commitSha: lc(tagSha), publishedAt: null, tagSha: lc(tagSha) };
	let tag = fetch_json(API_ROOT + '/git/tags/' + tagSha, MAX_API_RESPONSE), target = object(tag) && object(tag.object) ? tag.object : null;
	if (target != null && target.type == 'commit' && valid_sha(target.sha)) return { commitSha: lc(target.sha), publishedAt: object(tag.tagger) && tag.tagger.date || null, tagSha: lc(tagSha) };
	return null;
}
function read_classification() {
	try {
		let value = json(readfile(CLASSIFICATION));
		if (!object(value) || value.schema != 'zapret2-manager.z2k-integration.v1' || type(value.files) != 'array') return null;
		for (let i = 0; type(value.historicalFiles) == 'array' && i < length(value.historicalFiles); i++) push(value.files, value.historicalFiles[i]);
		return value;
	} catch (e) { return null; }
}
function class_for(map, path) { for (let i = 0; i < length(map.files); i++) if (map.files[i] && map.files[i].sourcePath == path) return map.files[i]; return null; }
function relevant_path(path) { return string(path) && (substr(path, 0, 10) == 'files/lua/' || substr(path, 0, 11) == 'files/fake/' || substr(path, 0, 12) == 'files/lists/'); }
function safe_path(path) { return string(path) && length(path) > 0 && length(path) <= MAX_PATH && substr(path, 0, 1) != '/' && index(path, '\\') < 0 && index(path, '..') < 0 && match(path, /^[A-Za-z0-9._\/-]+$/); }
function asset_id(item, path) {
	let base = item && item.localName ? item.localName : path, slash = rindex(base, '/'), name = slash >= 0 ? substr(base, slash + 1) : base, dot = rindex(name, '.'), slug = dot >= 0 ? substr(name, 0, dot) : name;
	slug = lc(slug);
	if (slug == 'list' && index(path, 'extra_strats') >= 0) { let dir = substr(path, 0, rindex(path, '/')), after = substr(dir, length('files/lists/')), flat = ''; for (let i = 0; i < length(after); i++) flat += substr(after, i, 1) == '/' ? '_' : lc(substr(after, i, 1)); slug = flat + '_list'; }
	let typeName = item && item.type == 'lua' ? 'lua' : (item && (item.type == 'bin' || item.type == 'txt') ? 'blob' : null); return typeName == null ? null : typeName + ':' + slug;
}
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function validate_manifest(value, rawSize, requested) {
	if (!object(value) || rawSize == null || rawSize < 2 || rawSize > MAX_MANIFEST || value.schema != 1 || value.branch != BRANCH || type(value.seq) != 'int' || value.seq < 0 || !string(value.current) || parse_release(value.current) == null || (requested != null && value.current != requested) || !object(value.files_sha256)) return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json schema or release identity is invalid.');
	let names = keys(value.files_sha256); if (!length(names) || length(names) > MAX_TAGS) return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json file count is invalid.');
	for (let i = 0; i < length(names); i++) { let path = names[i], digest = value.files_sha256[path]; if (!safe_path(path) || !valid_digest(digest)) return fail('EVERIFY', 'UPDATES.json contains an unsafe path or invalid SHA-256.', { path: path }); value.files_sha256[path] = lc(digest); }
	return { ok: true, manifest: value };
}
function fetch_manifest(version, commitSha) {
	if (parse_release(version) == null || !valid_sha(commitSha)) return fail('EINPUT', 'Z2K target identity is invalid.');
	let url = RAW_ROOT + '/' + commitSha + '/UPDATES.json', raw = fetch_text(url, MAX_MANIFEST, 'z2m-z2k-manifest');
	if (raw == null) return fail('EUNAVAILABLE', 'Не удалось получить UPDATES.json выбранного release.');
	let value = null; try { value = json(raw); } catch (e) { return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json не является JSON.'); }
	let checked = validate_manifest(value, length(raw), version); if (!checked.ok) return checked;
	let digestPath = temp_file('z2m-z2k-digest'); if (digestPath == null) return fail('EIO', 'Не удалось подготовить digest manifest.');
	try { writefile(digestPath, raw); } catch (e) { cleanup(digestPath); return fail('EIO', 'Не удалось записать digest manifest.'); }
	let digestResult = command("sha256sum " + quote(digestPath) + " | awk '{print $1}'"); cleanup(digestPath); let manifestSha256 = trim(digestResult.out);
	if (digestResult.rc != 0 || !valid_digest(manifestSha256)) return fail('EIO', 'Не удалось вычислить digest manifest.');
	return { ok: true, manifest: checked.manifest, manifestSha256: lc(manifestSha256) };
}
function managed_membership(manifest, map) {
	if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let assets = [], unknown = [], names = keys(manifest.files_sha256);
	for (let i = 0; i < length(names); i++) { let path = names[i], item = class_for(map, path); if (item == null) { if (relevant_path(path)) push(unknown, path); continue; } if (item.class == 'exact-managed') { let id = asset_id(item, path); if (id == null) { push(unknown, path); continue; } push(assets, { sourcePath: path, sha256: manifest.files_sha256[path], id: id, type: substr(id, 0, index(id, ':')), name: item.localName || id, packagePath: item.packageBaselinePath || null, runtimeTarget: item.runtimeTarget || null, dependencies: item.dependencies || [] }); } }
	sort(assets, function(a, b) { return a.sourcePath == b.sourcePath ? 0 : (a.sourcePath < b.sourcePath ? -1 : 1); }); sort(unknown); return { assets: assets, unknown: unknown };
}
function installed_release() {
	try { let listed = asset_registry_list(null); if (!listed || !listed.ok || type(listed.activationReceipts) != 'array') return null; for (let i = length(listed.activationReceipts) - 1; i >= 0; i--) { let receipt = listed.activationReceipts[i]; if (object(receipt) && receipt.bundleId == 'z2k-curated-lua' && parse_release(receipt.version) != null && type(receipt.assets) == 'array' && length(receipt.assets)) return receipt.version; } } catch (e) {} return null;
}
function target_operation(version, installed) {
	if (!installed) return 'install';
	let comparison = z2k_compare_versions(version, installed);
	return comparison == null ? null : (comparison > 0 ? 'upgrade' : (comparison < 0 ? 'downgrade' : 'reinstall'));
}
function fetch_refs() {
	let refs = fetch_json(TAGS_URL, MAX_API_RESPONSE); if (type(refs) != 'array' || length(refs) > MAX_TAGS) return fail('EUNAVAILABLE', 'Не удалось получить каталог Z2K releases.');
	let seen = {}, candidates = [];
	for (let i = 0; i < length(refs); i++) { let version = tag_name(refs[i]); if (version == null || seen[version]) continue; let sha = refs[i].object && refs[i].object.sha, objectType = refs[i].object && refs[i].object.type; if (!valid_sha(sha) || (objectType != 'commit' && objectType != 'tag')) continue; seen[version] = true; push(candidates, { version: version, tagSha: lc(sha), objectType: objectType }); }
	sort(candidates, function(a, b) { return release_compare(a, b); }); return { ok: true, refs: candidates };
}
function catalog_row(candidate, installed) {
	let resolved = resolve_tag_commit(candidate.version, candidate.tagSha, candidate.objectType);
	return { version: candidate.version, latest: false, installed: candidate.version == installed, commitSha: resolved && resolved.commitSha || null, publishedAt: resolved && resolved.publishedAt || 0, installable: resolved != null, unavailableReason: resolved == null ? 'release-unavailable' : null, tagSha: candidate.tagSha };
}
function read_cache() { try { let raw = readfile(CACHE_FILE); if (raw == null || length(raw) > MAX_API_RESPONSE) return null; let value = json(raw); return object(value) && type(value.versions) == 'array' ? value : null; } catch (e) { return null; } }
function cached_catalog_row(cached, version, tagSha) {
	for (let i = 0; cached && type(cached.versions) == 'array' && i < length(cached.versions); i++) {
		let row = cached.versions[i];
		if (object(row) && row.version == version && (!string(row.tagSha) || row.tagSha == tagSha) && valid_sha(row.commitSha)) return row;
	}
	return null;
}
function save_cache(value) { let tmp = CACHE_FILE + '.tmp.' + time(); try { writefile(tmp, sprintf('%J', value) + '\n'); let moved = command('mv -f ' + quote(tmp) + ' ' + quote(CACHE_FILE)); if (moved.rc != 0) cleanup(tmp); } catch (e) { cleanup(tmp); } }

export const z2k_versions = function() {
	let installed = installed_release(), refs = fetch_refs(), cached = read_cache(), stale = false;
	if (!refs.ok) { let cached = read_cache(); if (cached != null) return { ok: true, repository: REPOSITORY, versions: cached.versions, stale: true }; return refs; }
	let rows = [], limit = MAX_VERSIONS;
	for (let i = 0; i < length(refs.refs) && i < limit; i++) {
		let candidate = refs.refs[i], row = catalog_row(candidate, installed), old = cached_catalog_row(cached, candidate.version, candidate.tagSha);
		if (row.commitSha == null) {
			stale = true;
			if (old != null) { row.commitSha = old.commitSha; row.publishedAt = old.publishedAt || 0; row.installable = true; row.unavailableReason = null; }
		}
		push(rows, row);
	}
	if (installed != null) { let present = false; for (let i = 0; i < length(rows); i++) if (rows[i].version == installed) present = true; if (!present) for (let i = limit; i < length(refs.refs); i++) if (refs.refs[i].version == installed) { let candidate = refs.refs[i], row = catalog_row(candidate, installed), old = cached_catalog_row(cached, candidate.version, candidate.tagSha); if (row.commitSha == null) { stale = true; if (old != null) { row.commitSha = old.commitSha; row.publishedAt = old.publishedAt || 0; row.installable = true; row.unavailableReason = null; } } push(rows, row); break; } }
	if (length(rows)) rows[0].latest = true;
	let result = { ok: true, repository: REPOSITORY, versions: rows, installedRelease: installed, generatedAt: time(), stale: stale };
	if (!stale) save_cache(result);
	return result;
};

function commit_metadata(commitSha) { let value = fetch_json(API_ROOT + '/commits/' + commitSha, MAX_API_RESPONSE); if (!object(value) || !object(value.commit)) return null; return { message: value.commit.message || '', date: value.commit.author && value.commit.author.date || null }; }
function human_body(message) { let value = text(message), marker = index(value, '—'); if (marker < 0) return null; let body = trim(substr(value, marker + 1)); return length(body) ? body : null; }
function fallback_body(changeSet) {
	let modified = changeSet && type(changeSet.modified) == 'int' ? changeSet.modified : 0;
	let added = changeSet && type(changeSet.added) == 'int' ? changeSet.added : 0;
	let removed = changeSet && type(changeSet.removed) == 'int' ? changeSet.removed : 0;
	return 'Изменено ' + modified + ' ресурсов Z2K. Добавлено ' + added + '. Удалено ' + removed + '.';
}
function target_release(version, catalog) { for (let i = 0; i < length(catalog || []); i++) if (catalog[i].version == version) return catalog[i]; return null; }
function release_manifest(row) { return row == null || !valid_sha(row.commitSha) ? fail('EUNAVAILABLE', 'Выбранный release не имеет immutable commit.') : fetch_manifest(row.version, row.commitSha); }
function changes_between(current, previous, map) {
	let now = managed_membership(current, map), old = previous == null ? { assets: [], unknown: [] } : managed_membership(previous, map), currentBy = {}, previousBy = {}, added = 0, modified = 0, removed = 0, paths = [];
	for (let i = 0; i < length(now.assets); i++) currentBy[now.assets[i].sourcePath] = now.assets[i].sha256;
	for (let i = 0; i < length(old.assets); i++) previousBy[old.assets[i].sourcePath] = old.assets[i].sha256;
	for (let path in currentBy) { if (previousBy[path] == null) { added++; push(paths, path); } else if (previousBy[path] != currentBy[path]) { modified++; push(paths, path); } }
	for (let path in previousBy) if (currentBy[path] == null) { removed++; push(paths, path); }
	sort(paths); return { modified: modified, added: added, removed: removed, managedPaths: paths, unknown: now.unknown };
}

export const z2k_version_details = function(version) {
	if (parse_release(version) == null) return fail('EINPUT', 'Версия Z2K имеет недопустимый формат.');
	let catalog = z2k_versions(); if (!catalog.ok) return catalog; let row = target_release(version, catalog.versions); if (row == null) return fail('ENOENT', 'Выбранный release не найден в каталоге.');
	let checked = release_manifest(row); if (!checked.ok) return { ok: true, version: version, commitSha: row.commitSha, publishedAt: row.publishedAt, latest: row.latest, installed: row.installed, installable: false, unavailableReason: 'invalid-manifest', releaseName: 'Z2K ' + version, releaseBody: null, changes: { modified: 0, added: 0, removed: 0, managedPaths: [] } };
	let map = read_classification(), membership = managed_membership(checked.manifest, map); if (length(membership.unknown)) return { ok: true, version: version, commitSha: row.commitSha, publishedAt: row.publishedAt, latest: row.latest, installed: row.installed, installable: false, unavailableReason: 'incompatible-manager', releaseName: 'Z2K ' + version, releaseBody: null, changes: { modified: 0, added: 0, removed: 0, managedPaths: [] }, technical: { unknownRelevantPaths: membership.unknown } };
	let metadata = commit_metadata(row.commitSha), previous = null, previousVersion = null, installedVersion = installed_release(), operation = target_operation(version, installedVersion); for (let i = 0; i < length(catalog.versions); i++) if (catalog.versions[i].version == version && i + 1 < length(catalog.versions)) { previous = catalog.versions[i + 1]; previousVersion = previous.version; break; }
	let previousManifest = null; if (previous != null && previous.installable === true) { let old = release_manifest(previous); if (old.ok) previousManifest = old.manifest; }
	let changeSet = changes_between(checked.manifest, previousManifest, map), body = human_body(metadata && metadata.message) || fallback_body(changeSet);
	return { ok: true, version: version, commitSha: row.commitSha, publishedAt: row.publishedAt, releaseName: 'Z2K ' + version, releaseBody: body, latest: row.latest, installed: row.installed, operation: operation, installedVersion: installedVersion, installable: true, unavailableReason: null, previousVersion: previousVersion, changes: { modified: changeSet.modified, added: changeSet.added, removed: changeSet.removed, managedPaths: changeSet.managedPaths }, compareUrl: previousVersion ? 'https://github.com/' + REPOSITORY + '/compare/' + previousVersion + '...' + version : null, manifest: checked.manifest, manifestSha256: checked.manifestSha256, assets: membership.assets };
};

export const z2k_resolve_version = function(version) {
	if (parse_release(version) == null) return fail('EINPUT', 'Версия Z2K имеет недопустимый формат.');
	let catalog = z2k_versions(); if (!catalog.ok) return catalog; let row = target_release(version, catalog.versions); if (row == null || !valid_sha(row.commitSha)) return fail('ENOENT', 'Выбранный release не найден или не разрешён.');
	let checked = release_manifest(row); if (!checked.ok) return checked; let map = read_classification(), membership = managed_membership(checked.manifest, map); if (length(membership.unknown)) return fail('EZ2K_INCOMPATIBLE', 'Эта версия несовместима с текущей версией Zapret2 Manager.', { version: version, unknownRelevantPaths: membership.unknown });
	return { ok: true, version: version, commitSha: row.commitSha, manifest: checked.manifest, manifestSha256: checked.manifestSha256, assets: membership.assets, latest: row.latest, installed: row.installed };
};

export const z2k_compare_versions = function(left, right) {
	let a = parse_release(left), b = parse_release(right); if (a == null || b == null) return null;
	if (a.major != b.major) return a.major < b.major ? -1 : 1;
	if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
	return 0;
};
export const z2k_installed_release = function() { return installed_release(); };
