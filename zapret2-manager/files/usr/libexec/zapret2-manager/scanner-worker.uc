'use strict';

import { readfile } from 'fs';
import { scanner_plan_build } from './scanner-planner.uc';
import { scanner_baseline_classify, scanner_tcp_classify, scanner_udp_classify, scanner_candidate_verdict } from './scanner-probes.uc';
import { scanner_probe_adapter_baseline, scanner_probe_adapter_tcp, scanner_probe_adapter_staged, scanner_probe_adapter_udp } from './scanner-probe-adapter.uc';
import { scanner_probe_execute } from './scanner-probe-executor.uc';
import { scanner_session_begin, scanner_candidate_activate, scanner_candidate_cleanup, scanner_session_finish } from './scanner-transient.uc';
import { scanner_dependency_preflight } from './scanner-dependency-preflight.uc';
import { scanner_terminal_reconcile, scanner_stale_worker_recover } from './scanner-reconcile.uc';
import * as state from './scanner-state.uc';

const MAX_RESULTS = 128;
const HEARTBEAT_MAX_AGE = 120;
const PROBE_BUDGET_MS = 120000;
const SCAN_BUDGET_MS = 300000;
// Scanner 2.0 bounded budgets: exploration (cheap probes), verification (full probes), finalists 20, early infra stop
// Aligned with planner MODE_BUDGETS: quick 30/10, standard 60/20, full 80/20
const BUDGETS = { quick: { exploration: 30, verification: 10 }, standard: { exploration: 60, verification: 20 }, full: { exploration: 80, verification: 20 } };
const FINALISTS_TARGET = 20;
const INFRA_CONSECUTIVE_LIMIT = 5;
function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function exception_summary(value) {
	if (value == null) return null;
	if (!object(value)) return string(value) ? value : '' + value;
	let out = {};
	for (let key in ['name', 'code', 'message', 'stage']) if (value[key] != null && (string(value[key]) || integer(value[key]))) out[key] = value[key];
	return length(keys(out)) ? out : 'Scanner lifecycle exception';
}
function copy(value) {
	if (type(value) == 'array') { let out = []; for (let i = 0; i < length(value); i++) push(out, copy(value[i])); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = copy(value[key]); return out; }
	return value;
}
function zero_nonce() { let out = ''; for (let i = 0; i < 64; i++) out += '0'; return out; }
function error(code, message, extra) { let out = { ok: false, error: { code, message } }; for (let key in extra || {}) out[key] = extra[key]; return out; }
function task7_dependency(stage, exception) {
	return { ok: false, error: { code: 'EDEPENDENCY', message: 'Task 7 reconciliation evidence is required.', stage,
		dependency: 'Task 7 reconciliation', recovery: 'required', exception: exception_summary(exception) } };
}
function stale_heartbeat(value) { return !integer(value) || value > time() || time() - value > HEARTBEAT_MAX_AGE; }
function monotonic_ms() {
	let now = clock(true);
	return now[0] * 1000 + int(now[1] / 1000000);
}
function deadline(start) { return start + SCAN_BUDGET_MS; }
function budget(start) { return int(time() * 1000) <= deadline(start); }
function test_mode() { return getenv('Z2M_SCANNER_SERVER_TEST') == '1'; }
function seam(seams, name) { return test_mode() && object(seams) ? seams[name] : null; }
let lifecycle = null;
function request_validate(input) {
	if (!object(input) || !string(input.target) || !match(input.target, /^[a-z0-9][a-z0-9.-]{1,252}$/)
		|| index(input.target, '.') < 0 || index(input.target, ':') >= 0) return error('EINPUT', 'Scanner target must be a strict hostname.', { path: 'target' });
	let target = input.target;
	if (substr(target, length(target) - 1, 1) == '.') target = substr(target, 0, length(target) - 1);
	let protocol = input.protocol == null ? 'tcp' : input.protocol;
	let mode = input.mode == null ? 'quick' : input.mode;
	let resume = input.resume == null ? false : input.resume;
	if ((protocol != 'tcp' && protocol != 'udp') || (mode != 'quick' && mode != 'standard' && mode != 'full') || type(resume) != 'bool') return error('EINPUT', 'Scanner request fields are invalid.');
	let dpi_type = input.dpi_type == null ? null : input.dpi_type;
	if (dpi_type == '') dpi_type = null;
	return { ok: true, value: { target, protocol, mode, resume, dpi_type } };
}
function identity_test(seams) { return object(seams) && object(seams.identity) ? seams.identity : null; }
function process_starttime(pid) {
	try { let fields = split(trim(readfile('/proc/' + pid + '/stat') || ''), ' '); return length(fields) > 21 ? +fields[21] : null; } catch (e) { return null; }
}
function self_identity(seams) {
	let supplied = identity_test(seams);
	if (supplied != null) return supplied;
	let pid = 0;
	try { pid = +split(trim(readfile('/proc/self/stat') || ''), ' ')[0]; } catch (e) { pid = 0; }
	return { pid, startTime: process_starttime(pid), exe: '/usr/bin/ucode', owner: 'scanner/worker', generation: 0 };
}
function control(seams, id, index) {
	let sequence = seam(seams, 'controlSequence');
	if (type(sequence) == 'array') return sequence[index < length(sequence) ? index : length(sequence) - 1] || { stopRequested: false };
	let injected = seam(seams, 'control');
	if (object(injected)) return injected;
	let loaded = state.scanner_control_load(id);
	return loaded.ok ? loaded.control : { stopRequested: false };
}
function phase(record, value, current) { record.phase = value; record.currentCandidate = current == null ? null : current; record.heartbeatAt = time(); }
function event(record, type, message) { if (!record.events) record.events = []; push(record.events, { type, message, at: time() }); if (length(record.events) > 32) record.events = slice(record.events, length(record.events) - 32); }
function publish(record) {
	if (lifecycle?.seams?.publishFailureAt == lifecycle.stage) return error('EIO', 'Scanner checkpoint publication failed.');
	if (lifecycle?.seams?.saveFailureAt == lifecycle.stage) return error('EIO', 'Scanner recovery publication failed.');
	let stateWriteStarted = monotonic_ms();
	let saved = state.scanner_state_save(record);
	let stateWriteMs = monotonic_ms() - stateWriteStarted;
	if (object(record.planAuthority?.execution?.timings)) {
		record.planAuthority.execution.timings.stateWriteMs = stateWriteMs;
		if (object(saved?.state?.planAuthority?.execution?.timings))
			saved.state.planAuthority.execution.timings.stateWriteMs = stateWriteMs;
	}
	if (!saved.ok) return saved;
	record.revision = saved.revision; record.id = saved.id; return saved;
}
function checkpoint(record, stage) {
	if (lifecycle) lifecycle.stage = stage;
	let saved = publish(record);
	if (!saved.ok) {
		if (lifecycle) lifecycle.checkpointFailure = saved.error || { code: 'EIO', message: 'Scanner checkpoint publication failed.' };
		let failure = null; failure();
	}
	return saved;
}
function metrics_evidence(value) {
	if (!object(value)) return null;
	let out = {};
	for (let key in ['protocol', 'failureCode', 'failureReason', 'pathVerdict', 'pathReason', 'averageKbps', 'averageLatencyMs', 'successRate', 'attempts', 'mappedFamily', 'bytesReceived', 'exitCode', 'signal', 'startedAt', 'finishedAt', 'latencyMs', 'stunLatencyMs', 'kbps'])
		if (value[key] != null) out[key] = copy(value[key]);
	if (array(value.resolvedIps)) out.resolvedIps = copy(value.resolvedIps);
	if (array(value.perProbe)) out.perProbe = copy(value.perProbe);
	if (array(value.markerEvidence)) out.markerEvidence = copy(value.markerEvidence);
	return out;
}
function candidate_evidence(value) {
	if (!object(value)) return null;
	let evidence = { infrastructure: value.infrastructure === true, failureClass: string(value.failureClass) ? value.failureClass : null, baselineSuppressed: value.baselineSuppressed === true };
	if (object(value.metrics)) evidence.metrics = metrics_evidence(value.metrics);
	for (let key in ['pathVerdict', 'pathReason', 'failureCode', 'failureReason', 'resolvedIps', 'stages'])
		if (value[key] != null) evidence[key] = copy(value[key]);
	return evidence;
}
function cleanup_verified(value) {
	return object(value) && value.ok == true && value.processRemoved == true && value.firewallRemoved == true
		&& value.nfqueueRemoved == true && value.hostlistRemoved == true && value.temporaryFilesRemoved == true
		&& value.ownedOnly == true;
}
function activation_cleanup(value) {
	let pending = [value], visited = 0;
	while (length(pending) > 0 && visited < 32) {
		let current = pop(pending); visited++;
		if (cleanup_verified(current)) return current;
		if (!object(current)) continue;
		for (let key in ['cleanup', 'adapter', 'activation', 'error'])
			if (object(current[key])) push(pending, current[key]);
	}
	return null;
}
function probe_candidate(candidate, plan, baseline, seams, outerDeadline) {
	let raw = seam(seams, 'probe');
	if (type(raw) == 'function') raw = raw(candidate, plan);
	if (raw == null) {
		let now = int(time() * 1000), end = outerDeadline < now + PROBE_BUDGET_MS ? outerDeadline : now + PROBE_BUDGET_MS;
		if (candidate.protocol == 'udp') {
			let adapted = scanner_probe_adapter_udp(candidate, plan.targetProfile, { nowMs: now, deadlineMs: end, mode: plan.request.mode, cancelToken: lifecycle?.record?.id, profileDigest: state.scanner_profile_digest(plan.targetProfile) });
			if (!adapted.ok) return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.error?.message }, []);
			let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
			if (!executed.ok) return { ok: false, error: executed.error || { code: 'EDEPENDENCY', message: 'Probe dependency failed.' } };
			raw = executed.observations?.[0] || null;
		}
		else {
			let adapted = scanner_probe_adapter_staged(candidate, plan.targetProfile, { nowMs: int(time() * 1000), deadlineMs: end,
				mode: plan.request.mode, cancelToken: lifecycle?.record?.id, profileDigest: state.scanner_profile_digest(plan.targetProfile) });
			if (!adapted.ok) return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.error?.message }, []);
			let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
			if (!executed.ok) return { ok: false, error: executed.error || { code: 'EDEPENDENCY', message: 'Probe dependency failed.' } };
			raw = executed.observations?.[0];
		}
	}
	if (raw == null) return scanner_candidate_verdict({ infrastructureFailure: true, error: 'PROBE_DEPENDENCY' }, []);
	let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
	return scanner_candidate_verdict(baseline, [classified]);
}
function cheap_probe_candidate(candidate, plan, baseline, seams, outerDeadline) {
	let raw = seam(seams, 'cheapProbe');
	if (raw != null) {
		if (type(raw) == 'function') raw = raw(candidate, plan);
		if (raw != null) {
			let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
			return scanner_candidate_verdict(baseline, [classified]);
		}
	}
	raw = seam(seams, 'probe');
	if (type(raw) == 'function') raw = raw(candidate, plan);
	if (raw != null && test_mode()) {
		let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
		return scanner_candidate_verdict(baseline, [classified]);
	}
	let now = int(time() * 1000), end = outerDeadline < now + PROBE_BUDGET_MS ? outerDeadline : now + PROBE_BUDGET_MS;
	if (candidate.protocol == 'udp') {
		let adapted = scanner_probe_adapter_udp(candidate, plan.targetProfile, { nowMs: now, deadlineMs: end, mode: 'quick', cancelToken: lifecycle?.record?.id, profileDigest: state.scanner_profile_digest(plan.targetProfile) });
		if (!adapted.ok) return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.error?.message }, []);
		let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
		if (!executed.ok) return { ok: false, error: executed.error || { code: 'EDEPENDENCY', message: 'Probe dependency failed.' } };
		raw = executed.observations?.[0] || null;
	} else {
		let adapted = scanner_probe_adapter_tcp(candidate, plan.targetProfile, 'ipv4', { nowMs: now, deadlineMs: end, mode: 'quick', cancelToken: lifecycle?.record?.id, profileDigest: state.scanner_profile_digest(plan.targetProfile) });
		if (!adapted.ok) return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.error?.message }, []);
		let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
		if (!executed.ok) return { ok: false, error: executed.error || { code: 'EDEPENDENCY', message: 'Probe dependency failed.' } };
		raw = executed.observations?.[0] || null;
	}
	if (raw == null) return scanner_candidate_verdict({ infrastructureFailure: true, error: 'PROBE_DEPENDENCY' }, []);
	let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
	return scanner_candidate_verdict(baseline, [classified]);
}
function full_verify_candidate(candidate, plan, baseline, seams, outerDeadline) {
	let raw = seam(seams, 'fullProbe');
	if (raw != null) {
		if (type(raw) == 'function') raw = raw(candidate, plan);
		if (raw != null) {
			let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
			return scanner_candidate_verdict(baseline, [classified]);
		}
	}
	raw = seam(seams, 'probe');
	if (type(raw) == 'function') raw = raw(candidate, plan);
	if (raw != null && test_mode()) {
		let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
		return scanner_candidate_verdict(baseline, [classified]);
	}
	let now = int(time() * 1000), end = outerDeadline < now + PROBE_BUDGET_MS ? outerDeadline : now + PROBE_BUDGET_MS;
	if (candidate.protocol == 'udp') {
		let adapted = scanner_probe_adapter_udp(candidate, plan.targetProfile, { nowMs: now, deadlineMs: end, mode: plan.request.mode, cancelToken: lifecycle?.record?.id, profileDigest: state.scanner_profile_digest(plan.targetProfile) });
		if (!adapted.ok) return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.error?.message }, []);
		let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
		if (!executed.ok) return { ok: false, error: executed.error || { code: 'EDEPENDENCY', message: 'Probe dependency failed.' } };
		raw = executed.observations?.[0] || null;
	} else {
		let adapted = scanner_probe_adapter_staged(candidate, plan.targetProfile, { nowMs: now, deadlineMs: end, mode: plan.request.mode, cancelToken: lifecycle?.record?.id, profileDigest: state.scanner_profile_digest(plan.targetProfile) });
		if (!adapted.ok) return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.error?.message }, []);
		let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
		if (!executed.ok) return { ok: false, error: executed.error || { code: 'EDEPENDENCY', message: 'Probe dependency failed.' } };
		raw = executed.observations?.[0] || null;
	}
	if (raw == null) return scanner_candidate_verdict({ infrastructureFailure: true, error: 'PROBE_DEPENDENCY' }, []);
	let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
	return scanner_candidate_verdict(baseline, [classified]);
}
function result_identity(value) { return state.scanner_state_digest({ candidateId: value.candidateId, ordinal: value.ordinal, planDigest: value.planDigest, verdict: value.verdict, success: value.success, score: value.score, reason: value.reason, evidence: value.evidence }); }
function cleanup_attempt(attempt) { if (!attempt) return { ok: true, evidence: null }; try { return scanner_candidate_cleanup(attempt); } catch (e) { return { ok: false, error: e }; } }
function merge_recovery(existing, update) {
	let out = object(existing) ? copy(existing) : {};
	for (let key in update || {}) if (update[key] != null) out[key] = copy(update[key]);
	if (existing?.state == 'uncertain' || update?.state == 'uncertain') out.state = 'uncertain';
	return out;
}
function release_claim(claimed) {
	if (!claimed) return { ok: false, error: { code: 'EDEPENDENCY', message: 'Scanner claim identity is unavailable.' } };
	try { return state.scanner_state_release(claimed.id, claimed.identity); }
	catch (exception) { return { ok: false, error: exception }; }
}
function recover(record, seams, context, message) {
	let lifecycleFailure = lifecycle?.checkpointFailure || context?.exception || null;
	let recovery = merge_recovery(record.recovery, { state: 'uncertain', message, exception: exception_summary(lifecycleFailure), activation: context?.attempt?.activation || null, candidateCleanup: null, sessionCleanup: null, lockRelease: null, activeRelease: null, reconciliation: task7_dependency('recovery', message) });
	if (context?.attempt) recovery.candidateCleanup = cleanup_attempt(context.attempt);
	if (context?.session) { try { recovery.sessionCleanup = scanner_session_finish(context.session, seam(seams, 'transient')); recovery.lockRelease = recovery.sessionCleanup.lockRelease; } catch (e) { recovery.sessionCleanup = { ok: false, error: e, reconciliation: task7_dependency('session_cleanup', e) }; recovery.lockRelease = recovery.sessionCleanup; } }
	recovery.activeRelease = release_claim(lifecycle?.claimed || (context?.record?.id && context?.record?.worker ? { id: context.record.id, identity: context.record.worker } : null));
	record.status = 'error'; record.phase = 'recovery'; record.recovery = recovery; record.error = message || 'Scanner worker lifecycle failed; reconciliation is required.'; record.currentCandidate = null; record.finishedAt = time(); record.heartbeatAt = time();
	recovery.publication = { ok: false, durable: false, retryRequired: true, result: null };
	let published = null;
	try { published = state.scanner_state_save(record); } catch (e) { published = { ok: false, error: e }; }
	if (published && published.ok === true) recovery.publication = { ok: true, durable: true, retryRequired: false, result: published };
	else { recovery.publication = { ok: false, durable: false, retryRequired: true, result: published }; let released = release_claim(lifecycle?.claimed); recovery.activeRelease = released; }
	return { ok: false, state: record, error: { code: 'EINTERNAL', message: record.error }, recovery };
}
function terminal_reconciliation(record, transition, cleanupEvidence) {
	let journal = null;
	if (record.id) {
		try { journal = state.scanner_journal_load(record.id); } catch (e) { journal = null; }
	}
	let entry = journal?.ok && journal.journal.entries?.length ? journal.journal.entries[length(journal.journal.entries) - 1] : null;
	let evidence = object(record.recovery) ? record.recovery : {};
	let table = evidence.table || entry?.evidence?.table || entry?.evidence?.expectedTable;
	if (!table) {
		let cleanup = cleanupEvidence || evidence.sessionCleanup;
		if (object(cleanup) && cleanup.ok === true && cleanup.verifiedCleanup === true)
			return { ok: true, decision: 'no_scanner_table_created', recovery: { state: 'verified', tablePresent: false, tableChecked: true } };
		return task7_dependency('terminal_reconciliation', null);
	}
	return scanner_terminal_reconcile({
		sid: record.id,
		cid: record.currentCandidate || 'terminal',
		gen: record.worker?.generation || 0,
		table: table,
		journalState: evidence.journalState || entry?.state || null,
		ownerDead: true,
		tableChecked: evidence.tableChecked === true,
		tablePresent: evidence.tablePresent === true,
		terminalReason: transition,
	});
}
function finish(record, session, seams, transition, message) {
	let cleanup = null;
	try { cleanup = scanner_session_finish(session, seam(seams, 'transient')); }
	catch (exception) { cleanup = { ok: false, error: exception, recovery: task7_dependency('session_finish', exception), verifiedCleanup: false }; }
	if (lifecycle) lifecycle.sessionCleanup = cleanup;
	let reconciliation = seam(seams, 'reconcile');
	// Test seams model the required Task 7 provider explicitly.  Keeping a
	// missing seam fail-closed prevents the host-side harness from silently
	// substituting a production reconciliation path it was meant to withhold;
	// deployed runtime calls use the canonical provider below.
	if (reconciliation == null)
		reconciliation = test_mode() ? task7_dependency('terminal_reconciliation', null)
			: terminal_reconciliation(record, transition, cleanup);
	if (!object(reconciliation) || reconciliation.ok !== true || reconciliation.recovery?.state != 'verified') {
		record.status = 'error';
		record.phase = 'recovery';
		record.recovery = merge_recovery(record.recovery, { state: 'uncertain', sessionCleanup: cleanup, reconciliation: reconciliation || task7_dependency('terminal_reconciliation', null) });
		record.error = message || 'Scanner recovery is uncertain.';
	} else {
		record.status = transition == 'cancelled' ? 'cancelled' : (transition == 'completed' ? 'completed' : 'error');
		record.phase = record.status;
		record.recovery = merge_recovery(record.recovery, { state: 'verified', sessionCleanup: cleanup });
		if (message != null) record.error = message;
	}
	record.currentCandidate = null; record.finishedAt = time(); record.heartbeatAt = time();
	let saved;
	try { saved = checkpoint(record, 'terminal'); }
	catch (exception) {
		record.status = 'error'; record.phase = 'recovery'; record.recovery = merge_recovery(record.recovery,
			{ state: 'uncertain', reconciliation: task7_dependency('terminal_checkpoint', exception) });
		record.error = 'Task 7 reconciliation evidence is required after checkpoint failure.';
		record.recovery.activeRelease = release_claim(lifecycle?.claimed);
		if (lifecycle) lifecycle.stage = 'terminal-recovery';
		let published = null;
		try { published = publish(record); } catch (publicationException) { published = { ok: false, error: publicationException }; }
		record.recovery.publication = { ok: published?.ok === true, durable: published?.ok === true, retryRequired: published?.ok !== true, result: published };
		return { ok: false, state: record, cleanup, recovery: record.recovery };
	}
	if (!saved.ok) {
		let releasedAfterCheckpointFailure = release_claim(lifecycle?.claimed);
		record.status = 'error'; record.phase = 'recovery'; record.recovery = merge_recovery(record.recovery,
			{ state: 'uncertain', activeRelease: releasedAfterCheckpointFailure, sessionCleanup: cleanup, reconciliation: task7_dependency('terminal_checkpoint', saved.error) });
		record.error = 'Task 7 reconciliation evidence is required after checkpoint failure.';
		if (lifecycle) lifecycle.stage = 'terminal-recovery';
		let published = null;
		try { published = publish(record); } catch (publicationException) { published = { ok: false, error: publicationException }; }
		record.recovery.publication = { ok: published?.ok === true, durable: published?.ok === true, retryRequired: published?.ok !== true, result: published };
		return { ok: false, state: record, cleanup, recovery: record.recovery };
	}
	let released = release_claim(lifecycle?.claimed);
	if (lifecycle) lifecycle.activeRelease = released;
	if (!released.ok) {
		record.status = 'error'; record.phase = 'recovery'; record.recovery = merge_recovery(record.recovery, { state: 'uncertain', sessionCleanup: cleanup, activeRelease: released }); record.error = 'Scanner active marker release is uncertain.';
		checkpoint(record, 'terminal-recovery');
		return { ok: false, state: record, cleanup, recovery: record.recovery };
	}
	return saved.ok ? { ok: record.status != 'error', state: record, cleanup } : saved;
}
function persistable_candidate(value) {
	let out = {
		scannerId: value.scannerId, identityKind: value.identityKind, strategyId: value.strategyId,
		strategyRevision: value.strategyRevision, source: value.source, sourcePath: value.sourcePath,
		protocol: value.protocol, compiledTokens: copy(value.compiledTokens), compiledDigest: value.compiledDigest,
		dependencyDigest: value.dependencyDigest, ordinal: value.ordinal,
		saveRequired: value.saveRequired === true
	};
	if (value.saveRequired === true || value.identityKind == 'generated') out.dependencyClosure = copy(value.dependencyClosure);
	return out;
}
function persistable_plan(value) {
	let out = { schema: value.schema, request: copy(value.request), targetProfile: copy(value.targetProfile),
		catalogDigest: value.catalogDigest, compilerDigest: value.compilerDigest, candidates: [] };
	for (let candidate in value.candidates || []) push(out.candidates, persistable_candidate(candidate));
	if (object(value.execution)) {
		out.execution = { catalogEntriesConsidered: value.execution.catalogEntriesConsidered,
			lightweightEligible: value.execution.lightweightEligible, compileAttempts: value.execution.compileAttempts,
			compiledAccepted: value.execution.compiledAccepted, candidatesCompiled: value.execution.candidatesCompiled,
			candidatesEligible: value.execution.candidatesEligible, candidatesShortlisted: value.execution.candidatesShortlisted,
			maxCandidates: value.execution.maxCandidates, timings: copy(value.execution.timings || {}) };
	}
	return out;
}
function request_and_plan(input, seams) {
	let checked = request_validate(input.request);
	if (!checked.ok) return checked;
	let planned = null;
	try { planned = scanner_plan_build(checked.value); } catch (e) { planned = null; }
	if (!planned || planned.ok !== true) {
		let injected = seam(seams, 'plan');
		planned = injected != null ? { ok: true, plan: injected } : null;
	}
	let plan = planned?.plan;
	if (!object(plan) || type(plan.candidates) != 'array' || !digest(plan.catalogDigest) || !digest(plan.compilerDigest)) return error('EDEPENDENCY', 'Scanner plan authority is unavailable.');
	return { ok: true, request: checked.value, plan, persistedPlan: persistable_plan(plan) };
}
function plan_identity(plan) { return state.scanner_state_digest({ schema: plan.schema, request: plan.request, targetProfile: plan.targetProfile, catalogDigest: plan.catalogDigest, compilerDigest: plan.compilerDigest, candidates: plan.candidates }); }
function rehydrate_plan(persisted) {
	if (!object(persisted) || !object(persisted.request)) return error('ESTALE', 'Scanner plan authority is unavailable.');
	// Resume is bound to the plan persisted with the checkpoint. Rebuilding from
	// the live catalog here would make an otherwise valid scan stale whenever a
	// catalog update lands between candidates. The record itself is root-owned;
	// retain only the bounded plan projection and let the caller compare its
	// identity with the checkpoint digest below.
	let projection = persistable_plan(persisted);
	if (!object(projection) || type(projection.candidates) != 'array')
		return error('ESTALE', 'Scanner plan authority changed since the retained checkpoint.');
	// State fixtures and older checkpoints may already contain the complete
	// plan. Preserve that root-owned projection when its identity is distinct;
	// production checkpoints use the compact persistable form above.
	return { ok: true, plan: plan_identity(projection) == plan_identity(persisted) ? projection : copy(persisted) };
}
function checkpoint_valid(record, plan) {
	let start = integer(record.cursor?.nextCandidate) ? record.cursor.nextCandidate : -1;
	if (start < 0 || start > length(plan.candidates) || record.progress != start || type(record.results) != 'array' || length(record.results) != start) return false;
	let seen = {};
	for (let i = 0; i < length(record.results); i++) {
		let row = record.results[i], candidate = plan.candidates[i];
		if (!object(row) || !object(candidate) || row.candidateId != candidate.scannerId || row.ordinal != candidate.ordinal || row.planDigest != record.planDigest || seen[row.candidateId]
		|| (row.verdict != 'working' && row.verdict != 'failed' && row.verdict != 'infrastructure') || type(row.success) != 'bool'
		|| (row.score != null && !(type(row.score) == 'int' || type(row.score) == 'double')) || !object(row.evidence) || !digest(row.evidenceIdentity) || result_identity(row) != row.evidenceIdentity) return false;
		seen[row.candidateId] = true;
	}
	return true;
}
function baseline_valid(value, protocol) {
	return object(value) && value.infrastructureFailure === false && value.protocol == protocol &&
		type(value.baselineOpen) == 'bool' && type(value.allAvailableOpen) == 'bool' && type(value.probeAddressFamilies) == 'array' && value.error == null &&
		((protocol == 'tcp' && object(value.byAddressFamily) && object(value.byAddressFamily.ipv4) && object(value.byAddressFamily.ipv6)) ||
		 (protocol == 'udp' && object(value.byAddressFamily) && object(value.byAddressFamily.ipv4)));
}
let scanner_worker_run_impl = null;
function scanner_worker_resume_impl(input, seams) { return scanner_worker_run_impl(input, seams); }

export const scanner_worker_resume = function(input, seams) {
	let loaded = state.scanner_state_load(input?.id);
	if (!loaded.ok) return loaded;
	let record = loaded.state, persistedPlan = record.planAuthority, plan = null;
	let rebuilt = rehydrate_plan(persistedPlan);
	if (rebuilt.ok) plan = rebuilt.plan;
	let staleOwnerRecovered = false;
	if (object(record.worker) && stale_heartbeat(record.heartbeatAt)) {
		let journal = state.scanner_journal_load(record.id);
		let entry = journal?.ok && journal.journal.entries?.length ? journal.journal.entries[length(journal.journal.entries) - 1] : null;
		let stale = scanner_stale_worker_recover({ sid: record.id, cid: record.currentCandidate || 'stale', gen: record.worker.generation || 0,
			 table: record.recovery?.table || entry?.evidence?.table || entry?.evidence?.expectedTable,
			journalState: entry?.state || null, ownerDead: true,
			tableChecked: record.recovery?.tableChecked === true,
			tablePresent: record.recovery?.tablePresent === true });
		if (stale.ok && stale.uncertain === true) return error('EUNCERTAIN', 'Stale Scanner ownership requires fail-closed reconciliation.', { reconciliation: stale });
		staleOwnerRecovered = stale.ok === true && stale.recovery?.state === 'verified';
	}
	let resumableStatus = record.status == 'running'
		|| (record.status == 'cancelled' && record.recovery?.state == 'verified'
			&& integer(record.cursor?.nextCandidate) && record.cursor.nextCandidate < length(plan?.candidates || []));
	let staleHeartbeat = stale_heartbeat(record.heartbeatAt), requestIdentity = state.scanner_state_digest(record.request) == record.requestDigest;
	let planIdentity = plan != null && plan.catalogDigest == record.catalogDigest && plan.compilerDigest == record.compilerDigest
		&& plan_identity(plan) == record.planDigest;
	let checkpointIdentity = plan != null && checkpoint_valid(record, plan);
	if (!resumableStatus || (!staleOwnerRecovered && staleHeartbeat) || !plan || !requestIdentity || !planIdentity || !checkpointIdentity)
		return error('ESTALE', 'Scanner resume identity does not match the checkpoint.',
			{ resumableStatus: resumableStatus, staleOwnerRecovered: staleOwnerRecovered, staleHeartbeat: staleHeartbeat,
				requestIdentity: requestIdentity, planIdentity: planIdentity, checkpointIdentity: checkpointIdentity });
	if (!baseline_valid(record.baseline, record.request?.protocol) || !digest(record.baselineIdentity) || state.scanner_state_digest(record.baseline) != record.baselineIdentity)
		return error('EDEPENDENCY', 'Retained baseline authority is unavailable.');
	let identity = self_identity(seams);
	if (!staleOwnerRecovered && (!object(record.worker) || record.worker.pid != identity.pid || record.worker.startTime != identity.startTime))
		return error('ESTALE', 'Scanner worker identity is stale.');
	return scanner_worker_resume_impl({ id: record.id, request: record.request, resume: true, record, resumePlan: copy(plan) }, seams);
};

scanner_worker_run_impl = function(input, seams) {
	if (!object(input) || !object(input.request)) return error('EINPUT', 'Scanner worker request is invalid.');
	let prepared = input.resume === true && input.resumePlan != null ? request_validate(input.request) : request_and_plan(input, seams);
	if (!prepared.ok) return prepared;
	let req = prepared.value || prepared.request, plan = input.resume === true && input.resumePlan != null ? input.resumePlan : prepared.plan, persistedPlan = input.resume === true && input.record ? input.record.planAuthority : prepared.persistedPlan, identity = self_identity(seams);
	if (!integer(identity.pid) || !integer(identity.startTime)) return error('EDEPENDENCY', 'Scanner worker identity is unavailable.');
	lifecycle = { seams, stage: 'start', session: null, attempt: null, record: null, claimed: null };
	let record = input.record || {
		schema: 1, id: null, revision: 0, request: copy(req), requestDigest: null,
		catalogDigest: plan.catalogDigest, compilerDigest: plan.compilerDigest, planDigest: null,
		status: 'idle', phase: 'idle', progress: 0, total: length(plan.candidates), cursor: { nextCandidate: 0 },
		currentCandidate: null, counts: { working: 0, failed: 0, infrastructure: 0, promoted: 0, explorationExecuted: 0, verificationExecuted: 0 }, results: [], baseline: null, baselineIdentity: null, baselineExecutorCalls: 0,
		error: null, recovery: { state: 'not_required' }, cancellationRequested: false, worker: null,
		heartbeatAt: time(), startedAt: null, finishedAt: null, events: [], planAuthority: copy(persistedPlan)
	};
	if (!input.record && input.id) {
		let existing = state.scanner_state_load(input.id);
		if (existing.ok && existing.state.status == 'error' && existing.state.recovery?.state == 'uncertain') record = existing.state;
	}
	if (input.record) { persistedPlan = input.record.planAuthority; }
	lifecycle.record = record;
	record.id = input.id || record.id || 'scan-' + time(); record.request = copy(req); record.requestDigest = state.scanner_state_digest(req);
	record.catalogDigest = persistedPlan.catalogDigest; record.compilerDigest = persistedPlan.compilerDigest; record.planDigest = plan_identity(persistedPlan);
	if (!digest(record.requestDigest) || !digest(record.planDigest)) return error('EDEPENDENCY', 'Scanner identity digests are unavailable.');
	let dependencies = seam(seams, 'dependencyPreflight') || scanner_dependency_preflight();
	if (!dependencies.ok) return dependencies;
	let claimed = state.scanner_state_claim(record.id || 'pending', identity, input.resume === true);
	if (!claimed.ok) return claimed;
	lifecycle.claimed = { id: record.id, identity: copy(identity) };
	record.worker = { pid: identity.pid, startTime: identity.startTime, owner: 'scanner/worker', generation: integer(identity.generation) ? identity.generation : 0 };
	record.status = 'running'; record.startedAt = record.startedAt || time(); record.recovery = { state: 'not_required' }; phase(record, 'validating', null);
	let claimedCheckpoint = checkpoint(record, 'claim');
	if (!claimedCheckpoint.ok) { let failure = null; failure(); }
	let started = scanner_session_begin({ sessionId: record.id, candidates: plan.candidates }, seam(seams, 'transient'));
	if (!started.ok) { record.error = started.error?.message || 'Scanner transient session could not start.'; record.recovery = { state: cleanup_verified(started.error?.cleanup) ? 'verified' : 'uncertain', evidence: started.error?.cleanup || started.error }; return finish(record, { sessionId: record.id }, seams, 'error', record.error); }
	let session = started.session, transient = seam(seams, 'transient'); lifecycle.session = session;
	phase(record, 'snapshotting', null); checkpoint(record, 'snapshot');
	let baseline = input.resume === true ? record.baseline : seam(seams, 'baseline');
	let probeStarted = int(time() * 1000), probeDeadline = probeStarted + SCAN_BUDGET_MS;
	if (baseline == null) {
		let baselineProfile = { ...plan.targetProfile, protocol: req.protocol };
		let adapted = scanner_probe_adapter_baseline(baselineProfile, { nowMs: probeStarted, deadlineMs: probeDeadline, mode: req.mode, cancelToken: record.id, profileDigest: state.scanner_profile_digest(baselineProfile) });
		if (!adapted.ok) return finish(record, session, seams, 'error', 'Scanner baseline adapter failed.');
		let executed = seam(seams, 'executor') || scanner_probe_execute(adapted);
		record.baselineExecutorCalls = (record.baselineExecutorCalls || 0) + 1;
		if (!executed.ok) { record.error = executed.error?.code || 'EDEPENDENCY'; record.recovery = { state: 'verified', failure: executed.error }; return finish(record, session, seams, 'error', record.error); }
		else baseline = executed.observations?.[0];
	}
	baseline = baseline.baselineOpen != null ? baseline : scanner_baseline_classify(baseline);
	if (!object(baseline) || baseline.infrastructureFailure === true)
		return finish(record, session, seams, 'error', baseline?.error || 'EDEPENDENCY');
	record.baseline = copy(baseline);
	record.baselineIdentity = state.scanner_state_digest(record.baseline);
	phase(record, 'baselining', null); checkpoint(record, 'baseline');
	// Staged funnel budgets and adaptive stop
	let budgetForMode = BUDGETS[req.mode] || BUDGETS.standard;
	let infraConsecutive = 0, infraLastCause = null;
	let explorationCount = 0, verificationCount = 0;
	// User-facing stage: Поиск рабочих вариантов (exploration) vs Проверка лучших (verification)
	phase(record, 'searching', null); checkpoint(record, 'searching');
	let start = integer(record.cursor?.nextCandidate) ? record.cursor.nextCandidate : 0;
	for (let i = start; i < length(plan.candidates) && i < MAX_RESULTS; i++) {
		if (!budget(probeStarted)) { record.error = 'Scanner probe deadline exceeded.'; record.recovery = { state: 'uncertain' }; return finish(record, session, seams, 'error', record.error); }
		// Bounded exploration budget
		if (explorationCount >= budgetForMode.exploration) {
			if (record.counts.working >= FINALISTS_TARGET) break;
			record.error = 'Exploration budget exhausted.';
			break;
		}
		if (verificationCount >= FINALISTS_TARGET) break;
		// Adaptive stop: already have 20 verified working and next groups ranking significantly lower -> stop early
		if (record.counts.working >= FINALISTS_TARGET && i >= start + FINALISTS_TARGET + 10) break;
		if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); checkpoint(record, 'cancel'); return finish(record, session, seams, 'cancelled', null); }
		let candidate = copy(plan.candidates[i]);
		candidate.sessionId = session.sessionId; candidate.generation = session.generation;
		candidate.argvNonce = session.lock?.nonce && match(session.lock.nonce, /^[a-f0-9]{32,128}$/) ? session.lock.nonce : zero_nonce();
		phase(record, 'executing', candidate.scannerId); checkpoint(record, 'candidate-start');
		let activated = scanner_candidate_activate(candidate, transient);
		if (!activated.ok) {
			record.counts.infrastructure++;
			record.error = activated.error?.message || 'Candidate activation failed.';
			let activationCleanup = activation_cleanup(activated);
			record.recovery = { state: cleanup_verified(activationCleanup) ? 'verified' : 'uncertain', cleanup: activationCleanup, evidence: activated };
			return finish(record, session, seams, 'error', record.error);
		}
		activated.attempt.seams = transient;
		lifecycle.attempt = activated.attempt;
		if (seams?.throwAfterActivation === true) { let failure = null; failure(); }
		phase(record, 'probing', candidate.scannerId); checkpoint(record, 'probing');
		// STAGE D: Cheap exploration probe (quick, single host) — progressive elimination
		let cheapVerdict = cheap_probe_candidate(plan.candidates[i], plan, baseline, seams, probeDeadline);
		if (cheapVerdict.ok === false || (cheapVerdict.evidence?.infrastructure === true && cheapVerdict.reason == 'PROBE_DEPENDENCY')) {
			record.counts.infrastructure++;
			let cause = string(cheapVerdict.error?.code || cheapVerdict.reason || 'INFRA');
			if (cause == infraLastCause) infraConsecutive++; else { infraConsecutive = 1; infraLastCause = cause; }
			if (infraConsecutive >= INFRA_CONSECUTIVE_LIMIT) {
				record.error = 'Не удалось подготовить среду сканирования: ' + cause;
				record.recovery = { state: 'verified', failure: cheapVerdict.error || cheapVerdict.evidence, infraConsecutive, infraCause: cause };
				let cleanedInfra = scanner_candidate_cleanup(activated.attempt);
				if (!cleanedInfra.ok) { record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleanedInfra, evidence: cleanedInfra }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
				return finish(record, session, seams, 'error', record.error);
			}
			// Single infra: count, cleanup, continue to next candidate (do not treat as failed strategy)
			explorationCount++; record.counts.explorationExecuted = explorationCount;
			record.heartbeatAt = time(); checkpoint(record, 'probe');
			let cleanedInfra = scanner_candidate_cleanup(activated.attempt);
			if (!cleanedInfra.ok) { record.counts.infrastructure++; record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleanedInfra, evidence: cleanedInfra }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
			if (cleanedInfra.cleanup?.evidence?.tableChecked === true) record.recovery = merge_recovery(record.recovery, { tableChecked: true, tablePresent: false });
			let infraResult = { candidateId: candidate.scannerId, ordinal: candidate.ordinal, identityKind: candidate.identityKind == null ? null : candidate.identityKind, strategyId: candidate.strategyId == null ? null : candidate.strategyId, strategyRevision: integer(candidate.strategyRevision) ? candidate.strategyRevision : null, saveRequired: candidate.saveRequired === true, source: string(candidate.source) ? candidate.source : null, compiledTokens: type(candidate.compiledTokens) == 'array' ? copy(candidate.compiledTokens) : null, compiledDigest: digest(candidate.compiledDigest) ? candidate.compiledDigest : null, dependencyClosure: object(candidate.dependencyClosure) ? copy(candidate.dependencyClosure) : null, dependencyDigest: digest(candidate.dependencyDigest) ? candidate.dependencyDigest : null, candidateCatalogDigest: digest(candidate.catalogDigest) ? candidate.catalogDigest : record.catalogDigest, candidateCompilerDigest: digest(candidate.compilerDigest) ? candidate.compilerDigest : record.compilerDigest, verdict: 'infrastructure', success: false, score: null, reason: cheapVerdict.reason || 'INFRASTRUCTURE', evidence: candidate_evidence(cheapVerdict.evidence), explorationEvidence: candidate_evidence(cheapVerdict.evidence), verificationEvidence: null, verifiedWorking: false };
			infraResult.planDigest = record.planDigest; infraResult.evidenceIdentity = result_identity(infraResult); push(record.results, infraResult); record.counts.infrastructure++; record.progress = i + 1; record.cursor = { nextCandidate: i + 1 }; record.currentCandidate = null; lifecycle.attempt = null; event(record, 'candidate', candidate.scannerId); checkpoint(record, 'candidate-result');
			if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); checkpoint(record, 'cancel'); return finish(record, session, seams, 'cancelled', null); }
			continue;
		}
		infraConsecutive = 0; infraLastCause = null;
		explorationCount++; record.counts.explorationExecuted = explorationCount;
		// Progressive elimination: cheap clearly failed -> eliminate without full verification (promoted = false)
		if (cheapVerdict.verdict != 'working' && cheapVerdict.success !== true) {
			record.heartbeatAt = time(); checkpoint(record, 'probe');
			let cleanedCheap = scanner_candidate_cleanup(activated.attempt);
			if (!cleanedCheap.ok) { record.counts.infrastructure++; record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleanedCheap, evidence: cleanedCheap }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
			if (cleanedCheap.cleanup?.evidence?.tableChecked === true) record.recovery = merge_recovery(record.recovery, { tableChecked: true, tablePresent: false });
			let cheapResult = { candidateId: candidate.scannerId, ordinal: candidate.ordinal, identityKind: candidate.identityKind == null ? null : candidate.identityKind, strategyId: candidate.strategyId == null ? null : candidate.strategyId, strategyRevision: integer(candidate.strategyRevision) ? candidate.strategyRevision : null, saveRequired: candidate.saveRequired === true, source: string(candidate.source) ? candidate.source : null, compiledTokens: type(candidate.compiledTokens) == 'array' ? copy(candidate.compiledTokens) : null, compiledDigest: digest(candidate.compiledDigest) ? candidate.compiledDigest : null, dependencyClosure: object(candidate.dependencyClosure) ? copy(candidate.dependencyClosure) : null, dependencyDigest: digest(candidate.dependencyDigest) ? candidate.dependencyDigest : null, candidateCatalogDigest: digest(candidate.catalogDigest) ? candidate.catalogDigest : record.catalogDigest, candidateCompilerDigest: digest(candidate.compilerDigest) ? candidate.compilerDigest : record.compilerDigest, verdict: cheapVerdict.verdict, success: false, score: type(cheapVerdict.score) == 'double' || type(cheapVerdict.score) == 'int' ? cheapVerdict.score : null, reason: cheapVerdict.reason, evidence: candidate_evidence(cheapVerdict.evidence), explorationEvidence: candidate_evidence(cheapVerdict.evidence), verificationEvidence: null, verifiedWorking: false };
			cheapResult.planDigest = record.planDigest; cheapResult.evidenceIdentity = result_identity(cheapResult); push(record.results, cheapResult); record.counts.failed++; record.progress = i + 1; record.cursor = { nextCandidate: i + 1 }; record.currentCandidate = null; lifecycle.attempt = null; event(record, 'candidate', candidate.scannerId); checkpoint(record, 'candidate-result');
			if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); checkpoint(record, 'cancel'); return finish(record, session, seams, 'cancelled', null); }
			continue;
		}
		// Promising -> STAGE F: Full verification (staged, multi-host) — bounded to 20
		if (verificationCount >= FINALISTS_TARGET) {
			// Verification budget exhausted: adaptive stop, do not verify further promising candidates
			record.heartbeatAt = time(); checkpoint(record, 'probe');
			let cleanedBudget = scanner_candidate_cleanup(activated.attempt);
			if (!cleanedBudget.ok) { record.counts.infrastructure++; record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleanedBudget, evidence: cleanedBudget }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
			if (cleanedBudget.cleanup?.evidence?.tableChecked === true) record.recovery = merge_recovery(record.recovery, { tableChecked: true, tablePresent: false });
			// Do not count as verified finalist; just track as promoted but not verified and stop exploration
			record.counts.promoted = (record.counts.promoted || 0) + 1;
			record.progress = i + 1; record.cursor = { nextCandidate: i + 1 }; record.currentCandidate = null; lifecycle.attempt = null; event(record, 'candidate', candidate.scannerId); checkpoint(record, 'candidate-result');
			break;
		}
		// Promoted for verification
		record.counts.promoted = (record.counts.promoted || 0) + 1;
		phase(record, 'verifying', candidate.scannerId); checkpoint(record, 'verifying');
		let verdict = full_verify_candidate(plan.candidates[i], plan, baseline, seams, probeDeadline);
		if (verdict.ok === false || (verdict.evidence?.infrastructure === true && verdict.reason == 'PROBE_DEPENDENCY')) {
			record.counts.infrastructure++;
			let cause = string(verdict.error?.code || verdict.reason || 'INFRA');
			if (cause == infraLastCause) infraConsecutive++; else { infraConsecutive = 1; infraLastCause = cause; }
			if (infraConsecutive >= INFRA_CONSECUTIVE_LIMIT) {
				record.error = 'Не удалось подготовить среду сканирования: ' + cause;
				record.recovery = { state: 'verified', failure: verdict.error || verdict.evidence, infraConsecutive, infraCause: cause };
				let cleanedFullInfra = scanner_candidate_cleanup(activated.attempt);
				if (!cleanedFullInfra.ok) { record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleanedFullInfra, evidence: cleanedFullInfra }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
				return finish(record, session, seams, 'error', record.error);
			}
			// Single full infra: record as infra, cleanup, continue
			record.heartbeatAt = time(); checkpoint(record, 'probe');
			let cleanedFullInfra = scanner_candidate_cleanup(activated.attempt);
			if (!cleanedFullInfra.ok) { record.counts.infrastructure++; record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleanedFullInfra, evidence: cleanedFullInfra }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
			if (cleanedFullInfra.cleanup?.evidence?.tableChecked === true) record.recovery = merge_recovery(record.recovery, { tableChecked: true, tablePresent: false });
			let fullInfraResult = { candidateId: candidate.scannerId, ordinal: candidate.ordinal, identityKind: candidate.identityKind == null ? null : candidate.identityKind, strategyId: candidate.strategyId == null ? null : candidate.strategyId, strategyRevision: integer(candidate.strategyRevision) ? candidate.strategyRevision : null, saveRequired: candidate.saveRequired === true, source: string(candidate.source) ? candidate.source : null, compiledTokens: type(candidate.compiledTokens) == 'array' ? copy(candidate.compiledTokens) : null, compiledDigest: digest(candidate.compiledDigest) ? candidate.compiledDigest : null, dependencyClosure: object(candidate.dependencyClosure) ? copy(candidate.dependencyClosure) : null, dependencyDigest: digest(candidate.dependencyDigest) ? candidate.dependencyDigest : null, candidateCatalogDigest: digest(candidate.catalogDigest) ? candidate.catalogDigest : record.catalogDigest, candidateCompilerDigest: digest(candidate.compilerDigest) ? candidate.compilerDigest : record.compilerDigest, verdict: 'infrastructure', success: false, score: null, reason: verdict.reason || 'INFRASTRUCTURE', evidence: candidate_evidence(verdict.evidence), explorationEvidence: candidate_evidence(cheapVerdict.evidence), verificationEvidence: candidate_evidence(verdict.evidence), verifiedWorking: false };
			fullInfraResult.planDigest = record.planDigest; fullInfraResult.evidenceIdentity = result_identity(fullInfraResult); push(record.results, fullInfraResult); record.counts.infrastructure++; record.counts.verificationExecuted = (record.counts.verificationExecuted || 0) + 1; record.progress = i + 1; record.cursor = { nextCandidate: i + 1 }; record.currentCandidate = null; lifecycle.attempt = null; event(record, 'candidate', candidate.scannerId); checkpoint(record, 'candidate-result');
			if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); checkpoint(record, 'cancel'); return finish(record, session, seams, 'cancelled', null); }
			continue;
		}
		infraConsecutive = 0; infraLastCause = null;
		record.heartbeatAt = time(); checkpoint(record, 'probe');
		let cleaned = scanner_candidate_cleanup(activated.attempt);
		if (!cleaned.ok) { record.counts.infrastructure++; record.recovery = merge_recovery(record.recovery, { state: 'uncertain', activation: activated.attempt.activation, candidateCleanup: cleaned, evidence: cleaned }); return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
		if (cleaned.cleanup?.evidence?.tableChecked === true)
			record.recovery = merge_recovery(record.recovery, { tableChecked: true, tablePresent: false });
		let result = { candidateId: candidate.scannerId, ordinal: candidate.ordinal,
			identityKind: candidate.identityKind == null ? null : candidate.identityKind,
			strategyId: candidate.strategyId == null ? null : candidate.strategyId,
			strategyRevision: integer(candidate.strategyRevision) ? candidate.strategyRevision : null,
			saveRequired: candidate.saveRequired === true, source: string(candidate.source) ? candidate.source : null,
		compiledTokens: type(candidate.compiledTokens) == 'array' ? copy(candidate.compiledTokens) : null,
		compiledDigest: digest(candidate.compiledDigest) ? candidate.compiledDigest : null,
		dependencyClosure: object(candidate.dependencyClosure) ? copy(candidate.dependencyClosure) : null,
		dependencyDigest: digest(candidate.dependencyDigest) ? candidate.dependencyDigest : null,
		candidateCatalogDigest: digest(candidate.catalogDigest) ? candidate.catalogDigest : record.catalogDigest,
		candidateCompilerDigest: digest(candidate.compilerDigest) ? candidate.compilerDigest : record.compilerDigest,
			verdict: verdict.verdict, success: verdict.success === true,
			score: type(verdict.score) == 'double' || type(verdict.score) == 'int' ? verdict.score : null,
			reason: verdict.reason, evidence: candidate_evidence(verdict.evidence), explorationEvidence: candidate_evidence(cheapVerdict.evidence), verificationEvidence: candidate_evidence(verdict.evidence), verifiedWorking: verdict.success === true && verdict.verdict == 'working' };
		result.planDigest = record.planDigest; result.evidenceIdentity = result_identity(result); push(record.results, result); record.counts.verificationExecuted = (record.counts.verificationExecuted || 0) + 1; if (result.success && result.verifiedWorking === true) { record.counts.working++; verificationCount++; } else if (verdict.verdict == 'infrastructure') record.counts.infrastructure++; else record.counts.failed++;
		record.progress = i + 1; record.cursor = { nextCandidate: i + 1 }; record.currentCandidate = null; lifecycle.attempt = null; event(record, 'candidate', candidate.scannerId); checkpoint(record, 'candidate-result');
		if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); checkpoint(record, 'cancel'); return finish(record, session, seams, 'cancelled', null); }
	}
	phase(record, 'reconciling', null); checkpoint(record, 'reconcile');
	return finish(record, session, seams, 'completed', null);
};

export const scanner_worker_run = function(input, seams) {
	try { return scanner_worker_run_impl(input, seams); }
	catch (exception) {
		let identity = self_identity(seams), id = input?.id;
		let loaded = state.scanner_state_load(id);
		if (loaded.ok) {
			let record = loaded.state, context = lifecycle || { record, seams };
			context.record = record; context.exception = exception; return recover(record, seams, context, exception?.scanner ? 'Scanner checkpoint publication failed.' : 'Scanner worker lifecycle failed; reconciliation is required.');
		}
		let claimed = lifecycle?.claimed || (input?.id ? { id: input.id, identity: self_identity(seams) } : null);
		let activeRelease = release_claim(claimed);
		let recovery = { state: 'uncertain', activeRelease, durable: false, evidence: 'state-publication-unavailable' };
		if (claimed) {
			let fallback = copy(lifecycle?.record || { schema: 1, id: claimed.id, revision: 0, request: input?.request || {},
				requestDigest: null, catalogDigest: null, compilerDigest: null, planDigest: null, status: 'error', phase: 'recovery',
				progress: 0, total: 0, cursor: { nextCandidate: 0 }, currentCandidate: null,
				counts: { working: 0, failed: 0, infrastructure: 1 }, results: [], baseline: null, error: null,
				recovery: { state: 'uncertain' }, cancellationRequested: false, worker: claimed.identity,
				heartbeatAt: time(), startedAt: null, finishedAt: time(), events: [] });
			fallback.id = claimed.id; fallback.worker = claimed.identity; fallback.status = 'error'; fallback.phase = 'recovery';
			fallback.error = 'Scanner worker lifecycle failed; state publication is unavailable.'; fallback.recovery = recovery;
			if (lifecycle) lifecycle.stage = 'recovery';
			let published = null;
			try { published = state.scanner_state_save(fallback); } catch (exception) { published = { ok: false, error: exception }; }
			if (published.ok !== true) {
				try { state.scanner_state_release(lifecycle.record.id, lifecycle.identity); } catch (e) {}
			}
			recovery.publication = { ok: published.ok === true, durable: published.ok === true, retryRequired: published.ok !== true, result: published };
		}
		return error('EINTERNAL', 'Scanner worker lifecycle failed; state publication is unavailable.', { recovery });
	}
};
