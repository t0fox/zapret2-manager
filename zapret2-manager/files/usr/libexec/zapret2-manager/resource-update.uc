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
const CHECK_STATE = '/etc/zapret2-manager/resource-source-check.json';
const MAX_CHECK_STATE_BYTES = 512 * 1024;

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
function state_label(state) { return ({ current: 'Актуально', update: 'Доступно обновление', missing: 'Не установлено', checking: 'Проверяем', unavailable: 'Источник недоступен', stale: 'Проверка устарела', error: 'Ошибка проверки', attention: 'Требуется внимание', unknown: 'Не проверено' })[state] || 'Требуется внимание'; }
function current_asset(item, assets) {
	let registered = registry_asset(assets, item.id);
	if (registered != null) return regular(registered.path) ? { record: registered, path: registered.path, sha256: sha256(registered.path), byteSize: stat(registered.path).size, ownership: registered.ownership } : { record: registered, path: registered.path, sha256: null, byteSize: 0, ownership: registered.ownership };
	if (string(item.packagePath) && regular(item.packagePath)) return { record: null, path: item.packagePath, sha256: sha256(item.packagePath), byteSize: stat(item.packagePath).size, ownership: 'package' };
	return null;
}
function row_for(item, assets) {
	let current = current_asset(item, assets), registered = registry_asset(assets, item.id), state;
	if (current == null) state = 'missing';
	else if (registered != null && registered.ownership != 'package' && (!registered.provenance || registered.provenance.kind != 'catalog/upstream')) state = 'attention';
	else if (registered != null && registered.provenance && registered.provenance.kind == 'catalog/upstream') {
		// For dynamic catalog/upstream assets, split A/B/C:
		// A: actual file vs registered record -> integrity (broken if mismatch)
		// B: registered vs packaged baseline is NOT an update signal here (handled via C)
		// C: update availability is via z2k_upstream_check, not row_for
		if (current.sha256 == null || registered.contentSha256 == null) state = 'attention';
		else if (current.sha256 != registered.contentSha256 || current.byteSize != registered.byteSize) state = 'attention';
		else state = 'current';
	} else state = (current.sha256 == item.sha256 && current.byteSize == item.byteSize ? 'current' : 'update');
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
function z2k_projection(signed) {
	if (!object(signed) || signed.ok !== true) return { status: 'unknown', updates: [], rebases: [], reviews: [], trustMode: 'allow-untrusted', verified: false, source: null, manifest: null };
	let plan = object(signed.plan) ? signed.plan : {}, manifest = object(signed.manifest) ? signed.manifest : {};
	return {
		status: signed.status || 'unknown',
		updates: plan.updates || [],
		rebases: plan.rebases || [],
		reviews: plan.reviews || [],
		trustMode: signed.trustMode || null,
		verified: signed.ok === true && signed.trustMode != 'allow-untrusted',
		source: signed.source || null,
		manifest: { seq: manifest.seq, current: manifest.current }
	};
}
function z2k_local_projection(manifest) {
	let listed = asset_registry_list(null);
	if (!listed.ok) return { installed: false, integrity: 'broken', integrityOk: false, lua: { ready: 0, total: 0 }, baselineMatched: 0, revision: 0, commit: null, provenance: null, checkedAt: null };
	let want = {};
	for (let i = 0; i < length(manifest.bundles); i++) if (manifest.bundles[i].sourceId == 'z2k-resources') {
		let items = manifest.bundles[i].assets || [];
		for (let j = 0; j < length(items); j++) want[items[j].id] = true;
	}
	let rows = [];
	for (let i = 0; i < length(manifest.bundles); i++) {
		let sourceValue = source(manifest, manifest.bundles[i].sourceId), items = manifest.bundles[i].assets || [];
		for (let j = 0; j < length(items); j++) {
			if (!want[items[j].id]) continue;
			let row = row_for({ ...items[j], sourceId: manifest.bundles[i].sourceId, sourceCommit: manifest.bundles[i].sourceCommit }, listed.assets);
			push(rows, row);
		}
	}
	let total = length(rows), ready = 0, baselineMatched = 0, installedCount = 0, maxRevision = 0, hasMissing = false, hasAttention = false, commit = null, provenance = null, maxLastChecked = null;
	for (let i = 0; i < length(rows); i++) {
		if (rows[i].path != null) installedCount++;
		if (rows[i].state == 'current') baselineMatched++;
		if (rows[i].state == 'missing') hasMissing = true;
		if (rows[i].state == 'attention') hasAttention = true;
		if (rows[i].path != null && rows[i].state != 'missing' && rows[i].state != 'attention') {
			if (rows[i].type == 'lua') ready++;
		} else if (rows[i].type == 'lua' && rows[i].path == null) {
			// not ready
		}
		// Prefer actual installed registry provenance over static manifest sourceCommit (fixes 54b6765 display after dynamic update)
		let reg = registry_asset(listed.assets, rows[i].id);
		let regProv = reg && reg.provenance ? reg.provenance : null;
		let regCommit = regProv && regProv.sourceCommit ? regProv.sourceCommit : null;
		if (rows[i].revision > maxRevision) maxRevision = rows[i].revision;
		if (reg && reg.revision > maxRevision) maxRevision = reg.revision;
		if (commit == null && regCommit) commit = regCommit;
		else if (commit == null && rows[i].sourceCommit) commit = rows[i].sourceCommit;
		if (provenance == null && regProv) provenance = regProv;
		else if (provenance == null && rows[i].provenance) provenance = rows[i].provenance;
		let ck = reg && reg.lastChecked ? reg.lastChecked : rows[i].lastChecked;
		if (ck != null && (maxLastChecked == null || ck > maxLastChecked)) maxLastChecked = ck;
	}
	// If any installed asset has dynamic p-* provenance (e.g., p-79.18), surface it over static 54b6765 baseline
	if (commit == "54b6765f2ab3e0f7f13030c90c809f1dcacfcce2") {
		for (let i = 0; i < length(listed.assets); i++) {
			let a = listed.assets[i];
			if (want[a.id] && a.provenance && a.provenance.sourceCommit && substr(a.provenance.sourceCommit, 0, 2) == "p-") {
				commit = a.provenance.sourceCommit; provenance = a.provenance; break;
			}
		}
		// Also check blob assets that are part of z2k plan but not in want (since want only has 7 lua)
		if (commit == "54b6765f2ab3e0f7f13030c90c809f1dcacfcce2") {
			for (let i = 0; i < length(listed.assets); i++) {
				let a = listed.assets[i];
				if (a.provenance && a.provenance.bundleId == "z2k-curated-lua" && a.provenance.sourceCommit && substr(a.provenance.sourceCommit, 0, 2) == "p-") {
					commit = a.provenance.sourceCommit; provenance = a.provenance; break;
				}
			}
		}
	}
	// Count only lua for total/ready, but integrity considers all z2k assets
	let luaTotal = 0;
	for (let i = 0; i < length(rows); i++) if (rows[i].type == 'lua') luaTotal++;
	if (commit == null) {
		for (let i = 0; i < length(manifest.bundles); i++) if (manifest.bundles[i].sourceId == 'z2k-resources') commit = manifest.bundles[i].sourceCommit;
		if (commit == null) for (let i = 0; i < length(manifest.sources); i++) if (manifest.sources[i].id == 'z2k-resources') commit = manifest.sources[i].commit;
	}
	let totalLua = luaTotal;
	// ready already counts lua only; ensure total reflects luaTotal
	let integrity = hasAttention ? 'broken' : hasMissing ? 'broken' : baselineMatched === total ? 'verified' : 'diverged';
	let integrityOk = !hasMissing && !hasAttention;
	let installed = !hasMissing && installedCount > 0 && total > 0;
	return { installed: installed, integrity: integrity, integrityOk: integrityOk, lua: { ready: ready, total: totalLua }, baselineMatched: baselineMatched, revision: maxRevision, commit: commit, provenance: provenance, checkedAt: maxLastChecked };
}
function load_check_state() {
	let raw = readfile(CHECK_STATE);
	if (raw == null || length(raw) > MAX_CHECK_STATE_BYTES) return null;
	let value = null;
	try { value = json(raw); } catch (e) { return null; }
	if (!object(value) || value.schema != 1 || type(value.checkedAt) != 'int' || !object(value.signed)) return null;
	return value;
}
function save_check_state(signed, checkedAt, signedSources) {
	let payload = { schema: 1, checkedAt: checkedAt, signed: signed, signedSources: signedSources };
	let content = sprintf('%J', payload) + '\n';
	let tmp = CHECK_STATE + '.tmp.' + time();
	try { writefile(tmp, content); } catch (e) { return; }
	if (!regular(tmp)) { try { unlink(tmp); } catch (e) {} return; }
	let moved = command('mv -f ' + shell_quote(tmp) + ' ' + shell_quote(CHECK_STATE));
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) {} }
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
	// STALE-PROJECTION REGRESSION GUARD (see tests/product/z2k-candidate-compatibility.test.mjs):
	// This returns the PERSISTED CHECK_STATE (/etc/zapret2-manager/resource-source-check.json),
	// NOT a live fetch. After a sidecar migration or manifest change, it may still show
	// the previous status (e.g., rebase-required) until an explicit resources_check
	// (z2k_upstream_check) refreshes CHECK_STATE via save_check_state(). Do not make
	// this live — that would add network I/O to every status poll.
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let answer = build_status(loaded.manifest, null);
	if (!answer.ok) return answer;
	let local = z2k_local_projection(loaded.manifest);
	let persisted = load_check_state();
	let remote = persisted ? z2k_projection(persisted.signed) : z2k_projection(null);
	remote.local = local;
	answer.z2k = remote;
	if (persisted) {
		answer.checkedAt = persisted.checkedAt;
		answer.signedSources = { z2k: persisted.signedSources };
		for (let i = 0; i < length(answer.sources); i++) if (answer.sources[i].id == 'z2k-resources') {
			answer.sources[i].checkMode = persisted.signed.trustMode == 'allow-untrusted' ? 'allow-untrusted' : 'signed-manifest';
			answer.sources[i].verification = persisted.signedSources;
			if (!persisted.signed.ok) { answer.sources[i].state = 'error'; answer.sources[i].status = state_label('error'); }
			else {
				// Canonical product state must not contradict Resources: use z2k plan status, honest unknown
				if (remote.status === 'current') { answer.sources[i].state = 'current'; answer.sources[i].status = state_label('current'); }
				else if (remote.status === 'update-available') { answer.sources[i].state = 'update'; answer.sources[i].status = state_label('update'); }
				else if (remote.status === 'rebase-required' || remote.status === 'review-required') { answer.sources[i].state = 'attention'; answer.sources[i].status = state_label('attention'); }
				else if (remote.status === 'unknown') { answer.sources[i].state = 'unknown'; answer.sources[i].status = state_label('unknown'); }
			}
		}
	} else {
		answer.signedSources = { z2k: { state: 'unknown', status: 'Проверка источника выполняется только явно', checkMode: 'allow-untrusted', trustMode: 'allow-untrusted', verified: false } };
		for (let i = 0; i < length(answer.sources); i++) if (answer.sources[i].id == 'z2k-resources') {
			answer.sources[i].state = 'unknown';
			answer.sources[i].status = state_label('unknown');
		}
	}
	return answer;
};
export const resource_center_check = function () {
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let answer = build_status(loaded.manifest, time()); if (!answer.ok) return answer;
	let signed = z2k_upstream_check();
	let local = z2k_local_projection(loaded.manifest);
	let remote = z2k_projection(signed);
	remote.local = local;
	answer.z2k = remote;
	answer.signedSources = { z2k: { state: signed.ok ? (signed.status == 'current' ? 'current' : 'attention') : 'error', status: signed.ok ? (signed.trustMode == 'allow-untrusted' ? 'Источник разрешён без проверки подписи' : signed.status) : 'Ошибка проверки источника', checkMode: signed.trustMode == 'allow-untrusted' ? 'allow-untrusted' : 'signed-manifest', trustMode: signed.trustMode || null, verified: signed.ok === true && signed.trustMode != 'allow-untrusted', evidence: signed.ok ? { repository: signed.source.repository, branch: signed.source.branch, trustMode: signed.trustMode || null, manifestSeq: signed.manifest.seq, manifestCurrent: signed.manifest.current } : { code: signed.error && signed.error.code || 'EZ2K_CHECK_FAILED', message: signed.error && signed.error.message || 'Z2K source check failed' } } };
	for (let i = 0; i < length(answer.sources); i++) if (answer.sources[i].id == 'z2k-resources') {
		answer.sources[i].checkMode = signed.trustMode == 'allow-untrusted' ? 'allow-untrusted' : 'signed-manifest';
		answer.sources[i].verification = answer.signedSources.z2k;
		if (!signed.ok) { answer.sources[i].state = 'error'; answer.sources[i].status = state_label('error'); }
		else {
			if (signed.status === 'current') { answer.sources[i].state = 'current'; answer.sources[i].status = state_label('current'); }
			else if (signed.status === 'update-available') { answer.sources[i].state = 'update'; answer.sources[i].status = state_label('update'); }
			else if (signed.status === 'rebase-required' || signed.status === 'review-required') { answer.sources[i].state = 'attention'; answer.sources[i].status = state_label('attention'); }
			else if (signed.status === 'unknown') { answer.sources[i].state = 'unknown'; answer.sources[i].status = state_label('unknown'); }
		}
	}
	save_check_state(signed, answer.checkedAt, answer.signedSources.z2k);
	return answer;
};
export const resource_center_update = function (request) {
	if (!object(request) || request.confirm !== true) return fail('EINPUT', 'explicit update confirmation is required');
	// Branch detection for diagnostics: z2k-runtime vs bundle-based
	let diagPathUsed = null;
	if (request.component == 'z2k-runtime') diagPathUsed = 'z2k-runtime:z2k_component_apply';
	else if (request.bundleId) diagPathUsed = 'bundle:' + text(request.bundleId);
	else diagPathUsed = 'unknown';
	if (request.component == 'z2k-runtime') {
		let res = z2k_component_apply(request);
		// Attach bounded diagnostics for component path
		if (object(res)) {
			res.pathUsed = diagPathUsed;
			if (res.ok && res.transaction) {
				res.diagnostics = { pathUsed: diagPathUsed, remoteRevision: null, planned: res.transaction.updated || 0, downloaded: 0, verified: 0, staged: 0, applied: res.transaction.updated || 0, postflightMatched: 0, skipped: [], targetAssets: [] };
			} else if (!res.ok) {
				res.diagnostics = { pathUsed: diagPathUsed, remoteRevision: null, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
			}
			// Invariant: planned>0 && applied==0 => FAILED
			let p = res.diagnostics ? res.diagnostics.planned : null, a = res.diagnostics ? res.diagnostics.applied : null;
			if (p != null && a != null && p > 0 && a == 0 && res.ok) {
				return { ok: false, error: { code: 'EVERIFY', message: 'Обновление не применено: ' + p + ' обновлений было запланировано, 0 установлено.', diagnostics: res.diagnostics }, diagnostics: res.diagnostics, pathUsed: diagPathUsed };
			}
		}
		return res;
	}
	let controlled = inline_bundle(request); if (controlled != null) {
		if (object(controlled)) { controlled.pathUsed = 'controlled-bundle'; controlled.diagnostics = { pathUsed: 'controlled-bundle', remoteRevision: null, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: controlled.updated || 0, postflightMatched: 0, skipped: [], targetAssets: [] }; }
		return controlled;
	}
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let selected = bundle(loaded.manifest, request.bundleId); if (selected == null) return fail('EINPUT', 'resource bundle is not configured'); let sourceValue = source(loaded.manifest, selected.sourceId); if (sourceValue == null) return fail('EINPUT', 'resource bundle source is not configured'); let listed = asset_registry_list(null); if (!listed.ok) return listed;
	// Update pathUsed now that selected is known
	if (selected.sourceId == 'z2k-resources') diagPathUsed = 'z2k-resources:bundle:' + selected.id;
	else diagPathUsed = 'bundle:' + selected.id;
	let signedForZ2k = null;
	if (selected.sourceId == 'z2k-resources') {
		signedForZ2k = z2k_upstream_check(); if (!signedForZ2k.ok) {
			let d = { pathUsed: diagPathUsed, remoteRevision: null, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
			return fail('EVERIFY', 'signed Z2K manifest verification failed; update is blocked', { cause: signedForZ2k.error, diagnostics: d });
		}
		if (signedForZ2k.status == 'rebase-required') {
			let d = { pathUsed: diagPathUsed, remoteRevision: signedForZ2k.manifest && signedForZ2k.manifest.current || null, planned: length(signedForZ2k.plan.rebases || []), downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: signedForZ2k.plan.rebases || [], targetAssets: [] };
			return fail('EZ2K_REBASE_REQUIRED', 'signed Z2K manifest requires adapted-file rebase', { rebases: signedForZ2k.plan.rebases, diagnostics: d });
		}
		if (signedForZ2k.status == 'review-required') {
			let d = { pathUsed: diagPathUsed, remoteRevision: signedForZ2k.manifest && signedForZ2k.manifest.current || null, planned: length(signedForZ2k.plan.reviews || []), downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: signedForZ2k.plan.reviews || [], targetAssets: [] };
			return fail('EZ2K_REVIEW_REQUIRED', 'signed Z2K manifest requires semantic review', { reviews: signedForZ2k.plan.reviews, diagnostics: d });
		}
		if (!signedForZ2k.plan || !signedForZ2k.manifest) {
			let d = { pathUsed: diagPathUsed, remoteRevision: null, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
			return fail('EVERIFY', 'signed Z2K manifest is incomplete', { diagnostics: d });
		}
	}
	let root = make_stage_root(); if (root == null) return fail('ETARGET', 'resource staging directory is unavailable'); let paths = [], staged = [];
	if (selected.sourceId == 'z2k-resources' && signedForZ2k) {
		// Use the fresh verified manifest as the update target, not the static packaged bundle.
		// This is snapshot-consistent: CHECK and APPLY use the same signed.manifest.
		let planUpdates = signedForZ2k.plan.updates || [];
		let remoteFiles = signedForZ2k.manifest.files_sha256 || {};
		let remoteCommit = signedForZ2k.manifest.current || selected.sourceCommit;
		let remoteVersion = signedForZ2k.manifest.current || selected.version;
		let diagnostics = { pathUsed: diagPathUsed, remoteRevision: remoteCommit, planned: length(planUpdates), downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
		// Pre-fill targetAssets with before SHAs (correct slug derivation for all types)
		for (let i = 0; i < length(planUpdates); i++) {
			let sp = planUpdates[i], tgt = remoteFiles[sp] ? lc(remoteFiles[sp]) : null;
			let assetId = null, assetTypeTmp = null;
			try {
				let map = json(readfile('/usr/share/zapret2-manager/upstreams/z2k-integration.json'));
				if (map && type(map.files) == 'array') for (let k = 0; k < length(map.files); k++) if (map.files[k].sourcePath == sp) {
					let it = map.files[k];
					let baseTmp = it.localName ? it.localName : sp;
					let slashTmp = rindex(baseTmp, '/'); let basenameTmp = slashTmp >=0 ? substr(baseTmp, slashTmp+1) : baseTmp;
					let dotTmp = rindex(basenameTmp, '.'); let slugTmp = dotTmp >=0 ? substr(basenameTmp, 0, dotTmp) : basenameTmp;
					slugTmp = lc(slugTmp);
					if (slugTmp == 'list' && index(sp, 'extra_strats') >=0) {
						let dirPartTmp = substr(sp, 0, rindex(sp, '/'));
						let afterListsTmp = substr(dirPartTmp, length('files/lists/') );
						let flatTmp = ''; for (let _ci2 = 0; _ci2 < length(afterListsTmp); _ci2++) { let ch2 = substr(afterListsTmp, _ci2, 1); flatTmp += ch2 == '/' ? '_' : lc(ch2); }
						slugTmp = flatTmp + '_list';
					}
					if (it.type == 'lua') assetTypeTmp = 'lua';
					else if (it.type == 'bin') assetTypeTmp = 'blob';
					else if (it.type == 'txt') assetTypeTmp = 'blob';
					else assetTypeTmp = null;
					if (assetTypeTmp) assetId = assetTypeTmp + ':' + slugTmp;
					break;
				}
			} catch (e) {}
			if (assetId == null) {
				let slash2 = rindex(sp, '/'); let base2 = slash2 >=0 ? substr(sp, slash2+1) : sp;
				let dot2 = rindex(base2, '.'); let slug2 = dot2 >=0 ? substr(base2, 0, dot2) : base2;
				slug2 = lc(slug2);
				if (slug2 == 'list' && index(sp, 'extra_strats') >=0) {
					let dirPart2 = substr(sp, 0, rindex(sp, '/'));
					let afterLists2 = substr(dirPart2, length('files/lists/') );
					let flat2 = ''; for (let _ci3 = 0; _ci3 < length(afterLists2); _ci3++) { let ch3 = substr(afterLists2, _ci3, 1); flat2 += ch3 == '/' ? '_' : lc(ch3); }
					slug2 = flat2 + '_list';
					assetId = 'blob:' + slug2;
				} else assetId = 'lua:' + slug2;
			}
			let beforeSha = null;
			for (let r = 0; r < length(listed.assets); r++) if (listed.assets[r].id == assetId) { beforeSha = listed.assets[r].contentSha256; break; }
			push(diagnostics.targetAssets, { sourcePath: sp, assetId: assetId, installedShaBefore: beforeSha, targetSha: tgt, result: 'pending' });
		}
		for (let i = 0; i < length(planUpdates); i++) {
			let sourcePath = planUpdates[i];
			let targetSha = remoteFiles[sourcePath];
			if (!string(targetSha) || !match(lc(targetSha), /^[a-f0-9]{64}$/)) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'invalid-target-sha'; let e = fail('EVERIFY', 'remote target SHA is invalid', { sourcePath: sourcePath, diagnostics: diagnostics }); e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e; }
			// Resolve classification for asset id/type
			let map = null; try { map = json(readfile('/usr/share/zapret2-manager/upstreams/z2k-integration.json')); } catch (e) { map = null; }
			let item = null;
			if (map && type(map.files) == 'array') for (let k = 0; k < length(map.files); k++) if (map.files[k].sourcePath == sourcePath) { item = map.files[k]; break; }
			if (item == null) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'unclassified'; let e = fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K file has no classification', { sourcePath: sourcePath, diagnostics: diagnostics }); e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e; }
			let baseAsset = item.localName ? item.localName : sourcePath;
			let slashAsset = rindex(baseAsset, '/'); let basenameAsset = slashAsset >=0 ? substr(baseAsset, slashAsset+1) : baseAsset;
			let dotAsset = rindex(basenameAsset, '.'); let slugAsset = dotAsset >=0 ? substr(basenameAsset, 0, dotAsset) : basenameAsset;
			slugAsset = lc(slugAsset);
			// Ensure unique slug for colliding basenames like List.txt in different dirs
			if (slugAsset == 'list' && index(sourcePath, 'extra_strats') >=0) {
				let dirPart = substr(sourcePath, 0, rindex(sourcePath, '/'));
				// dirPart like files/lists/extra_strats/TCP/RKN -> take after files/lists/
				let afterLists = substr(dirPart, length('files/lists/') );
				// replace / with _ and lower
				let flat = ''; for (let _ci = 0; _ci < length(afterLists); _ci++) { let ch = substr(afterLists, _ci, 1); flat += ch == '/' ? '_' : lc(ch); }
				slugAsset = flat + '_list';
			}
			let assetType;
			if (item.type == 'lua') assetType = 'lua';
			else if (item.type == 'bin') assetType = 'blob';
			else if (item.type == 'txt') {
				// Use blob for txt to avoid hostlist/ipset canonical normalization mismatch; store as raw
				assetType = 'blob';
			} else assetType = null;
			let assetId = assetType ? (assetType + ':' + slugAsset) : null;
			if (assetId == null) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'unsupported-type'; let e = fail('EINPUT', 'unsupported Z2K asset type', { sourcePath: sourcePath, type: item.type, diagnostics: diagnostics }); e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e; }
			let registered = null;
			for (let r = 0; r < length(listed.assets); r++) if (listed.assets[r].id == assetId) { registered = listed.assets[r]; break; }
			if (registered != null) {
				let isPromotion = registered.ownership == 'package' && registered.provenance && registered.provenance.kind == 'builtin/package';
				if (!isPromotion && (registered.ownership == 'package' || !registered.provenance || registered.provenance.kind != 'catalog/upstream')) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'protected'; let e = fail('EPOLICY', 'user or package resource is protected', { id: assetId, diagnostics: diagnostics }); e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e; }
			}
			// Snapshot-consistent URL: use the same branch that UPDATES.json was fetched from (z2k-enhanced) with the verified manifest's files
			// The remote manifest is from z2k-enhanced branch head, so fetch via branch, not static commit, but verify SHA afterwards.
			let contentUrl = 'https://raw.githubusercontent.com/necronicle/z2k/z2k-enhanced/' + sourcePath;
			let path = root + '/' + i + '.asset', fetched = command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(contentUrl));
			if (fetched.rc != 0 || !regular(path)) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'fetch-failed'; let e = fail('EUNAVAILABLE', 'resource source is unavailable', { id: assetId, source: sourceValue.repository, diagnostics: diagnostics }); e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e; }
			diagnostics.downloaded++;
			let actualSha = sha256(path);
			if (actualSha != lc(targetSha)) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'sha-mismatch'; let e = fail('EVERIFY', 'fetched bytes SHA does not match remote target', { sourcePath: sourcePath, expected: lc(targetSha), actual: actualSha, diagnostics: diagnostics }); e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e; }
			diagnostics.verified++;
			let byteSize = 0; try { byteSize = stat(path).size; } catch (e) { byteSize = 0; }
			push(paths, path);
			push(staged, { type: assetType, id: assetId, name: item.localName || assetId, stagedPath: path, sha256: lc(targetSha), byteSize: byteSize, expectedRevision: registered && registered.revision || null, dependencies: [], provenance: { kind: 'catalog/upstream', source: sourceValue.repository, sourceCommit: remoteCommit, sourcePath: sourcePath, bundleId: selected.id, version: remoteVersion } });
			diagnostics.targetAssets[i].result = 'staged';
		}
		diagnostics.staged = length(staged);
		if (!length(staged)) {
			cleanup(root, paths);
			let ans = { ok: true, bundleId: selected.id, version: remoteVersion, updated: 0, state: 'current', status: state_label('current'), diagnostics: diagnostics, pathUsed: diagPathUsed, planned: diagnostics.planned, downloaded: diagnostics.downloaded, verified: diagnostics.verified, staged: diagnostics.staged, applied: 0, postflightMatched: 0, skipped: [], targetAssets: diagnostics.targetAssets, remoteRevision: remoteCommit };
			// Invariant: planned>0 && applied==0 => FAILED
			if (diagnostics.planned > 0 && ans.updated == 0) {
				ans.ok = false;
				ans.error = { code: 'EVERIFY', message: 'Обновление не применено: ' + diagnostics.planned + ' обновлений было запланировано, 0 установлено.', diagnostics: diagnostics };
				ans.pathUsed = diagPathUsed;
			}
			return ans;
		}
		let answer = asset_registry_apply_bundle({ bundleId: selected.id, version: remoteVersion, source: sourceValue.repository, sourceCommit: remoteCommit, assets: staged });
		diagnostics.applied = answer.ok ? (answer.updated || length(staged)) : 0;
		// Postflight: verify that each planned update now has installed SHA == remote target and provenance
		if (answer.ok) {
			let listedAfter = asset_registry_list(null);
			let postflightMatched = 0;
			if (listedAfter.ok) {
				for (let i = 0; i < length(planUpdates); i++) {
					let sp = planUpdates[i], expSha = lc(remoteFiles[sp]);
					let found = null;
					for (let a = 0; a < length(listedAfter.assets); a++) {
						let prov = listedAfter.assets[a].provenance;
						if (prov && prov.sourcePath == sp) { found = listedAfter.assets[a]; break; }
						let idFromPath = 'lua:' + substr(sp, length('files/lua/'), length(sp) - length('files/lua/') - 4);
						if (listedAfter.assets[a].id == idFromPath) { found = listedAfter.assets[a]; break; }
					}
					if (found != null && found.contentSha256 == expSha) {
						postflightMatched++;
						diagnostics.targetAssets[i].result = 'applied';
					} else {
						diagnostics.targetAssets[i].result = 'postflight-mismatch';
						cleanup(root, paths);
						let e = fail('EVERIFY', 'postflight verification failed: installed SHA does not match remote target', { sourcePath: sp, expected: expSha, actual: found && found.contentSha256, diagnostics: diagnostics });
						e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e;
					}
				}
				diagnostics.postflightMatched = postflightMatched;
				// Re-check canonical plan to ensure no remaining updates (unless new upstream or rebase/review)
				let rechecked = null; try { rechecked = z2k_upstream_check(); } catch (e) { rechecked = null; }
				if (rechecked && rechecked.ok && rechecked.status != 'current' && rechecked.plan) {
					// If the recheck still reports the same updates, it's a postflight failure, not success
					let stillUpdates = rechecked.plan.updates || [];
					let overlap = false;
					for (let u = 0; u < length(stillUpdates); u++) for (let p = 0; p < length(planUpdates); p++) if (stillUpdates[u] == planUpdates[p]) overlap = true;
					if (overlap && length(stillUpdates) >= length(planUpdates)) {
						cleanup(root, paths);
						let e = fail('EVERIFY', 'postflight recheck still reports the same updates; update not fully applied', { stillUpdates: stillUpdates, diagnostics: diagnostics });
						e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e;
					}
				}
			}
		} else {
			// Mark all as failed
			for (let i = 0; i < length(diagnostics.targetAssets); i++) diagnostics.targetAssets[i].result = 'apply-failed';
		}
		// Invariant: planned>0 && applied==0 => FAILED
		if (diagnostics.planned > 0 && diagnostics.applied == 0 && answer.ok) {
			cleanup(root, paths);
			let e = fail('EVERIFY', 'Обновление не применено: ' + diagnostics.planned + ' обновлений было запланировано, 0 установлено.', { diagnostics: diagnostics });
			e.diagnostics = diagnostics; e.pathUsed = diagPathUsed; return e;
		}
		cleanup(root, paths);
		if (answer.ok) {
			answer.diagnostics = diagnostics;
			answer.pathUsed = diagPathUsed;
			answer.planned = diagnostics.planned;
			answer.downloaded = diagnostics.downloaded;
			answer.verified = diagnostics.verified;
			answer.staged = diagnostics.staged;
			answer.applied = diagnostics.applied;
			answer.postflightMatched = diagnostics.postflightMatched;
			answer.skipped = diagnostics.skipped;
			answer.targetAssets = diagnostics.targetAssets;
			answer.remoteRevision = remoteCommit;
		} else {
			answer.diagnostics = diagnostics;
			answer.pathUsed = diagPathUsed;
		}
		return answer;
	}
	for (let i = 0; i < length(selected.assets || []); i++) { let item = selected.assets[i], row = row_for({ ...item, sourceId: selected.sourceId, sourceCommit: selected.sourceCommit }, listed.assets); if (row.state == 'current') continue; let registered = registry_asset(listed.assets, item.id); if (registered != null) {
		let isPromotion = registered.ownership == 'package' && registered.provenance && registered.provenance.kind == 'builtin/package';
		if (!isPromotion && (registered.ownership == 'package' || !registered.provenance || registered.provenance.kind != 'catalog/upstream')) { cleanup(root, paths); return fail('EPOLICY', 'user or package resource is protected', { id: item.id }); }
	} let path = root + '/' + i + '.asset', fetched = command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(item.contentUrl)); if (fetched.rc != 0 || !regular(path)) { cleanup(root, paths); return fail('EUNAVAILABLE', 'resource source is unavailable', { id: item.id, source: sourceValue.repository }); } push(paths, path); push(staged, { type: item.type, id: item.id, name: item.name, stagedPath: path, sha256: item.sha256, byteSize: item.byteSize, expectedRevision: registered && registered.revision || null, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: sourceValue.repository, sourceCommit: selected.sourceCommit, sourcePath: item.sourcePath, bundleId: selected.id, version: selected.version } }); }
	if (!length(staged)) { cleanup(root, paths); let ans = { ok: true, bundleId: selected.id, version: selected.version, updated: 0, state: 'current', status: state_label('current'), pathUsed: diagPathUsed, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: [], targetAssets: [], remoteRevision: selected.sourceCommit, diagnostics: { pathUsed: diagPathUsed, remoteRevision: selected.sourceCommit, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: 0, postflightMatched: 0, skipped: [], targetAssets: [] } }; return ans; }
	let answer = asset_registry_apply_bundle({ bundleId: selected.id, version: selected.version, source: sourceValue.repository, sourceCommit: selected.sourceCommit, assets: staged }); cleanup(root, paths);
	if (object(answer)) { answer.pathUsed = diagPathUsed; answer.diagnostics = { pathUsed: diagPathUsed, remoteRevision: selected.sourceCommit, planned: length(staged), downloaded: length(staged), verified: length(staged), staged: length(staged), applied: answer.updated || 0, postflightMatched: 0, skipped: [], targetAssets: [] }; answer.planned = answer.diagnostics.planned; answer.downloaded = answer.diagnostics.downloaded; answer.verified = answer.diagnostics.verified; answer.staged = answer.diagnostics.staged; answer.applied = answer.diagnostics.applied; answer.postflightMatched = 0; answer.skipped = []; answer.targetAssets = []; answer.remoteRevision = selected.sourceCommit;
		if (answer.diagnostics.planned > 0 && answer.diagnostics.applied == 0 && answer.ok) { return { ok: false, error: { code: 'EVERIFY', message: 'Обновление не применено: ' + answer.diagnostics.planned + ' обновлений было запланировано, 0 установлено.', diagnostics: answer.diagnostics }, diagnostics: answer.diagnostics, pathUsed: diagPathUsed }; }
	}
	return answer;
};
