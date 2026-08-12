'use strict';

// Bounded Scanner runtime coordinator. It never owns config bytes, Strategy
// identity, or firewall syntax. Those remain with the existing Apply/Profile
// and server-owned runtime adapters.
import { scanner_transient_lock, scanner_transient_config_snapshot } from './apply.uc';
import { profiles_transient_compile_preflight, profiles_transient_activate,
	profiles_transient_stabilize, profiles_transient_cleanup, profiles_transient_snapshot,
	profiles_transient_unlock } from './profiles-apply.uc';

const MAX_CANDIDATES = 128;
const MAX_STABILIZE_ATTEMPTS = 3;
const SCANNER_OWNER = 'scanner/session';
const ScannerSession = 'ScannerSession';
const CandidateAttempt = 'CandidateAttempt';
const CleanupEvidence = 'CleanupEvidence';

function object(value) { return type(value) == 'object' && value != null; }
function digest(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{64}$/); }
function failure(kind, stage, code, message) {
	return { kind: kind, stage: stage, code: code, message: message };
}
function error(stage, code, message, extra) {
	let result = { ok: false, error: failure('infrastructure', stage, code, message) };
	if (object(extra)) for (let key in extra) result[key] = extra[key];
	return result;
}
function candidate_valid(candidate) {
	return object(candidate) && type(candidate.scannerId) == 'string' && length(candidate.scannerId) > 0
		&& length(candidate.scannerId) <= 128 && match(candidate.scannerId, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
		&& (candidate.protocol == 'tcp' || candidate.protocol == 'udp')
		&& (type(candidate.compiledTokens) == 'array' || type(candidate.compiledCandidate) == 'string')
		&& digest(candidate.compiledDigest) && digest(candidate.dependencyDigest);
}
function compiled_text(candidate) {
	if (type(candidate.compiledCandidate) == 'string') return candidate.compiledCandidate;
	let tokens = candidate.compiledTokens, out = '';
	for (let i = 0; i < length(tokens); i++) {
		if (type(tokens[i]) != 'string' || !length(tokens[i])) return null;
		if (i > 0) out += ' ';
		out += tokens[i];
	}
	return length(out) ? out : null;
}
function identity_equal(expected, actual) {
	if (!object(expected) || !object(actual)) return false;
	for (let key in ['pid', 'startTime', 'exe', 'argvSha256', 'owner', 'generation'])
		if (expected[key] != actual[key]) return false;
	return actual.owner == SCANNER_OWNER;
}
function ownership_valid(activated) {
	return object(activated) && activated.identityVerified == true && object(activated.expectedProcess)
		&& object(activated.process) && identity_equal(activated.expectedProcess, activated.process)
		&& object(activated.nfqueue) && activated.nfqueue.registered == true
		&& activated.nfqueue.peer_portid == activated.process.pid
		&& object(activated.firewall) && activated.firewall.table == 'zapret2'
		&& activated.firewall.owner == SCANNER_OWNER
		&& type(activated.firewall.ownedRules) == 'array';
}
function cleanup_valid(value) {
	return object(value) && value.ok == true && value.processRemoved == true
		&& value.firewallRemoved == true && value.nfqueueRemoved == true
		&& value.hostlistRemoved == true && value.temporaryFilesRemoved == true
		&& value.ownedOnly == true;
}
function snapshot_process_valid(value) {
	return object(value) && type(value.pid) == 'int' && value.pid > 0
		&& type(value.startTime) == 'int' && value.startTime > 0
		&& value.exe == '/opt/zapret2/nfq2/nfqws2'
		&& digest(value.argvSha256) && value.owner == 'runtime/nfqws2'
		&& type(value.generation) == 'int' && value.generation >= 0;
}
function snapshot_valid(value) {
	return object(value) && value.ok == true && object(value.config) && digest(value.config.sha256)
		&& object(value.identity) && type(value.identity.revision) == 'int' && value.identity.revision >= 0
		&& object(value.runtime) && snapshot_process_valid(value.runtime.process)
		&& object(value.firewall) && value.firewall.table == 'zapret2'
		&& object(value.firewall.nfqueue) && value.firewall.nfqueue.registered == true
		&& value.firewall.nfqueue.peerPortid == value.runtime.process.pid
		&& object(value.artifacts) && value.artifacts.config == '/opt/zapret2/' + 'config'
		&& value.artifacts.firewall == 'zapret2' && value.artifacts.nfqueue == 300
		&& type(value.artifacts.temporaryRoot) == 'string'
		&& object(value.reconciliation) && type(value.reconciliation.generation) == 'int';
}
function next_stabilize(attempt, seams) {
	let last = null;
	for (let i = 0; i < MAX_STABILIZE_ATTEMPTS; i++) {
		let supplied = seams != null && seams.runtime != null ? seams.runtime.stabilize : null;
		if (type(supplied) == 'array') supplied = supplied[i < length(supplied) ? i : length(supplied) - 1];
		let result = profiles_transient_stabilize(attempt, supplied);
		if (result != null && result.ok == true && result.stable == true) return { ok: true, evidence: result, retries: i };
		if (result != null && result.ok == true && result.candidateFailure != null) { last = result; continue; }
		if (result != null && result.ok == false) return { ok: false, infrastructure: true, evidence: result, retries: i };
	}
	if (last != null) return { ok: false, candidate: true, evidence: last, retries: MAX_STABILIZE_ATTEMPTS };
	return { ok: false, infrastructure: true, evidence: { code: 'ESTABILIZE', message: 'stabilization bound exhausted' }, retries: MAX_STABILIZE_ATTEMPTS };
}

export const scanner_candidate_activate = function(candidate, seams) {
	if (getenv('Z2M_SCANNER_SERVER_TEST') != '1' && seams != null)
		return error('input', 'EINPUT', 'runtime seams are server-only');
	if (!candidate_valid(candidate)) return error('input', 'EINPUT', 'Scanner candidate binding is incomplete');
	for (let key in ['command', 'argv', 'args', 'executable', 'path', 'rawCommand', 'rawPath'])
		if (candidate[key] != null) return error('input', 'EINPUT', 'raw runtime command or path input is forbidden');
	let compiledInput = { compiledCandidate: compiled_text(candidate), compiledDigest: candidate.compiledDigest,
		dependencyDigest: candidate.dependencyDigest, dependencies: candidate.dependencyClosure };
	let compiled = profiles_transient_compile_preflight(compiledInput, seams != null ? seams.compile : null);
	if (!object(compiled) || compiled.ok != true)
		return error('preflight', compiled && compiled.error ? compiled.error.code : 'EPREFLIGHT', 'candidate preflight refused', { preflight: compiled });
	let activated = profiles_transient_activate(candidate, compiled, seams != null && seams.runtime != null ? seams.runtime.activate : null);
	if (!object(activated) || activated.ok != true)
		return error('activate', activated && activated.error ? activated.error.code : 'EACTIVATE', 'candidate activation failed', { activation: activated });
	if (!ownership_valid(activated)) return error('identity', 'EIDENTITY', 'activated process or NFQUEUE ownership does not match the exact Scanner identity', { activation: activated });
	let stabilized = next_stabilize({ candidate: candidate, activation: activated, compiled: compiled }, seams);
	if (stabilized.infrastructure) return error('stabilize', 'ESTABILIZE', 'transient runtime stabilization failed', { stabilization: stabilized });
	return { ok: true, attempt: { candidate: candidate, compiled: compiled, activation: activated,
		stabilization: stabilized.evidence, retries: stabilized.retries, failure: stabilized.candidate ? failure('candidate', 'probe', 'ECANDIDATE', stabilized.evidence.candidateFailure) : null } };
};

export const scanner_candidate_cleanup = function(attempt) {
	if (!object(attempt) || !ownership_valid(attempt.activation)) return error('cleanup', 'EIDENTITY', 'cleanup ownership evidence is incomplete');
	let supplied = attempt.seams != null && attempt.seams.runtime != null ? attempt.seams.runtime.cleanup : null;
	if (type(supplied) == 'array') supplied = supplied[0];
	let result = profiles_transient_cleanup(attempt, supplied);
	if (!cleanup_valid(result)) return error('cleanup', 'ECLEANUP', 'owned candidate cleanup was not verified', { cleanup: result });
	return { ok: true, cleanup: { ok: true, processRemoved: true, firewallRemoved: true,
		nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true,
		ownedOnly: true, evidence: result } };
};

// Task 7 owns terminal restoration. Task 5 exposes the typed boundary without
// claiming that the original runtime has been restored here.
export const scanner_session_restore = function(session, terminalReason) {
	if (!object(session) || !object(session.snapshot) || type(terminalReason) != 'string'
		|| !length(terminalReason)) return error('restore', 'EINPUT', 'typed Scanner restore binding is invalid');
	return error('restore', 'EDEFERRED', 'terminal Scanner restoration is owned by Task 7',
		{ session: session, terminalReason: terminalReason, terminalRestored: false });
};

export const scanner_session_begin = function(input, seams) {
	if (getenv('Z2M_SCANNER_SERVER_TEST') != '1' && seams != null)
		return error('input', 'EINPUT', 'runtime seams are server-only');
	if (!object(input) || type(input.candidates) != 'array' || length(input.candidates) > MAX_CANDIDATES)
		return error('input', 'EINPUT', 'bounded Scanner candidates are required');
	let requestedSessionId = type(input.sessionId) == 'string' && match(input.sessionId, /^[A-Za-z0-9][A-Za-z0-9._-]*$/)
		? input.sessionId : 'scanner-' + time();
	let lock = getenv('Z2M_SCANNER_SERVER_TEST') == '1'
		? scanner_transient_lock(seams != null ? seams.lock : null)
		: profiles_transient_lock(requestedSessionId);
	if (!lock.ok) return error('lock', lock.code, lock.message);
	let snapshot = profiles_transient_snapshot(seams != null ? seams.snapshot : null);
	if (seams == null && snapshot.ok != true) snapshot = scanner_transient_config_snapshot();
	if (!object(snapshot) || snapshot.ok != true) {
		if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') profiles_transient_unlock(requestedSessionId);
		return error('snapshot', 'ESNAPSHOT', 'pre-scan snapshot failed', { snapshot: snapshot });
	}
	if (!snapshot_valid(snapshot))
		{ if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') profiles_transient_unlock(requestedSessionId);
		return error('snapshot', 'ESNAPSHOT', 'complete config, identity, runtime, and firewall snapshot is required'); }
	return { ok: true, session: { state: 'running', snapshot: snapshot, snapshotCaptures: 1,
		originalRestores: 0, owner: SCANNER_OWNER,
		sessionId: requestedSessionId,
		generation: snapshot.reconciliation && type(snapshot.reconciliation.generation) == 'int'
			? snapshot.reconciliation.generation + 1 : 0,
		candidates: input.candidates }, seams: seams };
};

export const scanner_session_run = function(input, seams) {
	let started = scanner_session_begin(input, seams);
	if (!started.ok) return started;
	let session = started.session, attempts = [];
	for (let i = 0; i < length(session.candidates); i++) {
		let candidate = session.candidates[i];
		candidate.sessionId = session.sessionId; candidate.generation = session.generation;
		let activated = scanner_candidate_activate(candidate, seams);
		if (!activated.ok) { if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') profiles_transient_unlock(session.sessionId);
			return error(activated.error.stage, activated.error.code, activated.error.message, { attempts: attempts, session: session }); }
		let attempt = activated.attempt; attempt.seams = seams;
		if (attempt.failure != null) {
			let cleanup = scanner_candidate_cleanup(attempt);
			if (!cleanup.ok) { if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') profiles_transient_unlock(session.sessionId);
				return error('cleanup', 'ECLEANUP', 'candidate failure cleanup was not verified', { attempts: attempts, cleanup: cleanup }); }
			attempt.cleanup = cleanup.cleanup; push(attempts, attempt); continue;
		}
		let cleanup = scanner_candidate_cleanup(attempt);
		if (!cleanup.ok) { if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') profiles_transient_unlock(session.sessionId);
			return error('cleanup', 'ECLEANUP', 'candidate cleanup was not verified', { attempts: attempts, cleanup: cleanup }); }
		attempt.cleanup = cleanup.cleanup; push(attempts, attempt);
	}
	if (getenv('Z2M_SCANNER_SERVER_TEST') != '1') {
		let unlocked = profiles_transient_unlock(session.sessionId);
		if (!unlocked.ok) return error('lock', 'ELOCKED', 'Scanner lock release was not verified', { attempts: attempts, session: session });
	}
	return { ok: true, session: { state: 'neutral', snapshot: session.snapshot, owner: session.owner,
		sessionId: session.sessionId, generation: session.generation },
		attempts: attempts, snapshotCaptures: 1, originalRestores: 0,
		preserved: { config: true, identity: true, runtime: true, firewall: true } };
};
