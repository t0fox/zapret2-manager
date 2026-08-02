#!/usr/bin/ucode
'use strict';

// Persistent state only.  Triggers and orchestration are deliberately kept in
// later milestones so this module remains the single, auditable state owner.
import { readfile, writefile, mkdir, unlink, popen } from 'fs';
import { health_matrix_start, health_matrix_get } from './jobs.uc';
import { orchestra_run_start, orchestra_run_status } from './orchestra-run.uc';

const AUTO_STATE_PATH = '/etc/zapret2-manager/auto-strategy.json';
const AUTO_STATE_DIR = '/etc/zapret2-manager';
const MAX_SERVICES = 16;
const MAX_FAILURES = 99;
const BOOT_DELAY_SEC = 90;
const HEALTH_INTERVAL_SEC = 30;
const SCAN_COOLDOWN_SEC = 900;
const INFRA_BACKOFF_BASE_SEC = 15;
const INFRA_BACKOFF_MAX_SEC = 300;
const STRATEGY_FAILURES_TO_SCAN = 3;
const PHASES = ['disabled', 'waiting-network', 'healthy', 'degraded', 'scanning', 'applying', 'verifying', 'cooldown', 'failed'];

function command(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}

function default_state() {
	return { schema: 1, revision: 0, enabled: false, serviceIds: [], phase: 'disabled', consecutiveFailures: 0, activeRunId: null, lastGoodCandidateId: null, lastGoodProfileRevision: null, lastGoodEvidenceId: null, lastCheckAt: null, lastSuccessAt: null, lastFailureAt: null, lastRunAt: null, cooldownUntil: null, lastHealthJobId: null, infrastructureFailures: 0, scanRequestedAt: null, pendingApplyRunId: null, lastError: null };
}

function phase_ok(value) {
	for (let i = 0; i < length(PHASES); i++) if (PHASES[i] == value) return true;
	return false;
}

function service_ok(value) { return type(value) == 'string' && match(value, /^[a-z0-9][a-z0-9._-]{0,63}$/); }
function run_ok(value) { return type(value) == 'string' && match(value, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/); }
function opaque_ok(value, limit) { return type(value) == 'string' && length(value) > 0 && length(value) <= limit && match(value, /^[A-Za-z0-9._:@-]+$/); }
function number_or_null(value) { return type(value) == 'int' || type(value) == 'double' ? value : null; }

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

export const auto_state_normalize = function(raw) {
	let out = default_state();
	if (type(raw) != 'object' || raw.schema != 1) return out;
	out.revision = type(raw.revision) == 'int' && raw.revision >= 0 ? raw.revision : 0;
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
	out.lastError = type(raw.lastError) == 'string' ? substr(raw.lastError, 0, 240) : null;
	return out;
};

function state_path_safe() {
	// The fixed parent and file path are never derived from RPC input.  Refuse a
	// symlink at either boundary before reading or replacing the state file.
	return command("[ ! -L '" + AUTO_STATE_DIR + "' ] && { [ ! -e '" + AUTO_STATE_PATH + "' ] || { [ -f '" + AUTO_STATE_PATH + "' ] && [ ! -L '" + AUTO_STATE_PATH + "' ]; }; }").rc == 0;
}

export const auto_state_load = function() {
	if (!state_path_safe()) return { ok: false, error: { code: 'EPATH', message: 'auto strategy state path is not a regular manager-owned file' } };
	let raw = null;
	try { let text = readfile(AUTO_STATE_PATH); raw = text ? json(text) : null; } catch (e) { raw = null; }
	return { ok: true, state: auto_state_normalize(raw) };
};

export const auto_state_save = function(input, expectedRevision) {
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
};

export const auto_state_transition = function(raw, kind, at) {
	let state = auto_state_normalize(raw);
	if (kind == 'healthy') { state.phase = state.enabled ? 'healthy' : 'disabled'; state.consecutiveFailures = 0; state.lastCheckAt = at; state.lastSuccessAt = at; state.lastError = null; }
	else if (kind == 'strategy-failure') { state.phase = 'degraded'; state.consecutiveFailures = state.consecutiveFailures < MAX_FAILURES ? state.consecutiveFailures + 1 : MAX_FAILURES; state.lastCheckAt = at; state.lastFailureAt = at; }
	return state;
};

function uptime_seconds() { let raw = readfile('/proc/uptime') || ''; let bits = split(raw, ' '); return length(bits) ? +bits[0] : 0; }
function wan_ready() { let r = command("ubus call network.interface.wan status"); try { let x = json(r.out); return r.rc == 0 && x && x.up == true; } catch (e) { return false; } }
function dns_ready() { let raw = readfile('/tmp/resolv.conf.d/resolv.conf.auto') || ''; return match(raw, /^[ ]*nameserver[ ]+/m) != null; }
function engine_ready() { return command("pgrep -f '(^|/)nfqws2( |$)' >/dev/null 2>&1").rc == 0; }
function queue_ready() { let raw = readfile('/proc/net/netfilter/nfnetlink_queue') || ''; return match(raw, /^[ ]*300[ ]/m) != null; }

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
	state.phase = 'waiting-network'; state.consecutiveFailures = 0; state.cooldownUntil = now + wait; state.lastFailureAt = now; state.lastError = reason;
}

function observe_health(state, verdict, now) {
	state.lastCheckAt = now;
	if (verdict.class == 'healthy') { state.phase = 'healthy'; state.consecutiveFailures = 0; state.infrastructureFailures = 0; state.lastSuccessAt = now; state.lastError = null; return 'none'; }
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

export const auto_controller_tick = function() {
	let loaded = auto_state_load(); if (!loaded.ok) return loaded;
	let state = loaded.state, now = time();
	if (!state.enabled) { state.phase = 'disabled'; return auto_state_save(state, state.revision); }
	if (state.activeRunId != null) { let action = reconcile_scan(state, now); let saved = auto_state_save(state, state.revision); if (saved.ok) saved.action = action; return saved; }
	if (uptime_seconds() < BOOT_DELAY_SEC) { state.phase = 'waiting-network'; return auto_state_save(state, state.revision); }
	if (!wan_ready() || !dns_ready() || !engine_ready() || !queue_ready()) { infrastructure_backoff(state, now, 'WAN, DNS, nfqws2, or NFQUEUE is unavailable'); return auto_state_save(state, state.revision); }
	if (state.cooldownUntil != null && now < state.cooldownUntil) return { ok: true, state: state, action: 'none' };
	let health = health_matrix_get(), matrix = health.ok ? health.matrix : null;
	if (matrix && matrix.status == 'completed' && matrix.id != state.lastHealthJobId) { state.lastHealthJobId = matrix.id; let action = observe_health(state, health_class(matrix), now); if (action == 'scan') action = start_scan(state, now).action; let saved = auto_state_save(state, state.revision); if (saved.ok) saved.action = action; return saved; }
	if (matrix && (matrix.status == 'pending' || matrix.status == 'running')) return { ok: true, state: state, action: 'none' };
	if (state.lastCheckAt != null && now - state.lastCheckAt < HEALTH_INTERVAL_SEC) return { ok: true, state: state, action: 'none' };
	let started = health_matrix_start({ services: state.serviceIds });
	if (!started.ok) { infrastructure_backoff(state, now, started.error && started.error.message || 'health matrix unavailable'); return auto_state_save(state, state.revision); }
	state.lastCheckAt = now; let saved = auto_state_save(state, state.revision); if (saved.ok) saved.action = 'health-check'; return saved;
};
