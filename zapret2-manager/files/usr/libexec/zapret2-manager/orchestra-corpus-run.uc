'use strict';

import { readfile, writefile, unlink, mkdir, stat } from 'fs';
import {
	orchestra_run_load, orchestra_run_status, profile_set, corpus_translate,
	classify_attempt, control_load, proc_starttime, run, save, add_event,
	orchestra_probe_preflight, remaining_seconds
} from './orchestra-run.uc';
import { orchestra_corpus_get, orchestra_catalog_get } from './orchestra-corpus.uc';

const ROOT = '/tmp/zapret2-manager/orchestra-runs';
const WORKER = '/usr/libexec/zapret2-manager/orchestra-worker.uc';
const ADAPTER = '/usr/libexec/zapret2-manager/orchestra-candidate-run.sh';
const PROTOCOL = 'tcp_https';
const START_LOCK = ROOT + '/full-corpus-start.lock';
const MAX_CANDIDATES = 256;
const MAX_ATTEMPTS = 20000;
const MAX_TIMEOUT = 86400;
const EVIDENCE_LIMIT = 128;

function err(code, message, details, runId, phase) {
	return { ok: false, error: { code: code, message: message, details: details || {}, runId: runId || null, phase: phase || null } };
}
function safe_id(id) { return type(id) == 'string' && match(id, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/); }
function request_id(value) { return type(value) == 'string' && match(value, /^[A-Za-z0-9._-]{8,128}$/) ? value : null; }
function integer(value) {
	let text = '' + (value == null ? '' : value);
	return match(text, /^[0-9]+$/) ? +text : null;
}
function alive(pid) { return type(pid) == 'int' && pid > 1 && run('kill -0 ' + pid + ' 2>/dev/null').rc == 0; }
function identity(pid, start) { return alive(pid) && start && proc_starttime(pid) == start; }
function control_path(id) { return ROOT + '/' + id + '.control'; }
function candidate_file(id, candidate) { return ROOT + '/' + id + '/' + candidate + '.' + PROTOCOL; }
function pid_file(id, candidate) { return candidate_file(id, candidate) + '.pid'; }
function start_file(id, candidate) { return candidate_file(id, candidate) + '.starttime'; }
function rc_file(id, candidate) { return candidate_file(id, candidate) + '.rc'; }
function log_file(id, candidate) { return candidate_file(id, candidate) + '.log'; }
function read_pid(file) { let value = +(trim(readfile(file) || '')); return value > 1 ? value : null; }
function load_json(path) { try { let value = json(readfile(path)); return type(value) == 'object' && value != null ? value : null; } catch (e) { return null; } }
function arrays_equal(left, right) {
	if (type(left) != 'array' || type(right) != 'array' || length(left) != length(right)) return false;
	for (let i = 0; i < length(left); i++) if (left[i] != right[i]) return false;
	return true;
}
function hash_text(text, suffix) {
	let file = '/tmp/z2m-corpus-run-hash.' + time() + '.' + (suffix || 'x') + '.' + length(text);
	writefile(file, text);
	let result = trim(run("sha256sum '" + file + "' 2>/dev/null | awk '{print $1}'").out || '');
	try { unlink(file); } catch (e) { }
	return length(result) == 64 ? result : null;
}
function atomic_write(file, value) {
	let temporary = file + '.tmp.' + time();
	writefile(temporary, value);
	return run("mv -f '" + temporary + "' '" + file + "'").rc == 0;
}
function clear_controls(id) {
	try { unlink(control_path(id)); } catch (e) { }
	try { unlink(ROOT + '/' + id + '.pause'); } catch (e) { }
	try { unlink(ROOT + '/' + id + '.stop'); } catch (e) { }
}
function current_active() {
	let response = orchestra_run_status({});
	return response && response.ok === true && response.run ? response.run : null;
}
function request_ref_path(id) {
	let digest = hash_text(id, 'request');
	return digest ? ROOT + '/request-' + digest + '.json' : null;
}
function request_ref(id) {
	let path = request_ref_path(id);
	if (!path) return null;
	let reference = load_json(path);
	if (!reference || !safe_id(reference.runId) || reference.requestId != id) return null;
	return orchestra_run_load({ runId: reference.runId }) || null;
}
function save_request_ref(id, runId) {
	let path = request_ref_path(id);
	return path ? atomic_write(path, sprintf('%J', { requestId: id, runId: runId }) + '\n') : false;
}
function acquire_start_lock() {
	try { mkdir(ROOT); } catch (e) { }
	let lock = stat(START_LOCK);
	if (lock && time() - lock.mtime > 30) run("rmdir '" + START_LOCK + "' 2>/dev/null");
	return run("mkdir '" + START_LOCK + "' 2>/dev/null").rc == 0;
}
function release_start_lock() { run("rmdir '" + START_LOCK + "' 2>/dev/null"); }
function make_targets(domains) {
	let targets = [];
	for (let i = 0; i < length(domains); i++)
		push(targets, { id: sprintf('d%03d', i + 1), domain: domains[i], protocols: [PROTOCOL], probe: 'https' });
	return targets;
}
function initial_control(id, timestamp) {
	return { runId: id, pauseRequested: false, stopRequested: false, revision: 0, updatedAt: timestamp };
}
function normalize_input(input, corpus, catalog) {
	input = input || {};
	let mode = input.mode || (input.targetType == 'corpus' ? 'full-corpus' : null);
	if (mode != 'full-corpus') return err('EINPUT', 'mode must be full-corpus');
	if (input.corpusVersion != null && input.corpusVersion != corpus.version)
		return err('ESTALE', 'requested corpus version does not match the installed corpus', { expected: corpus.version, actual: input.corpusVersion });
	if (input.corpusDigest != null && input.corpusDigest != corpus.digest)
		return err('ESTALE', 'requested corpus digest does not match the installed corpus', { expected: corpus.digest, actual: input.corpusDigest });
	let ids = type(input.candidateIds) == 'array' && length(input.candidateIds) ? input.candidateIds : catalog.candidateIds;
	if (!arrays_equal(ids, catalog.candidateIds))
		return err('ECATALOG', 'full-corpus requires the exact applicable candidate set', { expected: catalog.candidateIds, actual: ids });
	let attempts = integer(input.attempts != null ? input.attempts : input.repeats != null ? input.repeats : 1);
	let timeouts = type(input.timeouts) == 'object' && input.timeouts != null ? input.timeouts : {};
	let perAttemptTimeoutSec = integer(timeouts.perAttemptSec != null ? timeouts.perAttemptSec : input.perAttemptTimeoutSec != null ? input.perAttemptTimeoutSec : 15);
	let totalTimeoutSec = integer(timeouts.totalSec != null ? timeouts.totalSec : input.totalTimeoutSec != null ? input.totalTimeoutSec : MAX_TIMEOUT);
	if (attempts == null || attempts < 1 || attempts > 2 || perAttemptTimeoutSec == null || perAttemptTimeoutSec < 1 || perAttemptTimeoutSec > 120 || totalTimeoutSec == null || totalTimeoutSec < perAttemptTimeoutSec || totalTimeoutSec > MAX_TIMEOUT)
		return err('EINPUT', 'full-corpus attempts or timeout bounds are invalid');
	let suppliedRequestId = input.requestId == null ? null : request_id(input.requestId);
	if (input.requestId != null && suppliedRequestId == null)
		return err('EINPUT', 'requestId must match [A-Za-z0-9._-]{8,128}');
	let generation = input.generation == null ? time() : integer(input.generation);
	if (generation == null) return err('EINPUT', 'generation must be a non-negative integer');
	return { ok: true, value: {
		mode: mode,
		candidateIds: ids,
		attempts: attempts,
		perAttemptTimeoutSec: perAttemptTimeoutSec,
		totalTimeoutSec: totalTimeoutSec,
		requestId: suppliedRequestId,
		generation: generation
	} };
}

export const orchestra_corpus_run_start = function(input) {
	let corpus = orchestra_corpus_get();
	if (!corpus || corpus.ok !== true) return corpus || err('ECORPUS', '61-domain corpus is unavailable');
	let catalog = orchestra_catalog_get();
	if (!catalog || catalog.ok !== true) return catalog || err('ECATALOG', 'applicable strategy catalog is unavailable');
	if (catalog.count < 1 || catalog.count > MAX_CANDIDATES)
		return err('EBOUND', 'applicable candidate count is outside the supported bound', { count: catalog.count, maxCandidates: MAX_CANDIDATES });
	let normalized = normalize_input(input, corpus, catalog);
	if (!normalized.ok) return normalized;
	let request = normalized.value;
	if (request.requestId) {
		let previous = request_ref(request.requestId);
		if (previous) return { ok: true, idempotent: true, run: previous };
	}
	if (!acquire_start_lock()) {
		let locked = current_active();
		return err('EBUSY', 'an orchestration run or start is already active', { runId: locked && locked.runId || null });
	}
	let active = current_active();
	if (active) {
		release_start_lock();
		if (request.requestId && active.requestId == request.requestId)
			return { ok: true, idempotent: true, run: active };
		return err('EBUSY', 'an orchestration run is already active', { runId: active.runId });
	}
	let attemptCount = corpus.count * catalog.count * request.attempts;
	if (attemptCount < 1 || attemptCount > MAX_ATTEMPTS) {
		release_start_lock();
		return err('EBOUND', 'full-corpus work exceeds the supported attempt bound', { attempts: attemptCount, maxAttempts: MAX_ATTEMPTS });
	}

	let created = time();
	let nonce = sprintf('%04x', (created * 1103515245) & 0xffff);
	let id = 'or-' + sprintf('%08x', created) + '-' + nonce;
	let requestId = request.requestId || ('full-corpus-' + sprintf('%08x', created) + '-' + nonce);
	let control = initial_control(id, created);
	let runState = {
		schema: 1,
		runId: id,
		requestId: requestId,
		generation: request.generation,
		createdAt: created,
		startedAt: created,
		deadlineAt: created + request.totalTimeoutSec,
		startedMonoSec: null,
		deadlineMonoSec: null,
		runTimeoutSec: request.totalTimeoutSec,
		phase: 'queued',
		mode: 'full-corpus',
		target: 'domains-61',
		targetType: 'corpus',
		corpusVersion: corpus.version,
		corpusDigest: corpus.digest,
		targetCount: corpus.count,
		targets: make_targets(corpus.domains),
		candidateMode: 'all',
		candidateIds: request.candidateIds,
		candidateRegistryDigest: catalog.digest,
		catalogRevision: catalog.revision,
		protocols: [PROTOCOL],
		attempts: request.attempts,
		repeats: request.attempts,
		perAttemptTimeoutSec: request.perAttemptTimeoutSec,
		totalTimeoutSec: request.totalTimeoutSec,
		maxCandidates: catalog.count,
		maxAttempts: attemptCount,
		totalCandidates: catalog.count,
		totalAttempts: attemptCount,
		totalCount: attemptCount,
		completedCount: 0,
		progress: 0,
		cursor: { candidateIndex: 0, domainIndex: 0, attempt: 0 },
		currentTargetId: null,
		currentDomain: null,
		currentProtocol: null,
		currentCandidate: null,
		currentAttempt: null,
		candidatePid: null,
		candidateStarttime: null,
		results: [],
		evidenceLimit: EVIDENCE_LIMIT,
		evidenceTotal: 0,
		evidenceDropped: 0,
		diagnosticEvents: [],
		rankedResults: [],
		candidateProgress: [],
		selectedWinner: null,
		applyAllowed: false,
		corpusResult: null,
		preflight: null,
		events: [],
		error: null,
		cleanup: { status: 'pending' },
		control: control,
		workerPid: null,
		workerStarttime: null,
		heartbeatAt: created
	};

	try { mkdir(ROOT + '/' + id); } catch (e) { }
	if (!stat(ROOT + '/' + id) || !atomic_write(control_path(id), sprintf('%J', control) + '\n') || !save(runState) || !save_request_ref(requestId, id)) {
		release_start_lock();
		return err('EIO', 'could not create the full-corpus run journal');
	}
	add_event(runState, 'queued', 'Full 61-domain corpus run queued', {
		domains: corpus.count,
		candidates: catalog.count,
		attempts: attemptCount,
		corpusDigest: corpus.digest,
		catalogDigest: catalog.digest,
		requestId: requestId,
		generation: request.generation
	});
	save(runState);
	let spawned = run("sh -c '/usr/bin/ucode " + WORKER + " " + id + " >/dev/null 2>&1 & echo $!'");
	let pid = +trim(spawned.out || ''), start = proc_starttime(pid);
	if (spawned.rc != 0 || !alive(pid) || !start) {
		runState.phase = 'failed';
		runState.finishedAt = time();
		runState.error = { code: 'EIO', message: 'could not start full-corpus worker', details: { rc: spawned.rc, pid: pid || null } };
		runState.cleanup = { status: 'completed', reason: 'worker spawn failed' };
		add_event(runState, 'failed', 'Could not start full-corpus worker', runState.error.details);
		save(runState);
		clear_controls(id);
		release_start_lock();
		return err('EIO', 'could not start full-corpus worker', runState.error.details, id, runState.phase);
	}
	runState.workerPid = pid;
	runState.workerStarttime = start;
	runState.heartbeatAt = time();
	if (!save(runState)) {
		release_start_lock();
		return err('EIO', 'could not publish full-corpus worker state', {}, id, runState.phase);
	}
	release_start_lock();
	return { ok: true, run: runState };
};

function write_candidate(id, candidate, line) { return atomic_write(candidate_file(id, candidate), line + '\n'); }
function adapter_start(id, candidate, domain, timeout) {
	let command = "'" + ADAPTER + "' '" + id + "' '" + candidate + "' '" + PROTOCOL + "' '" + domain + "' 'https' '" + timeout + "' >/dev/null 2>&1 & echo $!";
	let response = run(command), pid = +trim(response.out || '');
	return pid > 1 ? { pid: pid, start: proc_starttime(pid) } : null;
}
function stop_owned(id, candidate, adapter) {
	let pid = read_pid(pid_file(id, candidate));
	let start = trim(readfile(start_file(id, candidate)) || '');
	if (pid && start && identity(pid, start)) run('kill -TERM ' + pid + ' 2>/dev/null');
	for (let i = 0; i < 3 && identity(adapter.pid, adapter.start); i++) run('sleep 1');
	if (pid && start && identity(pid, start)) run('kill -KILL ' + pid + ' 2>/dev/null');
	for (let i = 0; i < 3 && identity(adapter.pid, adapter.start); i++) run('sleep 1');
}
function attempt_timeout(runState) {
	let remaining = remaining_seconds(runState);
	if (remaining <= 0) return 0;
	let value = remaining < runState.perAttemptTimeoutSec ? remaining : runState.perAttemptTimeoutSec;
	let rounded = +sprintf('%.0f', value);
	if (rounded > value) rounded--;
	return rounded < 1 ? 0 : rounded;
}
function terminal(runState, phase, code, message, details) {
	runState.phase = phase;
	runState.finishedAt = time();
	runState.currentTargetId = null;
	runState.currentDomain = null;
	runState.currentCandidate = null;
	runState.currentAttempt = null;
	runState.candidatePid = null;
	runState.candidateStarttime = null;
	runState.error = code ? { code: code, message: message, details: details || {} } : null;
	runState.cleanup = { status: 'completed', checkedAt: time(), ownedChildrenStopped: true };
	add_event(runState, phase, message, details || {});
	save(runState);
	clear_controls(runState.runId);
	return phase == 'completed';
}
function registry_for_run(runState) {
	let catalog = orchestra_catalog_get();
	if (!catalog || catalog.ok !== true || catalog.digest != runState.candidateRegistryDigest || !arrays_equal(catalog.candidateIds, runState.candidateIds)) return null;
	let set = profile_set(null, 'all');
	if (!set || type(set.profiles) != 'array') return null;
	let map = {}, selected = [];
	for (let candidate in set.profiles) map[candidate.id] = candidate;
	for (let id in runState.candidateIds) {
		let candidate = map[id];
		if (!candidate || candidate.compatibilityStatus == 'unsupported' || candidate.protocol != PROTOCOL) return null;
		push(selected, candidate);
	}
	return selected;
}
function median(values) {
	if (!length(values)) return null;
	for (let i = 0; i < length(values); i++) for (let j = i + 1; j < length(values); j++)
		if (values[j] < values[i]) { let temporary = values[i]; values[i] = values[j]; values[j] = temporary; }
	let middle = length(values) / 2;
	return length(values) % 2 ? values[+sprintf('%.0f', middle - 0.5)] : (values[middle - 1] + values[middle]) / 2;
}
function retain_evidence(runState, result) {
	push(runState.results, {
		evidenceId: result.evidenceId || null,
		candidateId: result.candidateId,
		domain: result.domain,
		protocol: result.protocol,
		attempt: result.attempt,
		verdict: result.verdict,
		passed: result.passed === true,
		timedOut: result.timedOut === true,
		durationMs: result.durationMs,
		exitCode: result.exitCode,
		reason: result.reason
	});
	runState.evidenceTotal = (runState.evidenceTotal || 0) + 1;
	while (length(runState.results) > runState.evidenceLimit) {
		shift(runState.results);
		runState.evidenceDropped = (runState.evidenceDropped || 0) + 1;
	}
}
function ranking(progress) {
	let rows = [];
	for (let item in progress || []) {
		let row = {
			candidateId: item.candidateId,
			strategyId: item.strategyId,
			name: item.name,
			source: item.source,
			sourcePath: item.sourcePath,
			successCount: item.passedDomains,
			targetCount: item.testedDomains,
			failedDomains: item.failedDomains,
			timeoutDomains: item.timeoutDomains,
			attemptCount: item.attemptCount,
			timeoutCount: item.timeoutCount,
			medianDurationMs: item.medianDurationMs,
			percent: item.testedDomains ? item.passedDomains * 100 / item.testedDomains : null,
			verdict: item.testedDomains == 61 && item.passedDomains == 61 ? 'complete' : item.passedDomains > 0 ? 'partial' : 'failed'
		};
		row.score = row.successCount * 1000000 - row.timeoutCount * 10000 - (row.medianDurationMs || 0);
		row.reason = row.verdict == 'complete' ? 'all 61 domains passed' : 'one or more corpus domains failed';
		push(rows, row);
	}
	for (let i = 0; i < length(rows); i++) for (let j = i + 1; j < length(rows); j++) {
		let leftLatency = rows[i].medianDurationMs == null ? 2147483647 : rows[i].medianDurationMs;
		let rightLatency = rows[j].medianDurationMs == null ? 2147483647 : rows[j].medianDurationMs;
		if (rows[j].successCount > rows[i].successCount ||
			(rows[j].successCount == rows[i].successCount && rightLatency < leftLatency) ||
			(rows[j].successCount == rows[i].successCount && rightLatency == leftLatency && rows[j].candidateId < rows[i].candidateId)) {
			let temporary = rows[i]; rows[i] = rows[j]; rows[j] = temporary;
		}
	}
	for (let i = 0; i < length(rows); i++) rows[i].rank = i + 1;
	return rows;
}

export const orchestra_corpus_worker_run = function(id) {
	if (!safe_id(id)) return false;
	let runState = orchestra_run_load({ runId: id });
	if (!runState || runState.mode != 'full-corpus' || runState.targetType != 'corpus') return false;
	let self = +(split(trim(readfile('/proc/self/stat') || ''), ' ')[0]);
	runState.workerPid = self;
	runState.workerStarttime = proc_starttime(self);
	runState.startedAt = time();
	let uptime = +(split(trim(readfile('/proc/uptime') || ''), ' ')[0] || 0);
	runState.startedMonoSec = uptime;
	runState.deadlineMonoSec = uptime + runState.totalTimeoutSec;
	runState.heartbeatAt = time();
	save(runState);

	runState.preflight = orchestra_probe_preflight();
	if (!runState.preflight || runState.preflight.ok !== true)
		return terminal(runState, 'infrastructure-error', 'EPROBEDEPENDENCY',
			runState.preflight && runState.preflight.error && runState.preflight.error.message || 'probe preflight failed',
			runState.preflight && runState.preflight.error && runState.preflight.error.details || {});
	let corpus = orchestra_corpus_get();
	if (!corpus || corpus.ok !== true || corpus.version != runState.corpusVersion || corpus.digest != runState.corpusDigest || corpus.count != runState.targetCount)
		return terminal(runState, 'failed', 'ESTALE', '61-domain corpus changed before execution', {
			expectedVersion: runState.corpusVersion,
			actualVersion: corpus && corpus.version || null,
			expectedDigest: runState.corpusDigest,
			actualDigest: corpus && corpus.digest || null
		});
	let candidates = registry_for_run(runState);
	if (!candidates) return terminal(runState, 'failed', 'ESTALE', 'applicable strategy catalog changed before execution');

	runState.phase = 'preparing';
	add_event(runState, 'preparing', 'Trusted corpus and strategy catalog resolved', {
		domains: runState.targetCount,
		candidates: length(candidates),
		attempts: runState.totalAttempts,
		generation: runState.generation
	});
	save(runState);
	runState.phase = 'testing';
	add_event(runState, 'testing', 'Full strategy by domain matrix started');
	save(runState);

	for (let candidateIndex = 0; candidateIndex < length(candidates); candidateIndex++) {
		let candidate = candidates[candidateIndex];
		let meta = corpus_translate(candidate.opt);
		if (!meta.ok) return terminal(runState, 'infrastructure-error', 'ECANDIDATE', 'trusted candidate could not be translated', { candidateId: candidate.id, reason: meta.reason });
		if (!write_candidate(id, candidate.id, meta.input))
			return terminal(runState, 'infrastructure-error', 'EWRITELIST', 'could not write candidate input', { candidateId: candidate.id });
		let candidateStarted = time(), passedByDomain = {}, failedDomains = [], timeoutDomains = [], durations = [], timeoutCount = 0, attemptCount = 0;
		for (let domainIndex = 0; domainIndex < length(runState.targets); domainIndex++) {
			let target = runState.targets[domainIndex];
			let domainPasses = 0, domainTimedOut = false;
			for (let attempt = 1; attempt <= runState.attempts; attempt++) {
				runState = orchestra_run_load({ runId: id });
				if (!runState) return false;
				let control = control_load(id);
				runState.control = control;
				if (control.stopRequested) return terminal(runState, 'stopped', null, 'Full corpus run stopped by user');
				while (control.pauseRequested) {
					if (runState.phase != 'paused') { runState.phase = 'paused'; add_event(runState, 'paused', 'Full corpus run paused between attempts'); save(runState); }
					run('sleep 1');
					runState = orchestra_run_load({ runId: id });
					control = control_load(id);
					if (control.stopRequested) return terminal(runState, 'stopped', null, 'Full corpus run stopped by user');
				}
				if (runState.phase == 'paused') { runState.phase = 'testing'; add_event(runState, 'resumed', 'Full corpus run resumed'); save(runState); }
				let timeout = attempt_timeout(runState);
				if (timeout < 1) return terminal(runState, 'timed-out', 'ETIMEOUT', 'Full corpus run reached its immutable deadline');
				let started = time();
				runState.cursor = { candidateIndex: candidateIndex, domainIndex: domainIndex, attempt: attempt };
				runState.currentTargetId = target.id;
				runState.currentDomain = target.domain;
				runState.currentProtocol = PROTOCOL;
				runState.currentCandidate = candidate.id;
				runState.currentAttempt = attempt;
				runState.heartbeatAt = started;
				save(runState);
				let adapter = adapter_start(id, candidate.id, target.domain, timeout);
				if (!adapter) return terminal(runState, 'infrastructure-error', 'EWRAPPERSTART', 'could not start candidate wrapper', { candidateId: candidate.id, domain: target.domain });
				while (identity(adapter.pid, adapter.start)) {
					runState = orchestra_run_load({ runId: id });
					control = control_load(id);
					let childPid = read_pid(pid_file(id, candidate.id));
					let childStart = trim(readfile(start_file(id, candidate.id)) || '');
					runState.control = control;
					runState.candidatePid = childPid;
					runState.candidateStarttime = childStart || null;
					runState.heartbeatAt = time();
					save(runState);
					if (control.stopRequested) { stop_owned(id, candidate.id, adapter); return terminal(runState, 'stopped', null, 'Full corpus run stopped by user'); }
					if (remaining_seconds(runState) <= 0) { stop_owned(id, candidate.id, adapter); return terminal(runState, 'timed-out', 'ETIMEOUT', 'Full corpus run reached its immutable deadline'); }
					run('sleep 1');
				}
				runState = orchestra_run_load({ runId: id });
				let rawRc = trim(readfile(rc_file(id, candidate.id)) || '');
				let rc = rawRc == '' ? -1 : +rawRc;
				let log = readfile(log_file(id, candidate.id)) || '';
				if (rc == 66 || rc == 69 || index(log, 'INFRA_ERROR') >= 0)
					return terminal(runState, 'infrastructure-error', 'EPROBEDEPENDENCY', 'candidate probe infrastructure failed', { candidateId: candidate.id, domain: target.domain, rc: rc });
				let result = classify_attempt(runState, candidate, PROTOCOL, attempt, started, time(), rc, log, rc == 124,
					candidate.upstreamStrategyReference, meta.input, meta, target.domain);
				result.targetId = target.id;
				attemptCount++;
				if (result.passed === true) { domainPasses++; push(durations, result.durationMs || 0); }
				if (result.timedOut === true || result.verdict == 'timeout') { timeoutCount++; domainTimedOut = true; }
				retain_evidence(runState, result);
				runState.completedCount++;
				runState.progress = runState.totalCount ? runState.completedCount * 100 / runState.totalCount : 0;
				runState.candidatePid = null;
				runState.candidateStarttime = null;
				runState.heartbeatAt = time();
				add_event(runState, 'attempt', 'Full corpus candidate attempt finished', {
					candidateId: candidate.id,
					domain: target.domain,
					attempt: attempt,
					verdict: result.verdict
				});
				save(runState);
			}
			if (domainPasses >= runState.attempts) passedByDomain[target.domain] = true;
			else push(failedDomains, target.domain);
			if (domainTimedOut) push(timeoutDomains, target.domain);
		}
		runState = orchestra_run_load({ runId: id });
		let passedDomains = length(keys(passedByDomain));
		push(runState.candidateProgress, {
			candidateId: candidate.id,
			strategyId: candidate.canonicalStrategyId || candidate.id,
			name: candidate.displayName || candidate.name || candidate.id,
			source: candidate.source || null,
			sourcePath: candidate.sourcePath || null,
			testedDomains: runState.targetCount,
			passedDomains: passedDomains,
			failedDomains: failedDomains,
			timeoutDomains: timeoutDomains,
			attemptCount: attemptCount,
			timeoutCount: timeoutCount,
			medianDurationMs: median(durations),
			completedAt: time(),
			durationSec: time() - candidateStarted
		});
		add_event(runState, 'candidate-completed', 'Candidate completed the full 61-domain corpus', {
			candidateId: candidate.id,
			passedDomains: passedDomains,
			testedDomains: runState.targetCount,
			attempts: attemptCount
		});
		save(runState);
	}

	runState = orchestra_run_load({ runId: id });
	runState.phase = 'ranking';
	add_event(runState, 'ranking', 'Ranking complete full-corpus evidence');
	save(runState);
	let rows = ranking(runState.candidateProgress);
	runState.rankedResults = rows;
	if (length(rows)) {
		runState.selectedWinner = {
			candidateId: rows[0].candidateId,
			strategyId: rows[0].strategyId,
			name: rows[0].name,
			source: rows[0].source,
			successCount: rows[0].successCount,
			targetCount: rows[0].targetCount,
			failedDomains: rows[0].failedDomains,
			medianLatencyMs: rows[0].medianDurationMs,
			score: rows[0].score,
			corpusDigest: runState.corpusDigest,
			catalogDigest: runState.candidateRegistryDigest
		};
	}
	let complete = runState.completedCount == runState.totalCount && length(runState.candidateProgress) == runState.totalCandidates;
	runState.corpusResult = {
		complete: complete,
		version: runState.corpusVersion,
		digest: runState.corpusDigest,
		targetCount: runState.targetCount,
		candidateCount: runState.totalCandidates,
		attemptCount: runState.totalAttempts,
		completedCount: runState.completedCount,
		evidenceRetained: length(runState.results),
		evidenceDropped: runState.evidenceDropped,
		winner: runState.selectedWinner
	};
	runState.applyAllowed = false;
	return terminal(runState, 'completed', null, 'Full 61-domain corpus ranking completed', {
		complete: complete,
		winner: runState.selectedWinner && runState.selectedWinner.candidateId || null,
		opened: runState.selectedWinner && runState.selectedWinner.successCount || 0,
		total: runState.targetCount
	});
};
