'use strict';

// Resource Center coordinator. It owns source/bundle policy and staging, while
// Asset Registry remains the only writer of managed asset metadata and bytes.
import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';
import { asset_registry_list, asset_registry_apply_bundle } from './asset-registry.uc';
import { z2k_upstream_check } from './z2k-upstream.uc';
import { z2k_component_apply } from './z2k-component.uc';

const MANIFEST = '/usr/share/zapret2-manager/resources/manifest.json';
const STAGE_PARENT = '/tmp/z2m-resource-update';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function fail(code, message, extra) { let out = { ok: false, error: { code: code, message: message } }; for (let k in extra || {}) out.error[k] = extra[k]; return out; }
function shell_quote(value) { let out = "'", raw = text(value); for (let i = 0; i < length(raw); i++) out += substr(raw, i, 1) == "'" ? "'\\''" : substr(raw, i, 1); return out + "'"; }
function command(value) { let p = popen(value + ' 2>&1', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function regular(path) { try { let value = stat(path); return object(value) && value.type == 'file' && type(value.size) == 'int'; } catch (e) { return false; } }
function sha256(path) { if (!regular(path)) return null; let value = command("sha256sum " + shell_quote(path) + " | awk '{print $1}'"); let digest = trim(value.out); return value.rc == 0 && match(digest, /^[a-f0-9]{64}$/) ? digest : null; }
function load_manifest() { let raw = readfile(MANIFEST); if (raw == null || length(raw) > MAX_MANIFEST_BYTES) return fail('EINPUT', 'resource manifest is unavailable or too large'); let value = null; try { value = json(raw); } catch (e) { return fail('EINPUT', 'resource manifest is malformed'); } if (!object(value) || value.schema != 'zapret2-manager.resource-manifest.v1' || type(value.sources) != 'array' || type(value.bundles) != 'array') return fail('EINPUT', 'resource manifest schema is invalid'); return { ok: true, manifest: value }; }
function source(manifest, id) { for (let i = 0; i < length(manifest.sources); i++) if (manifest.sources[i].id == id) return manifest.sources[i]; return null; }
function bundle(manifest, id) { for (let i = 0; i < length(manifest.bundles); i++) if (manifest.bundles[i].id == id) return manifest.bundles[i]; return null; }
function registry_asset(assets, id) { for (let i = 0; i < length(assets); i++) if (assets[i].id == id) return assets[i]; return null; }
function state_label(state) { return ({ current: 'Актуально', update: 'Доступно обновление', missing: 'Не установлено', checking: 'Проверяем', unavailable: 'Источник недоступен', stale: 'Проверка устарела', error: 'Ошибка проверки', attention: 'Требуется внимание' })[state] || 'Требуется внимание'; }
function current_asset(item, assets) {
	let registered = registry_asset(assets, item.id);
	if (registered != null) return regular(registered.path) ? { record: registered, path: registered.path, sha256: sha256(registered.path), byteSize: stat(registered.path).size, ownership: registered.ownership } : { record: registered, path: registered.path, sha256: null, byteSize: 0, ownership: registered.ownership };
	if (string(item.packagePath) && regular(item.packagePath)) return { record: null, path: item.packagePath, sha256: sha256(item.packagePath), byteSize: stat(item.packagePath).size, ownership: 'package' };
	return null;
}
function row_for(item, assets) {
	let current = current_asset(item, assets), registered = registry_asset(assets, item.id), state = current == null ? 'missing' : (registered != null && registered.ownership != 'package' && (!registered.provenance || registered.provenance.kind != 'catalog/upstream') ? 'attention' : (current.sha256 == item.sha256 && current.byteSize == item.byteSize ? 'current' : 'update'));
	return { id: item.id, type: item.type, name: item.name, sourcePath: item.sourcePath, path: current && current.path || item.packagePath || null, ownership: current && current.ownership || null, packageBaseline: current != null && current.ownership == 'package', revision: registered && registered.revision || 0, contentSha256: current && current.sha256 || null, byteSize: current && current.byteSize || 0, lastChecked: registered && registered.lastChecked || null, lastUpdated: registered && registered.lastUpdated || null, state: state, status: state_label(state), references: registered && registered.references || [], compatibility: item.compatibility || {}, dependencies: item.dependencies || [], source: item.sourceId || null, sourceCommit: item.sourceCommit || null, safeToUpdate: state != 'attention' };
}
function source_rows(manifest, rows) {
	let result = [];
	for (let i = 0; i < length(manifest.sources); i++) {
		let sourceValue = manifest.sources[i], sourceRows = [];
		for (let j = 0; j < length(rows); j++) if (rows[j].source == sourceValue.id) push(sourceRows, rows[j]);
		let state = sourceValue.status == 'package-pinned' ? 'current' : 'current';
		for (let j = 0; j < length(sourceRows); j++) { if (sourceRows[j].state == 'attention') { state = 'attention'; break; } if (sourceRows[j].state == 'update') state = 'update'; if (sourceRows[j].state == 'missing' && state == 'current') state = 'missing'; }
		push(result, { id: sourceValue.id, kind: sourceValue.kind, label: sourceValue.label, repository: sourceValue.repository, commit: sourceValue.commit, version: sourceValue.version || null, status: state_label(state), state: state, manifestPath: sourceValue.manifestPath || null, rows: length(sourceRows), checkMode: 'manifest-only' });
	}
	return result;
}
function build_status(manifest, checkedAt) {
	let listed = asset_registry_list(null); if (!listed.ok) return listed;
	let rows = [], installed = [], seen = {};
	for (let i = 0; i < length(manifest.bundles); i++) {
		let sourceValue = source(manifest, manifest.bundles[i].sourceId), items = manifest.bundles[i].assets || [];
		for (let j = 0; j < length(items); j++) { let item = items[j], row = row_for({ ...item, sourceId: manifest.bundles[i].sourceId, sourceCommit: manifest.bundles[i].sourceCommit }, listed.assets); push(rows, row); if (row.path != null) { row.provenance = sourceValue ? { source: sourceValue.label, repository: sourceValue.repository, commit: manifest.bundles[i].sourceCommit, sourcePath: item.sourcePath } : null; push(installed, row); } seen[item.id] = true; }
	}
	for (let i = 0; i < length(listed.assets); i++) if (!seen[listed.assets[i].id]) { let asset = listed.assets[i], row = { id: asset.id, type: asset.type, name: asset.name, path: asset.path, ownership: asset.ownership, packageBaseline: asset.ownership == 'package', revision: asset.revision, contentSha256: asset.contentSha256, byteSize: asset.byteSize, lastChecked: asset.lastChecked || null, lastUpdated: asset.lastUpdated || null, references: asset.references || [], state: asset.validation && asset.validation.status == 'passed' ? 'current' : 'attention', status: state_label(asset.validation && asset.validation.status == 'passed' ? 'current' : 'attention'), provenance: asset.provenance || null, safeToUpdate: asset.ownership != 'package' }; push(installed, row); }
	let updates = [], byType = {}, consumers = {};
	for (let i = 0; i < length(rows); i++) if (rows[i].state == 'update' || rows[i].state == 'missing') { push(updates, rows[i]); byType[rows[i].type] = (byType[rows[i].type] || 0) + 1; let consumer = rows[i].compatibility.consumer || 'не указано'; consumers[consumer] = (consumers[consumer] || 0) + 1; }
	return { ok: true, schema: 1, checkedAt: checkedAt || null, manifest: { bundleId: manifest.bundleId, version: manifest.version, generatedAt: manifest.generatedAt }, sources: source_rows(manifest, rows), installed: installed, updates: updates, summary: { installed: length(installed), updates: length(updates), byType: byType, consumers: consumers }, autoCheck: { enabled: false, autoInstall: false, mode: 'manifest-only' } };
}
function make_stage_root() { try { mkdir(STAGE_PARENT); } catch (e) {} let value = command('mktemp -d ' + shell_quote(STAGE_PARENT + '/stage.XXXXXX')); let root = trim(value.out); return value.rc == 0 && index(root, STAGE_PARENT + '/') == 0 ? root : null; }
function cleanup(root, paths) { for (let i = 0; i < length(paths || []); i++) { try { unlink(paths[i]); } catch (e) {} } if (root != null) command('rmdir ' + shell_quote(root) + ' >/dev/null 2>&1'); }
function base64_decode(value) { if (!string(value) || length(value) > MAX_REQUEST_BYTES || !match(value, /^[A-Za-z0-9+\/=%]*$/)) return null; let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', buffer = 0, bits = 0; for (let i = 0; i < length(value); i++) { let c = substr(value, i, 1); if (c == '=') break; let n = index(alphabet, c); if (n < 0) return null; buffer = buffer * 64 + n; bits += 6; if (bits >= 8) { bits -= 8; out += chr((buffer >> bits) & 255); buffer = buffer & ((1 << bits) - 1); } } return out; }
function inline_bundle(request) {
	let bundle = request.controlledBundle; if (!request.controlledTest || !object(bundle) || !string(bundle.bundleId) || substr(bundle.bundleId, 0, 11) != 'controlled-' || type(bundle.assets) != 'array' || !length(bundle.assets)) return null;
	let root = make_stage_root(); if (root == null) return fail('ETARGET', 'resource staging directory is unavailable'); let paths = [], staged = [];
	for (let i = 0; i < length(bundle.assets); i++) { let item = bundle.assets[i], content = base64_decode(item.contentBase64); if (!object(item) || content == null || !string(item.id) || !string(item.type)) { cleanup(root, paths); return fail('EINPUT', 'controlled bundle asset is invalid'); } let path = root + '/' + i + '.asset'; try { writefile(path, content); } catch (e) { cleanup(root, paths); return fail('EWRITE', 'controlled bundle staging failed'); } push(paths, path); push(staged, { type: item.type, id: item.id, name: item.name, stagedPath: path, sha256: item.sha256, byteSize: item.byteSize, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: 'controlled-test', sourceCommit: bundle.sourceCommit || '0000000000000000000000000000000000000000', sourcePath: item.sourcePath || item.id, bundleId: bundle.bundleId, version: bundle.version || 'test' } }); }
	let answer = asset_registry_apply_bundle({ bundleId: bundle.bundleId, version: bundle.version || 'test', source: 'controlled-test', sourceCommit: bundle.sourceCommit || '0000000000000000000000000000000000000000', assets: staged }); cleanup(root, paths); return answer;
}
export const resource_center_status = function () {
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let answer = build_status(loaded.manifest, null);
	if (answer.ok) answer.signedSources = { z2k: { state: 'unknown', status: 'Проверка подписи выполняется только явно', checkMode: 'signed-manifest', verified: false } };
	return answer;
};
export const resource_center_check = function () {
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let answer = build_status(loaded.manifest, time()); if (!answer.ok) return answer;
	let signed = z2k_upstream_check(); answer.signedSources = { z2k: { state: signed.ok ? (signed.status == 'current' ? 'current' : 'attention') : 'error', status: signed.ok ? signed.status : 'Ошибка проверки подписи', checkMode: 'signed-manifest', verified: signed.ok === true, evidence: signed.ok ? { repository: signed.source.repository, branch: signed.source.branch, trustRoot: signed.trustRoot, manifestSeq: signed.manifest.seq, manifestCurrent: signed.manifest.current } : { code: signed.error && signed.error.code || 'EZ2K_CHECK_FAILED', message: signed.error && signed.error.message || 'signed Z2K manifest check failed' } } };
	for (let i = 0; i < length(answer.sources); i++) if (answer.sources[i].id == 'z2k-resources') { answer.sources[i].checkMode = 'signed-manifest'; answer.sources[i].verification = answer.signedSources.z2k; if (!signed.ok) { answer.sources[i].state = 'error'; answer.sources[i].status = state_label('error'); } }
	return answer;
};
export const resource_center_update = function (request) {
	if (!object(request) || request.confirm !== true) return fail('EINPUT', 'explicit update confirmation is required');
	if (request.component == 'z2k-runtime') return z2k_component_apply(request);
	let controlled = inline_bundle(request); if (controlled != null) return controlled;
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let selected = bundle(loaded.manifest, request.bundleId); if (selected == null) return fail('EINPUT', 'resource bundle is not configured'); let sourceValue = source(loaded.manifest, selected.sourceId); if (sourceValue == null) return fail('EINPUT', 'resource bundle source is not configured'); let listed = asset_registry_list(null); if (!listed.ok) return listed;
	if (selected.sourceId == 'z2k-resources') { let signed = z2k_upstream_check(); if (!signed.ok) return fail('EVERIFY', 'signed Z2K manifest verification failed; update is blocked', { cause: signed.error }); if (signed.status == 'rebase-required') return fail('EZ2K_REBASE_REQUIRED', 'signed Z2K manifest requires adapted-file rebase', { rebases: signed.plan.rebases }); if (signed.status == 'review-required') return fail('EZ2K_REVIEW_REQUIRED', 'signed Z2K manifest requires semantic review', { reviews: signed.plan.reviews }); }
	let root = make_stage_root(); if (root == null) return fail('ETARGET', 'resource staging directory is unavailable'); let paths = [], staged = [];
	for (let i = 0; i < length(selected.assets || []); i++) { let item = selected.assets[i], row = row_for({ ...item, sourceId: selected.sourceId, sourceCommit: selected.sourceCommit }, listed.assets); if (row.state == 'current') continue; let registered = registry_asset(listed.assets, item.id); if (registered != null && (registered.ownership == 'package' || !registered.provenance || registered.provenance.kind != 'catalog/upstream')) { cleanup(root, paths); return fail('EPOLICY', 'user or package resource is protected', { id: item.id }); } let path = root + '/' + i + '.asset', fetched = command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(item.contentUrl)); if (fetched.rc != 0 || !regular(path)) { cleanup(root, paths); return fail('EUNAVAILABLE', 'resource source is unavailable', { id: item.id, source: sourceValue.repository }); } push(paths, path); push(staged, { type: item.type, id: item.id, name: item.name, stagedPath: path, sha256: item.sha256, byteSize: item.byteSize, expectedRevision: registered && registered.revision || null, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: sourceValue.repository, sourceCommit: selected.sourceCommit, sourcePath: item.sourcePath, bundleId: selected.id, version: selected.version } }); }
	if (!length(staged)) { cleanup(root, paths); return { ok: true, bundleId: selected.id, version: selected.version, updated: 0, state: 'current', status: state_label('current') }; }
	let answer = asset_registry_apply_bundle({ bundleId: selected.id, version: selected.version, source: sourceValue.repository, sourceCommit: selected.sourceCommit, assets: staged }); cleanup(root, paths); return answer;
};
