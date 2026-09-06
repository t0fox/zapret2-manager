'use strict';

// Resource Center coordinator. It owns source/bundle policy and staging, while
// Asset Registry remains the only writer of managed asset metadata and bytes.
import { readfile, writefile, stat, unlink, mkdir, lsdir, popen } from 'fs';
import { asset_registry_list, asset_registry_apply_bundle, asset_registry_finalize_activation, asset_registry_rollback_bundle } from './asset-registry.uc';
import { z2k_upstream_check, z2k_upstream_plan } from './z2k-upstream.uc';
import { z2k_candidate_gate } from './z2k-compat.uc';
import { z2k_resolve_version, z2k_compare_versions, z2k_asset_id_from_classification } from './z2k-versions.uc';
import { z2k_registry_installed_release, z2k_registry_receipt_state } from './z2k-installed-release.uc';
import { resolveCandidate, resolveInstalled, runtime_composition_candidate_cas, runtime_strategy_preflight, runtime_materialize_failure_rollback, verifyMaterialized, verifyActivationProcess, verifyInstalledProcess } from './runtime-composition.uc';
import { read_var, config_sha256, transaction_config_snapshot, restore_transaction_config } from './apply.uc';
import { engine_status } from './engine-manager.uc';
import * as strategy_sources from './strategy-sources.uc';
import { z2k_dependency_closure } from './z2k-dependency-closure.uc';
import { asset_registry_environment } from './asset-registry.uc';
import * as z2k_source_refresh from './strategy-source-refresh.uc';
import * as z2k_source from './strategy-source-z2k.uc';
import { z2k_compatibility_equal, z2k_compatibility_identity_valid } from './z2k-compatibility.uc';
import { catalog_refresh_rebuild } from './strategy-catalog-refresh.uc';
import { strategy_catalog_generation_read } from './strategy-catalog-generation.uc';
import { strategy_selection_get_readonly, strategy_selection_get, strategy_selection_restore } from './strategy-state.uc';
import { z2k_detect_candidate, z2k_detect_stage, z2k_detect_prepare, z2k_detect_publish_prepared, z2k_detect_restore, z2k_detect_finalize } from './z2k-detect.uc';

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
const Z2K_PENDING_ACTIVATION_TEST_PREFIX = '/tmp/z2m-z2k-detect-recovery-test-';
const Z2K_PENDING_ACTIVATION_OVERRIDE = getenv('Z2M_RESOURCE_UPDATE_PENDING_TEST_PATH');
const Z2K_PENDING_ACTIVATION = getenv('Z2M_UPDATE_SOURCE_TEST') == '1' && type(Z2K_PENDING_ACTIVATION_OVERRIDE) == 'string'
	&& substr(Z2K_PENDING_ACTIVATION_OVERRIDE, 0, length(Z2K_PENDING_ACTIVATION_TEST_PREFIX)) == Z2K_PENDING_ACTIVATION_TEST_PREFIX
	? Z2K_PENDING_ACTIVATION_OVERRIDE : '/etc/zapret2-manager/z2k-pending-activation.json';
const Z2K_RUNTIME_READY_TIMEOUT_MS = 12000;
const Z2K_RUNTIME_READY_POLL_MS = 1000;
// rpcd/ubus has a materially smaller response budget than the full local
// Resource Center diagnostic (the latter includes every dependency detail).
// Keep the RPC projection bounded and fail explicitly if a future field grows
// beyond this contract instead of allowing rpcd to truncate it into ECHILD.
const Z2K_STATUS_RPC_MAX_BYTES = 64 * 1024;
// Package-static Lua is a verified prefix supplied by the package composition
// descriptor.  Keep lifecycle Lua in a disjoint order range so the resolver's
// deterministic sort cannot interleave the two ownership domains.
const Z2K_PACKAGE_LUA_ORDER_BASE = 100;
const Z2K_DETECT_TARGET = '/usr/libexec/zapret2-manager/z2k-detect';
let z2k_active_detect_publication = null;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function array(value) { return type(value) == 'array'; }
function text(value) { return value == null ? '' : '' + value; }
// UCode does not hoist function declarations when a later-defined helper is
// first resolved from a lifecycle callback. Keep identity validators before
// Core snapshot preparation, which calls them during prepare/preview.
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
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
	return string(value) && match(value, /^[rp]-[0-9]+(\.[0-9]+)?$/) ? value : null;
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
	if (length(plan.rebases || []) || length(plan.blockingReviews || []) || length(plan.compilerInputs || [])) return fail('EZ2K_REVIEW_REQUIRED', length(plan.compilerInputs || []) ? 'Изменились compiler inputs; перед установкой нужны compile и validation.' : 'Выбранный release требует проверки перед установкой.', { attentionState: plan.attentionState || (length(plan.compilerInputs || []) ? 'validation-required' : 'review-required'), blockingReasons: plan.blockingReasons || [], reviewDetails: plan.reviewDetails || [], compilerInputs: plan.compilerInputs || [] });
	return { ok: true, canApply: true, attentionState: plan.attentionState || 'none', blockingReasons: plan.blockingReasons || [], reviewDetails: plan.reviewDetails || [], plan: plan };
}
function state_label(state) { return ({ current: 'Актуально', update: 'Доступно обновление', missing: 'Не установлено', checking: 'Проверяем', unavailable: 'Источник недоступен', stale: 'Проверка устарела', error: 'Ошибка проверки', attention: 'Требуется внимание', unknown: 'Не проверено' })[state] || 'Требуется внимание'; }
function plan_token(checkedAt, manifest, sourceCommit) {
	if (type(checkedAt) != 'int' || !object(manifest) || type(manifest.seq) != 'int' || !string(manifest.current)) return null;
	let suffix = string(sourceCommit) && match(lc(sourceCommit), /^[a-f0-9]{40}$/) ? ':' + lc(sourceCommit) : '';
	let token = 'z2k-plan-v1:' + checkedAt + ':' + manifest.seq + ':' + manifest.current + suffix;
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
function z2k_projection(signed, refreshPlan) {
	if (!object(signed) || signed.ok !== true) return { status: 'unknown', updateState: 'unknown', attentionState: 'none', canApply: false, updates: [], removedItems: [], rebases: [], reviews: [], advisoryReviews: [], blockingReviews: [], blockingReasons: [], reviewDetails: [], unknownUnconsumed: [], compilerInputs: [], dependencyGraph: null, dependencyClosure: null, runtimeBundleDigest: null, strategyCount: null, planToken: null, trustMode: 'allow-untrusted', verified: false, source: null, sourceCommit: null, manifestRevision: null, candidateStrategyRevision: null, manifest: null, availableRelease: null };
	let plan = object(signed.plan) ? signed.plan : {}, manifest = object(signed.manifest) ? signed.manifest : {};
	// CHECK_STATE is durable evidence, but its plan was produced by the
	// policy that was installed at check time. Re-project status through the
	// current pure planner so a package-side policy change is visible without
	// network I/O. The explicit check path keeps its enriched plan (including
	// candidate compatibility gates) by leaving refreshPlan false there.
	if (refreshPlan === true && object(signed.manifest)) {
		try {
			let current = z2k_upstream_plan(signed.manifest);
			if (current && current.ok === true) plan = current;
		} catch (e) { /* retain the last valid persisted plan */ }
	}
	let status = signed.status || 'unknown';
	if (refreshPlan === true && plan && plan.status) status = plan.status;
	let updateState = signed.updateState || plan.updateState || (length(plan.updates || []) + length(plan.removedItems || []) > 0 ? 'update-available' : status == 'unknown' ? 'unknown' : 'current');
	if (refreshPlan === true && plan && plan.updateState) updateState = plan.updateState;
	let attentionState = signed.attentionState || plan.attentionState || (status == 'rebase-required' ? 'rebase-required' : status == 'review-required' ? 'review-required' : 'none');
	if (refreshPlan === true && plan && plan.attentionState) attentionState = plan.attentionState;
	return {
		status: status,
		updateState: updateState,
		attentionState: attentionState,
		canApply: refreshPlan === true ? plan.canApply === true : signed.canApply === true || plan.canApply === true,
		updates: plan.updates || [],
		removedItems: plan.removedItems || [],
		rebases: plan.rebases || [],
		reviews: plan.reviews || [],
		advisoryReviews: plan.advisoryReviews || [],
		blockingReviews: plan.blockingReviews || [],
		blockingReasons: plan.blockingReasons || [],
		reviewDetails: plan.reviewDetails || [],
		unknownUnconsumed: plan.unknownUnconsumed || signed.unknownUnconsumed || [],
		compilerInputs: plan.compilerInputs || signed.compilerInputs || [],
		dependencyGraph: plan.dependencyGraph || signed.dependencyGraph || null,
		dependencyClosure: plan.dependencyClosure || signed.dependencyClosure || null,
		runtimeBundleDigest: plan.runtimeBundleDigest || signed.runtimeBundleDigest || null,
		strategyCount: plan.strategyCount || signed.strategyCount || null,
		planToken: signed.planToken || null,
		trustMode: signed.trustMode || null,
		verified: signed.ok === true && signed.trustMode != 'allow-untrusted',
		source: signed.source || null,
		sourceCommit: signed.sourceCommit || (signed.source && signed.source.commit) || null,
		manifestRevision: type(signed.manifestRevision) == 'int' ? signed.manifestRevision : (manifest.seq != null ? manifest.seq : null),
		z2kCompatibilityIdentity: signed.z2kCompatibilityIdentity || null,
		compatibilityIdentity: signed.compatibilityIdentity || null,
		candidateStrategyRevision: signed.candidateStrategyRevision || signed.strategyCandidateRevision || null,
		manifest: { seq: manifest.seq, current: manifest.current },
		availableRelease: known_release(manifest.current)
	};
}

function strategy_source_snapshot() {
	try {
		let current = strategy_sources.strategy_source_current_snapshot('z2k');
		return current && current.ok === true ? current.snapshot : null;
	} catch (e) { return null; }
}
function z2k_compiled_dependency_projection() {
	let snapshot = strategy_source_snapshot(), entry = null;
	for (let item in snapshot && snapshot.entries || [])
		if (object(item) && item.entryKind == 'all-in-one') { entry = item; break; }
	let closure = object(entry) && object(entry.dependencyClosure) ? entry.dependencyClosure : null;
	return {
		dependencyClosure: closure,
		runtimeBundleDigest: closure && closure.runtimeBundleDigest || null,
		strategyCount: object(snapshot) && type(snapshot.entryCount) == 'int' ? snapshot.entryCount : null
	};
}
function z2k_target_dependency_inventory(runtimeCandidate) {
	if (!object(runtimeCandidate)) return null;
	let environment = {};
	try { environment = asset_registry_environment(); } catch (e) { environment = {}; }
	let engineBuiltins = {
		fake_default_tls: { class: 'blob-engine-builtin', kind: 'blob', owner: 'nfqws2', role: 'engine-builtin', available: true },
		fake_default_http: { class: 'blob-engine-builtin', kind: 'blob', owner: 'nfqws2', role: 'engine-builtin', available: true },
		fake_default_quic: { class: 'blob-engine-builtin', kind: 'blob', owner: 'nfqws2', role: 'engine-builtin', available: true }
	};
	let dynamic = [
		{ id: 'dynamic:manager-whitelist', kind: 'hostlist', class: 'hostlist-dynamic', owner: 'manager', role: 'manager-whitelist',
			reference: '/runtime-assets/lists/whitelist.txt', runtimeTarget: '/etc/zapret2-manager/lists/whitelist.txt', available: true },
		{ id: 'dynamic:discovered-domains', kind: 'hostlist', class: 'hostlist-dynamic', owner: 'manager', role: 'z2k-discovered-domains',
			reference: '/runtime-assets/lists/discovered-domains.txt', runtimeTarget: '/opt/zapret2/lists/discovered-domains.txt', available: true }
	];
	return {
		assets: runtimeCandidate.runtimeAssets || [], dynamic: dynamic,
		blobs: environment.blobs || {}, lists: environment.lists || {}, lua: environment.lua || {},
		builtins: engineBuiltins,
		functions: environment.functions || {}, luaFunctions: environment.functions || {},
		runtimeAssets: runtimeCandidate.runtimeAssets || []
	};
}
function z2k_target_dependency_closure(runtimeCandidate) {
	let snapshot = strategy_source_snapshot(), entry = null, inventory = z2k_target_dependency_inventory(runtimeCandidate);
	for (let item in snapshot && snapshot.entries || [])
		if (object(item) && item.entryKind == 'all-in-one') { entry = item; break; }
	if (!object(entry) || !string(entry.officialNfqws2Opt) || !object(inventory)) return null;
	let closure = null;
	try { closure = z2k_dependency_closure({ args: entry.officialNfqws2Opt,
		assets: inventory.assets, dynamic: inventory.dynamic,
		blobs: inventory.blobs, lists: inventory.lists, lua: inventory.lua,
		builtins: inventory.builtins,
		functions: inventory.functions, luaFunctions: inventory.luaFunctions,
		sourceCommit: snapshot.sourceCommit || null, compilerSnapshotDigest: entry.provenance && entry.provenance.compilerSnapshotDigest || null,
		nfqws2OptSha256: entry.provenance && entry.provenance.nfqws2OptSha256 || null }); }
	catch (e) { closure = null; }
	return closure;
}
function z2k_core_snapshot_for_target(resolved, runtimeCandidate) {
	if (!object(resolved) || !string(resolved.version) || !valid_digest(resolved.manifestSha256)
		|| !object(resolved.manifest) || type(resolved.manifest.seq) != 'int'
		|| !valid_commit(resolved.commitSha) || !object(runtimeCandidate))
		return fail('EZ2K_INCOMPATIBLE', 'Core Z2K source identity is incomplete.');
	let inventory = z2k_target_dependency_inventory(runtimeCandidate);
	if (!object(inventory)) return fail('EDEPENDENCY', 'Core Z2K runtime inventory is unavailable.');
	let compiled = null;
	try { compiled = z2k_source_refresh.strategy_source_z2k_compile_exact({ sourceCommit: resolved.commitSha }); }
	catch (e) { compiled = null; }
	if (!object(compiled) || compiled.ok !== true) return compiled || fail('ECOMPILE', 'Official Z2K compiler failed for the selected immutable commit.');
	let prepared = null;
	try { prepared = z2k_source.strategy_source_z2k_prepare_snapshot({
		compiler: compiled.compiler, sourceCommit: resolved.commitSha, sourceFiles: compiled.sourceFiles,
		fileSha256: compiled.fileSha256, z2kRelease: resolved.version,
		manifestRevision: resolved.manifest.seq, dependencyInventory: inventory
	}); } catch (e) { prepared = null; }
	if (!object(prepared) || prepared.ok !== true) return prepared || fail('EVERIFY', 'Core Z2K source snapshot could not be prepared.');
	let snapshot = prepared.snapshot;
	if (!object(snapshot) || !z2k_compatibility_identity_valid(snapshot.z2kCompatibilityIdentity)
		|| snapshot.compatibilityIdentity != snapshot.z2kCompatibilityIdentity.digest
		|| !valid_digest(snapshot.runtimeBundleDigest))
		return fail('EPROVENANCE', 'Core Z2K snapshot did not produce a complete compatibility identity.');
	return { ok: true, snapshot: snapshot, compiler: compiled.compiler, sourceFiles: compiled.sourceFiles, fileSha256: compiled.fileSha256 };
}
function strategy_coherence(local, remote) {
	let installedRuntimeRevision = object(local) ? (local.commit || (object(local.provenance) && local.provenance.sourceCommit) || null) : null;
	let availableUpstreamRevision = object(remote) ? (remote.sourceCommit || remote.manifestRevision || null) : null;
	let snapshot = strategy_source_snapshot();
	let currentStrategySourceRevision = object(snapshot) ? snapshot.sourceCommit || null : null;
	let installedCompatibility = object(local) ? (local.z2kCompatibilityIdentity || local.compatibilityIdentity || null) : null;
	let currentCompatibility = object(snapshot) ? (snapshot.z2kCompatibilityIdentity || snapshot.compatibilityIdentity || null) : null;
	let availableCompatibility = object(remote) ? (remote.z2kCompatibilityIdentity || remote.compatibilityIdentity || null) : null;
	let candidateStrategyRevision = object(remote) ? (remote.candidateStrategyRevision || remote.strategyCandidateRevision || null) : null;
	let coherenceStatus = 'unknown';
	if (installedRuntimeRevision != null && currentStrategySourceRevision != null)
		coherenceStatus = installedRuntimeRevision == currentStrategySourceRevision ? 'aligned' : 'diverged';
	else if (installedRuntimeRevision != null) coherenceStatus = 'runtime-only';
	else if (currentStrategySourceRevision != null) coherenceStatus = 'strategy-only';
	let compatibilityStatus = 'unknown';
	if (z2k_compatibility_identity_valid(installedCompatibility) && z2k_compatibility_identity_valid(currentCompatibility))
		compatibilityStatus = z2k_compatibility_equal(installedCompatibility, currentCompatibility) ? 'aligned' : 'diverged';
	else if (installedCompatibility != null || currentCompatibility != null || availableCompatibility != null) compatibilityStatus = 'incomplete';
	return { installedRuntimeRevision: installedRuntimeRevision, availableUpstreamRevision: availableUpstreamRevision,
		currentStrategySourceRevision: currentStrategySourceRevision, candidateStrategyRevision: candidateStrategyRevision,
		coherenceStatus: coherenceStatus, installedCompatibility: installedCompatibility,
		currentCompatibility: currentCompatibility, availableCompatibility: availableCompatibility,
		compatibilityStatus: compatibilityStatus };
}
function z2k_engine_runtime_projection() {
	try {
		let value = engine_status();
		return object(value) ? {
			installed: value.installed === true,
			compatible: value.compatible === true,
			serviceState: value.serviceState || null,
			runtimeRunning: value.runtimeRunning === true,
			ready: value.installed === true && value.compatible === true && value.serviceState == 'running' && value.runtimeRunning === true,
			installedRelease: value.installedRelease || null
		} : { installed: false, compatible: false, serviceState: null, runtimeRunning: false, ready: false, installedRelease: null };
	} catch (e) {
		return { installed: false, compatible: false, serviceState: null, runtimeRunning: false, ready: false, installedRelease: null };
	}
}
function z2k_runtime_closure_counts(closure) {
	let counts = object(closure) && object(closure.counts) ? closure.counts : {};
	return {
		lua: type(counts.lua) == 'int' ? counts.lua : 0,
		blobs: type(counts.blobs) == 'int' ? counts.blobs : 0,
		hostlists: type(counts.hostlists) == 'int' ? counts.hostlists : 0,
		ipsets: type(counts.ipsets) == 'int' ? counts.ipsets : 0,
		dynamic: type(counts.dynamic) == 'int' ? counts.dynamic : 0,
		runtime: type(counts.runtime) == 'int' ? counts.runtime : 0,
		builtins: type(counts.builtins) == 'int' ? counts.builtins : 0,
		missing: type(counts.missing) == 'int' ? counts.missing : 0
	};
}
function z2k_runtime_closure_ready(closure, digest) {
	return object(closure) && closure.available === true && closure.resolution == 'complete'
		&& z2k_runtime_closure_counts(closure).missing == 0 && string(digest) && match(lc(digest), /^[a-f0-9]{64}$/)
		&& string(closure.runtimeBundleDigest) && closure.runtimeBundleDigest == digest;
}
function z2k_static_managed_count(installed, local) {
	if (!object(local) || local.installed !== true) return 0;
	let count = 0;
	for (let i = 0; i < length(installed || []); i++) {
		let row = installed[i] || {}, provenance = row.provenance || {};
		if (row.source == 'z2k-resources' || provenance.bundleId == 'z2k-curated-lua' || provenance.repository == 'necronicle/z2k') count++;
	}
	return count;
}
function z2k_semantic_item_for(row, closure) {
	if (!object(row) || !object(closure)) return null;
	let items = closure.items || [], sourcePath = row.sourcePath || (row.provenance && row.provenance.sourcePath) || null;
	for (let i = 0; i < length(items); i++) {
		let item = items[i] || {};
		if ((row.id && item.id == row.id) || (sourcePath && item.sourcePath == sourcePath)) return item;
	}
	return null;
}
function z2k_annotate_installed(installed, closure) {
	let result = [];
	for (let i = 0; i < length(installed || []); i++) {
		let row = installed[i], item = z2k_semantic_item_for(row, closure), copy = {};
		for (let key in row || {}) copy[key] = row[key];
		if (object(item)) {
			copy.semanticKind = item.kind || null;
			copy.dependencyClass = item.class || null;
			copy.runtimeTarget = item.runtimeTarget || null;
			copy.runtimeRole = item.role || null;
			copy.semanticOwner = item.owner || null;
		}
		push(result, copy);
	}
	return result;
}
function z2k_runtime_reconciliation(closure, installed) {
	let partitions = { packageStatic: 0, lifecycleManaged: 0, dynamic: 0, runtimeGenerated: 0, engineBuiltins: 0, user: 0 };
	let duplicateRuntimeAssets = [], ownerConflicts = [], seenIds = {}, seenTargets = {}, targetOwners = {};
	for (let item in object(closure) && closure.items || []) {
		if (!object(item)) continue;
		let id = item.id || item.class + ':' + (item.reference || '');
		if (seenIds[id]) push(duplicateRuntimeAssets, id);
		seenIds[id] = true;
		let target = item.runtimeTarget || null, owner = item.owner || item.ownership || 'unknown';
		if (target != null) {
			if (seenTargets[target]) push(duplicateRuntimeAssets, target);
			seenTargets[target] = true;
			if (targetOwners[target] != null && targetOwners[target] != owner)
				push(ownerConflicts, { runtimeTarget: target, owners: [targetOwners[target], owner] });
			targetOwners[target] = owner;
		}
		let klass = item.class || '', typeName = item.type || '', role = item.role || '';
		if (klass == 'blob-engine-builtin' || role == 'engine-builtin' || typeName == 'engine-builtin') partitions.engineBuiltins++;
		else if (klass == 'hostlist-dynamic' || klass == 'ipset-dynamic') partitions.dynamic++;
		else if (klass == 'blob-runtime' || klass == 'blob-inline' || role == 'runtime-generated' || typeName == 'runtime-generated') partitions.runtimeGenerated++;
		else if (typeName == 'package-static' || owner == 'package') partitions.packageStatic++;
		else if (typeName == 'user' || owner == 'user') partitions.user++;
		else if (typeName == 'lifecycle-managed' || owner == 'z2k-core' || klass == 'lua' || klass == 'blob-file' || klass == 'hostlist-static' || klass == 'ipset-static') partitions.lifecycleManaged++;
	}
	for (let row in installed || []) {
		let provenance = object(row && row.provenance) ? row.provenance : {}, kind = provenance.kind || '';
		if (kind == 'imported' || kind == 'user-created' || row && (row.ownership == 'user' || row.source == 'user')) partitions.user++;
	}
	return {
		schema: 'z2m.z2k-runtime-reconciliation.v1',
		closureAvailable: object(closure) && closure.available === true,
		partitions: partitions,
		duplicateRuntimeAssets: duplicateRuntimeAssets,
		ownerConflicts: ownerConflicts,
		uniqueRuntimeOwner: !length(ownerConflicts) && !length(duplicateRuntimeAssets)
	};
}
function z2k_runtime_summary(local, remote, engine, staticManagedCount, installed) {
	local = object(local) ? local : {};
	remote = object(remote) ? remote : {};
	engine = object(engine) ? engine : {};
	let closure = object(local.dependencyClosure) ? local.dependencyClosure : (object(remote.dependencyClosure) ? remote.dependencyClosure : null);
	let counts = z2k_runtime_closure_counts(closure), installedDigest = local.runtimeBundleDigest || null, digest = installedDigest || remote.runtimeBundleDigest || (closure && closure.runtimeBundleDigest) || null;
	let closureReady = z2k_runtime_closure_ready(closure, digest) && string(installedDigest) && closure && closure.runtimeBundleDigest == installedDigest, engineReady = engine.ready === true;
	let localInstalled = local.installed === true;
	let health = !engine.installed || !localInstalled ? 'missing' : local.integrityOk !== true ? 'broken' : !engineReady || !closureReady ? 'degraded' : 'ready';
	let blockingReviews = remote.blockingReviews || [], advisoryReviews = remote.advisoryReviews || [], unknownUnconsumed = remote.unknownUnconsumed || [], rebases = remote.rebases || [];
	let updateState = remote.updateState || remote.status || 'unknown', attentionState = remote.attentionState || 'none';
	if (length(rebases)) attentionState = 'rebase-required';
	else if (length(blockingReviews)) attentionState = 'review-required';
	else if (length(advisoryReviews)) attentionState = 'review-advisory';
	return {
		schema: 'z2m.z2k-runtime-summary.v1',
		installedRelease: engineReady ? local.installedRelease || { value: null, confidence: 'unknown', authority: null } : { value: null, confidence: 'unknown', authority: null },
		availableRelease: remote.availableRelease || null,
		health: health, updateState: updateState, attentionState: attentionState,
		integrity: local.integrity || null, integrityOk: local.integrityOk === true,
		strategies: local.strategyCount != null ? local.strategyCount : remote.strategyCount,
		counts: counts, staticManagedCount: staticManagedCount,
		dependencyClosure: closure, runtimeBundleDigest: digest,
		engine: engine, sourceCommit: local.commit || null,
		reconciliation: z2k_runtime_reconciliation(closure, installed),
		blockingReviews: blockingReviews, advisoryReviews: advisoryReviews,
		unknownUnconsumed: unknownUnconsumed, rebases: rebases,
		canApply: engineReady === true && remote.canApply === true && !length(blockingReviews) && !length(rebases) && !length(remote.compilerInputs || []),
		coherence: remote.coherence || null,
		identity: { closureDigest: closure && closure.runtimeBundleDigest || null, installedDigest: local.runtimeBundleDigest || null, coherent: closureReady }
	};
}
export const z2k_runtime_summary_projection = function(local, remote, engine, staticManagedCount, installed) {
	return z2k_runtime_summary(local, remote, engine, staticManagedCount, installed);
};
export const z2k_static_managed_count_projection = function(installed, local) {
	return z2k_static_managed_count(installed, local);
};
function z2k_apply_runtime_summary(remote, local, summary) {
	remote.runtimeSummary = summary;
	remote.health = summary.health;
	remote.integrity = summary.integrity;
	remote.integrityOk = summary.integrityOk;
	remote.installedRelease = summary.installedRelease;
	remote.availableRelease = summary.availableRelease;
	remote.strategyCount = summary.strategies;
	remote.staticManagedCount = summary.staticManagedCount;
	remote.dependencyClosure = summary.dependencyClosure;
	remote.runtimeBundleDigest = summary.runtimeBundleDigest;
	remote.reconciliation = summary.reconciliation;
	remote.canApply = summary.canApply;
	local.runtimeSummary = summary;
}
function z2k_canonical_runtime_path(runtimeTarget) {
	if (!string(runtimeTarget)) return null;
	let prefix = '/runtime-assets/', relative = substr(runtimeTarget, length(prefix));
	if (substr(runtimeTarget, 0, length(prefix)) != prefix || !length(relative) || index(relative, '..') >= 0 || index(relative, '\\') >= 0 || !match(relative, /^[A-Za-z0-9._\/-]+$/)) return null;
	if (substr(runtimeTarget, 0, length('/runtime-assets/bin/')) == '/runtime-assets/bin/') return RUNTIME_BASE + '/files/fake/' + substr(runtimeTarget, length('/runtime-assets/bin/'));
	if (substr(runtimeTarget, 0, length('/runtime-assets/lua/')) == '/runtime-assets/lua/') return RUNTIME_BASE + '/lua/' + substr(runtimeTarget, length('/runtime-assets/lua/'));
	if (substr(runtimeTarget, 0, length('/runtime-assets/lists/')) == '/runtime-assets/lists/') return RUNTIME_BASE + '/lists/' + substr(runtimeTarget, length('/runtime-assets/lists/'));
	if (substr(runtimeTarget, 0, length('/runtime-assets/ipset/')) == '/runtime-assets/ipset/') return RUNTIME_BASE + '/ipset/' + substr(runtimeTarget, length('/runtime-assets/ipset/'));
	return null;
}

function z2k_canonical_local_projection(listed, resolved) {
	let evidence = { snapshotId: resolved.snapshotId, membershipDigest: resolved.membershipDigest, files: {}, configHash: config_sha256() }, matched = 0, luaReady = 0;
	for (let i = 0; i < length(resolved.runtimeAssets || []); i++) {
		let expected = resolved.runtimeAssets[i], path = z2k_canonical_runtime_path(expected.runtimeTarget), present = path != null && regular(path);
		evidence.files[expected.id] = { exists: present, present: present, sha256: present ? sha256(path) : null, byteSize: present ? stat(path).size : null, owner: expected.owner };
	}
	let verification = verifyMaterialized(resolved, evidence);
	for (let i = 0; i < length(resolved.runtimeAssets || []); i++) {
		let expected = resolved.runtimeAssets[i], actual = evidence.files && evidence.files[expected.id];
		if (object(actual) && actual.present === true && actual.sha256 == expected.contentSha256 && actual.byteSize == expected.byteSize) {
			matched++;
			if (expected.kind == 'lua' && expected.role == 'lua-init') luaReady++;
		}
	}
	let authority = resolved.lifecycleIdentity || resolved.authority || {}, installedRelease = z2k_registry_installed_release(listed), checkedAt = null;
	for (let i = 0; i < length(listed.assets || []); i++) {
		let checked = listed.assets[i] && listed.assets[i].lastChecked;
		if (checked != null && (checkedAt == null || checked > checkedAt)) checkedAt = checked;
	}
	let provenance = {
		kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: authority.sourceCommit || null,
		version: authority.release || null, bundleId: 'z2k-curated-lua'
	};
	let compiled = z2k_compiled_dependency_projection();
	return {
		installed: authority.kind == 'installed' && string(authority.release),
		integrity: verification.ok ? 'verified' : 'broken',
		integrityOk: verification.ok === true,
		lua: { ready: luaReady, total: length(resolved.luaInit || []) },
		baselineMatched: matched,
		runtimeMatched: matched,
		runtimeAssets: resolved.runtimeAssets || [],
		luaInit: resolved.luaInit || [],
		compositionStatus: resolved.compositionStatus,
		revision: resolved.observedRegistryRevision,
		installedAuthorityRevision: resolved.installedAuthorityRevision || null,
		commit: authority.sourceCommit || null,
		z2kCompatibilityIdentity: authority.z2kCompatibilityIdentity || null,
		compatibilityIdentity: authority.compatibilityIdentity || null,
		provenance: provenance,
		checkedAt: checkedAt,
		installedRelease: installedRelease || { value: null, confidence: 'unknown', authority: null },
		dependencyClosure: compiled.dependencyClosure,
		runtimeBundleDigest: compiled.runtimeBundleDigest,
		strategyCount: compiled.strategyCount
	};
}

function z2k_local_projection(manifest) {
	let compiled = z2k_compiled_dependency_projection();
	let listed = asset_registry_list(null);
	if (!listed.ok) return { installed: false, integrity: 'broken', integrityOk: false, lua: { ready: 0, total: 0 }, baselineMatched: 0, revision: 0, commit: null, provenance: null, checkedAt: null, installedRelease: { value: null, confidence: 'unknown', authority: null }, dependencyClosure: compiled.dependencyClosure, runtimeBundleDigest: compiled.runtimeBundleDigest, strategyCount: compiled.strategyCount };
	let resolved = resolveInstalled({ registry: listed });
	if (resolved.ok && resolved.lifecycleState == 'installed' && resolved.compositionStatus == 'canonical') return z2k_canonical_local_projection(listed, resolved);
	if (resolved.ok && resolved.lifecycleState == 'V1_VERIFIED_MEMBERSHIP') {
		let membership = resolved.legacyMembership || [], luaReady = 0;
		for (let i = 0; i < length(membership); i++) if (membership[i] && membership[i].kind == 'lua') luaReady++;
		let authority = resolved.authority || {}, release = authority.release || null, commit = authority.sourceCommit || null;
		return {
			installed: true, integrity: 'reconciliation-required', integrityOk: false,
			lua: { ready: luaReady, total: luaReady }, baselineMatched: length(membership),
			runtimeMatched: length(membership), runtimeAssets: [], luaInit: [],
			compositionStatus: 'incomplete', lifecycleState: 'V1_VERIFIED_MEMBERSHIP',
			reconciliationRequired: true, revision: resolved.observedRegistryRevision || 0,
			installedAuthorityRevision: null, commit: commit,
			provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: commit, version: release, bundleId: 'z2k-curated-lua' },
			checkedAt: null, installedRelease: { value: release, confidence: 'confirmed', authority: 'activation-receipt-v1' },
			dependencyClosure: null, runtimeBundleDigest: null, strategyCount: null
		};
	}
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
	// Registry provenance is authoritative only when it contains the exact
	// immutable source commit. Release labels such as p-82.14 are not commits
	// and must never be projected as runtime provenance.
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
	// Package-static Lua is support material, not an activated Z2K release.
	// Lifecycle truth requires the Registry receipt and canonical runtime
	// closure, which are handled by z2k_canonical_local_projection above.
	return { installed: false, integrity: 'unverified', integrityOk: false, lua: { ready: 0, total: 0 }, baselineMatched: 0, revision: maxRevision, commit: null, provenance: null, checkedAt: maxLastChecked, installedRelease: { value: null, confidence: 'unknown', authority: null }, dependencyClosure: null, runtimeBundleDigest: null, strategyCount: null };
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
function z2k_runtime_guard_finish(guard, root, paths, result, testSeams) {
	let testing = object(testSeams) && testSeams.testOnly === true;
	cleanup(root, paths);
	let pause = testing ? (type(testSeams.pauseRelease) == 'function' ? testSeams.pauseRelease() : { ok: true, skipped: true }) : z2k_runtime_guard_release(guard);
	let lock = testing ? (type(testSeams.lockRelease) == 'function' ? testSeams.lockRelease() : { ok: true, skipped: true }) : z2k_lifecycle_lock_release();
	let answer = object(result) ? result : fail('EINTERNAL', 'Z2K lifecycle returned an invalid result.');
	if (!pause.ok || !lock.ok) {
		if (answer.ok === true) answer = fail('ERUNTIME', 'Z2K lifecycle cleanup could not release an owned resource.', { result: answer });
		answer.error = answer.error || { code: 'ERUNTIME', message: 'Z2K lifecycle cleanup failed.' };
		answer.ok = false;
	}
	let detectPublication = z2k_active_detect_publication, rollbackContract = object(answer.rollback) ? answer.rollback : (answer.error && object(answer.error.rollback) ? answer.error.rollback : null), detectTransaction = { ok: true, skipped: true };
	if (object(detectPublication) && detectPublication.published === true) {
		if (answer.ok === true) {
			detectTransaction = testing ? testSeams.detectFinalize(detectPublication) : z2k_detect_finalize(detectPublication);
			if (!detectTransaction.ok) {
				let restored = testing ? testSeams.detectRestore(detectPublication) : z2k_detect_restore(detectPublication);
				detectTransaction.restore = restored;
				answer = fail(restored.ok ? 'EWRITE' : 'EROLLBACK', restored.ok ? 'Z2K Detect publication could not be finalized.' : 'Z2K Detect publication finalization failed and stable state could not be restored.', { detect: detectTransaction });
			}
		} else if (object(rollbackContract) && rollbackContract.detectHandled === true) {
			detectTransaction = rollbackContract.detect || { ok: false, skipped: true, preserved: rollbackContract.detectPreserved === true, recoveryRequired: rollbackContract.recoveryRequired === true };
			if (rollbackContract.recoveryRequired === true) {
				answer.error = answer.error || { code: 'ERECOVERY_REQUIRED', message: 'Z2K lifecycle rollback is incomplete; durable recovery must reconcile all lifecycle owners before Detect changes.' };
				answer.error.code = 'ERECOVERY_REQUIRED';
				answer.error.recoveryRequired = true;
			}
		} else {
			detectTransaction = testing ? testSeams.detectRestore(detectPublication) : z2k_detect_restore(detectPublication);
			if (!detectTransaction.ok) {
				answer.error = answer.error || { code: 'EROLLBACK', message: 'Z2K transaction failed and Detect stable state could not be restored.' };
				answer.error.detect = detectTransaction;
				answer.ok = false;
			}
		}
	}
	answer.lifecycleCleanup = { pause: pause, lock: lock };
	answer.detectTransaction = detectTransaction;
	z2k_active_detect_publication = null;
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
function z2k_prepare_job_result_reusable(version, result) {
	if (!object(result) || result.ok !== true || !object(result.target) || result.target.targetVersion != version
		|| !string(result.planToken) || !length(result.planToken)) return false;
	let raw = readfile(CHECK_STATE), state = null;
	if (raw == null || length(raw) > MAX_CHECK_STATE_BYTES) return false;
	try { state = json(raw); } catch (e) { return false; }
	let persisted = state && state.schema == 2 ? state.preparedTarget : null;
	return object(persisted) && persisted.targetVersion == version && persisted.planToken == result.planToken;
}
function z2k_prepare_job_existing(version) {
	let names = lsdir(Z2K_OPERATION_PARENT) || [];
	for (let i = 0; i < length(names); i++) {
		let name = names[i];
		if (!string(name) || !match(name, /^z2k-[0-9]+-[a-f0-9]{16}$/)) continue;
		let path = z2k_operation_path(name), raw = readfile(path), job = null;
		try { if (raw != null && length(raw) <= MAX_REQUEST_BYTES) job = json(raw); } catch (e) { job = null; }
		if (!object(job) || job.kind != 'prepare' || !object(job.request) || job.request.version != version) continue;
		let answer = { ok: true, accepted: true, operationId: name, targetVersion: version, phase: job.phase || 'queued', state: job.phase || 'queued', finished: job.finished === true };
		if (job.finished === true) {
			answer.completed = true;
			if (job.result != null && job.result.ok === true) {
				if (!z2k_prepare_job_result_reusable(version, job.result)) continue;
			}
			if (job.result != null) answer.result = job.result;
			if (job.error != null) answer.error = job.error;
		}
		return answer;
	}
	return null;
}
export const resource_center_enqueue_prepare = function(request) {
	let version = object(request) ? request.version : request;
	if (!string(version) || z2k_compare_versions(version, version) == null) return fail('EINPUT', 'Z2K prepare version is invalid.');
	let existing = z2k_prepare_job_existing(version);
	if (existing != null) return existing;
	let operationId = z2k_operation_id({ planToken: 'prepare|' + version + '|' + time() });
	if (!operationId) return fail('EIO', 'Z2K prepare operation identity could not be created.');
	try { mkdir(STAGE_PARENT); } catch (e) {}
	try { mkdir(Z2K_OPERATION_PARENT); } catch (e) {}
	let dir = Z2K_OPERATION_PARENT + '/' + operationId, jobPath = dir + '/job.json';
	try { mkdir(dir); } catch (e) {}
	if (stat(jobPath) != null) return fail('EBUSY', 'Z2K prepare operation identity is already in use.');
	let now = time(), job = { schema: 1, kind: 'prepare', operationId: operationId, phase: 'queued', finished: false, request: { version: version }, createdAt: now, updatedAt: now, pid: null };
	if (!z2k_operation_write(jobPath, job)) return fail('EWRITE', 'Z2K prepare operation could not be queued.');
	let spawned = z2k_operation_spawn(jobPath);
	if (!spawned.ok) {
		job.phase = 'failed'; job.finished = true; job.error = spawned.error; job.updatedAt = time(); job.finishedAt = job.updatedAt;
		z2k_operation_write(jobPath, job);
		return spawned;
	}
	job.pid = spawned.pid; z2k_operation_write(jobPath, job);
	return { ok: true, accepted: true, operationId: operationId, targetVersion: version, state: 'queued', phase: 'queued', finished: false };
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
	canonical = target.targetVersion + '|' + target.targetCommitSha + '|' + target.manifestSha256 + '|' + target.localFingerprint + '|' + target.classificationSha256 + '|' + (target.runtimeBundleDigest || '') + '|' + (target.compilerSnapshotDigest || '') + '|' + (target.compatibilityIdentity || '') + '|' + target.operation + '|' + join(',', removeIds) + '|' + join(',', removalIdentity) + '|' + preparedAt;
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
function z2k_canonical_target_assets(targetVersion, targetCommit, manifestSha256, classificationSha256, assets, compatibility) {
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
		if (compatibility != null) {
			entry.z2kRelease = compatibility.release;
			entry.manifestRevision = compatibility.manifestRevision;
			entry.runtimeBundleDigest = compatibility.runtimeBundleDigest;
			entry.z2kCompatibilityIdentity = compatibility;
			entry.compatibilityIdentity = compatibility.digest;
		}
		if (role == 'lua-init') entry.runtimeOrder = item.runtimeOrder == null ? Z2K_PACKAGE_LUA_ORDER_BASE + luaOrder : Z2K_PACKAGE_LUA_ORDER_BASE + item.runtimeOrder;
		if (kind == 'lua') luaOrder++;
		push(result, entry);
	}
	return result;
}
function make_stage_root() { try { mkdir(STAGE_PARENT); } catch (e) {} let value = command('mktemp -d ' + shell_quote(STAGE_PARENT + '/stage.XXXXXX')); let root = trim(value.out); return value.rc == 0 && index(root, STAGE_PARENT + '/') == 0 ? root : null; }
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
	if (!state || state.state != 'LEGACY_VERIFIED' || !object(receipt) || receipt.schema != 'asset-activation-receipt.v1') return { ok: true, required: false };
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
export const resource_center_test_v1_reconciliation_check = function(input) {
	if (!object(input) || input.testOnly !== true || !object(input.listed) || !object(input.resolved)) return fail('EINPUT', 'Internal V1 reconciliation test seam is restricted to controlled tests.');
	return z2k_v1_reconciliation_check(input.listed, input.resolved);
};
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
	if (value.z2kRelease != value.targetVersion || type(value.manifestRevision) != 'int'
		|| !valid_digest(value.compilerSnapshotDigest) || !z2k_compatibility_identity_valid(value.z2kCompatibilityIdentity)
		|| value.compatibilityIdentity != value.z2kCompatibilityIdentity.digest
		|| value.z2kCompatibilityIdentity.release != value.z2kRelease
		|| value.z2kCompatibilityIdentity.sourceCommit != lc(value.targetCommitSha || value.targetCommit)
		|| value.z2kCompatibilityIdentity.manifestRevision != value.manifestRevision
		|| value.z2kCompatibilityIdentity.runtimeBundleDigest != value.runtimeBundleDigest
		|| value.z2kCompatibilityIdentity.compilerSnapshotDigest != value.compilerSnapshotDigest) return false;
	for (let i = 0; i < length(value.assets); i++) {
		let item = value.assets[i];
		if (!z2k_target_asset_valid(item) && !z2k_canonical_target_asset_valid(item)) return false;
		if (item.type == 'lifecycle-managed' && (!z2k_compatibility_identity_valid(item.z2kCompatibilityIdentity)
			|| item.compatibilityIdentity != value.compatibilityIdentity
			|| item.z2kCompatibilityIdentity.release != value.z2kCompatibilityIdentity.release
			|| item.z2kCompatibilityIdentity.sourceCommit != value.z2kCompatibilityIdentity.sourceCommit
			|| item.z2kCompatibilityIdentity.manifestRevision != value.z2kCompatibilityIdentity.manifestRevision
			|| item.z2kCompatibilityIdentity.runtimeBundleDigest != value.z2kCompatibilityIdentity.runtimeBundleDigest
			|| item.z2kCompatibilityIdentity.compilerSnapshotDigest != value.z2kCompatibilityIdentity.compilerSnapshotDigest)) return false;
	}
	let seen = {};
	for (let i = 0; i < length(value.assets); i++) seen[value.assets[i].id] = true;
	for (let i = 0; i < length(value.removeIds); i++) {
		let id = value.removeIds[i];
		if (!string(id) || !match(id, /^(lua|blob):[a-z0-9][a-z0-9._-]*$/) || seen[id]) return false;
		seen[id] = true;
		if (!valid_removal_descriptor(value.removeTargets[i], id)) return false;
	}
	return valid_digest(value.runtimeBundleDigest) && z2k_target_token(value, value.preparedAt) == value.planToken;
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
	let planToken = token || (signed && signed.ok === true ? plan_token(checkedAt, signed.manifest, signed.sourceCommit || signed.manifestRevision) : null);
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
	for (let i = 0; i < length(listed.assets); i++) if (!seen[listed.assets[i].id]) { let asset = listed.assets[i], provenance = asset.provenance || {}, row = { id: asset.id, type: asset.type, name: asset.name, sourcePath: provenance.sourcePath || null, sourceCommit: provenance.sourceCommit || null, path: asset.path, ownership: asset.ownership, packageBaseline: asset.ownership == 'package', revision: asset.revision, contentSha256: asset.contentSha256, byteSize: asset.byteSize, lastChecked: asset.lastChecked || null, lastUpdated: asset.lastUpdated || null, references: asset.references || [], state: asset.validation && asset.validation.status == 'passed' ? 'current' : 'attention', status: state_label(asset.validation && asset.validation.status == 'passed' ? 'current' : 'attention'), provenance: asset.provenance || null, safeToUpdate: asset.ownership != 'package' }; push(installed, row); }
	let updates = [], byType = {}, consumers = {};
	for (let i = 0; i < length(rows); i++) if (rows[i].state == 'update' || rows[i].state == 'missing') { push(updates, rows[i]); byType[rows[i].type] = (byType[rows[i].type] || 0) + 1; let consumer = rows[i].compatibility.consumer || 'не указано'; consumers[consumer] = (consumers[consumer] || 0) + 1; }
	return { ok: true, schema: 1, checkedAt: checkedAt || null, manifest: { bundleId: manifest.bundleId, version: manifest.version, generatedAt: manifest.generatedAt }, sources: source_rows(manifest, rows), installed: installed, updates: updates, summary: { installed: length(installed), updates: length(updates), byType: byType, consumers: consumers }, autoCheck: { enabled: false, autoInstall: false, mode: 'manifest-only' } };
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
function z2k_runtime_exact(item) {
	return object(item) && (item.class == 'exact-managed' || item.dependencyClass == 'runtime-exact');
}
function z2k_classification_asset_for(map, id, typeName) {
	let found = null;
	for (let i = 0; map && type(map.files) == 'array' && i < length(map.files); i++) {
		let item = map.files[i], mappedType = item && item.type == 'lua' ? 'lua' : item && (item.type == 'bin' || item.type == 'txt') ? 'blob' : null;
		if (!z2k_runtime_exact(item) || mappedType != typeName || !string(item.sourcePath) || !runtime_target_path(item.runtimeTarget)
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
				if (!z2k_runtime_exact(item) || mappedType != typeName || !runtime_target_path(item.runtimeTarget)
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
			if (!z2k_runtime_exact(historical)) return fail('EZ2K_INCOMPATIBLE', 'Z2K target membership would leave an unmanaged hybrid asset set.', { id: current.id, sourcePath: provenance.sourcePath });
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
		if (!z2k_runtime_exact(historical) || expectedType != current.type || !runtime_target_path(historical.runtimeTarget)
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
	let restarted = command('sh /etc/rc.common /etc/init.d/zapret2 restart');
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
	if (!restarted.ok) return { ok: false, restored: true, error: restarted.error || null, restart: restarted };
	return { ok: true, restored: true, restart: restarted };
}
export const z2k_runtime_confirmed_target = function(listed, classification, authority) {
	let active = [], activeById = {}, historical = {}, receipts = listed.activationReceipts || [];
	for (let i = 0; i < length(listed.assets || []); i++) {
		let asset = listed.assets[i], provenance = asset && asset.provenance;
		if (!provenance || provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua') continue;
		let item = z2k_classification_for(classification, provenance.sourcePath);
		if (!z2k_runtime_exact(item) || !runtime_target_path(item.runtimeTarget)) return fail('EVERIFY', 'Confirmed Z2K asset has no safe runtime mapping.', { id: asset.id });
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
function z2k_rollback_asset_matches(expected, actual) {
	if (!object(expected) || !object(actual) || expected.id != actual.id || expected.type != actual.type) return false;
	let expectedSha = expected.sha256 || expected.contentSha256, actualSha = actual.contentSha256 || actual.sha256;
	if (expectedSha != null && expectedSha != actualSha) return false;
	if (expected.byteSize != null && expected.byteSize != actual.byteSize) return false;
	if (expected.sourcePath != null) {
		let provenance = object(actual.provenance) ? actual.provenance : {}, actualPath = actual.sourcePath || provenance.sourcePath;
		if (expected.sourcePath != actualPath) return false;
	}
	return true;
}
function z2k_rollback_membership_matches(expected, actual) {
	if (!array(expected) || !array(actual) || length(expected) != length(actual)) return false;
	for (let i = 0; i < length(expected); i++) {
		let found = null;
		for (let j = 0; j < length(actual); j++) if (actual[j] && actual[j].id == expected[i].id) { found = actual[j]; break; }
		if (!z2k_rollback_asset_matches(expected[i], found)) return false;
	}
	return true;
}
function z2k_rollback_receipt_matches(expected, actual) {
	if (!object(expected) || !object(actual)) return false;
	let keysToCompare = ['schema', 'bundleId', 'version', 'source', 'sourceCommit', 'manifestSha256', 'classificationSha256', 'membershipDigest', 'candidateSnapshotId', 'baseRegistryRevision', 'committedRegistryRevision', 'installedAuthorityRevision'];
	for (let i = 0; i < length(keysToCompare); i++) {
		let key = keysToCompare[i];
		if (expected[key] != null && expected[key] != actual[key]) return false;
	}
	if (expected.schema == 'asset-activation-receipt.v1') return z2k_rollback_membership_matches(expected.assets, actual.assets);
	if (expected.schema == 'asset-activation-receipt.v2') return z2k_rollback_membership_matches(expected.z2kMembership, actual.z2kMembership);
	if (expected.schema == 'asset-activation-receipt.v3') {
		if (expected.release != null && expected.release != actual.release) return false;
		if (expected.manifestSeq != null && expected.manifestSeq != actual.manifestSeq) return false;
		if (expected.runtimeBundleDigest != null && expected.runtimeBundleDigest != actual.runtimeBundleDigest) return false;
		if (expected.compilerInputsDigest != null && expected.compilerInputsDigest != actual.compilerInputsDigest) return false;
		if (expected.catalogDigest != null && expected.catalogDigest != actual.catalogDigest) return false;
		if (expected.compatibilityIdentity != null && expected.compatibilityIdentity != actual.compatibilityIdentity) return false;
		let expectedDetect = expected.detect, actualDetect = actual.detect;
		if (object(expectedDetect) && (!object(actualDetect) || expectedDetect.arch != actualDetect.arch || expectedDetect.digest != actualDetect.digest
			|| expectedDetect.size != actualDetect.size || expectedDetect.sourceCommit != actualDetect.sourceCommit)) return false;
		return z2k_rollback_membership_matches(expected.runtimeMembership, actual.runtimeMembership);
	}
	return false;
}
function z2k_receipt_state_verified(state) { return object(state) && (state.state == 'LEGACY_VERIFIED' || state.state == 'COHERENT_VERIFIED'); }
function z2k_rollback_registry_already_restored(pending, listed) {
	if (!object(pending) || !object(pending.rollbackIdentity) || !object(listed) || listed.ok !== true
		|| listed.revision != pending.rollbackIdentity.registryRevision) return false;
	let expected = pending.rollbackIdentity.receipt || null, state = z2k_registry_receipt_state(listed);
	if (expected == null) return state.state == 'unknown' && state.receipt == null;
	return state.receipt != null && z2k_rollback_receipt_matches(expected, state.receipt);
}
function z2k_pending_legacy_reconciliation_eligible(pending, listed) {
	if (!object(pending) || pending.phase != 'ROLLING_BACK' || !object(pending.rollbackIdentity)
		|| !z2k_rollback_registry_already_restored(pending, listed)) return false;
	let state = z2k_registry_receipt_state(listed), receipt = state && state.receipt;
	return state && state.state == 'LEGACY_VERIFIED' && object(receipt)
		&& receipt.version == pending.targetVersion && receipt.sourceCommit == pending.targetCommit
		&& receipt.schema == 'asset-activation-receipt.v1';
}
function z2k_rollback_expected_revision(applied, listed, pending) {
	let expected = applied && (applied.committedAssetRevision || applied.revision);
	if (type(expected) != 'int' || !object(listed) || listed.ok !== true || listed.revision != expected + 1 || !object(pending)
		|| pending.phase == 'COMMITTED') return expected;
	let authority = z2k_registry_receipt_state(listed), receipt = authority && authority.receipt;
	if (z2k_receipt_state_verified(authority) && object(receipt)
		&& receipt.version == pending.targetVersion && receipt.sourceCommit == pending.targetCommit
		&& receipt.committedRegistryRevision == expected) return listed.revision;
	return expected;
}
function z2k_rollback_after_runtime_failure(selected, applied, diagnostics, runtimeActivated, testSeams) {
	let testing = object(testSeams) && testSeams.testOnly === true;
	let pending = testing ? testSeams.pendingLoad() : z2k_pending_load(), journal = pending == null || (testing ? testSeams.pendingWrite(pending, 'ROLLING_BACK') : z2k_pending_write(pending, 'ROLLING_BACK'));
	let runtimeRollback = runtimeActivated ? (testing ? testSeams.runtimeRollback() : z2k_runtime_rollback()) : { ok: true, skipped: true };
	let listed = testing ? testSeams.registryList() : asset_registry_list(null), alreadyRestored = testing ? testSeams.registryAlreadyRestored(pending, listed) : z2k_rollback_registry_already_restored(pending, listed);
	let expectedRevision = testing ? applied && (applied.committedAssetRevision || applied.revision) : z2k_rollback_expected_revision(applied, listed, pending);
	let registryRollback = alreadyRestored ? { ok: true, skipped: true, alreadyRestored: true, revision: listed.revision }
		: (testing ? testSeams.registryRollback({ bundleId: selected.id, expectedRevision: expectedRevision }) : asset_registry_rollback_bundle({ bundleId: selected.id, expectedRevision: expectedRevision }));
	let sourceRollback = { ok: true, skipped: true };
	if (pending && pending.sourceRestoreRequired === true && object(pending.sourceActivation)) {
		try { sourceRollback = testing ? testSeams.sourceRestore('z2k', pending.sourceActivation) : strategy_sources.strategy_source_restore_activation('z2k', pending.sourceActivation); }
		catch (e) { sourceRollback = fail('EROLLBACK', 'Z2K strategy source activation rollback raised an exception.'); }
	}
	let catalogRollback = { ok: true, skipped: true };
	if (pending && pending.catalogRestoreRequired === true && sourceRollback.ok === true) {
		try { catalogRollback = testing ? (type(testSeams.catalogRestore) == 'function' ? testSeams.catalogRestore() : fail('EINPUT', 'Catalog rollback test seam is incomplete.')) : catalog_refresh_rebuild(); }
		catch (e) { catalogRollback = fail('EROLLBACK', 'Z2K catalog rollback raised an exception.'); }
	}
	let strategyRollback = { ok: true, skipped: true }, configRollback = { ok: true, skipped: true };
	if (pending && pending.priorActiveStrategy != null) {
		try {
			strategyRollback = testing && type(testSeams.strategyRestore) == 'function' ? testSeams.strategyRestore(pending.priorActiveStrategy)
				: (function() { let current = strategy_selection_get(); return current && current.ok === true ? strategy_selection_restore({ expectedRevision: current.revision, selected: pending.priorActiveStrategy }) : fail('EROLLBACK', 'active strategy selection could not be read for rollback'); })();
		} catch (e) { strategyRollback = fail('EROLLBACK', 'active strategy selection rollback raised an exception.'); }
	}
	if (pending && pending.priorConfig != null) {
		try { configRollback = testing && type(testSeams.configRestore) == 'function' ? testSeams.configRestore(pending.priorConfig) : restore_transaction_config(pending.priorConfig, false); }
		catch (e) { configRollback = fail('EROLLBACK', 'active config rollback raised an exception.'); }
	}
	let detectPublication = pending && object(pending.detectPublication) ? pending.detectPublication : z2k_active_detect_publication;
	let commonOk = journal && runtimeRollback.ok && registryRollback.ok && sourceRollback.ok && catalogRollback.ok && strategyRollback.ok && configRollback.ok;
	if (!commonOk) return {
		ok: false, recoveryRequired: true, detectHandled: true, detectPreserved: true,
		runtime: runtimeRollback, registry: registryRollback, source: sourceRollback, catalog: catalogRollback, strategy: strategyRollback, config: configRollback,
		detect: { ok: false, skipped: true, preserved: true, recoveryRequired: true }, journal: journal,
		error: { code: 'ERECOVERY_REQUIRED', message: 'Z2K common rollback is incomplete; candidate Detect and durable ROLLING_BACK evidence were preserved for recovery.' }
	};
	let detectRollback = object(detectPublication) ? (testing ? testSeams.detectRestore(detectPublication) : z2k_detect_restore(detectPublication)) : { ok: true, skipped: true };
	if (!detectRollback.ok) return {
		ok: false, recoveryRequired: true, detectHandled: true, detectPreserved: true,
		runtime: runtimeRollback, registry: registryRollback, source: sourceRollback, catalog: catalogRollback, strategy: strategyRollback, config: configRollback,
		detect: detectRollback, journal: journal,
		error: { code: 'ERECOVERY_REQUIRED', message: 'Z2K common rollback completed but Detect restoration is incomplete; durable recovery must reconcile the stable target.' }
	};
	let okResult = true, evidence = { ok: true, skipped: true };
	if (pending != null) {
		evidence = { ok: (testing ? testSeams.pendingWrite(pending, 'ROLLED_BACK') : z2k_pending_write(pending, 'ROLLED_BACK')), phase: 'ROLLED_BACK' };
		okResult = evidence.ok && (testing ? testSeams.pendingClear() : z2k_pending_clear());
	}
	if (!okResult) return {
		ok: false, recoveryRequired: true, detectHandled: true, detectPreserved: false,
		runtime: runtimeRollback, registry: registryRollback, source: sourceRollback, catalog: catalogRollback, strategy: strategyRollback, config: configRollback,
		detect: detectRollback, journal: journal, evidence: evidence,
		error: { code: 'ERECOVERY_REQUIRED', message: 'Z2K rollback completed but durable recovery evidence could not be closed.' }
	};
	return { ok: true, recoveryRequired: false, detectHandled: true, detectPreserved: false, runtime: runtimeRollback, registry: registryRollback, source: sourceRollback, catalog: catalogRollback, strategy: strategyRollback, config: configRollback, detect: detectRollback, journal: journal, evidence: evidence };
}
export const resource_center_test_rollback_transaction = function(input) {
	if (!object(input) || input.testOnly !== true || !object(input.seams)) return fail('EINPUT', 'Internal rollback test seam is restricted to controlled tests.');
	let seams = input.seams;
	if (type(seams.pendingLoad) != 'function' || type(seams.pendingWrite) != 'function' || type(seams.pendingClear) != 'function'
		|| type(seams.runtimeRollback) != 'function' || type(seams.registryList) != 'function' || type(seams.registryAlreadyRestored) != 'function'
		|| type(seams.registryRollback) != 'function' || type(seams.sourceRestore) != 'function' || type(seams.detectRestore) != 'function') return fail('EINPUT', 'Internal rollback test seam is incomplete.');
	seams.testOnly = true;
	return z2k_rollback_after_runtime_failure(input.selected || { id: 'z2k-curated-lua' }, input.applied || {}, input.diagnostics || {}, input.runtimeActivated === true, seams);
};
export const resource_center_test_guard_finish = function(input) {
	if (!object(input) || input.testOnly !== true || !object(input.publication) || !object(input.result) || !object(input.seams)
		|| type(input.seams.detectRestore) != 'function' || type(input.seams.detectFinalize) != 'function') return fail('EINPUT', 'Internal guard test seam is incomplete.');
	z2k_active_detect_publication = input.publication;
	let seams = { testOnly: true, detectRestore: input.seams.detectRestore, detectFinalize: input.seams.detectFinalize };
	let answer = z2k_runtime_guard_finish({ ok: true, owned: false }, null, [], input.result, seams);
	z2k_active_detect_publication = null;
	return answer;
};
export const resource_center_test_rollback_expected_revision = function(input) {
	if (!object(input) || input.testOnly !== true || !object(input.applied) || !object(input.listed) || !object(input.pending)) return fail('EINPUT', 'Internal rollback revision test seam is restricted to controlled tests.');
	return z2k_rollback_expected_revision(input.applied, input.listed, input.pending);
};
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
	return z2k_receipt_state_verified(state) && object(receipt)
		&& (receipt.schema == 'asset-activation-receipt.v2' || receipt.schema == 'asset-activation-receipt.v3') && receipt.bundleId == 'z2k-curated-lua'
		&& receipt.version == pending.targetVersion && receipt.sourceCommit == pending.targetCommit
		&& receipt.candidateSnapshotId == pending.candidateSnapshotId && receipt.membershipDigest == pending.membershipDigest
		&& receipt.committedRegistryRevision == pending.committedAssetRevision
		&& type(receipt.installedAuthorityRevision) == 'int'
		&& receipt.installedAuthorityRevision <= listed.revision;
}
export const resource_center_test_finalized_pending_matches = function(pending, listed) {
	if (!object(pending) || pending.testOnly !== true) return false;
	return z2k_finalized_pending_matches(pending, listed);
};
function z2k_finalized_runtime_matches(pending, listed, suppliedProof) {
	let authority = z2k_registry_receipt_state(listed), receipt = authority && authority.receipt;
	if (!authority || authority.state != 'COHERENT_VERIFIED' || !object(receipt) || receipt.schema != 'asset-activation-receipt.v3') return fail('ERECOVERY_REQUIRED', 'FINALIZED recovery requires a coherent V3 receipt before runtime verification.');
	let runtimeInput = { registry: listed };
	if (object(suppliedProof) && array(suppliedProof.staticBase)) runtimeInput.staticBase = suppliedProof.staticBase;
	let resolved = resolveInstalled(runtimeInput);
	if (!resolved.ok || resolved.lifecycleState != 'installed' || resolved.compositionStatus != 'canonical') return fail('ERECOVERY_REQUIRED', 'FINALIZED recovery could not resolve the canonical installed runtime composition.', { resolved: resolved });
	if (!string(pending.runtimeSnapshotId)
		|| resolved.snapshotId != pending.runtimeSnapshotId
		|| resolved.membershipDigest != pending.membershipDigest
		|| resolved.membershipDigest != receipt.membershipDigest)
		return fail('ERECOVERY_REQUIRED', 'FINALIZED recovery runtime identity is not bound to the durable candidate receipt.', { runtimeSnapshotId: resolved.snapshotId, expectedRuntimeSnapshotId: pending.runtimeSnapshotId, runtimeMembershipDigest: resolved.membershipDigest });
	let materializedEvidence = object(suppliedProof) && object(suppliedProof.materialized) ? suppliedProof.materialized : z2k_materialized_evidence(resolved, { removeTargets: [] });
	let materialized = verifyMaterialized(resolved, materializedEvidence);
	if (!materialized.ok) return fail('ERECOVERY_REQUIRED', 'FINALIZED recovery runtime materialization does not match the installed receipt.', { materialized: materialized.error });
	let processEvidence = object(suppliedProof) && object(suppliedProof.process) ? suppliedProof.process : null;
	if (processEvidence == null) {
		let readiness = z2k_runtime_readiness({ stage: 'recovery', expectedEnabled: true });
		if (!readiness.ok) return fail('ERECOVERY_REQUIRED', 'FINALIZED recovery runtime readiness could not be proven.', { readiness: readiness.error });
		processEvidence = z2k_runtime_evidence(resolved, readiness, false);
	}
	let process = verifyInstalledProcess(resolved, processEvidence);
	if (!process.ok) return fail('ERECOVERY_REQUIRED', 'FINALIZED recovery process identity does not match the installed receipt.', { process: process.error });
	return { ok: true, snapshotId: resolved.snapshotId, membershipDigest: resolved.membershipDigest, materialized: materialized, process: process };
}
export const resource_center_test_finalized_recovery = function(input) {
	if (!object(input) || input.testOnly !== true || !object(input.pending) || !object(input.listed)) return fail('EINPUT', 'Internal FINALIZED recovery test seam is restricted to controlled tests.');
	let matches = z2k_finalized_pending_matches(input.pending, input.listed);
	if (!matches) return fail('ERECOVERY_REQUIRED', 'Finalized test evidence does not match the installed authority.');
	return z2k_finalized_runtime_matches(input.pending, input.listed, input.runtimeProof);
};
function z2k_pending_detect_restore(pending) {
	return object(pending) && object(pending.detectPublication) ? z2k_detect_restore(pending.detectPublication) : { ok: true, skipped: true };
}

function z2k_active_strategy_snapshot() {
	let selection = null, catalog = null, config = null;
	try { selection = strategy_selection_get_readonly(); } catch (e) { selection = null; }
	try { catalog = strategy_catalog_generation_read(); } catch (e) { catalog = null; }
	try { config = transaction_config_snapshot(); } catch (e) { config = null; }
	let ids = [];
	if (catalog && catalog.ok === true && catalog.index && catalog.index.winners) for (let id in catalog.index.winners) push(ids, id);
	return {
		selected: selection && selection.ok === true ? selection.selected || null : null,
		revision: selection && selection.ok === true ? selection.revision : null,
		catalog: catalog && catalog.ok === true ? { generationId: catalog.index.generationId, indexDigest: catalog.index.indexDigest, ids: ids } : null,
		config: config && config.ok === true ? { bytes: config.bytes, sha256: config.sha256 } : null,
		runtimeEnabled: read_var('ENABLED')
	};
}

function z2k_strategy_preflight(target) {
	return runtime_strategy_preflight({ activeStrategy: target && target.activeStrategy || null,
		candidateCatalog: target && target.candidateCatalog || null,
		candidateRuntime: target && target.candidateRuntime || null });
}

function z2k_precommit_gate(target, candidate, detectStaged) {
	if (!object(detectStaged) || !object(detectStaged.candidate) || detectStaged.candidate.sha256 != target.detectArtifact.sha256)
		return fail('EVERIFY', 'staged Detect bytes do not match the prepared candidate digest.', { expectedSha256: target.detectArtifact && target.detectArtifact.sha256 || null, actualSha256: detectStaged && detectStaged.candidate && detectStaged.candidate.sha256 || null });
	let strategy = z2k_strategy_preflight(target);
	return strategy.ok === true ? { ok: true, strategy: strategy } : strategy;
}
function z2k_target_summary(target) {
	return target == null ? null : { targetVersion: target.targetVersion, operation: target.operation, installedVersion: target.previousVersion || null, targetCanApply: target.targetCanApply === true, targetAttentionState: target.targetAttentionState || 'unknown', targetBlockingReasons: target.targetBlockingReasons || [], targetReviewDetails: target.targetReviewDetails || [], assetCount: length(target.assets || []), removedCount: length(target.removeIds || []), runtimeBundleDigest: target.runtimeBundleDigest || null, dependencyClosure: target.dependencyClosure || null, strategyCount: target.strategyCount || null, z2kRelease: target.z2kRelease || null, manifestRevision: target.manifestRevision == null ? null : target.manifestRevision, compilerSnapshotDigest: target.compilerSnapshotDigest || null, nfqws2OptSha256: target.nfqws2OptSha256 || null, z2kCompatibilityIdentity: target.z2kCompatibilityIdentity || null, compatibilityIdentity: target.compatibilityIdentity || null, preparedAt: target.preparedAt };
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
		signed.unknownUnconsumed = plan.unknownUnconsumed || [];
		signed.compilerInputs = plan.compilerInputs || [];
		signed.dependencyGraph = plan.dependencyGraph || null;
		let token = plan_token(latestCheck.checkedAt, signed.manifest, signed.sourceCommit || signed.manifestRevision); signed.planToken = token; latestCheck.planToken = token;
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
	let engine = z2k_engine_runtime_projection();
	if (!engine || engine.ready !== true) return fail('EENGINE_REQUIRED', 'Сначала установите и запустите совместимый Zapret2 Engine.');
	let version = object(request) ? request.version : request;
	if (!string(version) || z2k_compare_versions(version, version) == null) return fail('EINPUT', 'Версия Z2K имеет недопустимый формат.');
	let resolved = z2k_resolve_version(version); if (!resolved.ok) return resolved;
	let detect = z2k_detect_candidate(resolved.manifest, resolved.commitSha, trim(command('uname -m').out));
	if (!detect.ok) return detect;
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
	let canonicalAssets = z2k_canonical_target_assets(resolved.version, resolved.commitSha, resolved.manifestSha256, classificationSnapshot.sha256, sizedTarget.assets, null);
	if (canonicalAssets == null) return fail('EZ2K_INCOMPATIBLE', 'Не удалось построить canonical runtime composition для выбранного release.');
	let preparedAt = time(), target = { schema: 2, targetSchema: 'z2k-target-v2', targetVersion: resolved.version, targetCommitSha: resolved.commitSha, targetCommit: resolved.commitSha, manifestSha256: resolved.manifestSha256, localFingerprint: localFingerprint, classificationSha256: classificationSnapshot.sha256, operation: operation, previousVersion: installed, baseRegistryRevision: listed.revision, targetCanApply: targetGate.canApply === true, targetAttentionState: targetGate.attentionState || 'none', targetBlockingReasons: targetGate.blockingReasons || [], targetReviewDetails: targetGate.reviewDetails || [], preparedAt: preparedAt, removeIds: removals.ids, removeTargets: removals.targets, assets: canonicalAssets, detectArtifact: detect, detectRuntimeTarget: Z2K_DETECT_TARGET };
	let priorStrategy = z2k_active_strategy_snapshot();
	target.activeStrategy = priorStrategy.selected;
	target.candidateCatalog = priorStrategy.catalog;
	target.candidateRuntime = { closureReady: false, nativeReady: false };
	// Compose once to obtain the membership identity, then bind the final
	// plan token and resolve again so the persisted candidate snapshot carries
	// the exact token consumed by the apply path.
	let candidate = resolveCandidate(target, { observedRegistryRevision: listed.revision, phase: 'prepare' });
	if (!candidate.ok) return candidate;
	let core = z2k_core_snapshot_for_target(resolved, candidate);
	if (!core.ok) return core;
	let compatibility = core.snapshot.z2kCompatibilityIdentity;
	for (let item in canonicalAssets) {
		item.z2kRelease = compatibility.release;
		item.manifestRevision = compatibility.manifestRevision;
		item.runtimeBundleDigest = compatibility.runtimeBundleDigest;
		item.z2kCompatibilityIdentity = compatibility;
		item.compatibilityIdentity = compatibility.digest;
	}
	target.z2kRelease = compatibility.release;
	target.manifestRevision = compatibility.manifestRevision;
	target.compilerSnapshotDigest = core.snapshot.compilerSnapshotDigest;
	target.nfqws2OptSha256 = core.snapshot.nfqws2OptSha256;
	target.runtimeBundleDigest = compatibility.runtimeBundleDigest;
	target.z2kCompatibilityIdentity = compatibility;
	target.compatibilityIdentity = compatibility.digest;
	target.strategyCount = 1 + length(core.snapshot.standaloneCandidates || []);
	target.compilerFileSha256 = core.snapshot.fileSha256;
	target.membershipDigest = candidate.membershipDigest; target.candidateSnapshotId = candidate.snapshotId; target.compositionSnapshotId = candidate.compositionSnapshotId;
	target.dependencyClosure = core.snapshot.entries[0].dependencyClosure;
	if (!object(target.dependencyClosure) || target.dependencyClosure.available !== true || !valid_digest(target.runtimeBundleDigest)) {
		target.targetCanApply = false;
		target.targetAttentionState = target.targetAttentionState == 'none' ? 'dependency-required' : target.targetAttentionState;
		push(target.targetBlockingReasons, 'Z2K_RUNTIME_DEPENDENCY_CLOSURE_REQUIRED');
	}
	target.candidateRuntime = { closureReady: target.dependencyClosure && target.dependencyClosure.available === true, nativeReady: true };
	let strategyGate = z2k_strategy_preflight(target);
	if (!strategyGate.ok) return strategyGate;
	// Bind the token only after the final dependency digest is known. The
	// persisted target validator intentionally recomputes this identity.
	target.planToken = z2k_target_token(target, preparedAt);
	if (target.planToken == null) return fail('EIO', 'Не удалось построить Z2K target snapshot.');
	candidate = resolveCandidate(target, { observedRegistryRevision: listed.revision });
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
function z2k_coherent_finalize_request(input) {
	if (!object(input) || !object(input.selected) || input.selected.id != 'z2k-curated-lua'
		|| !object(input.target) || !object(input.candidate) || !object(input.detectStaged)
		|| !object(input.detectStaged.candidate) || !object(input.activationEvidence)) return fail('EINPUT', 'coherent activation finalization input is incomplete');
	let target = input.target, candidate = input.candidate, detect = input.detectStaged.candidate;
	let sourceCommit = target.targetCommitSha || target.targetCommit, release = target.targetVersion;
	let manifestSeq = target.manifestSeq == null ? target.manifestRevision : target.manifestSeq;
	let membershipDigest = candidate.membershipDigest, candidateSnapshotId = candidate.snapshotId;
	if (!string(release) || !valid_commit(sourceCommit) || type(manifestSeq) != 'int' || !valid_digest(target.manifestSha256)
		|| !valid_digest(target.classificationSha256) || !valid_digest(target.compilerSnapshotDigest)
		|| !valid_digest(target.runtimeBundleDigest) || !valid_digest(input.catalogDigest)
		|| !valid_digest(target.compatibilityIdentity) || !z2k_compatibility_identity_valid(target.z2kCompatibilityIdentity)
		|| target.z2kCompatibilityIdentity.release != release || target.z2kCompatibilityIdentity.sourceCommit != lc(sourceCommit)
		|| target.z2kCompatibilityIdentity.compilerSnapshotDigest != target.compilerSnapshotDigest
		|| target.z2kCompatibilityIdentity.runtimeBundleDigest != target.runtimeBundleDigest
		|| !string(candidateSnapshotId) || !string(membershipDigest)
		|| !string(target.candidateSnapshotId) || target.candidateSnapshotId != candidateSnapshotId
		|| !string(target.membershipDigest) || target.membershipDigest != membershipDigest
		|| type(target.baseRegistryRevision) != 'int'
		|| type(input.committedAssetRevision) != 'int' || input.committedAssetRevision <= target.baseRegistryRevision
		|| input.activationEvidence.verified !== true || !string(detect.arch) || !valid_digest(detect.sha256)
		|| type(detect.byteSize) != 'int' || detect.byteSize < 1 || !valid_commit(detect.sourceCommit)
		|| lc(detect.sourceCommit) != lc(sourceCommit)) return fail('EINPUT', 'coherent activation finalization evidence is incomplete');
	let membership = [];
	for (let i = 0; i < length(candidate.runtimeAssets || []); i++) {
		let entry = candidate.runtimeAssets[i];
		if (!object(entry) || entry.type != 'lifecycle-managed' || entry.owner != 'z2k-core'
			|| (entry.kind != 'lua' && entry.kind != 'blob' && entry.kind != 'hostlist' && entry.kind != 'ipset')
			|| (entry.kind == 'lua' && (entry.role != 'lua-init' || type(entry.runtimeOrder) != 'int' || entry.runtimeOrder < 0))
			|| (entry.kind != 'lua' && (entry.role != 'dependency' || entry.runtimeOrder != null))) return fail('EINPUT', 'candidate runtime membership is not canonical', { id: entry && entry.id || null });
		push(membership, entry);
	}
	if (!length(membership)) return fail('EINPUT', 'coherent activation requires complete runtime membership');
	let detectIdentity = { arch: detect.arch, digest: detect.sha256, size: detect.byteSize, sourceCommit: sourceCommit };
	return { ok: true, request: { bundleId: input.selected.id, version: release, release: release, source: 'necronicle/z2k', sourceCommit: sourceCommit,
		manifestSha256: target.manifestSha256, classificationSha256: target.classificationSha256, manifestSeq: manifestSeq,
		candidateSnapshotId: candidateSnapshotId, membershipDigest: membershipDigest, baseRegistryRevision: target.baseRegistryRevision,
		z2kCompatibilityIdentity: target.z2kCompatibilityIdentity, compatibilityIdentity: target.compatibilityIdentity,
		compilerInputsDigest: target.compilerSnapshotDigest, catalogDigest: input.catalogDigest, runtimeBundleDigest: target.runtimeBundleDigest,
		detect: detectIdentity, detectIdentity: detectIdentity, runtimeMembership: membership, z2kMembership: membership,
		committedAssetRevision: input.committedAssetRevision, activationEvidence: input.activationEvidence } };
}
export const resource_center_test_coherent_finalize_request = function(input) {
	if (!object(input) || input.testOnly !== true) return fail('EINPUT', 'Internal coherent finalization test seam is restricted to controlled tests.');
	return z2k_coherent_finalize_request(input);
};

// Failure-injection seam for the actual pre-commit gate.  It deliberately
// exposes mutation counters so the focused test proves that a rejected Detect
// or strategy candidate never reaches Registry/runtime publication.
export const resource_center_test_precommit_failure = function(input) {
	if (!object(input) || input.testOnly !== true || (input.failure != 'detect-sha' && input.failure != 'strategy-preflight'))
		return fail('EINPUT', 'Internal pre-commit failure seam is restricted to controlled tests.');
	let mutations = { registry: 0, runtime: 0 }, activeIdentity = 'X', digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	let target = { detectArtifact: { sha256: digest }, activeStrategy: null, candidateCatalog: { ids: [] }, candidateRuntime: { closureReady: true, nativeReady: true } };
	let staged = { candidate: { sha256: digest } };
	if (input.failure == 'detect-sha') staged.candidate.sha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
	else {
		target.activeStrategy = { id: 'avatar-selected', canonicalStrategyId: 'avatar-selected', sourceId: 'avatar', selected: true };
		target.candidateRuntime = { closureReady: false, nativeReady: false };
	}
	let gate = z2k_precommit_gate(target, { lifecycleState: 'candidate' }, staged);
	if (gate.ok === true) { mutations.registry++; mutations.runtime++; activeIdentity = 'Y'; }
	return gate.ok === true ? { ok: true, mutations: mutations, activeIdentity: activeIdentity } : { ok: false, error: gate.error, mutations: mutations, activeIdentity: activeIdentity };
};

export const resource_center_test_post_materialize_failure = function(input) {
	let physical = 'Y';
	let result = runtime_materialize_failure_rollback({ testOnly: input && input.testOnly === true, failure: 'readiness', materializedIdentity: physical, priorIdentity: 'X', restore: function(previous) { physical = previous; return { ok: true, restored: true }; } });
	if (result && result.physicalIdentity == null) result.physicalIdentity = physical;
	return result;
};

function z2k_apply_prepared(request, selected, sourceValue, listed, diagPathUsed) {
	let state = load_check_state(), target = z2k_target_from_state(state), requestedVersion = request && request.targetVersion;
	if (!target || !string(requestedVersion) || requestedVersion != target.targetVersion || request.planToken != target.planToken || request.operation != target.operation || (request.installedVersion !== target.previousVersion)) return fail('ECHECK_STALE', 'Z2K update requires a matching prepared operation and installed baseline; prepare the release again.');
	listed = asset_registry_list(null);
	if (!listed.ok || type(target.baseRegistryRevision) != 'int') return fail('ECHECK_STALE', 'Z2K prepared operation has no authoritative Registry baseline; prepare the release again.');
	let candidate = resolveCandidate(target, { observedRegistryRevision: listed.revision });
	if (!candidate.ok) return candidate;
	let core = z2k_core_snapshot_for_target({ version: target.targetVersion, commitSha: target.targetCommitSha || target.targetCommit,
		manifestSha256: target.manifestSha256, manifest: { seq: target.manifestRevision } }, candidate);
	if (!core.ok) return core;
	let dependencyClosure = core.snapshot.entries[0].dependencyClosure;
	if (!z2k_compatibility_equal(core.snapshot.z2kCompatibilityIdentity, target.z2kCompatibilityIdentity)
		|| core.snapshot.compilerSnapshotDigest != target.compilerSnapshotDigest
		|| core.snapshot.nfqws2OptSha256 != target.nfqws2OptSha256
		|| !object(dependencyClosure) || dependencyClosure.available !== true || dependencyClosure.runtimeBundleDigest != target.runtimeBundleDigest)
		return fail('EDEPENDENCY', 'Z2K runtime dependency closure changed or is unavailable; prepare the release again.', { expectedRuntimeBundleDigest: target.runtimeBundleDigest, actualRuntimeBundleDigest: dependencyClosure && dependencyClosure.runtimeBundleDigest || null });
	let fingerprint = z2k_local_fingerprint(target.assets, listed, target.removeIds);
	if (fingerprint == null || fingerprint != target.localFingerprint) return fail('ECHECK_STALE', 'Z2K local resources changed after preparation; prepare the release again.');
	let classificationSnapshot = z2k_read_classification_snapshot(), classification = classificationSnapshot && classificationSnapshot.value;
	if (classificationSnapshot == null || classificationSnapshot.sha256 != target.classificationSha256) return fail('ECHECK_STALE', 'Z2K runtime classification changed after preparation; prepare the release again.');
	let membership = z2k_target_membership_compatible(listed, target.assets, classification);
	if (!membership.ok) return membership;
	let removals = z2k_target_removals(listed, target.assets, classification);
	if (!removals.ok || !same_id_set(removals.ids, target.removeIds) || !same_removal_descriptors(removals.targets, target.removeTargets)) return fail('ECHECK_STALE', 'Z2K managed membership or removal mapping changed after preparation; prepare the release again.');
	let sourceBefore = null;
	try { sourceBefore = strategy_sources.strategy_sources_get(); } catch (e) { sourceBefore = null; }
	let consumed = consume_prepared_target(state, target);
	if (!consumed.ok) return consumed;
	let root = null, paths = [], guard = null, staged = [], detectPrepared = null, detectIntentWritten = false, applied = null, committedAssetRevision = null, registryCommitted = false, runtimeActivated = false,
		diagnostics = { pathUsed: diagPathUsed, targetVersion: target.targetVersion, operation: target.operation, planned: length(target.assets), removePlanned: length(target.removeIds || []), downloaded: 0, verified: 0, staged: 0, applied: 0, removed: 0, postflightMatched: 0, skipped: [], targetAssets: [] };
	try {
		guard = z2k_runtime_guard_acquire();
		if (!guard.ok) return z2k_runtime_guard_finish(guard, root, paths, guard);
		root = make_stage_root();
		if (root == null) return z2k_runtime_guard_finish(guard, root, paths, fail('ETARGET', 'resource staging directory is unavailable'));
		let detectStage = root + '/z2k-detect', detectCandidate = target.detectArtifact;
		push(paths, detectStage);
		if (!object(detectCandidate) || detectCandidate.runtimeTarget != Z2K_DETECT_TARGET) return z2k_runtime_guard_finish(guard, root, paths, fail('EDETECT_UNAVAILABLE', 'prepared Core target has no Detect artifact.'));
		let detectStaged = z2k_detect_stage(detectCandidate, detectStage);
		if (!detectStaged.ok) return z2k_runtime_guard_finish(guard, root, paths, detectStaged);
		diagnostics.detect = { sourcePath: detectCandidate.sourcePath, arch: detectCandidate.arch, sha256: detectCandidate.sha256, byteSize: detectStaged.candidate.byteSize, runtimeTarget: Z2K_DETECT_TARGET, result: 'staged' };
		let precommit = z2k_precommit_gate(target, candidate, detectStaged);
		if (!precommit.ok) return z2k_runtime_guard_finish(guard, root, paths, precommit);
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
		push(paths, path); push(staged, { type: z2k_registry_asset_type(item), id: item.id, name: item.name, stagedPath: path, sha256: item.sha256 || item.contentSha256, byteSize: stat(path).size, expectedRevision: before && before.revision || null, dependencies: item.dependencies || [], provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: target.targetCommitSha || target.targetCommit, sourcePath: item.sourcePath, bundleId: selected.id, version: target.targetVersion, z2kRelease: target.z2kRelease, manifestRevision: target.manifestRevision, runtimeBundleDigest: target.runtimeBundleDigest, compilerSnapshotDigest: target.compilerSnapshotDigest, z2kCompatibilityIdentity: target.z2kCompatibilityIdentity, compatibilityIdentity: target.compatibilityIdentity } });
		diagnostics.targetAssets[i].result = 'staged';
	}
	diagnostics.staged = length(staged);
	let beforeCommit = asset_registry_list(null), cas = beforeCommit.ok ? runtime_composition_candidate_cas(candidate, beforeCommit.revision, 'pre-commit', null) : fail('ESTALE', 'Z2K Registry could not be re-read before commit.');
	if (!cas.ok) return z2k_runtime_guard_finish(guard, root, paths, cas);
	let priorAuthority = z2k_registry_receipt_state(listed);
	// Capture the old stable Detect state before writing the single durable Core
	// intent. The target move is deliberately after PREPARED is durable.
	detectPrepared = z2k_detect_prepare(detectStaged.candidate, detectStage);
	if (!detectPrepared.ok) return z2k_runtime_guard_finish(guard, root, paths, detectPrepared);
	// The /tmp/z2m-resource-update/jobs worker file is only a progress mirror;
	// this durable pending-activation record is the recovery authority.
	let pending = { schema: 1, candidateSnapshotId: candidate.snapshotId, compositionSnapshotId: candidate.compositionSnapshotId, membershipDigest: candidate.membershipDigest,
		baseRegistryRevision: target.baseRegistryRevision, targetVersion: target.targetVersion, targetCommit: target.targetCommitSha || target.targetCommit,
		planToken: target.planToken, z2kCompatibilityIdentity: target.z2kCompatibilityIdentity,
		rollbackIdentity: { registryRevision: listed.revision, receipt: priorAuthority.receipt || null, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' },
		priorReceipt: priorAuthority.receipt || null, priorRegistryRevision: listed.revision, priorRegistryMembership: listed.assets || [],
		priorRuntimeComposition: resolveInstalled({ registry: listed }) || null,
		priorDetect: detectPrepared.prior || null,
		priorCatalog: priorStrategy.catalog || null, priorActiveStrategy: priorStrategy.selected || null,
		priorConfig: priorStrategy.config || null, priorRuntimeEnabled: priorStrategy.runtimeEnabled,
		detectPublication: detectPrepared,
		sourceActivation: sourceBefore && sourceBefore.sources && sourceBefore.sources.z2k ? {
			currentSnapshotId: sourceBefore.sources.z2k.currentSnapshotId || null,
			lastKnownGoodSnapshotId: sourceBefore.sources.z2k.lastKnownGoodSnapshotId || null
		} : { currentSnapshotId: null, lastKnownGoodSnapshotId: null },
		sourceRestoreRequired: true, phase: 'PREPARED' };
	if (!z2k_pending_write(pending, 'PREPARED')) {
		let detectDiscard = z2k_detect_restore(detectPrepared), pendingDiscard = z2k_pending_clear();
		return z2k_runtime_guard_finish(guard, root, paths, fail(detectDiscard.ok && pendingDiscard ? 'EWRITE' : 'EROLLBACK', 'Durable PREPARED Detect intent could not be persisted; no stable Detect move was committed.', { detect: detectDiscard, pendingCleared: pendingDiscard }));
	}
	detectIntentWritten = true;
	let detectPublished = z2k_detect_publish_prepared(detectPrepared, detectStage);
	if (!detectPublished.ok) {
		let detectRollback = z2k_detect_restore(detectPrepared), pendingCleared = z2k_pending_clear();
		return z2k_runtime_guard_finish(guard, root, paths, fail(detectRollback.ok && pendingCleared ? (detectPublished.error && detectPublished.error.code || 'EWRITE') : 'EROLLBACK', detectRollback.ok && pendingCleared ? 'Detect publication failed and its PREPARED journal was restored and cleared.' : 'Detect publication failed and its PREPARED journal could not be safely closed.', { detect: detectPublished, restore: detectRollback, pendingCleared: pendingCleared }));
	}
	z2k_active_detect_publication = detectPublished;
	diagnostics.detect.result = 'published'; diagnostics.detect.prior = detectPublished.prior;
		applied = asset_registry_apply_bundle({ bundleId: selected.id, version: target.targetVersion, source: 'necronicle/z2k', sourceCommit: target.targetCommitSha || target.targetCommit, expectedRegistryRevision: target.baseRegistryRevision, assets: staged, removeIds: target.removeIds, removals: target.removeTargets });
		if (!applied.ok) {
			let appliedRevision = applied && (applied.committedAssetRevision || applied.revision);
			if (type(appliedRevision) == 'int') {
				registryCommitted = true;
				let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: appliedRevision }, diagnostics, false);
				return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? (applied.error && applied.error.code || 'EWRITE') : 'EROLLBACK', rollback.ok ? 'Z2K Registry apply failed after mutation and was rolled back.' : 'Z2K Registry apply failed after mutation and rollback could not be completed.', { apply: applied, rollback: rollback, diagnostics: diagnostics }));
			}
			return z2k_runtime_guard_finish(guard, root, paths, applied);
		}
		registryCommitted = true;
		diagnostics.applied = applied.updated || length(staged);
		diagnostics.removed = applied.removed || 0;
		committedAssetRevision = applied.committedAssetRevision || applied.revision;
		pending.committedAssetRevision = committedAssetRevision;
		if (!z2k_pending_write(pending, 'COMMITTED')) {
			let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, false);
			return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Committed activation evidence could not be persisted; Registry state was rolled back.' : 'Committed activation evidence failed and Registry/runtime/source rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
		}
	let after = asset_registry_list(null), committedCandidate = after.ok ? resolveCandidate(target, { observedRegistryRevision: after.revision, phase: 'post-commit', committedAssetRevision: committedAssetRevision }) : fail('ESTALE', 'Z2K Registry could not be read after bundle commit.');
	if (!committedCandidate.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, false);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'ESTALE' : 'EROLLBACK', rollback.ok ? 'Z2K Registry changed after commit and all lifecycle owners were rolled back.' : 'Z2K Registry changed after commit and rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
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
	runtimeActivated = true;
	if (!z2k_pending_write(pending, 'MATERIALIZED')) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Materialized activation evidence failed and all lifecycle owners were rolled back.' : 'Materialized activation evidence failed and rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
	}
	let materialized = verifyMaterialized(committedCandidate, z2k_materialized_evidence(committedCandidate, target));
	diagnostics.materializedVerification = materialized;
	if (!materialized.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K materialization verification failed and was rolled back.' : 'Z2K materialization verification failed and rollback could not be completed.', { materialized: materialized.error, rollback: rollback, diagnostics: diagnostics }));
	}
	let activationEvidence = z2k_runtime_evidence(committedCandidate, runtime.restart, true), activationProof = activationEvidence.verified === true ? verifyActivationProcess(committedCandidate, activationEvidence) : activationEvidence;
	diagnostics.activationVerification = activationProof;
	if (!activationProof.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K activation process verification failed and was rolled back.' : 'Z2K activation process verification failed and rollback could not be completed.', { activation: activationProof.error, rollback: rollback, diagnostics: diagnostics }));
	}
	// Native validation resolves the canonical installed composition. Publish the
	// source only after the candidate/runtime proof is complete.
	let finalizedSource = null;
	try { finalizedSource = z2k_source_refresh.strategy_source_z2k_finalize_core_snapshot({
		snapshot: core.snapshot, dependencyInventory: z2k_target_dependency_inventory(committedCandidate)
	}); } catch (e) { finalizedSource = fail('EINTERNAL', 'Z2K source snapshot native validation raised an exception.', { detail: text(e) }); }
	if (!finalizedSource || finalizedSource.ok !== true || !object(finalizedSource.snapshot)
		|| !z2k_compatibility_equal(finalizedSource.snapshot.z2kCompatibilityIdentity, target.z2kCompatibilityIdentity)
		|| finalizedSource.snapshot.entryCount != target.strategyCount) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EPREFLIGHT' : 'EROLLBACK', rollback.ok ? 'Z2K official strategy snapshot failed native validation after runtime activation and was rolled back.' : 'Z2K official strategy snapshot failed native validation and rollback could not be completed.', { source: finalizedSource || null, rollback: rollback, diagnostics: diagnostics }));
	}
	core.snapshot = finalizedSource.snapshot;
	if (!z2k_pending_write(pending, 'PROCESS_VERIFIED')) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Process verification evidence failed and all lifecycle owners were rolled back.' : 'Process verification evidence failed and rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
	}
	let sourceInstalled = null;
	try { sourceInstalled = strategy_sources.strategy_source_install_verified_snapshot('z2k', { verified: true, snapshot: core.snapshot }); }
	catch (e) { sourceInstalled = null; }
	if (!sourceInstalled || sourceInstalled.ok !== true) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Z2K strategy source activation failed and was rolled back.' : 'Z2K strategy source activation failed and rollback could not be completed.', { source: sourceInstalled, rollback: rollback, diagnostics: diagnostics }));
	}
	// Catalog publication follows source activation and is itself a lifecycle
	// owner. Persist the restore obligation before publishing so a crash in the
	// following window cannot leave a new catalog paired with restored sources.
	pending.catalogRestoreRequired = true;
	if (!z2k_pending_write(pending, 'SOURCE_ACTIVATED')) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Z2K source activation evidence failed and all lifecycle owners were rolled back.' : 'Z2K source activation evidence failed and rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
	}
	let catalogRebuilt = null;
	try { catalogRebuilt = catalog_refresh_rebuild(); } catch (e) { catalogRebuilt = null; }
	if (!catalogRebuilt || catalogRebuilt.ok !== true) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EINDEX' : 'EROLLBACK', rollback.ok ? 'Z2K catalog publication failed and was rolled back.' : 'Z2K catalog publication failed and rollback could not be completed.', { catalog: catalogRebuilt, rollback: rollback, diagnostics: diagnostics }));
	}
	let finalizeRequest = z2k_coherent_finalize_request({ selected: selected, target: target, candidate: committedCandidate,
		detectStaged: detectStaged, activationEvidence: activationEvidence, committedAssetRevision: committedAssetRevision,
		catalogDigest: catalogRebuilt.indexDigest });
	if (!finalizeRequest.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EINPUT' : 'EROLLBACK', rollback.ok ? 'Coherent activation evidence was unavailable; all lifecycle owners were rolled back before receipt mutation.' : 'Coherent activation evidence was unavailable and rollback could not be completed.', { finalize: finalizeRequest.error, rollback: rollback, diagnostics: diagnostics }));
	}
	let finalized = asset_registry_finalize_activation(finalizeRequest.request);
	if (!finalized.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, applied, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'ESTALE' : 'EROLLBACK', rollback.ok ? 'Z2K activation finalization lost its Registry CAS.' : 'Z2K activation finalization failed and rollback could not be completed.', { finalize: finalized.error, rollback: rollback, diagnostics: diagnostics }));
	}
	let finalizedListed = asset_registry_list(null), finalizedRuntime = finalizedListed.ok ? resolveInstalled({ registry: finalizedListed }) : fail('ESTATE', 'Z2K installed runtime authority could not be read after receipt finalization.');
	if (!finalizedRuntime.ok || finalizedRuntime.lifecycleState != 'installed' || finalizedRuntime.compositionStatus != 'canonical'
		|| finalizedRuntime.membershipDigest != committedCandidate.membershipDigest) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, true);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EVERIFY' : 'EROLLBACK', rollback.ok ? 'Z2K finalized receipt could not be bound to the canonical installed runtime identity.' : 'Z2K finalized receipt/runtime identity failed and rollback could not be completed.', { runtime: finalizedRuntime, rollback: rollback, diagnostics: diagnostics }));
	}
	pending.runtimeSnapshotId = finalizedRuntime.snapshotId;
	// The receipt now carries the exact catalog digest. Clearing the catalog
	// restore obligation before FINALIZED is durable makes recovery a proof of
	// the new catalog rather than an instruction to rebuild the old one.
	pending.catalogRestoreRequired = false;
	if (!z2k_pending_write(pending, 'FINALIZED')) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, runtimeActivated);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Finalized activation evidence could not be persisted; Registry/runtime/source state was rolled back.' : 'Finalized activation evidence failed and rollback could not be completed.', { rollback: rollback, diagnostics: diagnostics }));
	}
	let reconciled = z2k_reconcile_after_mutation(target);
	diagnostics.postMutationCheckState = reconciled;
	if (!reconciled.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, runtimeActivated);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Z2K post-mutation reconciliation failed and was rolled back.' : 'Z2K post-mutation reconciliation failed and rollback could not be completed.', { mutationCompleted: true, reconciliation: reconciled, rollback: rollback, diagnostics: diagnostics }));
	}
	let detectFinalized = z2k_detect_finalize(z2k_active_detect_publication);
	if (!detectFinalized.ok) {
		let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, runtimeActivated);
		return z2k_runtime_guard_finish(guard, root, paths, fail(rollback.ok ? 'EWRITE' : 'EROLLBACK', rollback.ok ? 'Z2K Detect finalization failed and the lifecycle was rolled back.' : 'Z2K Detect finalization failed and rollback could not be completed.', { detect: detectFinalized, rollback: rollback, diagnostics: diagnostics }));
	}
	// Once Detect rollback state is closed, the FINALIZED pending record is the
	// durable coherent pair: Registry receipt, runtime/source activation, and the
	// stable Detect bytes all describe the same candidate. If clearing it fails,
	// leave that record for recovery instead of restoring Detect alone.
	z2k_active_detect_publication = null;
	if (!z2k_pending_clear()) return z2k_runtime_guard_finish(guard, root, paths, fail('ERECOVERY_REQUIRED', 'Z2K activation is coherent but finalized evidence could not be cleared; recovery must verify the receipt and stable Detect identity.', { mutationCompleted: true, durableRecovery: 'FINALIZED', invariant: 'Registry receipt, runtime/source activation, and stable Detect candidate remain paired.', detect: detectFinalized, diagnostics: diagnostics }));
	return z2k_runtime_guard_finish(guard, root, paths, { ok: true, bundleId: selected.id, targetVersion: target.targetVersion, operation: target.operation, updated: diagnostics.applied, revision: finalized.installedAuthorityRevision, committedAssetRevision: committedAssetRevision, rollbackAvailable: true, diagnostics: diagnostics, planToken: null });
	} catch (e) {
		let failure = fail('EINTERNAL', 'Z2K lifecycle failed while the intentional runtime guard was active.', { detail: text(e), diagnostics: diagnostics });
		if (object(detectPrepared) && registryCommitted !== true && z2k_active_detect_publication == null) {
			let detectDiscard = z2k_detect_restore(detectPrepared), pendingDiscard = z2k_pending_clear();
			failure = fail(detectDiscard.ok && pendingDiscard ? 'EINTERNAL' : 'EROLLBACK', failure.error.message, { detail: failure.error.detail, detect: detectDiscard, pendingCleared: pendingDiscard, diagnostics: diagnostics });
		}
		if (registryCommitted) {
			let rollback = z2k_rollback_after_runtime_failure(selected, { ...applied, committedAssetRevision: committedAssetRevision }, diagnostics, runtimeActivated);
			failure = fail(rollback.ok ? 'EINTERNAL' : 'EROLLBACK', rollback.ok ? failure.error.message : 'Z2K lifecycle failed after Registry mutation and rollback could not be completed.', { detail: failure.error.detail, rollback: rollback, diagnostics: diagnostics });
		}
		return z2k_runtime_guard_finish(guard, root, paths, failure);
	}
}
export const resource_center_status = function () {
	// CHECK_STATE remains the source of the last network check and manifest, but
	// the saved manifest is re-projected through the current pure planner below.
	// This keeps status network-free while making installed policy changes visible
	// without waiting for another upstream fetch. An explicit resources_check still
	// refreshes CHECK_STATE via save_check_state().
	let loaded = load_manifest(); if (!loaded.ok) return loaded;
	let persisted = load_check_state(), latestCheck = persisted && persisted.latestCheck;
	let activeZ2KManifest = latestCheck && latestCheck.signed && latestCheck.signed.ok === true ? latestCheck.signed.manifest : null;
	let answer = build_status(loaded.manifest, null, activeZ2KManifest);
	if (!answer.ok) return answer;
	let local = z2k_local_projection(loaded.manifest);
	let remote = latestCheck ? z2k_projection(latestCheck.signed, true) : z2k_projection(null);
	let engine = z2k_engine_runtime_projection();
	answer.installed = z2k_annotate_installed(answer.installed, local.dependencyClosure);
	remote.local = local;
	remote.coherence = strategy_coherence(local, remote);
	let runtimeSummary = z2k_runtime_summary(local, remote, engine, z2k_static_managed_count(answer.installed, local), answer.installed);
	z2k_apply_runtime_summary(remote, local, runtimeSummary);
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
function z2k_status_collection(value) {
	if (array(value)) return value;
	if (!object(value)) return value;
	let out = {};
	for (let key in value) out[key] = null;
	return out;
}
function z2k_status_copy(value, names) {
	let out = {};
	if (!object(value)) return out;
	for (let i = 0; i < length(names); i++) {
		let key = names[i];
		out[key] = value[key];
	}
	return out;
}
function z2k_status_closure(value) {
	if (!object(value)) return value;
	let out = z2k_status_copy(value, ['schema', 'available', 'resolution', 'missing', 'counts',
		'runtimeBundleDigest', 'sourceCommit', 'compilerSnapshotDigest', 'nfqws2OptSha256',
		'structurallyCompilable']);
	if (value.missing != null) out.missing = z2k_status_collection(value.missing);
	return out;
}
function z2k_status_runtime(value) {
	if (!object(value)) return value;
	let out = z2k_status_copy(value, ['schema', 'installedRelease', 'availableRelease', 'health',
		'updateState', 'attentionState', 'integrity', 'integrityOk', 'strategies', 'counts',
		'staticManagedCount', 'runtimeBundleDigest', 'sourceCommit', 'blockingReviews',
		'advisoryReviews', 'unknownUnconsumed', 'rebases', 'canApply']);
	if (value.dependencyClosure != null) out.dependencyClosure = z2k_status_closure(value.dependencyClosure);
	let nested = ['engine', 'reconciliation', 'coherence', 'identity'];
	for (let i = 0; i < length(nested); i++) {
		let key = nested[i];
		if (value[key] != null) out[key] = value[key];
	}
	return out;
}
function z2k_status_local(value) {
	if (!object(value)) return value;
	let out = z2k_status_copy(value, ['installed', 'integrity', 'integrityOk', 'lua', 'baselineMatched',
		'runtimeMatched', 'revision', 'installedAuthorityRevision', 'commit', 'provenance',
		'checkedAt', 'installedRelease', 'runtimeBundleDigest', 'strategyCount']);
	if (value.dependencyClosure != null) out.dependencyClosure = z2k_status_closure(value.dependencyClosure);
	if (value.runtimeSummary != null) out.runtimeSummary = z2k_status_runtime(value.runtimeSummary);
	return out;
}
function z2k_status_graph(value) {
	if (!object(value)) return value;
	let out = {};
	for (let key in value) {
		if (key == 'schema' || key == 'registryAvailable') out[key] = value[key];
		else out[key] = z2k_status_collection(value[key]);
	}
	return out;
}
function z2k_status_installed(value) {
	if (!array(value)) return value;
	let out = [];
	for (let i = 0; i < length(value); i++) {
		let row = value[i];
		if (!object(row)) continue;
		push(out, z2k_status_copy(row, ['id', 'type', 'name', 'sourcePath', 'path', 'ownership',
			'revision', 'contentSha256', 'byteSize', 'state', 'status', 'source', 'sourceCommit', 'semanticKind',
			'dependencyClass', 'runtimeTarget', 'runtimeRole', 'semanticOwner']));
	}
	return out;
}
function z2k_status_review_details(value) {
	if (!array(value)) return value;
	let out = [];
	for (let i = 0; i < length(value); i++) {
		let row = value[i];
		if (!object(row)) continue;
		push(out, z2k_status_copy(row, ['id', 'path', 'type', 'summary', 'summarySource']));
	}
	return out;
}
function z2k_status_projection(value) {
	if (!object(value)) return value;
	let out = z2k_status_copy(value, ['status', 'updateState', 'attentionState', 'canApply', 'updates',
		'removedItems', 'rebases', 'reviews', 'advisoryReviews', 'blockingReviews', 'blockingReasons',
		'reviewDetails', 'unknownUnconsumed', 'compilerInputs', 'runtimeBundleDigest', 'strategyCount',
		'planToken', 'trustMode', 'verified', 'source', 'sourceCommit', 'manifestRevision',
		'z2kCompatibilityIdentity', 'compatibilityIdentity', 'candidateStrategyRevision', 'manifest',
		'availableRelease', 'health', 'integrity', 'integrityOk', 'installedRelease', 'staticManagedCount',
		'checkedAt', 'preparedTarget', 'reconciliation', 'coherence', 'selectedVersion']);
	if (value.reviewDetails != null) out.reviewDetails = z2k_status_review_details(value.reviewDetails);
	if (value.dependencyGraph != null) out.dependencyGraph = z2k_status_graph(value.dependencyGraph);
	if (value.dependencyClosure != null) out.dependencyClosure = z2k_status_closure(value.dependencyClosure);
	if (value.local != null) out.local = z2k_status_local(value.local);
	if (value.runtimeSummary != null) out.runtimeSummary = z2k_status_runtime(value.runtimeSummary);
	return out;
}
export const resource_center_status_summary = function () {
	let answer = resource_center_status();
	if (!object(answer) || answer.ok !== true) return answer;
	let out = {
		ok: true,
		schema: answer.schema,
		checkedAt: answer.checkedAt == null ? null : answer.checkedAt,
		manifest: answer.manifest,
		sources: answer.sources,
		installed: z2k_status_installed(answer.installed),
		updates: answer.updates,
		summary: answer.summary,
		autoCheck: answer.autoCheck,
		z2k: z2k_status_projection(answer.z2k),
		signedSources: answer.signedSources,
		bounded: true
	};
	if (length(sprintf('%J', out)) > Z2K_STATUS_RPC_MAX_BYTES)
		return fail('EBOUNDS', 'resource center status exceeds the bounded RPC response budget',
			{ maxBytes: Z2K_STATUS_RPC_MAX_BYTES });
	return out;
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
	let engine = z2k_engine_runtime_projection();
	answer.installed = z2k_annotate_installed(answer.installed, local.dependencyClosure);
	remote.local = local;
	remote.coherence = strategy_coherence(local, remote);
	let runtimeSummary = z2k_runtime_summary(local, remote, engine, z2k_static_managed_count(answer.installed, local), answer.installed);
	z2k_apply_runtime_summary(remote, local, runtimeSummary);
	remote.checkedAt = checkedAt;
	remote.planToken = signed.ok === true ? plan_token(checkedAt, signed.manifest, signed.sourceCommit || signed.manifestRevision) : null;
	if (signed.ok === true && remote.planToken != null) signed.planToken = remote.planToken;
	answer.planToken = remote.planToken;
	answer.z2k = remote;
	answer.z2kCoherence = remote.coherence;
	answer.signedSources = { z2k: { state: signed.ok ? (signed.status == 'current' ? 'current' : 'attention') : 'error', status: signed.ok ? (signed.trustMode == 'allow-untrusted' ? 'Источник разрешён без проверки подписи' : signed.status) : 'Ошибка проверки источника', checkMode: signed.trustMode == 'allow-untrusted' ? 'allow-untrusted' : 'signed-manifest', trustMode: signed.trustMode || null, verified: signed.ok === true && signed.trustMode != 'allow-untrusted', evidence: signed.ok ? { repository: signed.source.repository, branch: signed.source.branch, commit: signed.source.commit || signed.sourceCommit || null, trustMode: signed.trustMode || null, manifestSeq: signed.manifest.seq, manifestCurrent: signed.manifest.current } : { code: signed.error && signed.error.code || 'EZ2K_CHECK_FAILED', message: signed.error && signed.error.message || 'Z2K source check failed' } } };
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

function z2k_reconcile_legacy_pending(pending) {
	// An exact restored V1 identity can be repaired by the supported same-release
	// FRESH reconciliation. This establishes a new canonical v2 activation
	// through the normal prepare/apply transaction; it never guesses composition.
	let prepared = resource_center_prepare_version({ version: pending.targetVersion });
	if (!prepared || prepared.ok !== true) return prepared || fail('ERECOVERY_REQUIRED', 'V1 reconciliation preparation failed.');
	let target = z2k_target_from_state(load_check_state());
	if (!target || target.targetVersion != pending.targetVersion || !string(target.planToken)) return fail('ERECOVERY_REQUIRED', 'V1 reconciliation did not persist a complete prepared target.');
	let applied = resource_center_update({ confirm: true, bundleId: 'z2k-curated-lua', targetVersion: target.targetVersion,
		planToken: target.planToken, operation: target.operation, installedVersion: target.previousVersion });
	return applied && applied.ok === true ? applied : fail('ERECOVERY_REQUIRED', 'V1 reconciliation transaction did not complete safely.', { result: applied || null });
}

export const resource_center_recover_pending = function() {
	let marker = stat(Z2K_PENDING_ACTIVATION);
	if (marker == null) return { ok: true, recovered: false, state: 'none' };
	let pending = z2k_pending_load();
	if (pending == null) return fail('ERECOVERY_REQUIRED', 'Durable Z2K activation evidence is unreadable; refusing to infer recovery from runtime files.');
	if (!z2k_pending_identity_valid(pending)) return fail('ERECOVERY_REQUIRED', 'Durable Z2K activation evidence is incomplete; refusing recovery.');
	if (pending.phase == 'PREPARED') {
		let detect = z2k_pending_detect_restore(pending);
		return detect.ok && z2k_pending_clear() ? { ok: true, recovered: true, state: 'prepared-cleared', detect: detect } : fail('ERECOVERY_REQUIRED', 'Prepared Z2K activation evidence could not be safely closed.', { detect: detect });
	}
	if (pending.phase == 'ROLLED_BACK') {
		let detect = z2k_pending_detect_restore(pending);
		return detect.ok && z2k_pending_clear() ? { ok: true, recovered: true, state: 'rolled-back-cleared', detect: detect } : fail('ERECOVERY_REQUIRED', 'Rolled-back Z2K activation evidence could not be safely closed.', { detect: detect });
	}
	if (pending.phase == 'FINALIZED') {
		let listedFinalized = asset_registry_list(null), matches = z2k_finalized_pending_matches(pending, listedFinalized), runtime = matches ? z2k_finalized_runtime_matches(pending, listedFinalized, null) : fail('ERECOVERY_REQUIRED', 'Finalized Z2K activation evidence does not match the installed authority.'), detect = matches && runtime.ok ? (object(pending.detectPublication) ? z2k_detect_finalize(pending.detectPublication) : { ok: true, skipped: true }) : fail('ERECOVERY_REQUIRED', 'Finalized Z2K runtime evidence could not be verified.');
		return matches && runtime.ok && detect.ok && z2k_pending_clear() ? { ok: true, recovered: true, state: 'finalized-cleared', runtime: runtime, detect: detect } : fail('ERECOVERY_REQUIRED', 'Finalized Z2K activation evidence could not be safely closed.', { runtime: runtime, detect: detect });
	}
	if (pending.phase != 'COMMITTED' && pending.phase != 'MATERIALIZED' && pending.phase != 'PROCESS_VERIFIED' && pending.phase != 'ROLLING_BACK') return fail('ERECOVERY_REQUIRED', 'Unknown Z2K activation phase cannot be recovered safely.', { phase: pending.phase });
	let runtimeActivated = pending.phase == 'MATERIALIZED' || pending.phase == 'PROCESS_VERIFIED' || pending.phase == 'ROLLING_BACK';
	let rollback = z2k_rollback_after_runtime_failure({ id: 'z2k-curated-lua' }, { committedAssetRevision: pending.committedAssetRevision }, { recovery: true, phase: pending.phase }, runtimeActivated);
	if (!rollback.ok && rollback.runtime && rollback.runtime.restored === true && z2k_pending_legacy_reconciliation_eligible(pending, asset_registry_list(null))) {
		let reconciled = z2k_reconcile_legacy_pending(pending);
		if (reconciled && reconciled.ok === true) return { ok: true, recovered: true, state: 'reconciled-v2', reconciliation: reconciled, rollback: rollback };
		return fail('ERECOVERY_REQUIRED', 'V1 runtime recovery requires a same-release reconciliation, but the canonical transaction did not complete.', { rollback: rollback, reconciliation: reconciled || null });
	}
	if (!rollback.ok) return fail('ERECOVERY_REQUIRED', 'Z2K activation recovery could not prove safe compensation.', { rollback: rollback, phase: pending.phase });
	return { ok: true, recovered: true, state: 'rolled-back', rollback: rollback };
};
