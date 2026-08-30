'use strict';

// Resource Center coordinator. It owns source/bundle policy and staging, while
// Asset Registry remains the only writer of managed asset metadata and bytes.
import { readfile, writefile, stat, unlink, mkdir, popen } from 'fs';
import { asset_registry_list, asset_registry_apply_bundle, asset_registry_finalize_activation, asset_registry_rollback_bundle } from './asset-registry.uc';
import { z2k_upstream_check, z2k_upstream_plan } from './z2k-upstream.uc';
import { z2k_candidate_gate } from './z2k-compat.uc';
import { z2k_resolve_version, z2k_compare_versions, z2k_asset_id_from_classification } from './z2k-versions.uc';
import { z2k_registry_installed_release, z2k_registry_receipt_state } from './z2k-installed-release.uc';
import { resolveCandidate, resolveInstalled, runtime_composition_candidate_cas, verifyMaterialized, verifyActivationProcess } from './runtime-composition.uc';
import { read_var, config_sha256 } from './apply.uc';

const MANIFEST = '/usr/share/zapret2-manager/resources/manifest.json';
const STAGE_PARENT = '/tmp/z2m-resource-update';
const RUNTIME_SYNC = '/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh';
const RUNTIME_BASE = '/opt/zapret2';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const CHECK_STATE = '/etc/zapret2-manager/resource-source-check.json';
const MAX_CHECK_STATE_BYTES = 1024 * 1024;
const LIFECYCLE_LOCK = '/tmp/z2m-z2k-lifecycle.lock';
const Z2K_PAUSE_FILE = '/tmp/zapret2-manager/paused';
const Z2K_OPERATION_PARENT = STAGE_PARENT + '/jobs';
const Z2K_OPERATION_WORKER = '/usr/libexec/zapret2-manager/resource-update-worker.uc';
const Z2K_PENDING_ACTIVATION = '/etc/zapret2-manager/z2k-pending-activation.json';
const Z2K_RUNTIME_READY_TIMEOUT_MS = 12000;
const Z2K_RUNTIME_READY_POLL_MS = 1000;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function fail(code, message, extra) { let out = { ok: false, error: { code: code, message: message } }; for (let k in extra || {}) out.error[k] = extra[k]; return out; }
function shell_quote(value) { let out = "'", raw = text(value); for (let i = 0; i < length(raw); i++) out += substr(raw, i, 1) == "'" ? "'\\''" : substr(raw, i, 1); return out + "'"; }
function command(value) { let p = popen(value + ' 2>&1', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function regular(path) { try { let value = stat(path); return object(value) && value.type == 'file' && type(value.size) == 'int'; } catch (e) { return false; } }
function sha256(path) { if (!regular(path)) return null; let value = command("sha256sum " + shell_quote(path) + " | awk '{print $1}'"); let digest = trim(value.out); return value.rc == 0 && match(digest, /^[a-f0-9]{64}$/) ? digest : null; }
function z2k_runtime_monotonic_ms() { let now = clock(true); return now[0] * 1000 + int(now[1] / 1000000); }
function z2k_runtime_tokens(raw) {
	let out = [], current = '';
	for (let i = 0; i < length(raw || ''); i++) {
		let c = substr(raw, i, 1);
		if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
			if (length(current)) { push(out, current); current = ''; }
		} else current += c;
	}
	if (length(current)) push(out, current);
	return out;
}
function z2k_runtime_pids(raw) {
	let pids = [], tokens = z2k_runtime_tokens(raw);
	for (let i = 0; i < length(tokens); i++) if (match(tokens[i], /^[0-9]+$/)) push(pids, +tokens[i]);
	return pids;
}
function z2k_runtime_queue(raw, rc) {
	if (rc != 0 || !length(raw || '')) return { registered: false, peerPid: null, row: null, reason: 'nfnetlink_queue unavailable' };
	let lines = split(raw, '\n');
	for (let i = 0; i < length(lines); i++) {
		let row = trim(lines[i]), fields = z2k_runtime_tokens(row);
		if (length(fields) >= 2 && fields[0] == '300' && match(fields[1], /^[0-9]+$/))
			return { registered: true, peerPid: +fields[1], row: row };
	}
	return { registered: false, peerPid: null, row: null, reason: 'queue 300 not registered in kernel' };
}
function z2k_runtime_observe() {
	let pid = command('pidof nfqws2');
	let queue = command('cat /proc/net/netfilter/nfnetlink_queue');
	let nft = command('nft list table inet zapret2');
	let nftOutput = trim(nft.out), nftRuleReady = false, nftLines = split(nftOutput, '\n');
	for (let i = 0; i < length(nftLines); i++) if (index(nftLines[i], 'queue') >= 0 && match(nftLines[i], /300/)) { nftRuleReady = true; break; }
	return {
		pids: z2k_runtime_pids(pid.out), pidRc: pid.rc, pidOutput: trim(pid.out),
		queue: z2k_runtime_queue(queue.out, queue.rc),
		nft: { ready: nft.rc == 0 && nftRuleReady, tableReady: nft.rc == 0,
			ruleReady: nftRuleReady, rc: nft.rc, output: nftOutput }
	};
}
function z2k_runtime_status_postflight() {
	let status = command('/usr/bin/ucode /usr/libexec/zapret2-manager/status.uc --no-print');
	return { ok: status.rc == 0 && regular('/tmp/zapret2-manager/status.json'), rc: status.rc,
		fileReady: regular('/tmp/zapret2-manager/status.json'), output: trim(status.out) };
}
function z2k_runtime_has_pid(pids, wanted) {
	for (let i = 0; i < length(pids || []); i++) if (pids[i] == wanted) return true;
	return false;
}
function z2k_runtime_readiness_reason(observation, expectedEnabled) {
	let value = object(observation) ? observation : {}, pids = type(value.pids) == 'array' ? value.pids : [];
	let queue = object(value.queue) ? value.queue : {}, nft = object(value.nft) ? value.nft : {};
	if (!expectedEnabled) return length(pids) ? 'daemon-still-running' : (!nft.ready ? (nft.tableReady === false ? 'nft-table-missing' : 'nft-queue-rule-missing') : null);
	if (!length(pids)) return 'daemon-not-spawned';
	if (length(pids) > 16) return 'daemon-count-invalid';
	if (queue.registered !== true) return 'queue-300-listener-missing';
	if (queue.peerPid == null || !z2k_runtime_has_pid(pids, queue.peerPid)) return 'queue-300-owner-mismatch';
	if (nft.ready !== true) return nft.tableReady === false ? 'nft-table-missing' : 'nft-queue-rule-missing';
	return null;
}
function z2k_runtime_readiness_message(reason, stage) {
	if (reason == 'daemon-not-spawned') return 'nfqws2 is not running after Z2K ' + stage + '.';
	if (reason == 'daemon-spawned-then-exited') return 'nfqws2 spawned but exited before Z2K ' + stage + ' readiness.';
	if (reason == 'queue-300-listener-missing') return 'Zapret2 NFQUEUE postflight is missing queue 300 listener after Z2K ' + stage + '.';
	if (reason == 'queue-300-owner-mismatch') return 'Zapret2 NFQUEUE queue 300 is owned by a different process after Z2K ' + stage + '.';
	if (reason == 'daemon-count-invalid') return 'nfqws2 process count is outside the supported range after Z2K ' + stage + '.';
	if (reason == 'daemon-still-running') return 'nfqws2 is still running while Z2K runtime is disabled after Z2K ' + stage + '.';
	if (reason == 'nft-queue-rule-missing') return 'Zapret2 nft queue rule is not ready after Z2K ' + stage + '.';
	if (reason == 'nft-table-missing') return 'Zapret2 nft table is not ready after Z2K ' + stage + '.';
	return 'Z2K runtime readiness was not verified after Z2K ' + stage + '.';
}
function z2k_runtime_readiness_diagnostics(stage, expectedEnabled, configValue, attempts, started, now, observation, reason, history) {
	let elapsed = now - started;
	if (elapsed < 0) elapsed = 0;
	return {
		stage: stage, expectedEnabled: expectedEnabled, configValue: configValue == null ? null : configValue,
		attempts: attempts, elapsedMs: elapsed,
		reason: reason, pids: observation && type(observation.pids) == 'array' ? observation.pids : [],
		queue: observation && observation.queue ? observation.queue : null,
		nft: observation && observation.nft ? observation.nft : null,
		observation: observation || null, history: history || []
	};
}
export const z2k_runtime_readiness = function(seams) {
	let input = object(seams) ? seams : {}, stage = string(input.stage) && length(input.stage) ? input.stage : 'activation';
	let expectedEnabled = input.expectedEnabled !== false;
	let configValue = input.configValue == null ? null : text(input.configValue);
	let timeoutMs = type(input.timeoutMs) == 'int' && input.timeoutMs >= 0 ? input.timeoutMs : Z2K_RUNTIME_READY_TIMEOUT_MS;
	let pollMs = type(input.pollIntervalMs) == 'int' && input.pollIntervalMs > 0 ? input.pollIntervalMs : Z2K_RUNTIME_READY_POLL_MS;
	let attemptsLimit = int((timeoutMs + pollMs - 1) / pollMs) + 1;
	if (attemptsLimit < 1) attemptsLimit = 1;
	let nowFn = type(input.now) == 'function' ? input.now : function() { return z2k_runtime_monotonic_ms(); };
	let waitFn = type(input.wait) == 'function' ? input.wait : function() { command('sleep 1'); };
	let observeFn = type(input.observe) == 'function' ? input.observe : z2k_runtime_observe;
	let started = nowFn(), last = null, reason = null, history = [];
	for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
		last = observeFn();
		reason = z2k_runtime_readiness_reason(last, expectedEnabled);
		let now = nowFn();
		push(history, { attempt: attempt, elapsedMs: now - started, reason: reason,
			pids: last && type(last.pids) == 'array' ? last.pids : [],
			queue: last && last.queue ? last.queue : null, nft: last && last.nft ? last.nft : null });
		let diagnostics = z2k_runtime_readiness_diagnostics(stage, expectedEnabled, configValue, attempt, started, now, last, reason, history);
		if (reason == null) {
			let pids = type(last.pids) == 'array' ? last.pids : [], queue = last.queue || {};
			return { ok: true, stage: stage, attempts: attempt, elapsedMs: diagnostics.elapsedMs,
				expectedEnabled: expectedEnabled, pid: join(pids, ' '), pids: pids,
				queue: queue.row || null, readiness: diagnostics };
		}
		if (attempt < attemptsLimit) waitFn(pollMs);
	}
	let observedPid = false;
	for (let i = 0; i < length(history); i++) if (length(history[i].pids || [])) { observedPid = true; break; }
	if (reason == 'daemon-not-spawned' && observedPid) reason = 'daemon-spawned-then-exited';
	let elapsedNow = nowFn(), diagnostics = z2k_runtime_readiness_diagnostics(stage, expectedEnabled, configValue, attemptsLimit, started, elapsedNow, last, reason, history);
	return { ok: false, error: { code: 'ERUNTIME', message: z2k_runtime_readiness_message(reason, stage), reason: reason, stage: stage, readiness: diagnostics } };
};
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
	return { ok: true, canApply: true, attentionState: plan.attentionState || 'none', blockingReasons: plan.blockingReasons || [], reviewDetails: plan.reviewDetails || [], plan: plan };
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
	if (!object(signed) || signed.ok !== true) return { status: 'unknown', updateState: 'unknown', attentionState: 'none', canApply: false, updates: [], removedItems: [], rebases: [], reviews: [], advisoryReviews: [], blockingReviews: [], blockingReasons: [], reviewDetails: [], planToken: null, trustMode: 'allow-untrusted', verified: false, source: null, manifest: null, availableRelease: null };
	let plan = object(signed.plan) ? signed.plan : {}, manifest = object(signed.manifest) ? signed.manifest : {};
	let status = signed.status || 'unknown';
	let updateState = signed.updateState || plan.updateState || (length(plan.updates || []) + length(plan.removedItems || []) > 0 ? 'update-available' : status == 'unknown' ? 'unknown' : 'current');
	let attentionState = signed.attentionState || plan.attentionState || (status == 'rebase-required' ? 'rebase-required' : status == 'review-required' ? 'review-required' : 'none');
	return {
		status: status,
		updateState: updateState,
		attentionState: attentionState,
		canApply: signed.canApply === true || plan.canApply === true,
		updates: plan.updates || [],
		removedItems: plan.removedItems || [],
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
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function z2k_target_asset_valid(item) {
	return object(item) && string(item.sourcePath) && match(item.sourcePath, /^files\/(lua|fake|lists)\/[A-Za-z0-9._\/-]+$/)
		&& string(item.id) && (substr(item.id, 0, 4) == 'lua:' || substr(item.id, 0, 5) == 'blob:')
		&& (item.type == 'lua' || item.type == 'blob') && valid_digest(item.sha256) && runtime_target_path(item.runtimeTarget) != null;
}
function z2k_canonical_target_asset_valid(item) {
	return object(item) && item.type == 'lifecycle-managed' && string(item.id) && string(item.owner) && item.owner == 'z2k-core'
		&& string(item.kind) && (item.kind == 'lua' || item.kind == 'blob' || item.kind == 'hostlist' || item.kind == 'ipset')
		&& string(item.role) && string(item.sourcePath) && match(item.sourcePath, /^files\/(lua|fake|lists)\/[A-Za-z0-9._\/-]+$/)
		&& runtime_target_path(item.runtimeTarget) != null && valid_digest(item.contentSha256) && valid_digest(item.sha256 || item.contentSha256)
		&& type(item.byteSize) == 'int' && item.byteSize > 0 && string(item.version)
		&& string(item.sourceCommit) && match(lc(item.sourceCommit), /^[a-f0-9]{40}$/)
		&& valid_digest(item.manifestSha256) && valid_digest(item.classificationSha256)
		&& (item.role != 'lua-init' || (item.kind == 'lua' && type(item.runtimeOrder) == 'int' && item.runtimeOrder >= 0));
}
function valid_target_operation(value) { return value == 'install' || value == 'upgrade' || value == 'reinstall' || value == 'downgrade'; }
function valid_latest_check(value) { return object(value) && type(value.checkedAt) == 'int' && value.checkedAt >= 0 && object(value.signed); }
function valid_removal_descriptor(value, expectedId) {
	return object(value) && value.id == expectedId && (value.type == 'lua' || value.type == 'blob')
		&& string(value.sourcePath) && match(value.sourcePath, /^files\/(lua|fake|lists)\/[A-Za-z0-9._\/-]+$/)
		&& runtime_target_path(value.runtimeTarget) != null && type(value.expectedRevision) == 'int' && value.expectedRevision > 0
		&& valid_digest(value.expectedContentSha256) && type(value.expectedByteSize) == 'int' && value.expectedByteSize > 0
		&& value.bundleId == 'z2k-curated-lua' && string(value.version) && string(value.sourceCommit) && match(lc(value.sourceCommit), /^[a-f0-9]{40}$/);
}
function z2k_runtime_guard_acquire() {
	let preexisting = false, owned = false;
	try {
		preexisting = stat(Z2K_PAUSE_FILE) != null;
		if (preexisting) return { ok: true, owned: !preexisting, preexisting: preexisting };
		writefile(Z2K_PAUSE_FILE, '');
		owned = true;
		if (stat(Z2K_PAUSE_FILE) == null) {
			try { unlink(Z2K_PAUSE_FILE); } catch (cleanupError) { }
			return fail('ERUNTIME', 'Z2K lifecycle could not pause the watchdog.', { reason: 'pause-acquire-failed' });
		}
		return { ok: true, owned: owned, preexisting: preexisting };
	} catch (e) {
		if (owned) { try { unlink(Z2K_PAUSE_FILE); } catch (cleanupError) { } }
		return fail('ERUNTIME', 'Z2K lifecycle could not pause the watchdog.', { reason: 'pause-acquire-failed', detail: text(e) });
	}
}
function z2k_runtime_guard_release(guard) {
	if (!guard || guard.owned !== true) return { ok: true, skipped: true, preserved: guard && guard.preexisting === true };
	try { unlink(Z2K_PAUSE_FILE); } catch (e) { }
	try {
		if (stat(Z2K_PAUSE_FILE) != null) {
			let fallback = command('rm -f ' + shell_quote(Z2K_PAUSE_FILE));
			if (fallback.rc != 0 || stat(Z2K_PAUSE_FILE) != null)
				return fail('ERUNTIME', 'Z2K lifecycle could not release the watchdog pause.', { reason: 'pause-release-failed', output: fallback.out });
		}
	} catch (e) {
		return fail('ERUNTIME', 'Z2K lifecycle could not release the watchdog pause.', { reason: 'pause-release-failed', detail: text(e) });
	}
	return { ok: true, released: true };
}
function z2k_lifecycle_lock_release() {
	try {
		let released = command('rmdir ' + shell_quote(LIFECYCLE_LOCK));
		if (released.rc != 0 && stat(LIFECYCLE_LOCK) != null)
			return fail('EBUSY', 'Z2K lifecycle lock could not be released.', { reason: 'lifecycle-lock-release-failed', output: released.out });
		return { ok: true };
	} catch (e) {
		return fail('EBUSY', 'Z2K lifecycle lock could not be released.', { reason: 'lifecycle-lock-release-failed', detail: text(e) });
	}
}
function cleanup(root, paths) { for (let i = 0; i < length(paths || []); i++) { try { unlink(paths[i]); } catch (e) {} } if (root != null) command('rmdir ' + shell_quote(root) + ' >/dev/null 2>&1'); }
function z2k_runtime_guard_finish(guard, root, paths, result) {
	cleanup(root, paths);
	let pause = z2k_runtime_guard_release(guard), lock = z2k_lifecycle_lock_release();
	let answer = object(result) ? result : fail('EINTERNAL', 'Z2K lifecycle returned an invalid result.');
	answer.lifecycleCleanup = { pause: pause, lock: lock };
	if (!pause.ok || !lock.ok) {
		if (answer.ok === true) return fail('ERUNTIME', 'Z2K lifecycle cleanup could not release an owned resource.', { result: answer, lifecycleCleanup: answer.lifecycleCleanup });
		answer.error = answer.error || { code: 'ERUNTIME', message: 'Z2K lifecycle cleanup failed.' };
		answer.error.lifecycleCleanup = answer.lifecycleCleanup;
		answer.ok = false;
	}
	return answer;
}
function digest_text(value, prefix) {
	let made = command('umask 077; mktemp /tmp/' + (prefix || 'z2m-digest') + '.XXXXXX'), path = trim(made.out);
	if (made.rc != 0 || !match(path, /^\/tmp\/[A-Za-z0-9._-]+$/)) return null;
	try { writefile(path, value == null ? '' : value); } catch (e) { cleanup(null, [path]); return null; }
	let digest = sha256(path); cleanup(null, [path]); return digest;
}
function z2k_operation_id(request) {
	if (!object(request) || !string(request.planToken) || !length(request.planToken)) return null;
	let digest = digest_text(request.planToken, 'z2m-z2k-operation');
	return valid_digest(digest) ? 'z2k-' + time() + '-' + substr(digest, 0, 16) : null;
}
function z2k_operation_id_valid(value) { return string(value) && match(value, /^z2k-[0-9]+-[a-f0-9]{16}$/); }
function z2k_operation_path(operationId) { return Z2K_OPERATION_PARENT + '/' + operationId + '/job.json'; }
function z2k_operation_write(path, value) {
	if (!string(path) || !object(value)) return false;
	let tmp = path + '.tmp';
	try { writefile(tmp, sprintf('%J', value) + '\n'); } catch (e) { return false; }
	if (!regular(tmp)) { try { unlink(tmp); } catch (e) {} return false; }
	let moved = command('mv -f ' + shell_quote(tmp) + ' ' + shell_quote(path));
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) {} return false; }
	return regular(path);
}
function z2k_operation_load(operationId) {
	if (!z2k_operation_id_valid(operationId)) return null;
	let raw = readfile(z2k_operation_path(operationId));
	if (raw == null || length(raw) > MAX_REQUEST_BYTES) return null;
	try { let value = json(raw); return object(value) && value.operationId == operationId ? value : null; }
	catch (e) { return null; }
}
function z2k_operation_spawn(jobPath) {
	let worker = '/usr/bin/ucode ' + shell_quote(Z2K_OPERATION_WORKER) + ' ' + shell_quote(jobPath) + ' >/dev/null 2>&1 & echo $!';
	let launched = command('sh -c ' + shell_quote(worker)), pid = trim(launched.out);
	return launched.rc == 0 && match(pid, /^[0-9]+$/) ? { ok: true, pid: +pid } : fail('ETARGET', 'Z2K lifecycle worker could not be started.', { output: trim(launched.out) });
}
export const resource_center_operation_write = function(path, value) { return z2k_operation_write(path, value); };
export const resource_center_enqueue_update = function(request) {
	if (!object(request) || request.confirm !== true || request.bundleId != 'z2k-curated-lua') return fail('EINPUT', 'Z2K lifecycle request is invalid.');
	if (!string(request.targetVersion) || z2k_compare_versions(request.targetVersion, request.targetVersion) == null || !string(request.planToken) || !length(request.planToken)) return fail('EINPUT', 'Z2K lifecycle request is incomplete.');
	let operationId = z2k_operation_id(request);
	if (!operationId) return fail('EIO', 'Z2K lifecycle operation identity could not be created.');
	try { mkdir(STAGE_PARENT); } catch (e) {}
	try { mkdir(Z2K_OPERATION_PARENT); } catch (e) {}
	let dir = Z2K_OPERATION_PARENT + '/' + operationId, jobPath = dir + '/job.json';
	try { mkdir(dir); } catch (e) {}
	if (stat(jobPath) != null) return fail('EBUSY', 'Z2K lifecycle operation identity is already in use.');
	let now = time(), job = { schema: 1, operationId: operationId, phase: 'queued', finished: false, request: request, createdAt: now, updatedAt: now, pid: null };
	if (!z2k_operation_write(jobPath, job)) return fail('EWRITE', 'Z2K lifecycle operation could not be queued.');
	let spawned = z2k_operation_spawn(jobPath);
	if (!spawned.ok) {
		job.phase = 'failed'; job.finished = true; job.error = spawned.error; job.updatedAt = time(); job.finishedAt = job.updatedAt;
		z2k_operation_write(jobPath, job);
		return spawned;
	}
	return { ok: true, accepted: true, operationId: operationId, state: 'queued', phase: 'queued', targetVersion: request.targetVersion };
};
export const resource_center_update_status = function(request) {
	let operationId = object(request) ? request.operationId : request;
	if (!z2k_operation_id_valid(operationId)) return fail('EINPUT', 'Z2K lifecycle operation id is invalid.');
	let job = z2k_operation_load(operationId);
	if (job == null) return fail('ENOENT', 'Z2K lifecycle operation was not found.');
	let answer = { ok: true, operationId: operationId, state: job.phase || 'queued', phase: job.phase || 'queued', finished: job.finished === true, pid: job.pid || null };
	if (job.result != null) answer.result = job.result;
	if (job.error != null) answer.error = job.error;
	return answer;
};
function z2k_target_token(target, preparedAt) {
	let removeIds = [], canonical;
	for (let i = 0; i < length(target.removeIds || []); i++) push(removeIds, target.removeIds[i]);
	sort(removeIds);
	let removalIdentity = [];
	for (let i = 0; i < length(target.removeTargets || []); i++) {
		let item = target.removeTargets[i];
		push(removalIdentity, item.id + '|' + item.type + '|' + item.sourcePath + '|' + item.runtimeTarget + '|' + item.expectedRevision + '|' + item.expectedContentSha256 + '|' + item.expectedByteSize + '|' + item.bundleId + '|' + item.version + '|' + item.sourceCommit);
	}
	sort(removalIdentity);
	canonical = target.targetVersion + '|' + target.targetCommitSha + '|' + target.manifestSha256 + '|' + target.localFingerprint + '|' + target.classificationSha256 + '|' + target.operation + '|' + join(',', removeIds) + '|' + join(',', removalIdentity) + '|' + preparedAt;
	let digest = digest_text(canonical, 'z2m-z2k-token');
	return digest == null ? null : 'z2k-target-v2:' + digest;
}
function z2k_runtime_kind(item) {
	if (!object(item)) return null;
	if (item.kind == 'lua' || item.kind == 'blob' || item.kind == 'hostlist' || item.kind == 'ipset') return item.kind;
	if (item.type == 'lua') return 'lua';
	if (item.type == 'ipset' || (string(item.sourcePath) && index(item.sourcePath, '/ipset/') >= 0)) return 'ipset';
	if (item.type == 'hostlist' || (string(item.sourcePath) && index(item.sourcePath, '/lists/') >= 0)) return 'hostlist';
	return item.type == 'blob' || item.type == 'bin' || item.type == 'txt' ? 'blob' : null;
}
function z2k_canonical_target_assets(targetVersion, targetCommit, manifestSha256, classificationSha256, assets) {
	if (type(assets) != 'array' || !length(assets)) return null;
	let result = [], seen = {}, luaOrder = 0;
	for (let i = 0; i < length(assets); i++) {
		let item = assets[i], kind = z2k_runtime_kind(item), role = item && item.role || (kind == 'lua' ? 'lua-init' : 'dependency');
		if (!object(item) || kind == null || !string(item.id) || seen[item.id] || !string(item.sourcePath) || !runtime_target_path(item.runtimeTarget)
			|| !valid_digest(item.sha256) || type(item.byteSize) != 'int' || item.byteSize < 1) return null;
		seen[item.id] = true;
		let entry = { id: item.id, owner: 'z2k-core', role: role, sourcePath: item.sourcePath, runtimeTarget: item.runtimeTarget,
			contentSha256: lc(item.sha256), sha256: lc(item.sha256), byteSize: item.byteSize, kind: kind, type: 'lifecycle-managed', version: targetVersion,
			sourceCommit: targetCommit, manifestSha256: manifestSha256, classificationSha256: classificationSha256,
			dependencies: item.dependencies || [], references: item.references || [] };
		if (role == 'lua-init') entry.runtimeOrder = item.runtimeOrder == null ? luaOrder : item.runtimeOrder;
		if (kind == 'lua') luaOrder++;
		push(result, entry);
	}
	return result;
}
function z2k_target_assets_with_sizes(assets, listed, targetCommit) {
	if (type(assets) != 'array' || !length(assets) || !object(listed) || type(listed.assets) != 'array' || !valid_commit(targetCommit))
		return fail('EZ2K_INCOMPATIBLE', 'Z2K target size evidence is unavailable.');
	let result = [], root = null, paths = [];
	try {
		for (let i = 0; i < length(assets); i++) {
			let item = assets[i], copy = {};
			if (!object(item) || !valid_digest(item.sha256)) { cleanup(root, paths); return fail('EZ2K_INCOMPATIBLE', 'Z2K target asset has no valid content identity.'); }
			for (let key in item) copy[key] = item[key];
			if (type(item.byteSize) == 'int' && item.byteSize > 0) { push(result, copy); continue; }
			let current = registry_asset(listed.assets, item.id), currentPath = current && current.path;
			if (current != null && runtime_source_safe(currentPath) && regular(currentPath) && current.contentSha256 == lc(item.sha256)
				&& type(current.byteSize) == 'int' && current.byteSize > 0 && stat(currentPath).size == current.byteSize && sha256(currentPath) == lc(item.sha256)) {
				copy.byteSize = current.byteSize; push(result, copy); continue;
			}
			if (string(item.packagePath) && regular(item.packagePath)) {
				let packageSha = sha256(item.packagePath), packageSize = stat(item.packagePath).size;
				if (packageSha == lc(item.sha256) && packageSize > 0) { copy.byteSize = packageSize; push(result, copy); continue; }
			}
			if (root == null) root = make_stage_root();
			if (root == null) { cleanup(root, paths); return fail('EUNAVAILABLE', 'immutable Z2K asset size evidence is unavailable.', { sourcePath: item.sourcePath }); }
			let path = root + '/' + i + '.size', url = 'https://raw.githubusercontent.com/necronicle/z2k/' + targetCommit + '/' + item.sourcePath,
				fetched = command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(url));
			if (fetched.rc != 0 || !regular(path)) { cleanup(root, paths); return fail('EUNAVAILABLE', 'immutable Z2K asset size evidence is unavailable.', { sourcePath: item.sourcePath }); }
			let actual = sha256(path), size = stat(path).size;
			if (actual != lc(item.sha256) || size < 1) { cleanup(root, paths); return fail('EVERIFY', 'immutable Z2K asset size evidence failed SHA verification.', { sourcePath: item.sourcePath, expectedSha256: item.sha256, actualSha256: actual }); }
			copy.byteSize = size; push(paths, path); push(result, copy);
		}
	} catch (e) { cleanup(root, paths); return fail('EINTERNAL', 'Z2K target size evidence failed.', { detail: text(e) }); }
	cleanup(root, paths);
	return { ok: true, assets: result };
}
function z2k_v1_reconciliation_check(listed, resolved) {
	let state = z2k_registry_receipt_state(listed), receipt = state && state.receipt;
	if (!state || state.state != 'V1_VERIFIED_MEMBERSHIP' || !object(receipt)) return { ok: true, required: false };
	if (receipt.version != resolved.version || receipt.sourceCommit != resolved.commitSha) return fail('RECONCILIATION_REQUIRED', 'V1 receipt identity does not match the FRESH same-release target.');
	let expected = {}, expectedCount = 0, seen = {};
	for (let i = 0; i < length(resolved.assets || []); i++) { expected[resolved.assets[i].id] = resolved.assets[i]; expectedCount++; }
	for (let i = 0; i < length(receipt.assets || []); i++) {
		let old = receipt.assets[i], fresh = old && expected[old.id], current = old && registry_asset(listed.assets, old.id), provenance = current && current.provenance;
		// UPDATES.json is immutable evidence for identity and content, but it
		// does not carry byte sizes. The already validated V1 receipt/Registry
		// membership is the only trustworthy local size evidence available at
		// this boundary; require it to agree with the FRESH target as well.
		if (!object(old) || fresh == null || current == null || !object(provenance) || seen[old.id]
			|| old.type != fresh.type || current.type != fresh.type || old.sourcePath != fresh.sourcePath || provenance.sourcePath != fresh.sourcePath
			|| old.sha256 != fresh.sha256 || current.contentSha256 != fresh.sha256 || old.byteSize != current.byteSize)
			return fail('RECONCILIATION_REQUIRED', 'V1 membership does not exactly match the FRESH same-release target.', { id: old && old.id || null });
		seen[old.id] = true;
	}
	if (expectedCount != length(receipt.assets || [])) return fail('RECONCILIATION_REQUIRED', 'FRESH same-release target contains a membership change relative to V1.');
	return { ok: true, required: true, operation: 'reinstall', version: receipt.version, sourceCommit: receipt.sourceCommit };
}
function z2k_registry_asset_type(item) {
	if (!object(item)) return null;
	if (item.type == 'lua' || item.type == 'blob' || item.type == 'ipset' || item.type == 'hostlist') return item.type;
	if (item.kind == 'lua') return 'lua';
	return item.id && substr(item.id, 0, 5) == 'blob:' ? 'blob' : item.kind;
}
function valid_prepared_target(value) {
	if (!object(value) || (value.schema != 2 && value.schema != 'z2k-target-v2') || !string(value.targetVersion) || z2k_compare_versions(value.targetVersion, value.targetVersion) == null
		|| !string(value.targetCommitSha || value.targetCommit) || !match(lc(value.targetCommitSha || value.targetCommit), /^[a-f0-9]{40}$/)
		|| !valid_digest(value.manifestSha256) || !valid_digest(value.localFingerprint)
		|| !valid_digest(value.classificationSha256)
		|| !valid_target_operation(value.operation) || type(value.preparedAt) != 'int' || value.preparedAt < 0
		|| !string(value.planToken) || substr(value.planToken, 0, length('z2k-target-v2:')) != 'z2k-target-v2:'
		|| value.targetCanApply !== true || !string(value.targetAttentionState) || type(value.targetBlockingReasons) != 'array' || type(value.targetReviewDetails) != 'array'
		|| type(value.assets) != 'array' || length(value.assets) == 0 || length(value.assets) > 64
		|| type(value.removeIds) != 'array' || length(value.removeIds) > 64
		|| type(value.removeTargets) != 'array' || length(value.removeTargets) != length(value.removeIds)) return false;
	for (let i = 0; i < length(value.assets); i++) if (!z2k_target_asset_valid(value.assets[i]) && !z2k_canonical_target_asset_valid(value.assets[i])) return false;
	let seen = {};
	for (let i = 0; i < length(value.assets); i++) seen[value.assets[i].id] = true;
	for (let i = 0; i < length(value.removeIds); i++) {
		let id = value.removeIds[i];
		if (!string(id) || !match(id, /^(lua|blob):[a-z0-9][a-z0-9._-]*$/) || seen[id]) return false;
		seen[id] = true;
		if (!valid_removal_descriptor(value.removeTargets[i], id)) return false;
	}
	return z2k_target_token(value, value.preparedAt) == value.planToken;
}
function z2k_target_from_state(state) { return state && state.preparedTarget && valid_prepared_target(state.preparedTarget) ? state.preparedTarget : null; }
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

function z2k_pending_load() {
	let raw = readfile(Z2K_PENDING_ACTIVATION);
	if (raw == null || length(raw) > MAX_CHECK_STATE_BYTES) return null;
	try {
		let value = json(raw);
		return object(value) && value.schema == 1 && string(value.phase) && string(value.candidateSnapshotId)
			&& type(value.baseRegistryRevision) == 'int' && object(value.rollbackIdentity) ? value : null;
	} catch (e) { return null; }
}
function z2k_pending_write(value, phase) {
	if (!object(value) || !string(phase)) return false;
	let payload = {}, key;
	for (key in value) payload[key] = value[key];
	payload.schema = 1; payload.phase = phase; payload.updatedAt = time();
	let content = sprintf('%J', payload) + '\n', tmp = Z2K_PENDING_ACTIVATION + '.tmp.' + time();
	try { writefile(tmp, content); } catch (e) { return false; }
	if (!regular(tmp)) { try { unlink(tmp); } catch (e) {} return false; }
	if (command('chmod 600 ' + shell_quote(tmp)).rc != 0) { try { unlink(tmp); } catch (e) {} return false; }
	let moved = command('mv -f ' + shell_quote(tmp) + ' ' + shell_quote(Z2K_PENDING_ACTIVATION));
	if (moved.rc != 0 || !regular(Z2K_PENDING_ACTIVATION)) { try { unlink(tmp); } catch (e) {} return false; }
	return command('chmod 600 ' + shell_quote(Z2K_PENDING_ACTIVATION)).rc == 0;
}
function z2k_pending_clear() {
	try { unlink(Z2K_PENDING_ACTIVATION); } catch (e) {}
	return stat(Z2K_PENDING_ACTIVATION) == null;
}
function build_status(manifest, checkedAt, activeZ2KManifest) {
	let listed = asset_registry_list(null); if (!listed.ok) return listed;
	let activeZ2KPaths = null;
	if (object(activeZ2KManifest) && object(activeZ2KManifest.files_sha256)) {
		activeZ2KPaths = {};
		for (let path in keys(activeZ2KManifest.files_sha256)) activeZ2KPaths[path] = true;
	}
	let rows = [], installed = [], seen = {};
	for (let i = 0; i < length(manifest.bundles); i++) {
		let bundle = manifest.bundles[i], sourceValue = source(manifest, bundle.sourceId), items = bundle.assets || [];
		for (let j = 0; j < length(items); j++) {
			let item = items[j];
			// The package manifest is a bootstrap inventory, not the active Z2K
			// membership. Once a valid checked target exists, do not project a
			// historical package-only asset that the target intentionally removed.
			if (bundle.sourceId == 'z2k-resources' && activeZ2KPaths != null && !activeZ2KPaths[item.sourcePath]) continue;
			let row = row_for({ ...item, sourceId: bundle.sourceId, sourceCommit: bundle.sourceCommit }, listed.assets);
			push(rows, row);
			if (row.path != null) { row.provenance = sourceValue ? { source: sourceValue.label, repository: sourceValue.repository, commit: bundle.sourceCommit, sourcePath: item.sourcePath } : null; push(installed, row); }
			seen[item.id] = true;
		}
	}
	for (let i = 0; i < length(listed.assets); i++) if (!seen[listed.assets[i].id]) { let asset = listed.assets[i], row = { id: asset.id, type: asset.type, name: asset.name, path: asset.path, ownership: asset.ownership, packageBaseline: asset.ownership == 'package', revision: asset.revision, contentSha256: asset.contentSha256, byteSize: asset.byteSize, lastChecked: asset.lastChecked || null, lastUpdated: asset.lastUpdated || null, references: asset.references || [], state: asset.validation && asset.validation.status == 'passed' ? 'current' : 'attention', status: state_label(asset.validation && asset.validation.status == 'passed' ? 'current' : 'attention'), provenance: asset.provenance || null, safeToUpdate: asset.ownership != 'package' }; push(installed, row); }
	let updates = [], byType = {}, consumers = {};
	for (let i = 0; i < length(rows); i++) if (rows[i].state == 'update' || rows[i].state == 'missing') { push(updates, rows[i]); byType[rows[i].type] = (byType[rows[i].type] || 0) + 1; let consumer = rows[i].compatibility.consumer || 'не указано'; consumers[consumer] = (consumers[consumer] || 0) + 1; }
	return { ok: true, schema: 1, checkedAt: checkedAt || null, manifest: { bundleId: manifest.bundleId, version: manifest.version, generatedAt: manifest.generatedAt }, sources: source_rows(manifest, rows), installed: installed, updates: updates, summary: { installed: length(installed), updates: length(updates), byType: byType, consumers: consumers }, autoCheck: { enabled: false, autoInstall: false, mode: 'manifest-only' } };
}
function make_stage_root() { try { mkdir(STAGE_PARENT); } catch (e) {} let value = command('mktemp -d ' + shell_quote(STAGE_PARENT + '/stage.XXXXXX')); let root = trim(value.out); return value.rc == 0 && index(root, STAGE_PARENT + '/') == 0 ? root : null; }
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
	sort(rows); return digest_text(join('\n', rows), 'z2m-z2k-fingerprint');
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
function z2k_classification_asset_for(map, id, typeName) {
	let found = null;
	for (let i = 0; map && type(map.files) == 'array' && i < length(map.files); i++) {
		let item = map.files[i], mappedType = item && item.type == 'lua' ? 'lua' : item && (item.type == 'bin' || item.type == 'txt') ? 'blob' : null;
		if (!object(item) || item.class != 'exact-managed' || mappedType != typeName || !string(item.sourcePath) || !runtime_target_path(item.runtimeTarget)
			|| z2k_asset_id_from_classification(item, item.sourcePath) != id) continue;
		if (found != null) return { ambiguous: true };
		found = item;
	}
	return found;
}
function z2k_receipt_header_valid(receipt) {
	return object(receipt) && receipt.schema == 'asset-activation-receipt.v1' && receipt.bundleId == 'z2k-curated-lua'
		&& string(receipt.version) && z2k_compare_versions(receipt.version, receipt.version) != null
		&& string(receipt.sourceCommit) && match(lc(receipt.sourceCommit), /^[a-f0-9]{40}$/)
		&& type(receipt.assets) == 'array' && length(receipt.assets) > 0;
}
function z2k_receipt_runtime_descriptor(id, typeName, receipts, classification) {
	let complete = null, legacy = false;
	for (let i = length(receipts || []) - 1; i >= 0; i--) {
		let receipt = receipts[i];
		if (!z2k_receipt_header_valid(receipt)) continue;
		for (let j = 0; j < length(receipt.assets); j++) {
			let recorded = receipt.assets[j];
			if (!object(recorded) || recorded.id != id) continue;
			let hasMetadata = recorded.sourceCommit != null || recorded.sourcePath != null || recorded.bundleId != null || recorded.version != null;
			if (hasMetadata) {
				if (!(string(recorded.sourceCommit) && string(recorded.sourcePath) && string(recorded.bundleId) && string(recorded.version))
					|| recorded.sourceCommit != receipt.sourceCommit || recorded.sourcePath == '' || recorded.bundleId != receipt.bundleId || recorded.version != receipt.version
					|| recorded.type != typeName || !valid_digest(recorded.sha256) || type(recorded.byteSize) != 'int' || recorded.byteSize < 1)
					return fail('EVERIFY', 'Complete historical Z2K receipt metadata is inconsistent.', { id: id });
				let item = z2k_classification_for(classification, recorded.sourcePath), mappedType = item && item.type == 'lua' ? 'lua' : item && (item.type == 'bin' || item.type == 'txt') ? 'blob' : null;
				if (item == null || item.class != 'exact-managed' || mappedType != typeName || !runtime_target_path(item.runtimeTarget)
					|| z2k_asset_id_from_classification(item, recorded.sourcePath) != id)
					return fail('EVERIFY', 'Complete historical Z2K receipt asset has no canonical runtime identity.', { id: id, sourcePath: recorded.sourcePath });
				if (complete != null && (complete.sourcePath != recorded.sourcePath || complete.type != recorded.type || complete.runtimeTarget != item.runtimeTarget))
					return fail('EVERIFY', 'Complete historical Z2K receipt metadata is contradictory.', { id: id });
				if (complete == null) complete = { id: id, type: typeName, sourcePath: recorded.sourcePath, runtimeTarget: item.runtimeTarget };
			} else {
				if (recorded.type != typeName || !valid_digest(recorded.sha256) || type(recorded.byteSize) != 'int' || recorded.byteSize < 1)
					return fail('EVERIFY', 'Legacy historical Z2K receipt asset is invalid.', { id: id });
				legacy = true;
			}
		}
	}
	if (complete != null) return { ok: true, descriptor: complete };
	if (!legacy) return fail('EVERIFY', 'Historical Z2K asset has no trustworthy receipt metadata.', { id: id });
	let item = z2k_classification_asset_for(classification, id, typeName);
	if (item == null || item.ambiguous === true) return fail('EVERIFY', 'Legacy historical Z2K asset has no unique canonical runtime mapping.', { id: id });
	return { ok: true, descriptor: { id: id, type: typeName, sourcePath: item.sourcePath, runtimeTarget: item.runtimeTarget } };
}
function z2k_read_classification_snapshot() {
	try {
		let raw = readfile('/usr/share/zapret2-manager/upstreams/z2k-integration.json'), value = raw == null ? null : json(raw);
		if (!object(value) || type(value.files) != 'array') return null;
		let digest = digest_text(raw, 'z2m-z2k-classification');
		if (!valid_digest(digest)) return null;
		for (let i = 0; type(value.historicalFiles) == 'array' && i < length(value.historicalFiles); i++) push(value.files, value.historicalFiles[i]);
		return { value: value, sha256: digest };
	} catch (e) { return null; }
}
function z2k_read_classification() {
	let snapshot = z2k_read_classification_snapshot();
	return snapshot == null ? null : snapshot.value;
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
function z2k_target_removals(listed, targetAssets, classification, canonicalPlan) {
	let targetById = {}, canonicalById = {}, removeIds = [], targets = [];
	for (let i = 0; i < length(targetAssets || []); i++) targetById[targetAssets[i].id] = true;
	for (let i = 0; object(canonicalPlan) && canonicalPlan.ok === true && i < length(canonicalPlan.removedItems || []); i++) {
		let planned = canonicalPlan.removedItems[i];
		if (object(planned) && string(planned.id) && string(planned.sourcePath)) canonicalById[planned.id] = planned.sourcePath;
	}
	for (let j = 0; j < length(listed && listed.assets || []); j++) {
		let current = listed.assets[j], provenance = current && current.provenance;
		if (!provenance || provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua' || targetById[current.id]) continue;
		let historical = provenance.sourcePath && z2k_classification_for(classification, provenance.sourcePath);
		let expectedType = historical && historical.type == 'lua' ? 'lua' : historical && (historical.type == 'bin' || historical.type == 'txt') ? 'blob' : null;
		if (historical == null || historical.class != 'exact-managed' || expectedType != current.type || !runtime_target_path(historical.runtimeTarget)
			|| type(current.revision) != 'int' || current.revision < 1 || !valid_digest(current.contentSha256) || type(current.byteSize) != 'int' || current.byteSize < 1
			|| !object(provenance) || provenance.bundleId != 'z2k-curated-lua' || !string(provenance.version) || !string(provenance.sourceCommit) || !string(provenance.sourcePath) || provenance.sourcePath != historical.sourcePath)
			return fail('EZ2K_INCOMPATIBLE', 'Z2K target removal descriptor is incomplete or inconsistent.', { id: current.id, sourcePath: provenance.sourcePath });
		if (object(canonicalPlan) && canonicalPlan.ok === true && canonicalById[current.id] != provenance.sourcePath)
			return fail('EZ2K_INCOMPATIBLE', 'Z2K canonical device plan and target removal mapping diverged.', { id: current.id, sourcePath: provenance.sourcePath });
		push(removeIds, current.id);
		push(targets, { id: current.id, type: current.type, sourcePath: provenance.sourcePath, runtimeTarget: historical.runtimeTarget,
			expectedRevision: current.revision, expectedContentSha256: current.contentSha256, expectedByteSize: current.byteSize,
			bundleId: provenance.bundleId, version: provenance.version, sourceCommit: provenance.sourceCommit });
	}
	sort(removeIds);
	sort(targets, function(a, b) { return a.id == b.id ? 0 : (a.id < b.id ? -1 : 1); });
	if (object(canonicalPlan) && canonicalPlan.ok === true && length(removeIds) != length(canonicalPlan.removedItems || []))
		return fail('EZ2K_INCOMPATIBLE', 'Z2K canonical device plan and target removal mapping diverged.', { planned: length(canonicalPlan.removedItems || []), mapped: length(removeIds) });
	return { ok: true, ids: removeIds, targets: targets };
}
function same_removal_descriptors(left, right) {
	if (type(left) != 'array' || type(right) != 'array' || length(left) != length(right)) return false;
	let fields = ['id', 'type', 'sourcePath', 'runtimeTarget', 'expectedRevision', 'expectedContentSha256', 'expectedByteSize', 'bundleId', 'version', 'sourceCommit'];
	let a = [], b = [];
	for (let i = 0; i < length(left); i++) push(a, left[i]);
	for (let i = 0; i < length(right); i++) push(b, right[i]);
	sort(a, function(x, y) { return x.id == y.id ? 0 : (x.id < y.id ? -1 : 1); });
	sort(b, function(x, y) { return x.id == y.id ? 0 : (x.id < y.id ? -1 : 1); });
	for (let i = 0; i < length(a); i++) for (let j = 0; j < length(fields); j++) if (a[i][fields[j]] != b[i][fields[j]]) return false;
	return true;
}
function z2k_resource_conflicts(listed, removeIds) {
	let conflictingAssets = [];
	for (let i = 0; i < length(removeIds || []); i++) {
		let current = registry_asset(listed && listed.assets, removeIds[i]), references = current && current.references;
		if (current != null && type(references) == 'array' && length(references)) push(conflictingAssets, { id: current.id, references: references });
	}
	if (length(conflictingAssets)) return fail('EZ2K_RESOURCE_CONFLICT', 'Эта версия Z2K не может быть применена: удаляемые ресурсы используются другими компонентами.', { conflictingAssets: conflictingAssets });
	return { ok: true };
}
function same_id_set(left, right) {
	if (length(left || []) != length(right || [])) return false;
	let seen = {};
	for (let i = 0; i < length(left || []); i++) seen[left[i]] = true;
	for (let i = 0; i < length(right || []); i++) if (!seen[right[i]]) return false;
	return true;
}
function z2k_runtime_spec(target, listed, classification, root) {
	let lines = [], targetById = {};
	for (let i = 0; i < length(target.assets || []); i++) {
		let item = target.assets[i], found = registry_asset(listed.assets, item.id), runtimePath = runtime_target_path(item.runtimeTarget);
		if (found == null || !runtime_source_safe(found.path) || runtimePath == null || found.contentSha256 != item.sha256 || found.byteSize < 1) return fail('EVERIFY', 'Registry target cannot be materialized into the runtime.', { id: item.id, runtimeTarget: item.runtimeTarget || null });
		targetById[item.id] = true;
		let registryType = z2k_registry_asset_type(item);
		if (registryType == null) return fail('EVERIFY', 'Z2K target has no Registry asset type.', { id: item.id });
		push(lines, 'ASSET|' + item.id + '|' + registryType + '|' + found.path + '|' + item.runtimeTarget + '|' + (item.sha256 || item.contentSha256) + '|' + found.byteSize);
	}
	for (let i = 0; i < length(target.removeTargets || []); i++) {
		let removal = target.removeTargets[i], id = removal.id, runtimeTarget = removal.runtimeTarget;
		if (!object(removal) || !string(id) || (removal.type != 'lua' && removal.type != 'blob') || runtime_target_path(runtimeTarget) == null) return fail('EVERIFY', 'Registry removal target has no safe runtime mapping.', { id: id });
		push(lines, 'REMOVE|' + id + '|' + removal.type + '||' + runtimeTarget + '||');
	}
	if (!length(lines)) return fail('EINPUT', 'Z2K target has no runtime assets to activate.');
	let spec = root + '/runtime-activation.tsv';
	try { writefile(spec, join('\n', lines) + '\n'); } catch (e) { return fail('EWRITE', 'Runtime activation spec could not be written.'); }
	return { ok: true, path: spec, assets: length(target.assets || []), removed: length(target.removeIds || []) };
}
function z2k_runtime_restart(stage) {
	let operationStage = string(stage) && length(stage) ? stage : 'activation';
	let before = z2k_runtime_observe(), previousProcesses = z2k_runtime_processes(before && before.pids);
	let restarted = command('sh /etc/init.d/zapret2 restart');
	if (restarted.rc != 0) return fail('ERUNTIME', 'Zapret2 service restart failed.', { stage: operationStage, output: restarted.out });
	let configured = read_var('NFQWS2_ENABLE');
	let readiness = z2k_runtime_readiness({
		stage: operationStage,
		expectedEnabled: configured != '0',
		configValue: configured,
		now: z2k_runtime_monotonic_ms,
		wait: function() { command('sleep 1'); },
		observe: z2k_runtime_observe
	});
	readiness.restart = { rc: restarted.rc, output: trim(restarted.out) };
	readiness.previousProcesses = previousProcesses;
	if (!readiness.ok) {
		readiness.error.restart = readiness.restart;
		return readiness;
	}
	let status = z2k_runtime_status_postflight();
	readiness.status = status;
	if (!status.ok) return fail('ERUNTIME', 'Zapret2 status postflight failed after Z2K ' + operationStage + '.', {
		stage: operationStage, reason: 'status-postflight-failed', restart: readiness.restart,
		readiness: readiness.readiness, status: status
	});
	readiness.configValue = configured;
	readiness.activeConfigHash = config_sha256();
	return readiness;
}
function z2k_runtime_postflight(target, diagnostics, listed) {
	let matched = 0;
	for (let i = 0; i < length(target.assets || []); i++) {
		let item = target.assets[i], registered = registry_asset(listed && listed.assets, item.id), expectedSize = registered && registered.byteSize,
			path = runtime_target_path(item.runtimeTarget), value = path && regular(path) ? sha256(path) : null, size = path && regular(path) ? stat(path).size : 0;
		if (path == null || registered == null || type(expectedSize) != 'int' || expectedSize < 1 || value != item.sha256 || size != expectedSize) return fail('EVERIFY', 'Runtime bytes do not match the selected Z2K target.', { id: item.id, runtimeTarget: item.runtimeTarget || null, expectedSha256: item.sha256, actualSha256: value, expectedSize: expectedSize, actualSize: size });
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
function z2k_process_starttime(pid) {
	if (type(pid) != 'int' || pid < 1) return null;
	let raw = readfile('/proc/' + pid + '/stat');
	if (!string(raw)) return null;
	let close = rindex(raw, ')'); if (close < 0) return null;
	let fields = split(trim(substr(raw, close + 1)), ' ');
	return length(fields) > 20 && match(fields[19], /^[0-9]+$/) ? fields[19] : null;
}
function z2k_runtime_processes(pids) {
	let result = [];
	for (let i = 0; i < length(pids || []); i++) {
		let starttime = z2k_process_starttime(pids[i]);
		if (starttime != null) push(result, { pid: pids[i], starttime: starttime });
	}
	return result;
}
function z2k_runtime_evidence(snapshot, readiness, activation) {
	if (!object(snapshot) || !array(snapshot.runtimeAssets)) return fail('EINPUT', 'runtime snapshot is invalid');
	let hashes = {}, pids = object(readiness) && array(readiness.pids) ? readiness.pids : [], pid = length(pids) ? pids[0] : null, starttime = z2k_process_starttime(pid), configHash = object(readiness) && readiness.activeConfigHash || config_sha256();
	for (let i = 0; i < length(snapshot.runtimeAssets); i++) {
		let item = snapshot.runtimeAssets[i], path = runtime_target_path(item.runtimeTarget), actual = path && regular(path) ? sha256(path) : null;
		if (actual == null) return fail('EVERIFY', 'runtime evidence is missing', { id: item.id });
		hashes[item.id] = actual;
	}
	if (configHash == null) return fail('EVERIFY', 'active config hash evidence is missing');
	if (pid == null || starttime == null) return fail('EVERIFY', 'process generation evidence is missing');
	let currentProcess = { pid: pid, starttime: starttime }, previousProcesses = object(readiness) && array(readiness.previousProcesses) ? readiness.previousProcesses : [];
	if (activation) {
		for (let i = 0; i < length(previousProcesses); i++) if (previousProcesses[i].pid == currentProcess.pid && previousProcesses[i].starttime == currentProcess.starttime)
			return fail('EVERIFY', 'activation process identity was not created by this activation', { pid: pid, starttime: starttime });
	}
	let runtimeIdentity = [];
	for (let i = 0; i < length(snapshot.runtimeAssets); i++) push(runtimeIdentity, snapshot.runtimeAssets[i].id + '=' + hashes[snapshot.runtimeAssets[i].id]);
	let generation = digest_text(snapshot.snapshotId + '|' + snapshot.compositionSnapshotId + '|' + configHash + '|' + join(runtimeIdentity, '|') + '|' + pid + '|' + starttime, 'z2m-z2k-generation');
	if (generation == null) return fail('EVERIFY', 'process generation evidence could not be generated');
	let luaInitIds = [];
	for (let i = 0; i < length(snapshot.luaInit || []); i++) push(luaInitIds, snapshot.luaInit[i].id);
	return { snapshotId: snapshot.snapshotId, membershipDigest: snapshot.membershipDigest, queueReady: object(readiness) && readiness.ok === true, createdForActivation: activation === true,
		pid: pid, processStarttime: starttime, processGeneration: generation, configHash: configHash, activeConfigHash: configHash, runtimeHashes: hashes,
		previousProcesses: previousProcesses,
		luaInitIds: luaInitIds, verified: true };
}
function z2k_materialized_evidence(snapshot, target) {
	let files = {}, removalsPresent = {};
	for (let i = 0; i < length(snapshot.runtimeAssets || []); i++) {
		let item = snapshot.runtimeAssets[i], path = runtime_target_path(item.runtimeTarget), present = path != null && regular(path);
		files[item.id] = { exists: present, present: present, sha256: present ? sha256(path) : null, byteSize: present ? stat(path).size : null, owner: item.owner };
	}
	for (let i = 0; i < length(target && target.removeTargets || []); i++) {
		let item = target.removeTargets[i], path = runtime_target_path(item.runtimeTarget);
		removalsPresent[item.id] = path != null && regular(path);
	}
	return { snapshotId: snapshot.snapshotId, membershipDigest: snapshot.membershipDigest, files: files, removalsPresent: removalsPresent, configHash: config_sha256() };
}
function z2k_runtime_activate(target, listed, classification, root, diagnostics) {
	let inputPath = '/tmp/z2m-runtime-candidate.' + time() + '.json', input = { preparedTarget: target, context: { observedRegistryRevision: listed.revision, phase: 'post-commit', committedAssetRevision: listed.revision } };
	try { writefile(inputPath, sprintf('%J', input) + '\n'); } catch (e) { return fail('EWRITE', 'Runtime composition input could not be persisted.'); }
	let activated = command('sh ' + shell_quote(RUNTIME_SYNC) + ' --activate-resolved candidate-materialize ' + shell_quote(inputPath));
	try { unlink(inputPath); } catch (e) {}
	if (activated.rc != 0) return fail('ERUNTIME', 'Canonical runtime composition could not be materialized into the active runtime.', { output: activated.out, input: inputPath, activated: false });
	let restarted = z2k_runtime_restart('activation');
	if (!restarted.ok) return { ok: false, error: restarted.error, activated: true, restart: restarted, postflight: { verified: false, reason: 'restart-failed' } };
	let postflight = z2k_runtime_postflight(target, diagnostics, listed);
	if (!postflight.ok) return { ok: false, error: postflight.error, activated: true, restart: restarted, postflight: postflight };
	return { ok: true, activated: true, restart: restarted, postflight: postflight, input: inputPath };
}
function z2k_runtime_rollback() {
	let restored = command('sh ' + shell_quote(RUNTIME_SYNC) + ' --rollback-registry');
	if (restored.rc != 0) return fail('EROLLBACK', 'Active runtime rollback failed.', { output: restored.out });
	let restarted = z2k_runtime_restart('rollback');
	if (!restarted.ok) return restarted;
	return { ok: true, restored: true, restart: restarted };
}
export const z2k_runtime_confirmed_target = function(listed, classification, authority) {
	let active = [], activeById = {}, historical = {}, receipts = listed.activationReceipts || [];
	for (let i = 0; i < length(listed.assets || []); i++) {
		let asset = listed.assets[i], provenance = asset && asset.provenance;
		if (!provenance || provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua') continue;
		let item = z2k_classification_for(classification, provenance.sourcePath);
		if (item == null || item.class != 'exact-managed' || !runtime_target_path(item.runtimeTarget)) return fail('EVERIFY', 'Confirmed Z2K asset has no safe runtime mapping.', { id: asset.id });
		push(active, { id: asset.id, type: asset.type, sourcePath: provenance.sourcePath, runtimeTarget: item.runtimeTarget, sha256: asset.contentSha256, byteSize: asset.byteSize });
		activeById[asset.id] = true;
	}
	for (let i = 0; i < length(receipts); i++) {
		let receipt = receipts[i];
		if (!z2k_receipt_header_valid(receipt)) continue;
		for (let j = 0; j < length(receipt.assets); j++) {
			let recorded = receipt.assets[j];
			if (object(recorded) && string(recorded.id) && !historical[recorded.id]) historical[recorded.id] = recorded;
		}
	}
	let removeTargets = [];
	for (let id in historical) {
		if (activeById[id]) continue;
		let recorded = historical[id], descriptor = z2k_receipt_runtime_descriptor(id, recorded.type, receipts, classification);
		if (!descriptor.ok) return descriptor;
		push(removeTargets, descriptor.descriptor);
	}
	sort(active, function(a, b) { return a.id == b.id ? 0 : (a.id < b.id ? -1 : 1); });
	sort(removeTargets, function(a, b) { return a.id == b.id ? 0 : (a.id < b.id ? -1 : 1); });
	return { ok: true, target: { targetVersion: authority.value, operation: 'materialize', assets: active, removeIds: [], removeTargets: removeTargets } };
};
export const z2k_runtime_materialize_confirmed = function() {
	let listed = asset_registry_list(null);
	if (!listed.ok) return listed;
	let authority = z2k_registry_installed_release(listed);
	if (!authority || authority.confidence != 'confirmed' || !authority.value)
		return { ok: true, state: 'blocked-unknown-authority', staticReady: true, lifecycleReady: false,
			skipped: true, reason: 'no-confirmed-z2k-release' };
	let resolved = resolveInstalled({ registry: listed });
	if (!resolved.ok) return resolved;
	if (resolved.lifecycleState == 'V1_VERIFIED_MEMBERSHIP' || resolved.compositionStatus != 'canonical')
		return fail('RECONCILIATION_REQUIRED', 'Canonical Z2K composition is required before runtime materialization.');
	let inputPath = '/tmp/z2m-runtime-installed.' + time() + '.json';
	try { writefile(inputPath, '{}\n'); } catch (e) { return fail('EWRITE', 'Installed runtime composition input could not be persisted.'); }
	let activated = command('sh ' + shell_quote(RUNTIME_SYNC) + ' --activate-resolved installed-materialize ' + shell_quote(inputPath));
	try { unlink(inputPath); } catch (e) {}
	if (activated.rc != 0) return fail('ERUNTIME', 'Confirmed Z2K runtime materialization failed.', { output: activated.out, snapshotId: resolved.snapshotId });
	return { ok: true, state: 'dynamic-ready', staticReady: true, lifecycleReady: true, skipped: false,
		version: resolved.lifecycleIdentity && resolved.lifecycleIdentity.release || null, snapshotId: resolved.snapshotId,
		assets: length(resolved.runtimeAssets || []), removed: 0 };
};
function z2k_rollback_after_runtime_failure(selected, applied, diagnostics, runtimeActivated) {
	let pending = z2k_pending_load(), journal = pending == null || z2k_pending_write(pending, 'ROLLING_BACK');
	let runtimeRollback = runtimeActivated ? z2k_runtime_rollback() : { ok: true, skipped: true };
	let registryRollback = asset_registry_rollback_bundle({ bundleId: selected.id, expectedRevision: applied.committedAssetRevision || applied.revision });
	let okResult = journal && runtimeRollback.ok && registryRollback.ok;
	if (okResult && pending != null) okResult = z2k_pending_write(pending, 'ROLLED_BACK') && z2k_pending_clear();
	return { ok: okResult, runtime: runtimeRollback, registry: registryRollback, journal: journal };
}
function z2k_pending_identity_valid(pending) {
	if (!object(pending) || !string(pending.candidateSnapshotId) || !string(pending.membershipDigest)
		|| !string(pending.targetVersion) || !string(pending.targetCommit) || !string(pending.planToken)
		|| type(pending.baseRegistryRevision) != 'int' || !object(pending.rollbackIdentity)
		|| type(pending.rollbackIdentity.registryRevision) != 'int'
		|| pending.rollbackIdentity.registryRevision != pending.baseRegistryRevision
		|| pending.rollbackIdentity.runtimeSnapshot != '/etc/zapret2-manager/runtime-assets.snapshot') return false;
	// PREPARED is written before the first irreversible Registry commit, so it
	// intentionally has no committed revision and can be safely abandoned on
	// recovery. Every later phase must carry the exact N+1 bundle revision.
	if (pending.phase == 'PREPARED') return pending.committedAssetRevision == null;
	return type(pending.committedAssetRevision) == 'int'
		&& pending.committedAssetRevision > pending.baseRegistryRevision;
}
function z2k_finalized_pending_matches(pending, listed) {
	if (!z2k_pending_identity_valid(pending) || !object(listed) || listed.ok !== true) return false;
	let state = z2k_registry_receipt_state(listed), receipt = state && state.receipt;
	return state && state.state == 'confirmed' && object(receipt)
		&& receipt.schema == 'asset-activation-receipt.v2' && receipt.bundleId == 'z2k-curated-lua'
		&& receipt.version == pending.targetVersion && receipt.sourceCommit == pending.targetCommit
		&& receipt.candidateSnapshotId == pending.candidateSnapshotId && receipt.membershipDigest == pending.membershipDigest
		&& receipt.committedRegistryRevision == pending.committedAssetRevision
		&& type(receipt.installedAuthorityRevision) == 'int'
		&& receipt.installedAuthorityRevision <= listed.revision;
}
export const resource_center_recover_pending = function() {
	let marker = stat(Z2K_PENDING_ACTIVATION);
	if (marker == null) return { ok: true, recovered: false, state: 'none' };
	let pending = z2k_pending_load();
	if (pending == null) return fail('ERECOVERY_REQUIRED', 'Durable Z2K activation evidence is unreadable; refusing to infer recovery from runtime files.');
	if (!z2k_pending_identity_valid(pending)) return fail('ERECOVERY_REQUIRED', 'Durable Z2K activation evidence is incomplete; refusing recovery.');
	if (pending.phase == 'PREPARED') return z2k_pending_clear() ? { ok: true, recovered: true, state: 'prepared-cleared' } : fail('ERECOVERY_REQUIRED', 'Prepared Z2K activation evidence could not be closed.');
	if (pending.phase == 'ROLLED_BACK') return z2k_pending_clear() ? { ok: true, recovered: true, state: 'rolled-back-cleared' } : fail('ERECOVERY_REQUIRED', 'Rolled-back Z2K activation evidence could not be closed.');
	if (pending.phase == 'FINALIZED') return z2k_finalized_pending_matches(pending, asset_registry_list(null))
		&& z2k_pending_clear() ? { ok: true, recovered: true, state: 'finalized-cleared' } : fail('ERECOVERY_REQUIRED', 'Finalized Z2K activation evidence does not match the installed authority.');
	if (pending.phase != 'COMMITTED' && pending.phase != 'MATERIALIZED' && pending.phase != 'PROCESS_VERIFIED' && pending.phase != 'ROLLING_BACK') return fail('ERECOVERY_REQUIRED', 'Unknown Z2K activation phase cannot be recovered safely.', { phase: pending.phase });
	let runtimeActivated = pending.phase == 'MATERIALIZED' || pending.phase == 'PROCESS_VERIFIED' || pending.phase == 'ROLLING_BACK';
	let rollback = z2k_rollback_after_runtime_failure({ id: 'z2k-curated-lua' }, { committedAssetRevision: pending.committedAssetRevision }, { recovery: true, phase: pending.phase }, runtimeActivated);
	if (!rollback.ok) return fail('ERECOVERY_REQUIRED', 'Z2K activation recovery could not prove safe compensation.', { rollback: rollback, phase: pending.phase });
	return { ok: true, recovered: true, state: 'rolled-back', rollback: rollback };
};
function z2k_target_summary(target) {
	return target == null ? null : { targetVersion: target.targetVersion, operation: target.operation, installedVersion: target.previousVersion || null, targetCanApply: target.targetCanApply === true, targetAttentionState: target.targetAttentionState || 'unknown', targetBlockingReasons: target.targetBlockingReasons || [], targetReviewDetails: target.targetReviewDetails || [], assetCount: length(target.assets || []), removedCount: length(target.removeIds || []), preparedAt: target.preparedAt };
}
function save_prepared_target(target) {
	let state = load_check_state() || { schema: 2, latestCheck: null, preparedTarget: null };
	state.schema = 2; state.preparedTarget = target; return persist_check_state(state);
}
function consume_prepared_target(expectedState, expectedTarget) {
	let locked = command('mkdir ' + shell_quote(LIFECYCLE_LOCK));
	if (locked.rc != 0) return fail('EBUSY', 'Другая Z2K lifecycle-операция уже потребляет подготовленный target.');
	try {
		let current = load_check_state(), target = z2k_target_from_state(current);
		if (!target || target.planToken != expectedTarget.planToken) {
			command('rmdir ' + shell_quote(LIFECYCLE_LOCK));
			return fail('ECHECK_STALE', 'Z2K prepared operation was already consumed; prepare the release again.');
		}
		let consumed = persist_check_state({ schema: 2, latestCheck: current && current.latestCheck || expectedState && expectedState.latestCheck || null, preparedTarget: null });
		if (!consumed) {
			command('rmdir ' + shell_quote(LIFECYCLE_LOCK));
			return fail('EWRITE', 'Z2K prepared operation could not be consumed; no mutation was performed.');
		}
		return { ok: true, lockHeld: true };
	} catch (e) {
		command('rmdir ' + shell_quote(LIFECYCLE_LOCK));
		return fail('EINTERNAL', 'Z2K prepared operation could not be consumed; no mutation was performed.', { detail: text(e) });
	}
}
function base64_decode(value) { if (!string(value) || length(value) > MAX_REQUEST_BYTES || !match(value, /^[A-Za-z0-9+\/=%]*$/)) return null; let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', buffer = 0, bits = 0; for (let i = 0; i < length(value); i++) { let c = substr(value, i, 1); if (c == '=') break; let n = index(alphabet, c); if (n < 0) return null; buffer = buffer * 64 + n; bits += 6; if (bits >= 8) { bits -= 8; out += chr((buffer >> bits) & 255); buffer = buffer & ((1 << bits) - 1); } } return out; }
function z2k_unknown_plan(manifest) {
	return { ok: true, status: 'unknown', updateState: 'unknown', attentionState: 'none', canApply: false, updates: [], removedItems: [], rebases: [], reviews: [], advisoryReviews: [], blockingReviews: [], blockingReasons: [], reviewDetails: [], updateItems: [], manifest: manifest || null };
}
function z2k_reconcile_after_mutation(target) {
	let state = load_check_state(), latestCheck = state && state.latestCheck, signed = latestCheck && latestCheck.signed, plan = null;
	let reusable = object(target) && valid_digest(target.manifestSha256) && object(latestCheck) && object(signed) && signed.ok === true && object(signed.manifest) && signed.manifestSha256 == target.manifestSha256;
	if (reusable) {
		try { plan = z2k_upstream_plan(signed.manifest); } catch (e) { plan = null; }
	}
	if (plan && plan.ok === true) {
		signed.status = plan.status; signed.updateState = plan.updateState; signed.attentionState = plan.attentionState; signed.canApply = plan.canApply;
		signed.updates = plan.updates; signed.rebases = plan.rebases; signed.reviews = plan.reviews; signed.advisoryReviews = plan.advisoryReviews;
		signed.blockingReviews = plan.blockingReviews; signed.blockingReasons = plan.blockingReasons; signed.reviewDetails = plan.reviewDetails; signed.updateItems = plan.updateItems;
		signed.removedItems = plan.removedItems || [];
		signed.plan = plan;
		let token = plan_token(latestCheck.checkedAt, signed.manifest); signed.planToken = token; latestCheck.planToken = token;
	} else if (object(signed)) {
		let unknown = z2k_unknown_plan(signed.manifest || null);
		signed.status = 'unknown'; signed.updateState = 'unknown'; signed.attentionState = 'none'; signed.canApply = false;
		signed.updates = []; signed.removedItems = []; signed.rebases = []; signed.reviews = []; signed.advisoryReviews = []; signed.blockingReviews = []; signed.blockingReasons = []; signed.reviewDetails = []; signed.updateItems = [];
		signed.plan = unknown; signed.planToken = null; latestCheck.planToken = null;
	} else latestCheck = null;
	let saved = persist_check_state({ schema: 2, latestCheck: latestCheck, preparedTarget: null });
	return { ok: saved, state: plan && plan.ok === true ? plan.updateState : 'unknown', reusedManifest: reusable && plan && plan.ok === true, preparedTarget: null };
}
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
	let classificationSnapshot = z2k_read_classification_snapshot(), classification = classificationSnapshot && classificationSnapshot.value;
	if (classificationSnapshot == null) return fail('EZ2K_INCOMPATIBLE', 'Z2K classification mapping is unavailable or invalid.');
	let membership = z2k_target_membership_compatible(listed, resolved.assets, classification); if (!membership.ok) return membership;
	let targetGate = z2k_target_gate(resolved.manifest); if (!targetGate.ok) return targetGate;
	let targetPlan = targetGate.plan; if (!object(targetPlan) || targetPlan.ok !== true) return fail('EZ2K_INCOMPATIBLE', 'Не удалось построить canonical Z2K target plan.');
	let removals = z2k_target_removals(listed, resolved.assets, classification, targetPlan); if (!removals.ok) return removals;
	let conflicts = z2k_resource_conflicts(listed, removals.ids); if (!conflicts.ok) return conflicts;
	let authority = z2k_registry_installed_release(listed), installed = authority && authority.value || null;
	let legacyReconciliation = z2k_v1_reconciliation_check(listed, resolved);
	if (!legacyReconciliation.ok) return legacyReconciliation;
	let operation = legacyReconciliation.required ? 'reinstall' : z2k_target_operation(version, installed), localFingerprint = z2k_local_fingerprint(resolved.assets, listed, removals.ids);
	if (operation == null || localFingerprint == null) return fail('EIO', 'Не удалось построить Z2K target snapshot.');
	let sizedTarget = z2k_target_assets_with_sizes(resolved.assets, listed, resolved.commitSha);
	if (!sizedTarget.ok) return sizedTarget;
	let canonicalAssets = z2k_canonical_target_assets(resolved.version, resolved.commitSha, resolved.manifestSha256, classificationSnapshot.sha256, sizedTarget.assets);
	if (canonicalAssets == null) return fail('EZ2K_INCOMPATIBLE', 'Не удалось построить canonical runtime composition для выбранного release.');
	let preparedAt = time(), target = { schema: 2, targetSchema: 'z2k-target-v2', targetVersion: resolved.version, targetCommitSha: resolved.commitSha, targetCommit: resolved.commitSha, manifestSha256: resolved.manifestSha256, localFingerprint: localFingerprint, classificationSha256: classificationSnapshot.sha256, operation: operation, previousVersion: installed, baseRegistryRevision: listed.revision, targetCanApply: targetGate.canApply === true, targetAttentionState: targetGate.attentionState || 'none', targetBlockingReasons: targetGate.blockingReasons || [], targetReviewDetails: targetGate.reviewDetails || [], preparedAt: preparedAt, removeIds: removals.ids, removeTargets: removals.targets, assets: canonicalAssets };
	target.planToken = z2k_target_token(target, preparedAt);
	if (target.planToken == null) return fail('EIO', 'Не удалось построить Z2K target snapshot.');
	let candidate = resolveCandidate(target, { observedRegistryRevision: listed.revision });
	if (!candidate.ok) return candidate;
	target.membershipDigest = candidate.membershipDigest; target.candidateSnapshotId = candidate.snapshotId; target.compositionSnapshotId = candidate.compositionSnapshotId;
	if (target.planToken == null || !save_prepared_target(target)) return fail('EIO', 'Не удалось сохранить Z2K target snapshot.');
	return { ok: true, target: z2k_target_summary(target), planToken: target.planToken, diagnostics: resolved.diagnostics || null };
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
	listed = asset_registry_list(null);
	if (!listed.ok || type(target.baseRegistryRevision) != 'int') return fail('ECHECK_STALE', 'Z2K prepared operation has no authoritative Registry baseline; prepare the release again.');
	let candidate = resolveCandidate(target, { observedRegistryRevision: listed.revision });
	if (!candidate.ok) return candidate;
	let fingerprint = z2k_local_fingerprint(target.assets, listed, target.removeIds);
	if (fingerprint == null || fingerprint != target.localFingerprint) return fail('ECHECK_STALE', 'Z2K local resources changed after preparation; prepare the release again.');
	let classificationSnapshot = z2k_read_classification_snapshot(), classification = classificationSnapshot && classificationSnapshot.value;
	if (classificationSnapshot == null || classificationSnapshot.sha256 != target.classificationSha256) return fail('ECHECK_STALE', 'Z2K runtime classification changed after preparation; prepare the release again.');
	let membership = z2k_target_membership_compatible(listed, target.assets, classification);
	if (!membership.ok) return membership;
	let removals = z2k_target_removals(listed, target.assets, classification);
	if (!removals.ok || !same_id_set(removals.ids, target.removeIds) || !same_removal_descriptors(removals.targets, target.removeTargets)) return fail('ECHECK_STALE', 'Z2K managed membership or removal mapping changed after preparation; prepare the release again.');
	let consumed = consume_prepared_target(state, target);
	if (!consumed.ok) return consumed;
	let root = null, paths = [], guard = null, staged = [], diagnostics = { pathUsed: diagPathUsed, targetVersion: target.targetVersion, operation: target.operation, planned: length(target.assets), removePlanned: length(target.removeIds || []), downloaded: 0, verified: 0, staged: 0, applied: 0, removed: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
	try {
		guard = z2k_runtime_guard_acquire();
		if (!guard.ok) return z2k_runtime_guard_finish(guard, root, paths, guard);
		root = make_stage_root();
		if (root == null) return z2k_runtime_guard_finish(guard, root, paths, fail('ETARGET', 'resource staging directory is unavailable'));
	for (let i = 0; i < length(target.assets); i++) {
		let item = target.assets[i], before = registry_asset(listed.assets, item.id), policy = z2k_target_policy(listed, item);
		push(diagnostics.targetAssets, { sourcePath: item.sourcePath, assetId: item.id, installedShaBefore: before && before.contentSha256 || null, targetSha: item.sha256, result: 'pending' });
		if (!z2k_target_asset_valid(item) && !z2k_canonical_target_asset_valid(item)) { diagnostics.targetAssets[i].result = 'invalid-target'; return z2k_runtime_guard_finish(guard, root, paths, fail('EVERIFY', 'prepared Z2K target asset is invalid.', { sourcePath: item && item.sourcePath, diagnostics: diagnostics })); }
		if (!policy.ok) { diagnostics.targetAssets[i].result = 'protected'; policy.diagnostics = diagnostics; return z2k_runtime_guard_finish(guard, root, paths, policy); }
		let path = root + '/' + i + '.asset', url = 'https://raw.githubusercontent.com/necronicle/z2k/' + target.targetCommitSha + '/' + item.sourcePath, fetched = command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(url));
		if (fetched.rc != 0 || !regular(path)) { diagnostics.targetAssets[i].result = 'fetch-failed'; return z2k_runtime_guard_finish(guard, root, paths, fail('EUNAVAILABLE', 'resource source is unavailable.', { sourcePath: item.sourcePath, diagnostics: diagnostics })); }
		diagnostics.downloaded++; let actual = sha256(path);
		if (actual != lc(item.sha256)) { diagnostics.targetAssets[i].result = 'sha-mismatch'; return z2k_runtime_guard_finish(guard, root, paths, fail('EVERIFY', 'fetched bytes SHA does not match prepared target.', { sourcePath: item.sourcePath, expectedSha256: item.sha256, actualSha256: actual, diagnostics: diagnostics })); }
		diagnostics.verified++; let gate = z2k_candidate_gate(item.sourcePath, path, item.sha256);
		if (!gate.ok) { diagnostics.targetAssets[i].result = gate.error && gate.error.code == 'ESTALE' ? 'stale' : 'incompatible'; return z2k_runtime_guard_finish(guard, root, paths, fail(gate.error && gate.error.code || 'EZ2K_REVIEW_REQUIRED', 'staged Z2K candidate requires review.', { sourcePath: item.sourcePath, diagnostics: diagnostics })); }
		push(paths, path); push(staged, { type: z2k_registry_asset_type(item), id: item.id, name: item.name, stagedPath: path, sha256: item.sha256 || item.contentSha256, byteSize: stat(path).size, expectedRevision: before && before.revision || null, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: target.targetCommitSha || target.targetCommit, sourcePath: item.sourcePath, bundleId: selected.id, version: target.targetVersion } });
		diagnostics.targetAssets[i].result = 'staged';
	}
	diagnostics.staged = length(staged);
	let beforeCommit = asset_registry_list(null), cas = beforeCommit.ok ? runtime_composition_candidate_cas(candidate, beforeCommit.revision, 'pre-commit', null) : fail('ESTALE', 'Z2K Registry could not be re-read before commit.');
	if (!cas.ok) return z2k_runtime_guard_finish(guard, root, paths, cas);
	let priorAuthority = z2k_registry_receipt_state(listed);
	// The /tmp/z2m-resource-update/jobs worker file is only a progress mirror;
	// this durable pending-activation record is the recovery authority.
	let pending = { schema: 1, candidateSnapshotId: candidate.snapshotId, compositionSnapshotId: candidate.compositionSnapshotId, membershipDigest: candidate.membershipDigest,
		baseRegistryRevision: target.baseRegistryRevision, targetVersion: target.targetVersion, targetCommit: target.targetCommitSha || target.targetCommit,
		planToken: target.planToken, rollbackIdentity: { registryRevision: listed.revision, receipt: priorAuthority.receipt || null, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' }, phase: 'PREPARED' };
	if (!z2k_pending_write(pending, 'PREPARED')) return z2k_runtime_guard_finish(guard, root, paths, fail('EWRITE', 'Durable pending activation evidence could not be persisted.'));
	let applied = asset_registry_apply_bundle({ bundleId: selected.id, version: target.targetVersion, source: 'necronicle/z2k', sourceCommit: target.targetCommitSha || target.targetCommit, expectedRegistryRevision: target.baseRegistryRevision, assets: staged, removeIds: target.removeIds, removals: target.removeTargets });
	if (!applied.ok) return z2k_runtime_guard_finish(guard, root, paths, applied);
	diagnostics.applied = applied.updated || length(staged);
	diagnostics.removed = applied.removed || 0;
	let committedAssetRevision = applied.committedAssetRevision || applied.revision;
	pending.committedAssetRevision = committedAssetRevision;
	if (!z2k_pending_write(pending, 'COMMITTED')) return z2k_runtime_guard_finish(guard, root, paths, fail('EWRITE', 'Committed activation evidence could not be persisted.'));
	let after = asset_registry_list(null), committedCandidate = after.ok ? resolveCandidate(target, { observedRegistryRevision: after.revision, phase: 'post-commit', committedAssetRevision: committedAssetRevision }) : fail('ESTALE', 'Z2K Registry could not be read after bundle commit.');
	if (!committedCandidate.ok) {
		let rollback = asset_registry_rollback_bundle({ bundleId: selected.id, expectedRevision: committedAssetRevision });
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'ESTALE' : 'EROLLBACK', rollback.ok ? 'Z2K Registry changed during candidate commit.' : 'Z2K Registry changed and rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
	}
	let registryPostflight = z2k_target_postflight(after, target, diagnostics);
	diagnostics.registryPostflight = registryPostflight;
	if (!registryPostflight.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, false);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K Registry activation was rolled back after postflight verification failed.' : 'Z2K Registry activation failed and rollback could not be completed.', { postflight: registryPostflight.error, rollback: rollback, diagnostics: diagnostics }));
	}
	let runtimeSpecPath = root + '/runtime-activation.tsv';
	push(paths, runtimeSpecPath);
	let runtime = z2k_runtime_activate(target, after, classification, root, diagnostics);
	diagnostics.runtimePostflight = runtime.postflight || { verified: false, reason: runtime.error && runtime.error.code || 'runtime-activation-failed' };
	if (!runtime.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, runtime.activated === true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'ERUNTIME' : 'EROLLBACK', rollback.ok ? 'Z2K runtime activation was rolled back; Registry state was restored.' : 'Z2K runtime activation failed and rollback could not be completed.', { runtime: runtime.error || null, rollback: rollback, diagnostics: diagnostics }));
	}
	if (!z2k_pending_write(pending, 'MATERIALIZED')) return z2k_runtime_guard_finish(guard, root, paths, fail('EWRITE', 'Materialized activation evidence could not be persisted.'));
	let materialized = verifyMaterialized(committedCandidate, z2k_materialized_evidence(committedCandidate, target));
	diagnostics.materializedVerification = materialized;
	if (!materialized.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K materialization verification failed and was rolled back.' : 'Z2K materialization verification failed and rollback could not be completed.', { materialized: materialized.error, rollback: rollback, diagnostics: diagnostics }));
	}
	let activationEvidence = z2k_runtime_evidence(committedCandidate, runtime.restart, true), activationProof = activationEvidence.ok ? verifyActivationProcess(committedCandidate, activationEvidence) : activationEvidence;
	diagnostics.activationVerification = activationProof;
	if (!activationProof.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K activation process verification failed and was rolled back.' : 'Z2K activation process verification failed and rollback could not be completed.', { activation: activationProof.error, rollback: rollback, diagnostics: diagnostics }));
	}
	if (!z2k_pending_write(pending, 'PROCESS_VERIFIED')) return z2k_runtime_guard_finish(guard, root, paths, fail('EWRITE', 'Process verification evidence could not be persisted.'));
	let z2kMembership = [];
	for (let i = 0; i < length(committedCandidate.runtimeAssets || []); i++) if (committedCandidate.runtimeAssets[i].type == 'lifecycle-managed') push(z2kMembership, committedCandidate.runtimeAssets[i]);
	let finalized = asset_registry_finalize_activation({ bundleId: selected.id, version: target.targetVersion, source: 'necronicle/z2k', sourceCommit: target.targetCommitSha || target.targetCommit,
		manifestSha256: target.manifestSha256, classificationSha256: target.classificationSha256, candidateSnapshotId: target.candidateSnapshotId || committedCandidate.snapshotId,
		membershipDigest: target.membershipDigest || committedCandidate.membershipDigest, baseRegistryRevision: target.baseRegistryRevision,
		committedAssetRevision: committedAssetRevision, z2kMembership: z2kMembership, activationEvidence: activationEvidence });
	if (!finalized.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'ESTALE' : 'EROLLBACK', rollback.ok ? 'Z2K activation finalization lost its Registry CAS.' : 'Z2K activation finalization failed and rollback could not be completed.', { finalize: finalized.error, rollback: rollback, diagnostics: diagnostics }));
	}
	if (!z2k_pending_write(pending, 'FINALIZED') || !z2k_pending_clear()) return z2k_runtime_guard_finish(guard, root, paths, fail('EWRITE', 'Z2K activation finalized but durable evidence could not be closed.', { mutationCompleted: true, diagnostics: diagnostics }));
	let reconciled = z2k_reconcile_after_mutation(target);
	diagnostics.postMutationCheckState = reconciled;
	if (!reconciled.ok) return z2k_runtime_guard_finish(guard, root, paths, fail('EWRITE', 'Z2K update completed, but its persisted status could not be reconciled; check the state before retrying.', { mutationCompleted: true, diagnostics: diagnostics }));
	return z2k_runtime_guard_finish(guard, root, paths, { ok: true, bundleId: selected.id, targetVersion: target.targetVersion, operation: target.operation, updated: diagnostics.applied, revision: finalized.installedAuthorityRevision, committedAssetRevision: committedAssetRevision, rollbackAvailable: true, diagnostics: diagnostics, planToken: null });
	} catch (e) {
		return z2k_runtime_guard_finish(guard, root, paths, fail('EINTERNAL', 'Z2K lifecycle failed while the intentional runtime guard was active.', { detail: text(e), diagnostics: diagnostics }));
	}
}
export const resource_center_status = function () {
	// STALE-PROJECTION REGRESSION GUARD (see tests/product/z2k-candidate-compatibility.test.mjs):
	// This returns the PERSISTED CHECK_STATE (/etc/zapret2-manager/resource-source-check.json),
	// NOT a live fetch. After a sidecar migration or manifest change, it may still show
	// the previous status (e.g., rebase-required) until an explicit resources_check
	// An explicit check refreshes CHECK_STATE via save_check_state(). Do not make
	// this live — that would add network I/O to every status poll.
	let loaded = load_manifest(); if (!loaded.ok) return loaded;
	let persisted = load_check_state(), latestCheck = persisted && persisted.latestCheck;
	let activeZ2KManifest = latestCheck && latestCheck.signed && latestCheck.signed.ok === true ? latestCheck.signed.manifest : null;
	let answer = build_status(loaded.manifest, null, activeZ2KManifest);
	if (!answer.ok) return answer;
	let local = z2k_local_projection(loaded.manifest);
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
	let previous = load_check_state(), previousCheck = previous && previous.latestCheck;
	let activeZ2KManifest = signed.ok === true ? signed.manifest : (previousCheck && previousCheck.signed && previousCheck.signed.ok === true ? previousCheck.signed.manifest : null);
	let answer = build_status(loaded.manifest, checkedAt, activeZ2KManifest); if (!answer.ok) return answer;
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
