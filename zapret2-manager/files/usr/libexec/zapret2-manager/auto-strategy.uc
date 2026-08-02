'use strict';

// Persistent state only.  Triggers and orchestration are deliberately kept in
// later milestones so this module remains the single, auditable state owner.
import { readfile, writefile, mkdir, unlink, popen } from 'fs';
import { health_matrix_start, health_matrix_get } from './jobs.uc';
import { orchestra_run_start, orchestra_run_status, orchestra_run_load, orchestra_run_stop, orchestra_service_manifest, orchestra_preview_best, orchestra_apply_best, orchestra_apply_status, proc_starttime, run } from './orchestra-run.uc';
import { verify_service_targets } from './orchestra-evidence.uc';

const AUTO_STATE_PATH = '/etc/zapret2-manager/auto-strategy.json';
const AUTO_STATE_DIR = '/etc/zapret2-manager';
const AUTO_LAST_GOOD_PATH = '/etc/zapret2-manager/auto-strategy-last-good.json';
const AUTO_LAST_GOOD_MAX_BYTES = 16384;
const MAX_SERVICES = 16;
const MAX_FAILURES = 99;
const BOOT_DELAY_SEC = 90;
const HEALTH_INTERVAL_SEC = 30;
const SCAN_COOLDOWN_SEC = 900;
const INFRA_BACKOFF_BASE_SEC = 15;
const INFRA_BACKOFF_MAX_SEC = 300;
const STRATEGY_FAILURES_TO_SCAN = 3;
const AUTO_RPC_REQUEST_LIMIT = 16;
const PHASES = ['disabled', 'waiting-network', 'healthy', 'degraded', 'scanning', 'applying', 'verifying', 'recovering', 'cooldown', 'failed'];

function command(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}

function default_state() {
	return { schema: 1, revision: 0, generation: 0, enabled: false, serviceIds: [], phase: 'disabled', consecutiveFailures: 0, activeRunId: null, lastGoodCandidateId: null, lastGoodProfileRevision: null, lastGoodEvidenceId: null, lastCheckAt: null, lastSuccessAt: null, lastFailureAt: null, lastRunAt: null, cooldownUntil: null, lastHealthJobId: null, infrastructureFailures: 0, scanRequestedAt: null, pendingApplyRunId: null, lastBootCheckAt: null, infrastructureStatus: null, currentAppliedRevision: null, currentAppliedHash: null, lastGoodRevision: null, lastGoodHash: null, divergenceStatus: null, interruptedOperation: null, recoveryStatus: null, disableRequested: false, rpcRequests: [], lastError: null };
}

function phase_ok(value) {
	for (let i = 0; i < length(PHASES); i++) if (PHASES[i] == value) return true;
	return false;
}

function service_ok(value) { return type(value) == 'string' && match(value, /^[a-z0-9][a-z0-9._-]{0,63}$/); }
function run_ok(value) { return type(value) == 'string' && match(value, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/); }
function opaque_ok(value, limit) { return type(value) == 'string' && length(value) > 0 && length(value) <= limit && match(value, /^[A-Za-z0-9._:@-]+$/); }
function number_or_null(value) { return type(value) == 'int' || type(value) == 'double' ? value : null; }
function hex_ok(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{64}$/); }
function bounded_summary(value) { if (type(value) != 'object') return null; let phase = type(value.phase) == 'string' ? substr(value.phase, 0, 32) : null, reason = type(value.reason) == 'string' ? substr(value.reason, 0, 160) : null; return phase || reason ? { phase: phase, reason: reason, at: number_or_null(value.at) } : null; }
function request_id_ok(value) { return type(value) == 'string' && match(value, /^[A-Za-z0-9._-]{8,128}$/); }
function bounded_rpc_requests(value) { let out = []; if (type(value) != 'array') return out; for (let i = 0; i < length(value) && length(out) < AUTO_RPC_REQUEST_LIMIT; i++) { let x = value[i]; if (type(x) != 'object' || !request_id_ok(x.id) || !opaque_ok(x.payload, 512) || !opaque_ok(x.op, 32)) continue; push(out, { id: x.id, payload: x.payload, op: x.op, revision: type(x.revision) == 'int' ? x.revision : 0, accepted: x.accepted == true, status: opaque_ok(x.status, 64) ? x.status : null, runId: run_ok(x.runId) ? x.runId : null }); } return out; }

function unique_services(value) {
	let out = [];
	if (type(value) != 'array') return out;
	for (let i = 0; i < length(value) && length(out) < MAX_SERVICES; i++) {
		if (!service_ok(value[i])) continue;
		let found = false;
		for (let j = 0; j < length(out); j++) if (out[j] == value[i]) found = true;
		if (!found) push(out, value[i]);
	}
	return out;
}

function auto_state_normalize(raw) {
	let out = default_state();
	if (type(raw) != 'object' || raw.schema != 1) return out;
	out.revision = type(raw.revision) == 'int' && raw.revision >= 0 ? raw.revision : 0;
	out.generation = type(raw.generation) == 'int' && raw.generation >= 0 ? raw.generation : out.revision;
	out.enabled = raw.enabled == true;
	out.serviceIds = unique_services(raw.serviceIds);
	out.phase = out.enabled && phase_ok(raw.phase) ? raw.phase : 'disabled';
	out.consecutiveFailures = type(raw.consecutiveFailures) == 'int' ? (raw.consecutiveFailures < 0 ? 0 : (raw.consecutiveFailures > MAX_FAILURES ? MAX_FAILURES : raw.consecutiveFailures)) : 0;
	out.activeRunId = run_ok(raw.activeRunId) ? raw.activeRunId : null;
	out.lastGoodCandidateId = opaque_ok(raw.lastGoodCandidateId, 128) ? raw.lastGoodCandidateId : null;
	out.lastGoodProfileRevision = opaque_ok(raw.lastGoodProfileRevision, 128) ? raw.lastGoodProfileRevision : null;
	out.lastGoodEvidenceId = opaque_ok(raw.lastGoodEvidenceId, 160) ? raw.lastGoodEvidenceId : null;
	out.lastCheckAt = number_or_null(raw.lastCheckAt); out.lastSuccessAt = number_or_null(raw.lastSuccessAt); out.lastFailureAt = number_or_null(raw.lastFailureAt); out.lastRunAt = number_or_null(raw.lastRunAt); out.cooldownUntil = number_or_null(raw.cooldownUntil);
	out.lastHealthJobId = opaque_ok(raw.lastHealthJobId, 128) && substr(raw.lastHealthJobId, 0, 4) == 'job-' ? raw.lastHealthJobId : null;
	out.infrastructureFailures = type(raw.infrastructureFailures) == 'int' ? (raw.infrastructureFailures < 0 ? 0 : (raw.infrastructureFailures > MAX_FAILURES ? MAX_FAILURES : raw.infrastructureFailures)) : 0;
	out.scanRequestedAt = number_or_null(raw.scanRequestedAt);
	out.pendingApplyRunId = run_ok(raw.pendingApplyRunId) ? raw.pendingApplyRunId : null;
	out.lastBootCheckAt = number_or_null(raw.lastBootCheckAt);
	out.infrastructureStatus = opaque_ok(raw.infrastructureStatus, 96) ? raw.infrastructureStatus : null;
	out.currentAppliedRevision = opaque_ok(raw.currentAppliedRevision, 128) ? raw.currentAppliedRevision : null;
	out.currentAppliedHash = hex_ok(raw.currentAppliedHash) ? raw.currentAppliedHash : null;
	out.lastGoodRevision = opaque_ok(raw.lastGoodRevision, 128) ? raw.lastGoodRevision : null;
	out.lastGoodHash = hex_ok(raw.lastGoodHash) ? raw.lastGoodHash : null;
	out.divergenceStatus = opaque_ok(raw.divergenceStatus, 96) ? raw.divergenceStatus : null;
	out.interruptedOperation = bounded_summary(raw.interruptedOperation);
	out.recoveryStatus = opaque_ok(raw.recoveryStatus, 96) ? raw.recoveryStatus : null;
	out.disableRequested = raw.disableRequested == true;
	out.rpcRequests = bounded_rpc_requests(raw.rpcRequests);
	out.lastError = type(raw.lastError) == 'string' ? substr(raw.lastError, 0, 240) : null;
	return out;
}

function state_path_safe() {
	// The fixed parent and file path are never derived from RPC input.  Refuse a
	// symlink at either boundary before reading or replacing the state file.
	return command("[ ! -L '" + AUTO_STATE_DIR + "' ] && { [ ! -e '" + AUTO_STATE_PATH + "' ] || { [ -f '" + AUTO_STATE_PATH + "' ] && [ ! -L '" + AUTO_STATE_PATH + "' ]; }; }").rc == 0;
}

function last_good_path_safe() { return command("[ ! -L '" + AUTO_LAST_GOOD_PATH + "' ] && { [ ! -e '" + AUTO_LAST_GOOD_PATH + "' ] || { [ -f '" + AUTO_LAST_GOOD_PATH + "' ] && [ ! -L '" + AUTO_LAST_GOOD_PATH + "' ]; }; }").rc == 0; }
function applied_config_hash() { let digest = command("sha256sum /opt/zapret2/config 2>/dev/null"); let bits = split(trim(digest.out), /[ ]+/); return digest.rc == 0 && length(bits) && hex_ok(bits[0]) ? bits[0] : null; }
function last_good_metadata() { if (!last_good_path_safe()) return { ok: false, error: 'not a regular non-symlink file' }; if (command("[ -e '" + AUTO_LAST_GOOD_PATH + "' ]").rc != 0) return { ok: true, absent: true }; let meta = command("stat -c '%U %a %s' '" + AUTO_LAST_GOOD_PATH + "'"); let bits = split(trim(meta.out), /[ ]+/); if (meta.rc != 0 || length(bits) != 3 || bits[0] != 'root' || !match(bits[1], /^[0-6][0-5][0-5]$/) || !match(bits[2], /^[0-9]+$/) || +bits[2] > AUTO_LAST_GOOD_MAX_BYTES) return { ok: false, error: 'unsafe owner, mode, or size' }; return { ok: true, size: +bits[2] }; }
function last_good_record_ok(raw) { if (type(raw) != 'object' || raw.schema != 1 || !opaque_ok(raw.generation, 64) || !opaque_ok(raw.candidateId, 128) || !hex_ok(raw.corpusDigest) || !opaque_ok(raw.profileRevision, 128) || !hex_ok(raw.profileHash) || !run_ok(raw.runId) || type(raw.serviceIds) != 'array' || !length(raw.serviceIds) || length(raw.serviceIds) > MAX_SERVICES || type(raw.evidenceIds) != 'array' || length(raw.evidenceIds) < 2 || length(raw.evidenceIds) > 32 || type(raw.runtimeVerification) != 'object' || raw.runtimeVerification.status != 'verified' || raw.runtimeVerification.queueOwnerMatches != true || type(raw.healthVerification) != 'object' || raw.healthVerification.requiredTargetsPassed != true || raw.healthVerification.confirmationPassed != true) return false; for (let i = 0; i < length(raw.serviceIds); i++) if (!service_ok(raw.serviceIds[i])) return false; for (let j = 0; j < length(raw.evidenceIds); j++) if (!opaque_ok(raw.evidenceIds[j], 160)) return false; return true; }
function auto_last_good_load() { let meta = last_good_metadata(); if (!meta.ok || meta.absent) return meta; try { let raw = json(readfile(AUTO_LAST_GOOD_PATH)); return last_good_record_ok(raw) ? { ok: true, record: raw } : { ok: false, error: 'invalid last-good record' }; } catch (e) { return { ok: false, error: 'invalid last-good JSON' }; } }
function last_good_load() { let loaded = auto_last_good_load(); return loaded.ok ? loaded.record : null; }
function last_good_save(value) { if (!last_good_record_ok(value) || !last_good_path_safe()) return false; let tmp = AUTO_LAST_GOOD_PATH + '.tmp.' + time(); try { writefile(tmp, sprintf('%J', value) + '\n'); } catch (e) { return false; } if (command("chmod 600 '" + tmp + "'").rc != 0) { try { unlink(tmp); } catch (e) { } return false; } let moved = command("mv -f '" + tmp + "' '" + AUTO_LAST_GOOD_PATH + "'"); if (moved.rc != 0) { try { unlink(tmp); } catch (e) { } return false; } return true; }

function run_winners(runRecord) {
	let winners = [];
	for (let i = 0; i < length(runRecord.targetResults || []); i++) for (let j = 0; j < length(runRecord.targetResults[i].protocols || []); j++) { let w = runRecord.targetResults[i].protocols[j].winner; if (!w || type(w.positiveEvidenceIds) != 'array' || length(w.positiveEvidenceIds) < 2) return null; push(winners, w); }
	return length(winners) == length(runRecord.targets || []) ? winners : null;
}

function auto_state_load() {
	if (!state_path_safe()) return { ok: false, error: { code: 'EPATH', message: 'auto strategy state path is not a regular manager-owned file' } };
	let raw = null;
	try { let text = readfile(AUTO_STATE_PATH); raw = text ? json(text) : null; } catch (e) { raw = null; }
	return { ok: true, state: auto_state_normalize(raw) };
}

function auto_state_corrupt() {
	if (!state_path_safe()) return true;
	try { let raw = readfile(AUTO_STATE_PATH); if (!raw) return false; let value = json(raw); return type(value) != 'object' || value.schema != 1; }
	catch (e) { return true; }
}

function auto_state_save(input, expectedRevision) {
	let current = auto_state_load();
	if (!current.ok) return current;
	if (expectedRevision != null && expectedRevision != current.state.revision)
		return { ok: false, error: { code: 'ECONFLICT', message: 'auto strategy revision mismatch', details: { expected: expectedRevision, actual: current.state.revision } } };
	let state = auto_state_normalize(input);
	state.revision = current.state.revision + 1;
	try { mkdir(AUTO_STATE_DIR); } catch (e) { }
	if (!state_path_safe()) return { ok: false, error: { code: 'EPATH', message: 'auto strategy state path changed while saving' } };
	let tmp = AUTO_STATE_PATH + '.tmp.' + time();
	try { writefile(tmp, sprintf('%J', state) + '\n'); } catch (e) { return { ok: false, error: { code: 'EIO', message: 'could not write auto strategy temporary state' } }; }
	let moved = command("mv -f '" + tmp + "' '" + AUTO_STATE_PATH + "'");
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'could not atomically publish auto strategy state' } }; }
	return { ok: true, state: state };
}

function auto_apply_pending(expectedRevision) {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded; let state = loaded.state;
	if (expectedRevision != null && expectedRevision != state.revision) return { ok: false, error: { code: 'ECONFLICT', message: 'auto strategy revision mismatch' } };
	if (!state.enabled || !run_ok(state.pendingApplyRunId) || state.activeRunId != null) return { ok: false, error: { code: 'ESTATE', message: 'no eligible pending Auto Strategy apply' } };
	let record = orchestra_run_load({ runId: state.pendingApplyRunId }), winners = record ? run_winners(record) : null;
	if (!record || record.runId != state.pendingApplyRunId || record.phase != 'completed' || record.targetType != 'service' || record.serviceVerdict != 'ready' || record.validity != 'valid' || record.candidateEvidenceUsable != true || !record.candidateRegistryDigest || !winners) return { ok: false, error: { code: 'ESTALE', message: 'pending winner is not a current evidenced service run' } };
	state.phase = 'applying'; let preview = orchestra_preview_best({ runId: record.runId }); if (!preview.ok) { state.phase = 'cooldown'; state.lastError = 'preview failed'; auto_state_save(state, state.revision); return preview; }
	let applied = orchestra_apply_best({ runId: record.runId, changeHash: preview.changeHash, idempotencyToken: 'auto-' + record.runId + '-' + state.revision }); if (!applied.ok || !applied.runtimeVerification || applied.runtimeVerification.ok != true) { if (applied.ok) run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback'); state.phase = 'cooldown'; state.pendingApplyRunId = null; state.lastError = 'sanctioned apply failed, rolled back, or lacks runtime verification'; auto_state_save(state, state.revision); return applied.ok ? { ok: false, error: { code: 'EVERIFY', message: state.lastError } } : applied; }
	state.phase = 'verifying'; let confirmation = verify_service_targets(record.targets, run); if (!confirmation.ok) { let rb = run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback'); state.phase = 'cooldown'; state.pendingApplyRunId = null; state.lastError = rb.rc == 0 ? 'post-apply confirmation failed; rollback requested' : 'post-apply confirmation failed; rollback failed'; auto_state_save(state, state.revision); return { ok: false, error: { code: rb.rc == 0 ? 'ETARGET' : 'EROLLBACK', message: state.lastError }, rollback: { requested: true, rc: rb.rc } }; }
	let evidence = []; for (let i = 0; i < length(winners); i++) for (let j = 0; j < length(winners[i].positiveEvidenceIds); j++) push(evidence, winners[i].positiveEvidenceIds[j]); let rt = applied.runtimeVerification, previous = last_good_load(), first = winners[0], lastGood = { schema: 1, generation: '' + time(), candidateId: first.candidateId, corpusDigest: record.candidateRegistryDigest, profileRevision: applied.operationId || null, profileHash: applied_config_hash() || preview.changeHash, serviceIds: [record.serviceId], runId: record.runId, evidenceIds: slice(evidence, 0, 32), runtimeVerification: { status: 'verified', pid: rt.daemonPid || null, processStarttime: null, queue: rt.queueOwner || null, queueOwnerMatches: rt.checks && rt.checks.ownerMatch == true }, healthVerification: { requiredTargetsPassed: true, confirmationPassed: true }, appliedAt: time(), previousLastGoodGeneration: previous && previous.generation || null };
	if (!last_good_save(lastGood)) { state.phase = 'failed'; state.lastError = 'verified apply succeeded but persistent last-good commit failed'; auto_state_save(state, state.revision); return { ok: false, error: { code: 'EIO', message: state.lastError } }; }
	state.phase = 'healthy'; state.pendingApplyRunId = null; state.lastGoodCandidateId = first.candidateId; state.lastGoodProfileRevision = applied.operationId || null; state.lastGoodEvidenceId = evidence[0] || null; state.lastSuccessAt = time(); state.lastError = null; let saved = auto_state_save(state, state.revision); return saved.ok ? { ok: true, state: saved.state, lastGood: lastGood, apply: applied } : saved;
}

function auto_state_transition(raw, kind, at) {
	let state = auto_state_normalize(raw);
	if (kind == 'healthy') { state.phase = state.enabled ? 'healthy' : 'disabled'; state.consecutiveFailures = 0; state.lastCheckAt = at; state.lastSuccessAt = at; state.lastError = null; }
	else if (kind == 'strategy-failure') { state.phase = 'degraded'; state.consecutiveFailures = state.consecutiveFailures < MAX_FAILURES ? state.consecutiveFailures + 1 : MAX_FAILURES; state.lastCheckAt = at; state.lastFailureAt = at; }
	return state;
}

function uptime_seconds() { let raw = readfile('/proc/uptime') || ''; let bits = split(raw, ' '); return length(bits) ? +bits[0] : 0; }
function wan_ready() { let r = command("ubus call network.interface.wan status"); try { let x = json(r.out); return r.rc == 0 && x && x.up == true; } catch (e) { return false; } }
function dns_ready() { let raw = readfile('/tmp/resolv.conf.d/resolv.conf.auto') || ''; return match(raw, /(^|\n)[ ]*nameserver[ ]+/) != null; }
function engine_ready() { return command("pgrep -f '(^|/)nfqws2( |$)' >/dev/null 2>&1").rc == 0; }
function queue_ready() { let raw = readfile('/proc/net/netfilter/nfnetlink_queue') || ''; return match(raw, /(^|\n)[ ]*300[ ]/) != null; }

function health_class(matrix) {
	if (!matrix || matrix.status != 'completed' || type(matrix.rows) != 'array' || !length(matrix.rows)) return { class: 'infrastructure', reason: 'health matrix unavailable or empty' };
	let allHealthy = true;
	for (let i = 0; i < length(matrix.rows); i++) {
		let c = matrix.rows[i].class || '';
		if (c == 'dns' || c == 'skipped' || c == 'unavailable-unknown') return { class: 'infrastructure', reason: 'health matrix reports ' + c };
		if (c != 'reachable-http') allHealthy = false;
		if (c == 'connect' || c == 'tls' || c == 'http-application' || c == 'unknown-timeout') return { class: 'strategy-failure', reason: 'health matrix reports ' + c };
	}
	return allHealthy ? { class: 'healthy', reason: 'all selected service probes reached HTTP' } : { class: 'infrastructure', reason: 'health matrix is inconclusive' };
}

function infrastructure_backoff(state, now, reason) {
	state.infrastructureFailures = state.infrastructureFailures < MAX_FAILURES ? state.infrastructureFailures + 1 : MAX_FAILURES;
	let wait = INFRA_BACKOFF_BASE_SEC;
	for (let i = 1; i < state.infrastructureFailures && wait < INFRA_BACKOFF_MAX_SEC; i++) wait *= 2;
	if (wait > INFRA_BACKOFF_MAX_SEC) wait = INFRA_BACKOFF_MAX_SEC;
	state.phase = 'waiting-network'; state.infrastructureStatus = 'waiting'; state.consecutiveFailures = 0; state.cooldownUntil = now + wait; state.lastFailureAt = now; state.lastError = reason;
}

function observe_health(state, verdict, now) {
	state.lastCheckAt = now;
	if (verdict.class == 'healthy') { state.phase = 'healthy'; state.infrastructureStatus = 'ready'; state.consecutiveFailures = 0; state.infrastructureFailures = 0; state.lastSuccessAt = now; state.lastError = null; return 'none'; }
	if (verdict.class == 'infrastructure') { infrastructure_backoff(state, now, verdict.reason); return 'none'; }
	state.phase = 'degraded'; state.infrastructureFailures = 0; state.consecutiveFailures = state.consecutiveFailures < MAX_FAILURES ? state.consecutiveFailures + 1 : MAX_FAILURES; state.lastFailureAt = now; state.lastError = verdict.reason;
	if (state.consecutiveFailures >= STRATEGY_FAILURES_TO_SCAN && state.activeRunId == null && state.scanRequestedAt == null && (state.lastRunAt == null || now - state.lastRunAt >= SCAN_COOLDOWN_SEC)) { state.scanRequestedAt = now; return 'scan'; }
	return 'none';
}

function auto_run_request(serviceId) {
	return { targetType: 'service', targetId: serviceId, candidateMode: 'zapret2gui-only', repeats: 2, perAttemptTimeoutSec: 20, totalTimeoutSec: 600 };
}

function start_scan(state, now) {
	if (!length(state.serviceIds)) { infrastructure_backoff(state, now, 'no Auto Strategy service is selected'); return { ok: false, action: 'none' }; }
	let started = orchestra_run_start(auto_run_request(state.serviceIds[0]));
	if (!started.ok || !started.run || !run_ok(started.run.runId)) { infrastructure_backoff(state, now, started.error && started.error.message || 'orchestra scan could not start'); return { ok: false, action: 'none' }; }
	state.phase = 'scanning'; state.activeRunId = started.run.runId; state.scanRequestedAt = null; state.lastRunAt = now; state.lastError = null;
	return { ok: true, action: 'scan' };
}

function reconcile_scan(state, now) {
	let status = orchestra_run_status({ runId: state.activeRunId });
	if (!status.ok || !status.run) { infrastructure_backoff(state, now, 'active orchestra run is unavailable'); state.activeRunId = null; return 'none'; }
	let run = status.run;
	if (run.phase != 'completed' && run.phase != 'failed' && run.phase != 'stopped' && run.phase != 'timed-out' && run.phase != 'interrupted' && run.phase != 'infrastructure-error') return 'none';
	state.activeRunId = null; state.scanRequestedAt = null; state.lastRunAt = now;
	if (run.phase == 'completed' && run.serviceVerdict == 'ready' && run.candidateEvidenceUsable == true) { state.phase = 'applying'; state.pendingApplyRunId = run.runId; state.lastError = null; return 'apply'; }
	state.phase = 'cooldown'; state.cooldownUntil = now + SCAN_COOLDOWN_SEC; state.lastError = 'no confirmed winner from run ' + run.runId;
	return 'no-winner';
}

function current_applied_state() {
	let hash = applied_config_hash();
	return hash ? { present: true, revision: null, hash: hash } : { present: false, revision: null, hash: null };
}

function interrupted_apply_recovery(state, now) {
	let operation = state.lastGoodProfileRevision ? orchestra_apply_status({ operationId: state.lastGoodProfileRevision }) : null;
	let operationPhase = operation && operation.ok && operation.operation ? operation.operation.phase : 'unknown';
	state.phase = 'recovering'; state.recoveryStatus = 'required';
	state.interruptedOperation = { phase: 'applying', reason: 'boot recovery from interrupted apply (' + operationPhase + ')', at: now };
	// service.uc owns the transactional snapshot.  Do not reconstruct or write
	// upstream configuration here; recovery must stay on its sanctioned path.
	let rollback = run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback');
	if (rollback.rc != 0) { state.phase = 'failed'; state.recoveryStatus = 'failed'; state.lastError = 'interrupted apply recovery failed'; return false; }
	state.phase = 'cooldown'; state.recoveryStatus = 'completed'; state.cooldownUntil = now + SCAN_COOLDOWN_SEC; state.pendingApplyRunId = null; state.lastError = 'interrupted apply recovered through sanctioned rollback';
	return true;
}

function auto_boot_reconcile(state, now) {
	state.lastBootCheckAt = now;
	let lastGood = auto_last_good_load();
	if (!lastGood.ok && !lastGood.absent) { state.phase = 'failed'; state.recoveryStatus = 'manual-required'; state.lastError = 'last-good rejected: ' + lastGood.error; return { blocked: true, action: 'none' }; }
	if (lastGood.ok) { state.lastGoodCandidateId = lastGood.record.candidateId; state.lastGoodProfileRevision = lastGood.record.profileRevision; state.lastGoodRevision = lastGood.record.profileRevision; state.lastGoodHash = lastGood.record.profileHash; }
	else { state.lastGoodRevision = null; state.lastGoodHash = null; }
	// A persisted M3 winner is an apply request, not an interrupted writer.  It
	// remains eligible for M4's preview/apply transaction after boot; only an
	// applying/verifying state without that immutable run is recovery work.
	if ((state.phase == 'applying' && state.pendingApplyRunId == null) || state.phase == 'verifying' || state.recoveryStatus == 'required') return { blocked: true, action: interrupted_apply_recovery(state, now) ? 'recovered' : 'recovery-failed' };
	if (state.activeRunId != null) {
		let runRecord = orchestra_run_load({ runId: state.activeRunId });
		let live = runRecord && runRecord.workerPid && runRecord.workerStarttime && proc_starttime(runRecord.workerPid) == runRecord.workerStarttime;
		if (!runRecord || (!live && runRecord.phase != 'completed')) { state.interruptedOperation = { phase: 'scanning', reason: 'stale worker PID/starttime lock', at: now }; state.activeRunId = null; state.scanRequestedAt = null; state.phase = 'cooldown'; state.cooldownUntil = now + SCAN_COOLDOWN_SEC; state.lastError = 'interrupted scan did not produce an accepted winner'; return { blocked: true, action: 'none' }; }
	}
	let current = current_applied_state();
	if (lastGood.ok && current.hash == lastGood.record.profileHash) current.revision = lastGood.record.profileRevision;
	state.currentAppliedHash = current.hash; state.currentAppliedRevision = current.revision;
	if (!current.present) { state.divergenceStatus = 'current-missing'; state.recoveryStatus = lastGood.ok ? 'manual-sanctioned-apply-required' : 'manual-required'; state.phase = 'failed'; state.lastError = 'current applied configuration is unavailable; automatic direct restore is forbidden'; return { blocked: true, action: 'none' }; }
	if (lastGood.ok && current.hash == lastGood.record.profileHash) { state.divergenceStatus = 'matching'; state.recoveryStatus = 'not-needed'; }
	else if (lastGood.ok) { state.divergenceStatus = 'divergent'; state.recoveryStatus = 'not-needed'; }
	else { state.divergenceStatus = 'no-last-good'; state.recoveryStatus = 'not-needed'; }
	return { blocked: false, action: 'none' };
}

function rpc_error(code, message) { return { ok: false, error: { code: code, message: substr(message, 0, 160) } }; }
function rpc_payload(op, input) { let ids = type(input) == 'object' && type(input.serviceIds) == 'array' ? join(input.serviceIds, '.') : ''; return op + ':' + ids + ':' + (input && input.overrideCooldown == true ? '1' : '0'); }
function rpc_admit(state, input, op) {
	if (type(input) != 'object' || type(input.expectedRevision) != 'int' || !request_id_ok(input.requestId)) return { ok: false, response: rpc_error('EINPUT', 'expectedRevision and bounded requestId are required') };
	let payload = rpc_payload(op, input);
	for (let i = 0; i < length(state.rpcRequests); i++) if (state.rpcRequests[i].id == input.requestId) {
		if (state.rpcRequests[i].op != op || state.rpcRequests[i].payload != payload) return { ok: false, response: rpc_error('EIDEMPOTENCY', 'requestId was already used for another request') };
		return { ok: false, response: { ok: true, idempotent: true, revision: state.rpcRequests[i].revision, accepted: state.rpcRequests[i].accepted, status: state.rpcRequests[i].status, runId: state.rpcRequests[i].runId } };
	}
	if (input.expectedRevision != state.revision) return { ok: false, response: rpc_error('ECONFLICT', 'auto strategy revision mismatch') };
	return { ok: true, payload: payload };
}
function rpc_services(input) {
	if (type(input) != 'object' || type(input.serviceIds) != 'array' || !length(input.serviceIds) || length(input.serviceIds) > MAX_SERVICES) return { ok: false, error: rpc_error('EINPUT', 'a bounded non-empty serviceIds list is required') };
	let ids = unique_services(input.serviceIds);
	if (!length(ids)) return { ok: false, error: rpc_error('EINPUT', 'no valid service IDs were supplied') };
	for (let i = 0; i < length(ids); i++) { let manifest = orchestra_service_manifest(ids[i]); if (!manifest.ok) return { ok: false, error: rpc_error('EINPUT', 'service manifest is unavailable or invalid') }; }
	return { ok: true, serviceIds: ids };
}
function rpc_save(state, admission, op, response) {
	let record = { id: admission.requestId, payload: admission.payload, op: op, revision: state.revision + 1, accepted: response.accepted == true, status: type(response.status) == 'string' ? response.status : null, runId: run_ok(response.runId) ? response.runId : null };
	push(state.rpcRequests, record); if (length(state.rpcRequests) > AUTO_RPC_REQUEST_LIMIT) state.rpcRequests = slice(state.rpcRequests, length(state.rpcRequests) - AUTO_RPC_REQUEST_LIMIT);
	let saved = auto_state_save(state, state.revision); if (!saved.ok) return saved;
	response.ok = true; response.revision = saved.state.revision; response.state = saved.state; return response;
}

function auto_rpc_status() {
	let loaded = auto_state_load();
	if (!loaded.ok) return rpc_error('ESTATE', 'auto strategy state path is unavailable');
	if (auto_state_corrupt()) return { ok: true, schemaVersion: 1, revision: 0, enabled: false, phase: 'failed', serviceIds: [], consecutiveFailures: 0, activeRun: { runId: null, generation: null, startedAt: null, progress: null, cancellable: false }, currentApplied: { revision: null, hash: null }, lastGood: { available: false, candidateId: null, profileRevision: null, profileHash: null, appliedAt: null }, health: { status: 'unknown', lastCheckAt: null, lastSuccessAt: null, lastFailureAt: null }, infrastructure: { status: 'failed', reason: 'state-corrupt' }, cooldownUntil: null, lastError: 'state-corrupt', capabilities: { runNow: false, stop: false, restoreLastGood: false }, verifyRouter: [] };
	let state = loaded.state, lastGood = auto_last_good_load(), active = state.activeRunId ? orchestra_run_status({ runId: state.activeRunId }) : null;
	let activeRun = active && active.ok && active.run ? active.run : null;
	let verified = lastGood.ok == true && lastGood.record != null && lastGood.record.runtimeVerification != null && lastGood.record.runtimeVerification.status == 'verified';
	let recovery = state.phase == 'recovering' || state.recoveryStatus == 'required';
	return { ok: true, schemaVersion: 1, revision: state.revision, enabled: state.enabled, phase: state.phase, serviceIds: state.serviceIds, consecutiveFailures: state.consecutiveFailures, activeRun: { runId: activeRun && activeRun.runId || null, generation: state.generation, startedAt: activeRun && activeRun.startedAt || null, progress: activeRun && activeRun.progress || null, cancellable: activeRun && activeRun.phase != 'applied' && activeRun.phase != 'completed' && !recovery || false }, currentApplied: { revision: state.currentAppliedRevision, hash: state.currentAppliedHash }, lastGood: { available: verified, candidateId: verified ? lastGood.record.candidateId : null, profileRevision: verified ? lastGood.record.profileRevision : null, profileHash: verified ? lastGood.record.profileHash : null, appliedAt: verified ? lastGood.record.appliedAt : null }, health: { status: state.phase == 'healthy' ? 'healthy' : state.phase == 'degraded' ? 'degraded' : state.infrastructureStatus == 'waiting' ? 'infrastructure-failure' : 'unknown', lastCheckAt: state.lastCheckAt, lastSuccessAt: state.lastSuccessAt, lastFailureAt: state.lastFailureAt }, infrastructure: { status: state.infrastructureStatus || 'unknown', reason: state.infrastructureStatus == 'waiting' ? state.lastError : null }, cooldownUntil: state.cooldownUntil, lastError: state.lastError, capabilities: { runNow: state.enabled && !state.activeRunId && !recovery && state.pendingApplyRunId == null, stop: state.activeRunId != null && !recovery, restoreLastGood: verified && !state.activeRunId && !recovery }, verifyRouter: verified ? ['PID/starttime, NFQUEUE ownership and rollback evidence require router verification'] : [] };
}

function auto_rpc_enable(input) {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded; let state = loaded.state, admission = rpc_admit(state, input, 'enable'); if (!admission.ok) return admission.response;
	let services = rpc_services(input); if (!services.ok) return services.error;
	state.enabled = true; state.serviceIds = services.serviceIds; state.phase = 'waiting-network'; state.scanRequestedAt = null; state.disableRequested = false;
	admission.requestId = input.requestId; return rpc_save(state, admission, 'enable', { accepted: true, status: 'health-first' });
}

function auto_rpc_disable(input) {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded; let state = loaded.state, admission = rpc_admit(state, input, 'disable'); if (!admission.ok) return admission.response;
	if (!state.enabled && state.activeRunId == null && state.pendingApplyRunId == null && state.phase != 'applying' && state.phase != 'verifying' && state.phase != 'recovering') return { ok: true, status: 'already-disabled', revision: state.revision };
	let cancellation = false, pending = state.phase == 'applying' || state.phase == 'verifying' || state.phase == 'recovering';
	if (state.activeRunId != null && state.phase == 'scanning') { let stopped = orchestra_run_stop({ runId: state.activeRunId }); if (!stopped.ok) return rpc_error('EINTERNAL', 'could not request scan cancellation'); cancellation = true; }
	state.enabled = false; state.disableRequested = pending; if (!pending && state.activeRunId == null) state.phase = 'disabled';
	admission.requestId = input.requestId; return rpc_save(state, admission, 'disable', { accepted: true, status: pending ? 'disable-pending-safe-completion' : 'disabled', cancellationRequested: cancellation, disablePendingSafeCompletion: pending });
}

function auto_rpc_run(input) {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded; let state = loaded.state, admission = rpc_admit(state, input, 'run'); if (!admission.ok) return admission.response;
	let services = rpc_services(input); if (!services.ok) return services.error;
	if (!state.enabled) return rpc_error('EDISABLED', 'Auto Strategy is disabled');
	if (state.activeRunId != null) return rpc_error('EALREADY', 'a bounded scan is already active');
	if (state.pendingApplyRunId != null || state.phase == 'applying' || state.phase == 'verifying') return rpc_error('EBUSY', 'apply or verification is active');
	if (state.phase == 'recovering' || state.recoveryStatus == 'required') return rpc_error('ERECOVERY', 'recovery must complete before a scan');
	if (!wan_ready() || !dns_ready() || !engine_ready() || !queue_ready()) return rpc_error('EINFRA', 'infrastructure is not ready');
	if (state.cooldownUntil != null && time() < state.cooldownUntil) return rpc_error('ECOOLDOWN', 'scan cooldown is active');
	let lastGood = auto_last_good_load(), current = current_applied_state(); if (!lastGood.ok || !current.present) return rpc_error('ENOLASTGOOD', 'verified rollback baseline is unavailable');
	state.serviceIds = services.serviceIds; let started = start_scan(state, time()); if (!started.ok) return rpc_error('EINTERNAL', 'existing bounded orchestra scan could not start'); state.generation++;
	admission.requestId = input.requestId; return rpc_save(state, admission, 'run', { accepted: true, status: 'accepted', runId: state.activeRunId, generation: state.generation, asynchronous: true, statusMethod: 'orchestra_auto_status' });
}

function auto_rpc_stop(input) {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded; let state = loaded.state, admission = rpc_admit(state, input, 'stop'); if (!admission.ok) return admission.response;
	if (state.phase == 'recovering' || state.recoveryStatus == 'required') return rpc_error('ERECOVERY', 'recovery cannot be interrupted');
	if (state.activeRunId == null) { if (state.pendingApplyRunId != null) { state.pendingApplyRunId = null; state.phase = 'degraded'; admission.requestId = input.requestId; return rpc_save(state, admission, 'stop', { accepted: true, status: 'stopped-pending-candidate' }); } return { ok: true, status: 'not-running', revision: state.revision }; }
	let stopped = orchestra_run_stop({ runId: state.activeRunId }); if (!stopped.ok) return rpc_error('EINTERNAL', 'scan cancellation could not be requested');
	admission.requestId = input.requestId; return rpc_save(state, admission, 'stop', { accepted: true, status: 'cancellation-requested', runId: state.activeRunId, cancellationRequested: true });
}

function auto_rpc_restore(input) {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded; let state = loaded.state, admission = rpc_admit(state, input, 'restore'); if (!admission.ok) return admission.response;
	if (state.activeRunId != null || state.pendingApplyRunId != null || state.phase == 'applying' || state.phase == 'verifying' || state.phase == 'recovering') return rpc_error('EBUSY', 'another operation is active');
	let lastGood = auto_last_good_load(); if (!lastGood.ok) return rpc_error('ENOLASTGOOD', 'verified last-good record is unavailable');
	let current = current_applied_state(); if (current.present && current.hash == lastGood.record.profileHash && state.phase == 'healthy') return { ok: true, status: 'already-current', revision: state.revision };
	let preview = orchestra_preview_best({ runId: lastGood.record.runId }); if (!preview.ok) return rpc_error('ESTATE', 'last-good run cannot be previewed through the sanctioned path');
	let applied = orchestra_apply_best({ runId: lastGood.record.runId, changeHash: preview.changeHash, idempotencyToken: 'auto-restore-' + input.requestId });
	if (!applied.ok || !applied.runtimeVerification || applied.runtimeVerification.ok != true) { if (applied.ok) run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback'); return rpc_error('EVERIFY', 'sanctioned restore failed verification and rollback was requested'); }
	let record = orchestra_run_load({ runId: lastGood.record.runId }), confirmed = record ? verify_service_targets(record.targets, run) : null;
	if (!confirmed || !confirmed.ok) { run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback'); return rpc_error('EVERIFY', 'restored target confirmation failed and rollback was requested'); }
	state.phase = 'healthy'; state.currentAppliedHash = lastGood.record.profileHash; state.currentAppliedRevision = lastGood.record.profileRevision; state.lastSuccessAt = time(); state.lastError = null;
	admission.requestId = input.requestId; return rpc_save(state, admission, 'restore', { accepted: true, status: 'restored', operationId: applied.operationId, asynchronous: false, verificationStatus: 'verified' });
}

function auto_controller_tick() {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded;
	let state = loaded.state, now = time();
	if (!state.enabled) { state.phase = 'disabled'; return auto_state_save(state, state.revision); }
	if (uptime_seconds() < BOOT_DELAY_SEC) { state.phase = 'waiting-network'; return auto_state_save(state, state.revision); }
	let boot = auto_boot_reconcile(state, now);
	if (boot.blocked) { let blocked = auto_state_save(state, state.revision); if (blocked.ok) blocked.action = boot.action; return blocked; }
	if (state.activeRunId != null) { let action = reconcile_scan(state, now); let saved = auto_state_save(state, state.revision); if (saved.ok) saved.action = action; return saved; }
	if (!wan_ready() || !dns_ready() || !engine_ready() || !queue_ready()) { infrastructure_backoff(state, now, 'WAN, DNS, nfqws2, or NFQUEUE is unavailable'); return auto_state_save(state, state.revision); }
	if (state.cooldownUntil != null && now < state.cooldownUntil) return { ok: true, state: state, action: 'none' };
	if (state.pendingApplyRunId != null) return auto_apply_pending(state.revision);
	let health = health_matrix_get(), matrix = health.ok ? health.matrix : null;
	if (matrix && matrix.status == 'completed' && matrix.id != state.lastHealthJobId) { state.lastHealthJobId = matrix.id; let action = observe_health(state, health_class(matrix), now); if (action == 'scan') action = start_scan(state, now).action; let saved = auto_state_save(state, state.revision); if (saved.ok) saved.action = action; return saved; }
	if (matrix && (matrix.status == 'pending' || matrix.status == 'running')) return { ok: true, state: state, action: 'none' };
	if (state.lastCheckAt != null && now - state.lastCheckAt < HEALTH_INTERVAL_SEC) return { ok: true, state: state, action: 'none' };
	let started = health_matrix_start({ services: state.serviceIds });
	if (!started.ok) { infrastructure_backoff(state, now, started.error && started.error.message || 'health matrix unavailable'); return auto_state_save(state, state.revision); }
	state.lastCheckAt = now; let saved = auto_state_save(state, state.revision); if (saved.ok) saved.action = 'health-check'; return saved;
}

export { auto_state_normalize, auto_last_good_load, auto_state_load, auto_state_save,
	auto_apply_pending, auto_state_transition, auto_boot_reconcile, auto_rpc_status,
	auto_rpc_enable, auto_rpc_disable, auto_rpc_run, auto_rpc_stop, auto_rpc_restore,
	auto_controller_tick };
