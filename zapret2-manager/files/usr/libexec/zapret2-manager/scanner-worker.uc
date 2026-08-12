'use strict';

import { readfile } from 'fs';
import { scanner_plan_build } from './scanner-planner.uc';
import { scanner_baseline_classify, scanner_tcp_classify, scanner_udp_classify, scanner_candidate_verdict } from './scanner-probes.uc';
import { scanner_probe_adapter_baseline, scanner_probe_adapter_tcp, scanner_probe_adapter_udp } from './scanner-probe-adapter.uc';
import { scanner_session_begin, scanner_candidate_activate, scanner_candidate_cleanup, scanner_session_finish } from './scanner-transient.uc';
import * as state from './scanner-state.uc';

const MAX_RESULTS = 128;
const HEARTBEAT_MAX_AGE = 120;
const PROBE_BUDGET_MS = 120000;
function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function copy(value) {
	if (type(value) == 'array') { let out = []; for (let item in value) push(out, copy(item)); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = copy(value[key]); return out; }
	return value;
}
function error(code, message, extra) { let out = { ok: false, error: { code, message } }; for (let key in extra || {}) out[key] = extra[key]; return out; }
function stale_heartbeat(value) { return !integer(value) || value > time() || time() - value > HEARTBEAT_MAX_AGE; }
function deadline(start) { return start + PROBE_BUDGET_MS; }
function budget(start) { return int(time() * 1000) <= deadline(start); }
function test_mode() { return getenv('Z2M_SCANNER_SERVER_TEST') == '1'; }
function seam(seams, name) { return test_mode() && object(seams) ? seams[name] : null; }
function request_validate(input) {
	if (!object(input) || !string(input.target) || !match(input.target, /^[a-z0-9][a-z0-9.-]{1,252}$/)
		|| index(input.target, '.') < 0 || index(input.target, ':') >= 0) return error('EINPUT', 'Scanner target must be a strict hostname.', { path: 'target' });
	let target = input.target;
	if (substr(target, length(target) - 1, 1) == '.') target = substr(target, 0, length(target) - 1);
	let protocol = input.protocol == null ? 'tcp' : input.protocol;
	let mode = input.mode == null ? 'quick' : input.mode;
	let resume = input.resume == null ? false : input.resume;
	if ((protocol != 'tcp' && protocol != 'udp') || (mode != 'quick' && mode != 'standard' && mode != 'full') || type(resume) != 'bool') return error('EINPUT', 'Scanner request fields are invalid.');
	return { ok: true, value: { target, protocol, mode, resume, dpi_type: input.dpi_type == null ? null : input.dpi_type } };
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
	let saved = state.scanner_state_save(record);
	if (!saved.ok) return saved;
	record.revision = saved.revision; record.id = saved.id; return saved;
}
function candidate_evidence(value) {
	if (!object(value)) return null;
	return { infrastructure: value.infrastructure === true, failureClass: string(value.failureClass) ? value.failureClass : null, baselineSuppressed: value.baselineSuppressed === true };
}
function cleanup_verified(value) {
	return object(value) && value.ok == true && value.processRemoved == true && value.firewallRemoved == true
		&& value.nfqueueRemoved == true && value.hostlistRemoved == true && value.temporaryFilesRemoved == true
		&& value.ownedOnly == true;
}
function probe_candidate(candidate, plan, baseline, seams) {
	let raw = seam(seams, 'probe');
	if (type(raw) == 'function') raw = raw(candidate, plan);
	if (raw == null) {
		let now = int(time() * 1000);
		let adapted = candidate.protocol == 'udp'
			? scanner_probe_adapter_udp(candidate, { host: plan.targetProfile.primaryHost, port: 443 }, { nowMs: now, deadlineMs: now + PROBE_BUDGET_MS })
			: scanner_probe_adapter_tcp(candidate, plan.targetProfile, 'ipv4', { nowMs: now, deadlineMs: now + PROBE_BUDGET_MS, mode: plan.request.mode });
		return scanner_candidate_verdict({ infrastructureFailure: true, error: adapted.ok ? 'PROBE_OBSERVATION_UNAVAILABLE' : adapted.error?.message }, []);
	}
	let classified = candidate.protocol == 'udp' ? scanner_udp_classify(raw) : scanner_tcp_classify(raw);
	return scanner_candidate_verdict(baseline, [classified]);
}
function finish(record, session, seams, transition, message) {
	let cleanup = scanner_session_finish(session, seam(seams, 'transient'));
	let reconciliation = seam(seams, 'reconcile');
	if (!cleanup.ok || record.recovery?.state == 'uncertain' || reconciliation?.ok !== true || reconciliation?.recovery?.state != 'verified') {
		record.status = 'error'; record.phase = 'recovery'; record.recovery = { state: 'uncertain' }; record.error = message || 'Scanner recovery is uncertain.';
	} else {
		record.status = transition == 'cancelled' ? 'cancelled' : (transition == 'completed' ? 'completed' : 'error');
		record.phase = record.status; record.recovery = { state: 'verified' };
		if (message != null) record.error = message;
	}
	record.currentCandidate = null; record.finishedAt = time(); record.heartbeatAt = time();
	let saved = publish(record); let released = state.scanner_state_release(record.id, record.worker);
	if (!released.ok) { record.status = 'error'; record.phase = 'recovery'; record.recovery = { state: 'uncertain' }; record.error = 'Scanner active marker release is uncertain.'; publish(record); }
	return saved.ok ? { ok: record.status != 'error', state: record, cleanup } : saved;
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
	return { ok: true, request: checked.value, plan };
}
function plan_identity(plan) { return state.scanner_state_digest({ schema: plan.schema, request: plan.request, targetProfile: plan.targetProfile, catalogDigest: plan.catalogDigest, compilerDigest: plan.compilerDigest, candidates: plan.candidates }); }
function checkpoint_valid(record, plan) {
	let start = integer(record.cursor?.nextCandidate) ? record.cursor.nextCandidate : -1;
	if (start < 0 || start > length(plan.candidates) || record.progress != start || type(record.results) != 'array' || length(record.results) != start) return false;
	let seen = {};
	for (let i = 0; i < length(record.results); i++) {
		let row = record.results[i], candidate = plan.candidates[i];
		if (!object(row) || !object(candidate) || row.candidateId != candidate.scannerId || seen[row.candidateId]) return false;
		seen[row.candidateId] = true;
	}
	return true;
}

export const scanner_worker_resume = function(input, seams) {
	let loaded = state.scanner_state_load(input?.id);
	if (!loaded.ok) return loaded;
	let record = loaded.state, prepared = request_and_plan({ request: record.request }, seams), plan = prepared.ok ? prepared.plan : null;
	if (record.status != 'running' || stale_heartbeat(record.heartbeatAt) || !plan || state.scanner_state_digest(record.request) != record.requestDigest || plan.catalogDigest != record.catalogDigest
		|| plan.compilerDigest != record.compilerDigest || plan_identity(plan) != record.planDigest || !checkpoint_valid(record, plan))
		return error('ESTALE', 'Scanner resume identity does not match the checkpoint.');
	let identity = self_identity(seams);
	if (!object(record.worker) || record.worker.pid != identity.pid || record.worker.startTime != identity.startTime)
		return error('ESTALE', 'Scanner worker identity is stale.');
	return scanner_worker_run({ id: record.id, request: record.request, resume: true, record }, seams);
};

function scanner_worker_run_impl(input, seams) {
	if (!object(input) || !object(input.request)) return error('EINPUT', 'Scanner worker request is invalid.');
	let prepared = request_and_plan(input, seams);
	if (!prepared.ok) return prepared;
	let req = prepared.request, plan = prepared.plan, identity = self_identity(seams);
	if (!integer(identity.pid) || !integer(identity.startTime)) return error('EDEPENDENCY', 'Scanner worker identity is unavailable.');
	let record = input.record || {
		schema: 1, id: null, revision: 0, request: copy(req), requestDigest: null,
		catalogDigest: plan.catalogDigest, compilerDigest: plan.compilerDigest, planDigest: null,
		status: 'idle', phase: 'idle', progress: 0, total: length(plan.candidates), cursor: { nextCandidate: 0 },
		currentCandidate: null, counts: { working: 0, failed: 0, infrastructure: 0 }, results: [], baseline: null,
		error: null, recovery: { state: 'not_required' }, cancellationRequested: false, worker: null,
		heartbeatAt: time(), startedAt: null, finishedAt: null, events: []
	};
	record.id = input.id || record.id || 'scan-' + time(); record.request = copy(req); record.requestDigest = state.scanner_state_digest(req);
	record.catalogDigest = plan.catalogDigest; record.compilerDigest = plan.compilerDigest; record.planDigest = plan_identity(plan);
	if (!digest(record.requestDigest) || !digest(record.planDigest)) return error('EDEPENDENCY', 'Scanner identity digests are unavailable.');
	let claimed = state.scanner_state_claim(record.id || 'pending', identity, input.resume === true);
	if (!claimed.ok) return claimed;
	record.worker = { pid: identity.pid, startTime: identity.startTime, owner: 'scanner/worker', generation: integer(identity.generation) ? identity.generation : 0 };
	record.status = 'running'; record.startedAt = record.startedAt || time(); record.recovery = { state: 'not_required' }; phase(record, 'validating', null);
	let saved = publish(record); if (!saved.ok) { state.scanner_state_release(record.id, identity); return saved; }
	let started = scanner_session_begin({ sessionId: record.id, candidates: plan.candidates }, seam(seams, 'transient'));
	if (!started.ok) { record.error = started.error?.message || 'Scanner transient session could not start.'; record.recovery = { state: cleanup_verified(started.error?.cleanup) ? 'verified' : 'uncertain', evidence: started.error?.cleanup || started.error }; return finish(record, { sessionId: record.id }, seams, 'error', record.error); }
	let session = started.session, transient = seam(seams, 'transient');
	phase(record, 'snapshotting', null); publish(record);
	let baseline = seam(seams, 'baseline');
	let probeStarted = int(time() * 1000);
	if (baseline == null) {
		let adapted = scanner_probe_adapter_baseline({ ...plan.targetProfile, protocol: req.protocol }, { nowMs: probeStarted, deadlineMs: deadline(probeStarted) });
		if (!adapted.ok) return finish(record, session, seams, 'error', 'Scanner baseline adapter failed.');
		return finish(record, session, seams, 'error', 'Scanner baseline observation is unavailable.');
	}
	baseline = baseline.baselineOpen != null ? baseline : scanner_baseline_classify(baseline);
	record.baseline = { baselineOpen: baseline.baselineOpen, byAddressFamily: baseline.byAddressFamily };
	phase(record, 'baselining', null); publish(record);
	let start = integer(record.cursor?.nextCandidate) ? record.cursor.nextCandidate : 0;
	for (let i = start; i < length(plan.candidates) && i < MAX_RESULTS; i++) {
		if (!budget(probeStarted)) { record.error = 'Scanner probe deadline exceeded.'; record.recovery = { state: 'uncertain' }; return finish(record, session, seams, 'error', record.error); }
		if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); publish(record); return finish(record, session, seams, 'cancelled', null); }
		let candidate = plan.candidates[i]; phase(record, 'executing', candidate.scannerId); publish(record);
		let activated = scanner_candidate_activate(candidate, transient);
		if (!activated.ok) { record.counts.infrastructure++; record.error = activated.error?.message || 'Candidate activation failed.'; record.recovery = { state: cleanup_verified(activated.cleanup) ? 'verified' : 'uncertain', evidence: activated.cleanup || activated.error }; return finish(record, session, seams, 'error', record.error); }
		activated.attempt.seams = transient;
		phase(record, 'probing', candidate.scannerId); publish(record);
		let verdict = probe_candidate(candidate, plan, baseline, seams);
		record.heartbeatAt = time(); publish(record);
		let cleaned = scanner_candidate_cleanup(activated.attempt);
		if (!cleaned.ok) { record.counts.infrastructure++; record.recovery = { state: 'uncertain', evidence: cleaned }; return finish(record, session, seams, 'error', 'Candidate cleanup was not verified.'); }
		let result = { candidateId: candidate.scannerId, ordinal: candidate.ordinal, verdict: verdict.verdict, success: verdict.success === true, score: verdict.success === true ? 1 : 0, reason: verdict.reason, evidence: candidate_evidence(verdict.evidence) };
		push(record.results, result); if (result.success) record.counts.working++; else if (verdict.verdict == 'infrastructure') record.counts.infrastructure++; else record.counts.failed++;
		record.progress = i + 1; record.cursor = { nextCandidate: i + 1 }; record.currentCandidate = null; event(record, 'candidate', candidate.scannerId); publish(record);
		if (control(seams, record.id, i).stopRequested) { record.cancellationRequested = true; phase(record, 'cancelling', null); publish(record); return finish(record, session, seams, 'cancelled', null); }
	}
	phase(record, 'reconciling', null); publish(record);
	return finish(record, session, seams, 'completed', null);
};

export const scanner_worker_run = function(input, seams) {
	try { return scanner_worker_run_impl(input, seams); }
	catch (exception) {
		let identity = self_identity(seams), id = input?.id;
		let loaded = state.scanner_state_load(id);
		if (loaded.ok) {
			let record = loaded.state;
			record.status = 'error'; record.phase = 'recovery'; record.recovery = { state: 'uncertain' };
			record.error = 'Scanner worker lifecycle failed; reconciliation is required.';
			record.finishedAt = time(); record.heartbeatAt = time();
			publish(record); state.scanner_state_release(record.id, identity);
			return { ok: false, state: record, error: { code: 'EINTERNAL', message: record.error } };
		}
		return error('EINTERNAL', 'Scanner worker lifecycle failed; state publication is unavailable.', { recovery: { state: 'uncertain' } });
	}
};
