'use strict';

// Bounded Scanner runtime coordinator. It never owns config bytes, Strategy
// identity, or firewall syntax. Those remain with the existing Apply/Profile
// and server-owned runtime adapters.
import { scanner_transient_lock, scanner_transient_config_snapshot } from './apply.uc';
import { profiles_transient_compile_preflight, profiles_transient_activate,
	profiles_transient_stabilize, profiles_transient_cleanup, profiles_transient_snapshot,
	profiles_transient_unlock, profiles_transient_session_cleanup } from './profiles-apply.uc';

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
	if (type(candidate.compiledCandidate) == 'string') {
		if (type(candidate.compiledTokens) == 'array') {
			let rebuilt = compiled_text({ compiledTokens: candidate.compiledTokens });
			if (rebuilt == null || rebuilt != candidate.compiledCandidate) return null;
		}
		return candidate.compiledCandidate;
	}
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
function cleanup_evidence(value) { return cleanup_valid(value) ? value : null; }
function cleanup_verified(value) {
	return object(value) && value.ok == true && value.processRemoved == true
		&& value.firewallRemoved == true && value.nfqueueRemoved == true
		&& value.hostlistRemoved == true && value.temporaryFilesRemoved == true
		&& value.ownedOnly == true;
}
function zero_nonce() {
	let out = '';
	for (let i = 0; i < 64; i++) out += '0';
	return out;
}
function clone_value(value) {
	if (type(value) == 'array') {
		let out = [];
		for (let item in value) push(out, clone_value(item));
		return out;
	}
	if (type(value) == 'object' && value != null) {
		let out = {};
		for (let key in value) out[key] = clone_value(value[key]);
		return out;
	}
	return value;
}
function candidate_cleanup(attempt) {
	if (!object(attempt) || !ownership_valid(attempt.activation)) return error('cleanup', 'EIDENTITY', 'cleanup ownership evidence is incomplete');
	let supplied = attempt.seams != null && attempt.seams.runtime != null ? attempt.seams.runtime.cleanup : null;
	if (type(supplied) == 'array') supplied = supplied[0];
	let result = profiles_transient_cleanup(attempt, supplied);
	if (!cleanup_valid(result)) return error('cleanup', 'ECLEANUP', 'owned candidate cleanup was not verified', { cleanup: result });
	return { ok: true, cleanup: { ok: true, processRemoved: true, firewallRemoved: true,
		nfqueueRemoved: true, hostlistRemoved: true, temporaryFilesRemoved: true,
		ownedOnly: true, evidence: result } };
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
	let compiledInput = { compiledCandidate: compiled_text(candidate), compiledTokens: candidate.compiledTokens,
		compiledDigest: candidate.compiledDigest,
		dependencyDigest: candidate.dependencyDigest, dependencies: candidate.dependencyClosure };
	let compiled = profiles_transient_compile_preflight(compiledInput, seams != null ? seams.compile : null);
	if (!object(compiled) || compiled.ok != true)
		return error('preflight', compiled && compiled.error ? compiled.error.code : 'EPREFLIGHT', 'candidate preflight refused', { preflight: compiled });
	let activated = profiles_transient_activate(candidate, compiled, seams != null && seams.runtime != null ? seams.runtime.activate : null);
	if (!object(activated) || activated.ok != true)
		return error('activate', activated && activated.error ? activated.error.code : 'EACTIVATE', 'candidate activation failed', {
			activation: activated, cleanup: cleanup_evidence(activated && activated.cleanup)
		});
	if (!ownership_valid(activated)) {
		let invalidAttempt = { candidate: candidate, compiled: compiled, activation: activated, seams: seams };
		return error('identity', 'EIDENTITY', 'activated process or NFQUEUE ownership does not match the exact Scanner identity', {
			activation: activated, cleanup: candidate_cleanup(invalidAttempt)
		});
	}
	let attempt = { candidate: candidate, activation: activated, compiled: compiled };
	let stabilized = next_stabilize(attempt, seams);
	if (stabilized.infrastructure) {
		attempt.seams = seams;
		let cleanup = candidate_cleanup(attempt);
		return error('stabilize', 'ESTABILIZE', 'transient runtime stabilization failed', {
			stabilization: stabilized, cleanup: cleanup
		});
	}
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

// Task 7 boundary marker: terminal runtime restoration is intentionally not a
// callable Task 5 export. Task 7 owns that later integration contract.

function release_then_session_cleanup(session, seams) {
	let unlocked = getenv('Z2M_SCANNER_SERVER_TEST') == '1'
		? (seams != null && seams.lockRelease != null ? profiles_transient_unlock(session.sessionId, seams.lockRelease) : { ok: true })
		: profiles_transient_unlock(session.sessionId, session.lock.nonce);
	if (!unlocked.ok) return { ok: false, lockRelease: unlocked, sessionCleanup: { ok: false, code: 'ELOCKED' } };
	let removed = profiles_transient_session_cleanup(session.sessionId, session.generation,
		seams != null ? seams.sessionCleanup : null);
	return { ok: removed.ok == true, lockRelease: unlocked, sessionCleanup: removed,
		verifiedCleanup: removed.ok == true && removed.verified == true };
}

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
		let failedSession = { sessionId: requestedSessionId, generation: 0, lock: lock };
		let recovery = release_then_session_cleanup(failedSession, seams);
		return error('snapshot', 'ESNAPSHOT', 'pre-scan snapshot failed', {
			snapshot: snapshot, cleanup: recovery
		});
	}
	if (!snapshot_valid(snapshot))
		{ let failedSession = { sessionId: requestedSessionId, generation: 0, lock: lock };
		let recovery = release_then_session_cleanup(failedSession, seams);
		return error('snapshot', 'ESNAPSHOT', 'complete config, identity, runtime, and firewall snapshot is required', {
			cleanup: recovery
		}); }
	return { ok: true, session: { state: 'running', snapshot: snapshot, snapshotCaptures: 1,
		originalRestores: 0, owner: SCANNER_OWNER, lock: lock,
		sessionId: requestedSessionId,
		generation: snapshot.reconciliation && type(snapshot.reconciliation.generation) == 'int'
			? snapshot.reconciliation.generation + 1 : 0,
		candidates: clone_value(input.candidates) }, seams: seams };
};

export const scanner_session_run = function(input, seams) {
	let started = scanner_session_begin(input, seams);
	if (!started.ok) return started;
	let session = started.session, attempts = [];
	for (let i = 0; i < length(session.candidates); i++) {
		let candidate = {};
		for (let key in session.candidates[i]) candidate[key] = session.candidates[i][key];
		candidate.sessionId = session.sessionId; candidate.generation = session.generation;
		candidate.argvNonce = zero_nonce();
		if (session.lock != null && type(session.lock.nonce) == 'string'
			&& match(session.lock.nonce, /^[a-f0-9]{32,128}$/)) candidate.argvNonce = session.lock.nonce;
		let activated = scanner_candidate_activate(candidate, seams);
		if (!activated.ok) {
			let recovery = release_then_session_cleanup(session, seams);
			if (!recovery.ok || recovery.verifiedCleanup != true)
				return error(activated.error.stage, activated.error.code, activated.error.message, {
					attempts: attempts, session: session, cleanup: activated.cleanup, recovery: recovery
				});
			return error(activated.error.stage, activated.error.code, activated.error.message, {
				attempts: attempts, session: session, cleanup: activated.cleanup, recovery: recovery, lockRelease: recovery.lockRelease
			});
		}
		let attempt = activated.attempt; attempt.seams = seams;
		if (attempt.failure != null) {
			let cleanup = scanner_candidate_cleanup(attempt);
		if (!cleanup.ok) {
				let recovery = release_then_session_cleanup(session, seams);
				return error('cleanup', 'ECLEANUP', 'candidate failure cleanup was not verified', { attempts: attempts, cleanup: cleanup, recovery: recovery }); }
			attempt.cleanup = cleanup.cleanup; push(attempts, attempt); continue;
		}
		let cleanup = scanner_candidate_cleanup(attempt);
		if (!cleanup.ok) {
			let recovery = release_then_session_cleanup(session, seams);
			return error('cleanup', 'ECLEANUP', 'candidate cleanup was not verified', { attempts: attempts, cleanup: cleanup, recovery: recovery }); }
		attempt.cleanup = cleanup.cleanup; push(attempts, attempt);
	}
	let unlocked = getenv('Z2M_SCANNER_SERVER_TEST') == '1'
		? (seams != null && seams.lockRelease != null ? profiles_transient_unlock(session.sessionId, seams.lockRelease) : { ok: true })
		: profiles_transient_unlock(session.sessionId, session.lock.nonce);
	if (!unlocked.ok) {
		return error('lock', 'ELOCKED', 'Scanner lock release was not verified', {
			attempts: attempts, session: session, recovery: { ok: false, verifiedCleanup: false, lockStillHeld: true, sessionCleanup: { ok: false, code: 'ELOCKED' } }, lockRelease: unlocked
		});
	}
	let removed = getenv('Z2M_SCANNER_SERVER_TEST') == '1' && (seams == null || seams.sessionCleanup == null)
		? { ok: true, removed: true, verified: true, sessionDirectoryRemoved: true }
		: profiles_transient_session_cleanup(session.sessionId, session.generation,
			seams != null ? seams.sessionCleanup : null);
	if (!removed.ok) return error('cleanup', 'ECLEANUP', 'Scanner session directory removal was not verified', {
		attempts: attempts, session: session, recovery: { ok: false, verifiedCleanup: false, evidence: removed }
	});
	return { ok: true, session: { state: 'neutral', snapshot: session.snapshot, owner: session.owner,
		sessionId: session.sessionId, generation: session.generation },
		attempts: attempts, snapshotCaptures: 1, originalRestores: 0,
		preserved: { config: true, identity: true, runtime: true, firewall: true } };
};

// Task 6 terminal boundary: release only the Scanner-owned session resources.
// Whole-runtime reconciliation remains owned by Task 7 and is supplied by the
// caller as explicit evidence; this export never restores Strategy/config.
export const scanner_session_finish = function(session, seams) {
	if (!session || !session.sessionId) return { ok: false, error: { stage: 'cleanup', code: 'EINPUT', message: 'Scanner session identity is missing' } };
	return release_then_session_cleanup(session, seams);
};
