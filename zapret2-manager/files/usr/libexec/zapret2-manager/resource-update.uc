'use strict';

// Resource Center coordinator. It owns source/bundle policy and staging, while
// Asset Registry remains the only writer of managed asset metadata and bytes.
import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';
import { asset_registry_list, asset_registry_apply_bundle, asset_registry_rollback_bundle } from './asset-registry.uc';
import { z2k_upstream_check, z2k_upstream_plan } from './z2k-upstream.uc';
import { z2k_candidate_gate } from './z2k-compat.uc';
import { z2k_resolve_version, z2k_compare_versions } from './z2k-versions.uc';
import { z2k_registry_installed_release } from './z2k-installed-release.uc';

const MANIFEST = '/usr/share/zapret2-manager/resources/manifest.json';
const STAGE_PARENT = '/tmp/z2m-resource-update';
const RUNTIME_SYNC = '/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh';
const RUNTIME_BASE = '/opt/zapret2';
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
function known_release(value) {
	if (!string(value) || !length(value) || substr(value, 0, 2) == 'p-' || match(value, /^[a-f0-9]{7,40}$/i)) return null;
	return value;
}
function z2k_manifest_installed_release(manifest, listed, want, installedCount, hasMissing, hasAttention) {
	let authority = z2k_registry_installed_release(listed);
	if (authority && authority.value != null) return authority;
	if (authority && authority.confidence == 'unknown' && authority.authority == null && !hasAttention && !(installedCount > 0 && hasMissing)) return authority;
	if (hasAttention || (installedCount > 0 && hasMissing)) return { value: null, confidence: 'inconsistent', authority: 'known-manifest' };
	return { value: null, confidence: 'unknown', authority: null };
}
function z2k_target_gate(manifest) {
	let plan = z2k_upstream_plan(manifest);
	if (!plan.ok) return plan;
	if (length(plan.rebases || []) || length(plan.blockingReviews || [])) return fail('EZ2K_REVIEW_REQUIRED', 'Выбранный release требует проверки перед установкой.', { attentionState: plan.attentionState || 'review-required', blockingReasons: plan.blockingReasons || [], reviewDetails: plan.reviewDetails || [] });
	return { ok: true, canApply: true, attentionState: plan.attentionState || 'none', blockingReasons: plan.blockingReasons || [], reviewDetails: plan.reviewDetails || [] };
}
function state_label(state) { return ({ current: 'Актуально', update: 'Доступно обновление', missing: 'Не установлено', checking: 'Проверяем', unavailable: 'Источник недоступен', stale: 'Проверка устарела', error: 'Ошибка проверки', attention: 'Требуется внимание', unknown: 'Не проверено' })[state] || 'Требуется внимание'; }
function plan_token(checkedAt, manifest) {
	if (type(checkedAt) != 'int' || !object(manifest) || type(manifest.seq) != 'int' || !string(manifest.current)) return null;
	let token = 'z2k-plan-v1:' + checkedAt + ':' + manifest.seq + ':' + manifest.current;
	return length(token) <= 256 ? token : null;
}
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
	if (!object(signed) || signed.ok !== true) return { status: 'unknown', updateState: 'unknown', attentionState: 'none', canApply: false, updates: [], rebases: [], reviews: [], advisoryReviews: [], blockingReviews: [], blockingReasons: [], reviewDetails: [], planToken: null, trustMode: 'allow-untrusted', verified: false, source: null, manifest: null, availableRelease: null };
	let plan = object(signed.plan) ? signed.plan : {}, manifest = object(signed.manifest) ? signed.manifest : {};
	let status = signed.status || 'unknown';
	let updateState = signed.updateState || plan.updateState || (length(plan.updates || []) ? 'update-available' : status == 'unknown' ? 'unknown' : 'current');
	let attentionState = signed.attentionState || plan.attentionState || (status == 'rebase-required' ? 'rebase-required' : status == 'review-required' ? 'review-required' : 'none');
	return {
		status: status,
		updateState: updateState,
		attentionState: attentionState,
		canApply: signed.canApply === true || plan.canApply === true,
		updates: plan.updates || [],
		rebases: plan.rebases || [],
		reviews: plan.reviews || [],
		advisoryReviews: plan.advisoryReviews || [],
		blockingReviews: plan.blockingReviews || [],
		blockingReasons: plan.blockingReasons || [],
		reviewDetails: plan.reviewDetails || [],
		planToken: signed.planToken || null,
		trustMode: signed.trustMode || null,
		verified: signed.ok === true && signed.trustMode != 'allow-untrusted',
		source: signed.source || null,
		manifest: { seq: manifest.seq, current: manifest.current },
		availableRelease: known_release(manifest.current)
	};
}
function z2k_local_projection(manifest) {
	let listed = asset_registry_list(null);
	if (!listed.ok) return { installed: false, integrity: 'broken', integrityOk: false, lua: { ready: 0, total: 0 }, baselineMatched: 0, revision: 0, commit: null, provenance: null, checkedAt: null, installedRelease: { value: null, confidence: 'unknown', authority: null } };
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
	let installedRelease = z2k_manifest_installed_release(manifest, listed, want, installedCount, hasMissing, hasAttention);
	return { installed: installed, integrity: integrity, integrityOk: integrityOk, lua: { ready: ready, total: totalLua }, baselineMatched: baselineMatched, revision: maxRevision, commit: commit, provenance: provenance, checkedAt: maxLastChecked, installedRelease: installedRelease };
}
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function z2k_target_asset_valid(item) {
	return object(item) && string(item.sourcePath) && match(item.sourcePath, /^files\/(lua|fake|lists)\/[A-Za-z0-9._\/-]+$/)
		&& string(item.id) && (substr(item.id, 0, 4) == 'lua:' || substr(item.id, 0, 5) == 'blob:')
		&& (item.type == 'lua' || item.type == 'blob') && valid_digest(item.sha256) && runtime_target_path(item.runtimeTarget) != null;
}
function valid_target_operation(value) { return value == 'install' || value == 'upgrade' || value == 'reinstall' || value == 'downgrade'; }
function valid_latest_check(value) { return object(value) && type(value.checkedAt) == 'int' && value.checkedAt >= 0 && object(value.signed); }
function valid_prepared_target(value) {
	if (!object(value) || value.schema != 2 || !string(value.targetVersion) || z2k_compare_versions(value.targetVersion, value.targetVersion) == null
		|| !string(value.targetCommitSha) || !match(lc(value.targetCommitSha), /^[a-f0-9]{40}$/)
		|| !valid_digest(value.manifestSha256) || !valid_digest(value.localFingerprint)
		|| !valid_target_operation(value.operation) || type(value.preparedAt) != 'int' || value.preparedAt < 0
		|| !string(value.planToken) || substr(value.planToken, 0, length('z2k-target-v2:')) != 'z2k-target-v2:'
		|| value.targetCanApply !== true || !string(value.targetAttentionState) || type(value.targetBlockingReasons) != 'array' || type(value.targetReviewDetails) != 'array'
		|| type(value.assets) != 'array' || length(value.assets) == 0 || length(value.assets) > 64
		|| type(value.removeIds) != 'array' || length(value.removeIds) > 64
		|| type(value.removeTargets) != 'array' || length(value.removeTargets) != length(value.removeIds)) return false;
	for (let i = 0; i < length(value.assets); i++) if (!z2k_target_asset_valid(value.assets[i])) return false;
	let seen = {};
	for (let i = 0; i < length(value.assets); i++) seen[value.assets[i].id] = true;
	for (let i = 0; i < length(value.removeIds); i++) {
		let id = value.removeIds[i];
		if (!string(id) || !match(id, /^(lua|blob):[a-z0-9][a-z0-9._-]*$/) || seen[id]) return false;
		seen[id] = true;
		if (!object(value.removeTargets[i]) || value.removeTargets[i].id != id || runtime_target_path(value.removeTargets[i].runtimeTarget) == null) return false;
	}
	return true;
}
function normalize_check_state(value) {
	if (!object(value)) return null;
	if (value.schema == 2) {
		if ((value.latestCheck != null && !valid_latest_check(value.latestCheck)) || (value.preparedTarget != null && !valid_prepared_target(value.preparedTarget))) return null;
		return { schema: 2, latestCheck: value.latestCheck || null, preparedTarget: value.preparedTarget || null };
	}
	// Migrate the old single-snapshot shape in memory. The first subsequent
	// check/prepare write persists schema 2; a corrupt old snapshot fails closed.
	if (value.schema == 1 && type(value.checkedAt) == 'int' && object(value.signed))
		return { schema: 2, latestCheck: { checkedAt: value.checkedAt, planToken: value.planToken || null, signed: value.signed, signedSources: value.signedSources || null }, preparedTarget: null };
	return null;
}
function load_check_state() {
	let raw = readfile(CHECK_STATE);
	if (raw == null || length(raw) > MAX_CHECK_STATE_BYTES) return null;
	let value = null;
	try { value = json(raw); } catch (e) { return null; }
	return normalize_check_state(value);
}
function persist_check_state(payload) {
	let content = sprintf('%J', payload) + '\n', tmp = CHECK_STATE + '.tmp.' + time();
	try { writefile(tmp, content); } catch (e) { return false; }
	if (!regular(tmp)) { try { unlink(tmp); } catch (e) {} return false; }
	let moved = command('mv -f ' + shell_quote(tmp) + ' ' + shell_quote(CHECK_STATE));
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) {} return false; }
	return regular(CHECK_STATE);
}
function save_check_state(signed, checkedAt, signedSources, token) {
	let planToken = token || (signed && signed.ok === true ? plan_token(checkedAt, signed.manifest) : null);
	if (signed && signed.ok === true && planToken != null) signed.planToken = planToken;
	let old = load_check_state(), payload = { schema: 2, latestCheck: { checkedAt: checkedAt, planToken: planToken, signed: signed, signedSources: signedSources }, preparedTarget: old && old.preparedTarget || null };
	persist_check_state(payload);
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
function digest_text(value, prefix) {
	let made = command('umask 077; mktemp /tmp/' + (prefix || 'z2m-digest') + '.XXXXXX'), path = trim(made.out);
	if (made.rc != 0 || !match(path, /^\/tmp\/[A-Za-z0-9._-]+$/)) return null;
	try { writefile(path, value == null ? '' : value); } catch (e) { cleanup(null, [path]); return null; }
	let digest = sha256(path); cleanup(null, [path]); return digest;
}
function z2k_local_fingerprint(targetAssets, listed, removeIds) {
	let rows = [];
	for (let i = 0; i < length(targetAssets || []); i++) {
		let item = targetAssets[i], current = registry_asset(listed.assets, item.id), path = current && current.path || item.packagePath || '', regularPath = path && regular(path), actual = regularPath ? sha256(path) : 'missing', size = regularPath ? stat(path).size : 0, provenance = current && current.provenance || {};
		push(rows, item.id + '|' + actual + '|' + size + '|' + (current && current.revision || 0) + '|' + (current && current.ownership || 'none') + '|' + (provenance.bundleId || '') + '|' + (provenance.version || '') + '|' + (provenance.sourceCommit || '') + '|' + (provenance.sourcePath || ''));
	}
	for (let i = 0; i < length(removeIds || []); i++) {
		let current = registry_asset(listed.assets, removeIds[i]), path = current && current.path || '', regularPath = path && regular(path), actual = regularPath ? sha256(path) : 'missing', size = regularPath ? stat(path).size : 0, provenance = current && current.provenance || {};
		push(rows, 'remove|' + removeIds[i] + '|' + actual + '|' + size + '|' + (current && current.revision || 0) + '|' + (provenance.bundleId || '') + '|' + (provenance.version || '') + '|' + (provenance.sourceCommit || '') + '|' + (provenance.sourcePath || ''));
	}
	sort(rows); return digest_text(join(rows, '\n'), 'z2m-z2k-fingerprint');
}
function z2k_target_operation(targetVersion, installedVersion) {
	if (!installedVersion) return 'install';
	let comparison = z2k_compare_versions(targetVersion, installedVersion); if (comparison == null) return null;
	return comparison > 0 ? 'upgrade' : (comparison < 0 ? 'downgrade' : 'reinstall');
}
function z2k_classification_for(map, path) {
	for (let i = 0; map && type(map.files) == 'array' && i < length(map.files); i++) if (map.files[i] && map.files[i].sourcePath == path) return map.files[i];
	return null;
}
function z2k_read_classification() {
	try {
		let raw = readfile('/usr/share/zapret2-manager/upstreams/z2k-integration.json'), value = raw == null ? null : json(raw);
		if (!object(value) || type(value.files) != 'array') return null;
		for (let i = 0; type(value.historicalFiles) == 'array' && i < length(value.historicalFiles); i++) push(value.files, value.historicalFiles[i]);
		return value;
	} catch (e) { return null; }
}
function z2k_target_membership_compatible(listed, targetAssets, classification) {
	let targetById = {};
	for (let i = 0; i < length(targetAssets || []); i++) targetById[targetAssets[i].id] = targetAssets[i].sourcePath;
	for (let j = 0; j < length(listed && listed.assets || []); j++) {
		let current = listed.assets[j], provenance = current && current.provenance;
		if (provenance && provenance.kind == 'catalog/upstream' && provenance.bundleId == 'z2k-curated-lua' && provenance.sourcePath && targetById[current.id] != provenance.sourcePath) {
			let historical = z2k_classification_for(classification, provenance.sourcePath);
			if (historical == null || historical.class != 'exact-managed') return fail('EZ2K_INCOMPATIBLE', 'Z2K target membership would leave an unmanaged hybrid asset set.', { id: current.id, sourcePath: provenance.sourcePath });
		}
	}
	return { ok: true };
}
function z2k_target_removals(listed, targetAssets, classification) {
	let targetById = {}, removeIds = [], targets = [];
	for (let i = 0; i < length(targetAssets || []); i++) targetById[targetAssets[i].id] = true;
	for (let j = 0; j < length(listed && listed.assets || []); j++) {
		let current = listed.assets[j], provenance = current && current.provenance;
		if (!provenance || provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua' || targetById[current.id]) continue;
		let historical = provenance.sourcePath && z2k_classification_for(classification, provenance.sourcePath);
		if (historical == null || historical.class != 'exact-managed') return fail('EZ2K_INCOMPATIBLE', 'Z2K target removal is not classified as exact-managed.', { id: current.id, sourcePath: provenance.sourcePath });
		push(removeIds, current.id);
		push(targets, { id: current.id, runtimeTarget: historical.runtimeTarget || null });
	}
	sort(removeIds);
	sort(targets, function(a, b) { return a.id == b.id ? 0 : (a.id < b.id ? -1 : 1); });
	return { ok: true, ids: removeIds, targets: targets };
}
function same_id_set(left, right) {
	if (length(left || []) != length(right || [])) return false;
	let seen = {};
	for (let i = 0; i < length(left || []); i++) seen[left[i]] = true;
	for (let i = 0; i < length(right || []); i++) if (!seen[right[i]]) return false;
	return true;
}
function runtime_target_path(runtimeTarget) {
	if (!string(runtimeTarget)) return null;
	let prefix = '/runtime-assets/', relative = substr(runtimeTarget, length(prefix));
	if (substr(runtimeTarget, 0, length(prefix)) != prefix || !length(relative) || index(relative, '..') >= 0 || index(relative, '\\') >= 0 || !match(relative, /^[A-Za-z0-9._\/-]+$/)) return null;
	if (substr(runtimeTarget, 0, length('/runtime-assets/bin/')) == '/runtime-assets/bin/') return RUNTIME_BASE + '/files/fake/' + substr(runtimeTarget, length('/runtime-assets/bin/'));
	if (substr(runtimeTarget, 0, length('/runtime-assets/lua/')) == '/runtime-assets/lua/') return RUNTIME_BASE + '/lua/' + substr(runtimeTarget, length('/runtime-assets/lua/'));
	if (substr(runtimeTarget, 0, length('/runtime-assets/lists/')) == '/runtime-assets/lists/') return RUNTIME_BASE + '/lists/' + substr(runtimeTarget, length('/runtime-assets/lists/'));
	if (substr(runtimeTarget, 0, length('/runtime-assets/ipset/')) == '/runtime-assets/ipset/') return RUNTIME_BASE + '/ipset/' + substr(runtimeTarget, length('/runtime-assets/ipset/'));
	return null;
}
function runtime_source_safe(path) { return string(path) && substr(path, 0, length('/etc/zapret2-manager/assets/')) == '/etc/zapret2-manager/assets/' && index(path, '..') < 0 && index(path, '\\') < 0; }
function z2k_runtime_spec(target, listed, classification, root) {
	let lines = [], targetById = {};
	for (let i = 0; i < length(target.assets || []); i++) {
		let item = target.assets[i], found = registry_asset(listed.assets, item.id), runtimePath = runtime_target_path(item.runtimeTarget);
		if (found == null || !runtime_source_safe(found.path) || runtimePath == null || found.contentSha256 != item.sha256 || found.byteSize < 1) return fail('EVERIFY', 'Registry target cannot be materialized into the runtime.', { id: item.id, runtimeTarget: item.runtimeTarget || null });
		targetById[item.id] = true;
		push(lines, 'ASSET|' + item.id + '|' + item.type + '|' + found.path + '|' + item.runtimeTarget + '|' + item.sha256 + '|' + found.byteSize);
	}
	for (let i = 0; i < length(target.removeTargets || []); i++) {
		let removal = target.removeTargets[i], id = removal.id, found = registry_asset(listed.assets, id), runtimeTarget = removal.runtimeTarget;
		if (found == null || runtime_target_path(runtimeTarget) == null) return fail('EVERIFY', 'Registry removal target has no safe runtime mapping.', { id: id });
		push(lines, 'REMOVE|' + id + '|' + found.type + '||' + runtimeTarget + '||');
	}
	if (!length(lines)) return fail('EINPUT', 'Z2K target has no runtime assets to activate.');
	let spec = root + '/runtime-activation.tsv';
	try { writefile(spec, join(lines, '\n') + '\n'); } catch (e) { return fail('EWRITE', 'Runtime activation spec could not be written.'); }
	return { ok: true, path: spec, assets: length(target.assets || []), removed: length(target.removeIds || []) };
}
function z2k_runtime_restart() {
	let restarted = command('/etc/init.d/zapret2 restart');
	if (restarted.rc != 0) return fail('ERUNTIME', 'Zapret2 service restart failed.', { output: restarted.out });
	let pid = command('pidof nfqws2'), queue = command("nft list table inet zapret2 | grep queue");
	if (pid.rc != 0 || !match(trim(pid.out), /^[0-9]+([ \t]+[0-9]+)*$/)) return fail('ERUNTIME', 'nfqws2 is not running after Z2K activation.', { pid: trim(pid.out), output: pid.out });
	if (queue.rc != 0 || index(queue.out, '300') < 0) return fail('ERUNTIME', 'Zapret2 NFQUEUE postflight is missing queue 300.', { pid: trim(pid.out), output: queue.out });
	return { ok: true, pid: trim(pid.out), queue: trim(queue.out) };
}
function z2k_runtime_postflight(target, diagnostics) {
	let matched = 0;
	for (let i = 0; i < length(target.assets || []); i++) {
		let item = target.assets[i], path = runtime_target_path(item.runtimeTarget), value = path && regular(path) ? sha256(path) : null, size = path && regular(path) ? stat(path).size : 0;
		if (path == null || value != item.sha256 || size != item.byteSize) return fail('EVERIFY', 'Runtime bytes do not match the selected Z2K target.', { id: item.id, runtimeTarget: item.runtimeTarget || null, expectedSha256: item.sha256, actualSha256: value, expectedSize: item.byteSize, actualSize: size });
		matched++;
	}
	for (let i = 0; i < length(target.removeTargets || []); i++) {
		let removal = target.removeTargets[i], path = runtime_target_path(removal.runtimeTarget);
		if (path == null) return fail('EVERIFY', 'Removed runtime asset has no safe runtime mapping.', { id: removal.id });
		if (regular(path)) return fail('EVERIFY', 'Removed runtime asset is still present.', { id: removal.id, runtimeTarget: removal.runtimeTarget });
	}
	diagnostics.runtimePostflightMatched = matched;
	return { ok: true, verified: true, matched: matched, removed: length(target.removeTargets || []) };
}
function z2k_runtime_activate(target, listed, classification, root, diagnostics) {
	let spec = z2k_runtime_spec(target, listed, classification, root);
	if (!spec.ok) return spec;
	let activated = command('sh ' + shell_quote(RUNTIME_SYNC) + ' --activate-registry ' + shell_quote(spec.path));
	if (activated.rc != 0) return fail('ERUNTIME', 'Registry target could not be materialized into the active runtime.', { output: activated.out, spec: spec.path, activated: false });
	let restarted = z2k_runtime_restart();
	if (!restarted.ok) return { ok: false, error: restarted.error, activated: true, restart: restarted, postflight: { verified: false, reason: 'restart-failed' } };
	let postflight = z2k_runtime_postflight(target, diagnostics);
	if (!postflight.ok) return { ok: false, error: postflight.error, activated: true, restart: restarted, postflight: postflight };
	return { ok: true, activated: true, restart: restarted, postflight: postflight, spec: spec };
}
function z2k_runtime_rollback() {
	let restored = command('sh ' + shell_quote(RUNTIME_SYNC) + ' --rollback-registry');
	if (restored.rc != 0) return fail('EROLLBACK', 'Active runtime rollback failed.', { output: restored.out });
	let restarted = z2k_runtime_restart();
	if (!restarted.ok) return restarted;
	return { ok: true, restored: true, restart: restarted };
}
function z2k_rollback_after_runtime_failure(selected, applied, diagnostics, runtimeActivated) {
	let runtimeRollback = runtimeActivated ? z2k_runtime_rollback() : { ok: true, skipped: true };
	let registryRollback = asset_registry_rollback_bundle({ bundleId: selected.id, expectedRevision: applied.revision });
	return { ok: runtimeRollback.ok && registryRollback.ok, runtime: runtimeRollback, registry: registryRollback };
}
function z2k_target_token(target, preparedAt) {
	let removeIds = [], canonical;
	for (let i = 0; i < length(target.removeIds || []); i++) push(removeIds, target.removeIds[i]);
	sort(removeIds);
	canonical = target.targetVersion + '|' + target.targetCommitSha + '|' + target.manifestSha256 + '|' + target.localFingerprint + '|' + target.operation + '|' + join(removeIds, ',') + '|' + preparedAt;
	let digest = digest_text(canonical, 'z2m-z2k-token');
	return digest == null ? null : 'z2k-target-v2:' + digest;
}
function z2k_target_summary(target) {
	return target == null ? null : { targetVersion: target.targetVersion, operation: target.operation, installedVersion: target.previousVersion || null, targetCanApply: target.targetCanApply === true, targetAttentionState: target.targetAttentionState || 'unknown', targetBlockingReasons: target.targetBlockingReasons || [], targetReviewDetails: target.targetReviewDetails || [], assetCount: length(target.assets || []), removedCount: length(target.removeIds || []), preparedAt: target.preparedAt };
}
function save_prepared_target(target) {
	let state = load_check_state() || { schema: 2, latestCheck: null, preparedTarget: null };
	state.schema = 2; state.preparedTarget = target; return persist_check_state(state);
}
function z2k_target_from_state(state) { return state && state.preparedTarget && valid_prepared_target(state.preparedTarget) ? state.preparedTarget : null; }
function base64_decode(value) { if (!string(value) || length(value) > MAX_REQUEST_BYTES || !match(value, /^[A-Za-z0-9+\/=%]*$/)) return null; let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', buffer = 0, bits = 0; for (let i = 0; i < length(value); i++) { let c = substr(value, i, 1); if (c == '=') break; let n = index(alphabet, c); if (n < 0) return null; buffer = buffer * 64 + n; bits += 6; if (bits >= 8) { bits -= 8; out += chr((buffer >> bits) & 255); buffer = buffer & ((1 << bits) - 1); } } return out; }
function inline_bundle(request) {
	let bundle = request.controlledBundle; if (!request.controlledTest || !object(bundle) || !string(bundle.bundleId) || substr(bundle.bundleId, 0, 11) != 'controlled-' || type(bundle.assets) != 'array' || !length(bundle.assets)) return null;
	let root = make_stage_root(); if (root == null) return fail('ETARGET', 'resource staging directory is unavailable'); let paths = [], staged = [];
	for (let i = 0; i < length(bundle.assets); i++) { let item = bundle.assets[i], content = base64_decode(item.contentBase64); if (!object(item) || content == null || !string(item.id) || !string(item.type)) { cleanup(root, paths); return fail('EINPUT', 'controlled bundle asset is invalid'); } let path = root + '/' + i + '.asset'; try { writefile(path, content); } catch (e) { cleanup(root, paths); return fail('EWRITE', 'controlled bundle staging failed'); } push(paths, path); push(staged, { type: item.type, id: item.id, name: item.name, stagedPath: path, sha256: item.sha256, byteSize: item.byteSize, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: 'controlled-test', sourceCommit: bundle.sourceCommit || '0000000000000000000000000000000000000000', sourcePath: item.sourcePath || item.id, bundleId: bundle.bundleId, version: bundle.version || 'test' } }); }
	let answer = asset_registry_apply_bundle({ bundleId: bundle.bundleId, version: bundle.version || 'test', source: 'controlled-test', sourceCommit: bundle.sourceCommit || '0000000000000000000000000000000000000000', assets: staged }); cleanup(root, paths); return answer;
}
export const resource_center_prepare_version = function(request) {
	let version = object(request) ? request.version : request;
	if (!string(version) || z2k_compare_versions(version, version) == null) return fail('EINPUT', 'Версия Z2K имеет недопустимый формат.');
	let resolved = z2k_resolve_version(version); if (!resolved.ok) return resolved;
	if (type(resolved.assets) != 'array' || !length(resolved.assets) || length(resolved.assets) > 64) return fail('EZ2K_INCOMPATIBLE', 'Выбранный release не содержит полного exact-managed набора.');
	for (let i = 0; i < length(resolved.assets); i++) if (!z2k_target_asset_valid(resolved.assets[i])) return fail('EZ2K_INCOMPATIBLE', 'Выбранный release содержит неподдерживаемый managed asset.', { sourcePath: resolved.assets[i] && resolved.assets[i].sourcePath });
	let listed = asset_registry_list(null); if (!listed.ok) return listed;
	let classification = z2k_read_classification();
	let membership = z2k_target_membership_compatible(listed, resolved.assets, classification); if (!membership.ok) return membership;
	let targetGate = z2k_target_gate(resolved.manifest); if (!targetGate.ok) return targetGate;
	let removals = z2k_target_removals(listed, resolved.assets, classification); if (!removals.ok) return removals;
	let authority = z2k_registry_installed_release(listed), installed = authority && authority.value || null, operation = z2k_target_operation(version, installed), localFingerprint = z2k_local_fingerprint(resolved.assets, listed, removals.ids);
	if (operation == null || localFingerprint == null) return fail('EIO', 'Не удалось построить Z2K target snapshot.');
	let preparedAt = time(), target = { schema: 2, targetVersion: resolved.version, targetCommitSha: resolved.commitSha, manifestSha256: resolved.manifestSha256, localFingerprint: localFingerprint, operation: operation, previousVersion: installed, targetCanApply: targetGate.canApply === true, targetAttentionState: targetGate.attentionState || 'none', targetBlockingReasons: targetGate.blockingReasons || [], targetReviewDetails: targetGate.reviewDetails || [], preparedAt: preparedAt, removeIds: removals.ids, removeTargets: removals.targets, assets: resolved.assets };
	target.planToken = z2k_target_token(target, preparedAt);
	if (target.planToken == null || !save_prepared_target(target)) return fail('EIO', 'Не удалось сохранить Z2K target snapshot.');
	return { ok: true, target: z2k_target_summary(target), planToken: target.planToken };
};
function z2k_target_policy(listed, item) {
	let registered = registry_asset(listed.assets, item.id);
	if (registered == null) return { ok: true, registered: null };
	let promotion = registered.ownership == 'package' && registered.provenance && registered.provenance.kind == 'builtin/package';
	if (!promotion && (registered.ownership == 'package' || registered.ownership != 'manager' || !registered.provenance || registered.provenance.kind != 'catalog/upstream')) return fail('EPOLICY', 'package or user resource cannot be replaced by upstream', { id: item.id });
	return { ok: true, registered: registered };
}
function z2k_target_postflight(listed, target, diagnostics) {
	if (!listed.ok) return fail('ESTATE', 'asset registry metadata is unavailable after Z2K activation.');
	diagnostics.removed = 0;
	for (let i = 0; i < length(target.removeIds || []); i++) {
		if (registry_asset(listed.assets, target.removeIds[i]) != null) return fail('EVERIFY', 'Z2K removed asset is still registered after activation.', { id: target.removeIds[i] });
		diagnostics.removed++;
	}
	for (let i = 0; i < length(target.assets); i++) {
		let item = target.assets[i], found = registry_asset(listed.assets, item.id), actual = found && found.path && regular(found.path) ? sha256(found.path) : null;
		if (found == null || actual != item.sha256 || found.contentSha256 != item.sha256 || !found.provenance || found.provenance.kind != 'catalog/upstream' || found.provenance.sourceCommit != target.targetCommitSha || found.provenance.version != target.targetVersion || found.provenance.sourcePath != item.sourcePath) return fail('EVERIFY', 'Z2K postflight verification failed.', { id: item.id, expectedSha256: item.sha256, actualSha256: actual });
		diagnostics.targetAssets[i].result = 'applied'; diagnostics.postflightMatched++;
	}
	return { ok: true };
}
function z2k_apply_prepared(request, selected, sourceValue, listed, diagPathUsed) {
	let state = load_check_state(), target = z2k_target_from_state(state), requestedVersion = request && request.targetVersion;
	if (!target || !string(requestedVersion) || requestedVersion != target.targetVersion || request.planToken != target.planToken || request.operation != target.operation || (request.installedVersion !== target.previousVersion)) return fail('ECHECK_STALE', 'Z2K update requires a matching prepared operation and installed baseline; prepare the release again.');
	let fingerprint = z2k_local_fingerprint(target.assets, listed, target.removeIds);
	if (fingerprint == null || fingerprint != target.localFingerprint) return fail('ECHECK_STALE', 'Z2K local resources changed after preparation; prepare the release again.');
	let classification = z2k_read_classification();
	let membership = z2k_target_membership_compatible(listed, target.assets, classification);
	if (!membership.ok) return membership;
	let removals = z2k_target_removals(listed, target.assets, classification);
	if (!removals.ok || !same_id_set(removals.ids, target.removeIds)) return fail('ECHECK_STALE', 'Z2K managed membership changed after preparation; prepare the release again.');
	let root = make_stage_root(); if (root == null) return fail('ETARGET', 'resource staging directory is unavailable');
	let paths = [], staged = [], diagnostics = { pathUsed: diagPathUsed, targetVersion: target.targetVersion, operation: target.operation, planned: length(target.assets), removePlanned: length(target.removeIds || []), downloaded: 0, verified: 0, staged: 0, applied: 0, removed: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
	for (let i = 0; i < length(target.assets); i++) {
		let item = target.assets[i], before = registry_asset(listed.assets, item.id), policy = z2k_target_policy(listed, item);
		push(diagnostics.targetAssets, { sourcePath: item.sourcePath, assetId: item.id, installedShaBefore: before && before.contentSha256 || null, targetSha: item.sha256, result: 'pending' });
		if (!z2k_target_asset_valid(item)) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'invalid-target'; return fail('EVERIFY', 'prepared Z2K target asset is invalid.', { sourcePath: item && item.sourcePath, diagnostics: diagnostics }); }
		if (!policy.ok) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'protected'; policy.diagnostics = diagnostics; return policy; }
		let path = root + '/' + i + '.asset', url = 'https://raw.githubusercontent.com/necronicle/z2k/' + target.targetCommitSha + '/' + item.sourcePath, fetched = command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(url));
		if (fetched.rc != 0 || !regular(path)) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'fetch-failed'; return fail('EUNAVAILABLE', 'resource source is unavailable.', { sourcePath: item.sourcePath, diagnostics: diagnostics }); }
		diagnostics.downloaded++; let actual = sha256(path);
		if (actual != lc(item.sha256)) { cleanup(root, paths); diagnostics.targetAssets[i].result = 'sha-mismatch'; return fail('EVERIFY', 'fetched bytes SHA does not match prepared target.', { sourcePath: item.sourcePath, expectedSha256: item.sha256, actualSha256: actual, diagnostics: diagnostics }); }
		diagnostics.verified++; let gate = z2k_candidate_gate(item.sourcePath, path, item.sha256);
		if (!gate.ok) { cleanup(root, paths); diagnostics.targetAssets[i].result = gate.error && gate.error.code == 'ESTALE' ? 'stale' : 'incompatible'; return fail(gate.error && gate.error.code || 'EZ2K_REVIEW_REQUIRED', 'staged Z2K candidate requires review.', { sourcePath: item.sourcePath, diagnostics: diagnostics }); }
		push(paths, path); push(staged, { type: item.type, id: item.id, name: item.name, stagedPath: path, sha256: item.sha256, byteSize: stat(path).size, expectedRevision: before && before.revision || null, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: target.targetCommitSha, sourcePath: item.sourcePath, bundleId: selected.id, version: target.targetVersion } });
		diagnostics.targetAssets[i].result = 'staged';
	}
	diagnostics.staged = length(staged);
	let applied = asset_registry_apply_bundle({ bundleId: selected.id, version: target.targetVersion, source: 'necronicle/z2k', sourceCommit: target.targetCommitSha, assets: staged, removeIds: target.removeIds });
	if (!applied.ok) { cleanup(root, paths); return applied; }
	diagnostics.applied = applied.updated || length(staged);
	diagnostics.removed = applied.removed || 0;
	let after = asset_registry_list(null), registryPostflight = z2k_target_postflight(after, target, diagnostics);
	diagnostics.registryPostflight = registryPostflight;
	if (!registryPostflight.ok) {
		let rollback = asset_registry_rollback_bundle({ bundleId: selected.id, expectedRevision: applied.revision }); cleanup(root, paths);
		return fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K Registry activation was rolled back after postflight verification failed.' : 'Z2K Registry activation failed and rollback could not be completed.', { postflight: registryPostflight.error, rollback: rollback, diagnostics: diagnostics });
	}
	let runtime = z2k_runtime_activate(target, after, classification, root, diagnostics);
	diagnostics.runtimePostflight = runtime.postflight || { verified: false, reason: runtime.error && runtime.error.code || 'runtime-activation-failed' };
	if (!runtime.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, runtime.activated === true); cleanup(root, paths);
		return fail(rollback.ok ? 'ERUNTIME' : 'EROLLBACK', rollback.ok ? 'Z2K runtime activation was rolled back; Registry state was restored.' : 'Z2K runtime activation failed and rollback could not be completed.', { runtime: runtime.error || null, rollback: rollback, diagnostics: diagnostics });
	}
	if (!persist_check_state({ schema: 2, latestCheck: state && state.latestCheck || null, preparedTarget: null })) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true); cleanup(root, paths);
		return fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Z2K activation was rolled back because prepared target state could not be cleared.' : 'Z2K activation succeeded but rollback after state failure was incomplete.', { rollback: rollback, diagnostics: diagnostics });
	}
	cleanup(root, paths);
	return { ok: true, bundleId: selected.id, targetVersion: target.targetVersion, operation: target.operation, updated: diagnostics.applied, revision: applied.revision, rollbackAvailable: true, diagnostics: diagnostics, planToken: null };
}
export const resource_center_status = function () {
	// STALE-PROJECTION REGRESSION GUARD (see tests/product/z2k-candidate-compatibility.test.mjs):
	// This returns the PERSISTED CHECK_STATE (/etc/zapret2-manager/resource-source-check.json),
	// NOT a live fetch. After a sidecar migration or manifest change, it may still show
	// the previous status (e.g., rebase-required) until an explicit resources_check
	// An explicit check refreshes CHECK_STATE via save_check_state(). Do not make
	// this live — that would add network I/O to every status poll.
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let answer = build_status(loaded.manifest, null);
	if (!answer.ok) return answer;
	let local = z2k_local_projection(loaded.manifest);
	let persisted = load_check_state(), latestCheck = persisted && persisted.latestCheck;
	let remote = latestCheck ? z2k_projection(latestCheck.signed) : z2k_projection(null);
	remote.local = local;
	remote.checkedAt = latestCheck ? latestCheck.checkedAt : null;
	remote.planToken = latestCheck ? (latestCheck.planToken || remote.planToken) : null;
	remote.preparedTarget = persisted && persisted.preparedTarget ? { targetVersion: persisted.preparedTarget.targetVersion, operation: persisted.preparedTarget.operation, preparedAt: persisted.preparedTarget.preparedAt } : null;
	answer.z2k = remote;
	if (latestCheck) {
		answer.checkedAt = latestCheck.checkedAt;
		answer.signedSources = { z2k: latestCheck.signedSources };
		for (let i = 0; i < length(answer.sources); i++) if (answer.sources[i].id == 'z2k-resources') {
			answer.sources[i].checkMode = latestCheck.signed.trustMode == 'allow-untrusted' ? 'allow-untrusted' : 'signed-manifest';
			answer.sources[i].verification = latestCheck.signedSources;
			if (!latestCheck.signed.ok) { answer.sources[i].state = 'error'; answer.sources[i].status = state_label('error'); }
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
	let loaded = load_manifest(); if (!loaded.ok) return loaded;
	let signed = z2k_upstream_check();
	let checkedAt = signed.ok === true ? time() : null;
	let answer = build_status(loaded.manifest, checkedAt); if (!answer.ok) return answer;
	let local = z2k_local_projection(loaded.manifest);
	let remote = z2k_projection(signed);
	remote.local = local;
	remote.checkedAt = checkedAt;
	remote.planToken = signed.ok === true ? plan_token(checkedAt, signed.manifest) : null;
	if (signed.ok === true && remote.planToken != null) signed.planToken = remote.planToken;
	answer.planToken = remote.planToken;
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
	if (signed.ok === true) save_check_state(signed, checkedAt, answer.signedSources.z2k, remote.planToken);
	return answer;
};
export const resource_center_update = function (request) {
	if (!object(request) || request.confirm !== true) return fail('EINPUT', 'explicit update confirmation is required');
	// Branch detection for diagnostics: z2k-runtime vs bundle-based
	let diagPathUsed = null;
	if (request.component == 'z2k-runtime') return fail('ELEGACY_LIFECYCLE', 'The legacy Z2K component lifecycle is retired; prepare a release target first.');
	else if (request.bundleId) diagPathUsed = 'bundle:' + text(request.bundleId);
	else diagPathUsed = 'unknown';
	let controlled = inline_bundle(request); if (controlled != null) {
		if (object(controlled)) { controlled.pathUsed = 'controlled-bundle'; controlled.diagnostics = { pathUsed: 'controlled-bundle', remoteRevision: null, planned: 0, downloaded: 0, verified: 0, staged: 0, applied: controlled.updated || 0, postflightMatched: 0, skipped: [], targetAssets: [] }; }
		return controlled;
	}
	let loaded = load_manifest(); if (!loaded.ok) return loaded; let selected = bundle(loaded.manifest, request.bundleId); if (selected == null) return fail('EINPUT', 'resource bundle is not configured'); let sourceValue = source(loaded.manifest, selected.sourceId); if (sourceValue == null) return fail('EINPUT', 'resource bundle source is not configured'); let listed = asset_registry_list(null); if (!listed.ok) return listed;
	// Update pathUsed now that selected is known
	if (selected.sourceId == 'z2k-resources') diagPathUsed = 'z2k-resources:bundle:' + selected.id;
	else diagPathUsed = 'bundle:' + selected.id;
	if (selected.sourceId == 'z2k-resources') return z2k_apply_prepared(request, selected, sourceValue, listed, diagPathUsed);
	let root = make_stage_root(); if (root == null) return fail('ETARGET', 'resource staging directory is unavailable'); let paths = [], staged = [];
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
