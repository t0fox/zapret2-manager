'use strict';

// Z2K component boundary. This module classifies the signed upstream first,
// then delegates every mutable byte to the canonical Asset Registry. It never
// installs Z2K init scripts, schedulers, webpanel files, or a second runtime.
import { readfile, stat, readlink } from 'fs';
import { z2k_upstream_plan } from './z2k-upstream.uc';
import { asset_registry_apply_bundle } from './asset-registry.uc';

const CLASSIFICATION = '/usr/share/zapret2-manager/upstreams/z2k-integration.json';
const STAGE_ROOT = '/tmp/z2m-resource-update';
const SOURCE_REPOSITORY = 'necronicle/z2k';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function fail(code, message, details) { let out = { ok: false, error: { code: code, message: message } }; if (details != null) out.error.details = details; return out; }
function regular(path) { try { let s = stat(path), link = readlink(path); return object(s) && s.type == 'file' && link == null && type(s.size) == 'int'; } catch (e) { return false; } }
function under(path, root) { return string(path) && string(root) && path != root && substr(path, 0, length(root) + 1) == root + '/' && index(substr(path, length(root) + 1), '..') < 0; }
function classification() { try { let value = json(readfile(CLASSIFICATION)); return object(value) && value.schema == 'zapret2-manager.z2k-integration.v1' && object(value.source) && type(value.files) == 'array' ? value : null; } catch (e) { return null; } }
function class_for(map, sourcePath) { for (let i = 0; i < length(map.files); i++) if (map.files[i].sourcePath == sourcePath) return map.files[i]; return null; }
function asset_type(item) { return item.type == 'bin' ? 'blob' : (item.type == 'lua' ? 'lua' : null); }

export const z2k_component_plan = function(remoteManifest) {
	let map = classification(); if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let checked = z2k_upstream_plan(remoteManifest); if (!checked.ok) return checked;
	let exactManaged = [], adapted = [], ignored = [], watched = [];
	for (let sourcePath in keys(checked.manifest.files_sha256)) {
		let item = class_for(map, sourcePath); if (item == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K file has no explicit integration class.', { sourcePath: sourcePath });
		if (item.class == 'exact-managed' && item.basedOnSha256 != checked.manifest.files_sha256[sourcePath]) push(exactManaged, { sourcePath: sourcePath, localName: item.localName, type: asset_type(item), sha256: checked.manifest.files_sha256[sourcePath] });
		else if (item.class == 'adapted' && item.basedOnSha256 != checked.manifest.files_sha256[sourcePath]) push(adapted, sourcePath);
		else if (item.class == 'ignored-platform' && item.basedOnSha256 != checked.manifest.files_sha256[sourcePath]) push(ignored, sourcePath);
		else if (item.class == 'watched' && item.basedOnSha256 != checked.manifest.files_sha256[sourcePath]) push(watched, sourcePath);
	}
	if (length(adapted)) return { ok: true, status: 'rebase-required', error: { code: 'EZ2K_REBASE_REQUIRED', message: 'Адаптированный Z2K файл изменился и требует ручного rebase.' }, exactManaged: exactManaged, adapted: adapted, ignored: ignored, watched: watched, source: map.source, manifest: checked.manifest };
	if (length(watched)) return { ok: true, status: 'review-required', error: { code: 'EZ2K_REVIEW_REQUIRED', message: 'Изменились наблюдаемые Z2K файлы; требуется semantic review.' }, exactManaged: exactManaged, adapted: [], ignored: ignored, watched: watched, source: map.source, manifest: checked.manifest };
	return { ok: true, status: checked.status, source: map.source, exactManaged: exactManaged, adapted: [], ignored: ignored, watched: [], manifest: checked.manifest };
};

export const z2k_component_apply = function(request) {
	if (!object(request) || request.signed !== true) return fail('EZ2K_SIGNATURE_INVALID', 'Z2K component apply requires a verified signed manifest.');
	if (request.confirm !== true) return fail('EINPUT', 'explicit Z2K component confirmation is required');
	let planned = z2k_component_plan(request.remoteManifest); if (!planned.ok) return planned;
	if (planned.status == 'rebase-required') return fail('EZ2K_REBASE_REQUIRED', planned.error.message, { adapted: planned.adapted });
	if (planned.status == 'review-required') return fail('EZ2K_REVIEW_REQUIRED', planned.error.message, { watched: planned.watched });
	if (!string(request.bundleId) || !string(request.version) || type(request.assets) != 'array' || !length(request.assets)) return fail('EINPUT', 'Z2K component asset bundle is incomplete');
	let map = classification(); if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let staged = [], seen = {};
	for (let i = 0; i < length(request.assets); i++) {
		let asset = request.assets[i], item = object(asset) ? class_for(map, asset.sourcePath) : null, typeName = item && asset_type(item);
		if (item == null || item.class != 'exact-managed') return fail('EZ2K_REBASE_REQUIRED', 'Only exact-managed Z2K files may be activated.', { sourcePath: asset && asset.sourcePath || null });
		if (!typeName || seen[asset.id] || !under(asset.stagedPath, STAGE_ROOT) || !regular(asset.stagedPath) || asset.sha256 != planned.manifest.files_sha256[asset.sourcePath]) return fail('EVERIFY', 'Z2K staged asset does not match the signed manifest.', { sourcePath: asset.sourcePath });
		seen[asset.id] = true;
		push(staged, { type: typeName, id: asset.id, name: asset.name, stagedPath: asset.stagedPath, sha256: asset.sha256, byteSize: asset.byteSize, expectedRevision: asset.expectedRevision, dependencies: asset.dependencies || [], provenance: { kind: 'catalog/upstream', source: SOURCE_REPOSITORY, sourceCommit: planned.source.commit, sourcePath: asset.sourcePath, bundleId: request.bundleId, version: request.version } });
	}
	let result = asset_registry_apply_bundle({ bundleId: request.bundleId, version: request.version, source: SOURCE_REPOSITORY, sourceCommit: planned.source.commit, assets: staged });
	return result.ok ? { ok: true, component: 'z2k-runtime-assets', transaction: result, postflight: result.postflight } : result;
};
