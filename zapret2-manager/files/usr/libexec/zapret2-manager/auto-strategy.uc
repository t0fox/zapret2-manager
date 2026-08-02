#!/usr/bin/ucode
'use strict';

// Persistent state only.  Triggers and orchestration are deliberately kept in
// later milestones so this module remains the single, auditable state owner.
import { readfile, writefile, mkdir, unlink, popen } from 'fs';

const AUTO_STATE_PATH = '/etc/zapret2-manager/auto-strategy.json';
const AUTO_STATE_DIR = '/etc/zapret2-manager';
const MAX_SERVICES = 16;
const MAX_FAILURES = 99;
const PHASES = ['disabled', 'waiting-network', 'healthy', 'degraded', 'scanning', 'applying', 'verifying', 'cooldown', 'failed'];

function command(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}

function default_state() {
	return { schema: 1, revision: 0, enabled: false, serviceIds: [], phase: 'disabled', consecutiveFailures: 0, activeRunId: null, lastGoodCandidateId: null, lastGoodProfileRevision: null, lastGoodEvidenceId: null, lastCheckAt: null, lastSuccessAt: null, lastFailureAt: null, lastRunAt: null, cooldownUntil: null, lastError: null };
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
