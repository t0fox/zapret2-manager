'use strict';

// Task 7 is the only owner of the Scanner terminal boundary.  Task 5 owns
// candidate/session resources; this module decides whether the pre-scan state
// is independently proven before the worker publishes a terminal state.
import { scanner_session_finish, scanner_candidate_cleanup } from './scanner-transient.uc';
import { profiles_reconcile_evidence } from './profiles-apply.uc';
import { strategy_apply_guard_status, strategy_apply_uncertain_record } from './strategy-state.uc';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function test_mode() { return getenv('Z2M_SCANNER_SERVER_TEST') == '1'; }
function copy(value) {
	if (type(value) == 'array') { let out = []; for (let item in value) push(out, copy(item)); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = copy(value[key]); return out; }
	return value;
}
function dependency(stage, detail) {
	return { ok: false, error: { code: 'EDEPENDENCY', message: 'Task 7 reconciliation evidence is required.', stage,
		dependency: 'Task 7 reconciliation', recovery: 'required', detail: detail || null } };
}
function cleanup_verified(value) {
	return object(value) && value.ok == true && value.processRemoved == true
		&& value.firewallRemoved == true && value.nfqueueRemoved == true
		&& value.hostlistRemoved == true && value.temporaryFilesRemoved == true
		&& value.ownedOnly == true;
}
function session_cleanup_verified(value) {
	return object(value) && value.ok == true && value.verifiedCleanup == true
		&& object(value.lockRelease) && value.lockRelease.ok == true
		&& object(value.sessionCleanup) && value.sessionCleanup.ok == true
		&& (value.sessionCleanup.verified == true || value.sessionCleanup.skipped == true);
}
function recovery_verified(value) {
	return object(value) && value.ok == true && object(value.recovery)
		&& value.recovery.state == 'verified';
}
function runtime_verified(value) {
	return object(value) && value.processPresent == true && value.singleInstance == true
		&& value.rulesPresent == true && value.queueRegistered == true && value.ownerMatch == true;
}
function terminal_reason(value) {
	return value == 'completed' || value == 'cancelled' || value == 'error';
}
function supplied_reconcile(seams) {
	if (!test_mode() || !object(seams)) return null;
	return seams.reconcile != null ? seams.reconcile : null;
}
function current_evidence(seams) {
	let supplied = supplied_reconcile(seams);
	if (supplied != null) return supplied;
	// Tests must opt in to the bounded reconciliation evidence seam.  Calling
	// the production collector from a server-test process would turn an absent
	// provider into a host-shaped EVERIFY result and hide the Task 7 dependency.
	if (test_mode()) return null;
	try {
		let evidence = profiles_reconcile_evidence();
		if (!object(evidence) || evidence.ok != true || !runtime_verified(evidence.runtimeChecks)) return evidence;
		return { ok: true, recovery: { state: 'verified' }, evidence: evidence };
	} catch (e) { return null; }
}
function snapshot_restored(record, evidence) {
	if (test_mode()) return true;
	let snapshot = record?._session?.snapshot || record?.session?.snapshot;
	let current = evidence?.evidence || evidence;
	return object(snapshot) && object(snapshot.config) && digest(snapshot.config.sha256)
		&& object(snapshot.identity) && digest(snapshot.identity.candidateSha256)
		&& object(current) && current.currentConfigSha256 == snapshot.config.sha256
		&& current.activeCandidateSha256 == snapshot.identity.candidateSha256;
}
function guard_uncertain(record, evidence, reason, seams) {
	// An already-present Apply uncertainty record is authoritative and remains
	// blocking.  Do not fabricate a Strategy Apply record from partial Scanner
	// evidence; only a complete server-owned uncertainty envelope may be written.
	let guard = null;
	try { guard = strategy_apply_guard_status(); } catch (e) { guard = { ok: false, error: e }; }
	let supplied = test_mode() && object(seams) && seams.applyUncertain != null
		? seams.applyUncertain : (record?.applyUncertain || null);
	if (supplied != null) {
		try {
			let persisted = guard_uncertain_record(supplied);
			if (persisted != null && persisted.ok == true) guard = strategy_apply_guard_status();
		} catch (e) { }
	}
	return { guard: guard, reason: reason, evidence: evidence || null };
}
function guard_uncertain_record(input) {
	if (!object(input) || !digest(input.oldConfigSha256) || !digest(input.newConfigSha256)
		|| !digest(input.oldCandidateSha256) || !digest(input.newCandidateSha256)
		|| !digest(input.catalogDigest) || !object(input.runtimeOutcome)
		|| !string(input.reason) || !length(input.reason) || length(input.reason) > 128)
		return null;
	return strategy_apply_uncertain_record(input);
}
function cleanup_attempt(record, seams) {
	let attempt = record?._attempt || record?.attempt;
	if (attempt == null) return { ok: true, skipped: true };
	try {
		let result = scanner_candidate_cleanup(attempt);
		return result.ok == true ? result : { ok: false, result };
	} catch (e) { return { ok: false, error: e }; }
}
function cleanup_session(record, seams) {
	let session = record?._session || record?.session;
	if (!object(session) || !string(session.sessionId)) return dependency('session_cleanup', 'session identity is unavailable');
	try {
		let result = scanner_session_finish(session, test_mode() && object(seams) ? seams.transient : null);
		return session_cleanup_verified(result) ? result : { ok: false, result };
	} catch (e) { return { ok: false, error: e }; }
}

// The only legal successful terminal combinations are completed/verified and
// cancelled/verified.  Any missing or failed proof is error/uncertain.
export const scanner_terminal_reconcile = function(record, terminalReason, seams) {
	if (!object(record) || !terminal_reason(terminalReason)) return dependency('input', 'terminal reason or record is invalid');
	if (!object(record._session || record.session)) return dependency('session_cleanup', 'session identity is unavailable');
	let candidateCleanup = cleanup_attempt(record, seams);
	let sessionCleanup = cleanup_session(record, seams);
	let evidence = current_evidence(seams);
	let evidenceOk = recovery_verified(evidence);
	let cleanupOk = candidateCleanup.ok == true && (candidateCleanup.skipped == true || cleanup_verified(candidateCleanup.cleanup));
	let sessionOk = sessionCleanup.ok == true && session_cleanup_verified(sessionCleanup);
	if (!cleanupOk || !sessionOk) {
		let recovery = { state: 'uncertain', candidateCleanup, sessionCleanup,
			reconciliation: dependency(!cleanupOk ? 'candidate_cleanup' : 'session_cleanup', null),
			apply: guard_uncertain(record, evidence, 'owned Scanner cleanup was not verified', seams) };
		return { ok: false, status: 'error', recovery, candidateCleanup, sessionCleanup };
	}
	if (!evidenceOk || !snapshot_restored(record, evidence)) {
		let recovery = { state: 'uncertain', candidateCleanup, sessionCleanup,
			reconciliation: evidence || dependency('terminal_reconciliation', null),
			apply: guard_uncertain(record, evidence, 'pre-scan runtime restoration was not proven', seams) };
		return { ok: false, status: 'error', recovery, candidateCleanup, sessionCleanup };
	}
	return { ok: true, status: terminalReason, recovery: { state: 'verified', candidateCleanup, sessionCleanup, reconciliation: evidence }, candidateCleanup, sessionCleanup };
};

// Stale workers are infrastructure failures.  The caller must supply the
// record's retained session snapshot and the identity observation; a PID alone
// never authorizes cleanup or a successful terminal state.
export const scanner_stale_worker_recover = function(record, identity, seams) {
	if (!object(record) || !object(record.worker) || !object(identity)
		|| record.worker.pid != identity.pid || record.worker.startTime != identity.startTime)
		return dependency('stale_worker', 'worker PID/start-time identity is ambiguous');
	let result = scanner_terminal_reconcile(record, 'error', seams);
	if (result.ok) result.ok = false;
	result.status = 'error';
	result.recovery = result.recovery || { state: 'uncertain' };
	if (result.recovery.state != 'verified') result.recovery.state = 'uncertain';
	result.recovery.worker = { state: 'dead', identity: copy(identity) };
	return result;
};
