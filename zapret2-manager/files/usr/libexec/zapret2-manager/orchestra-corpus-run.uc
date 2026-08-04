'use strict';

import { readfile, writefile, unlink, mkdir, stat } from 'fs';
import {
	orchestra_run_load, orchestra_run_status, profile_set, corpus_translate,
	classify_attempt, control_load, proc_starttime, run, save, add_event,
	orchestra_probe_preflight, remaining_seconds
} from './orchestra-run.uc';
import { orchestra_corpus_get } from './orchestra-corpus.uc';

const ROOT = '/tmp/zapret2-manager/orchestra-runs';
const ACTIVE = ROOT + '/active.json';
const WORKER = '/usr/libexec/zapret2-manager/orchestra-worker.uc';
const ADAPTER = '/usr/libexec/zapret2-manager/orchestra-candidate-run.sh';
const PROTOCOL = 'tcp_https';
const MAX_CANDIDATES = 256;
const MAX_ATTEMPTS = 20000;
const MAX_TIMEOUT = 86400;

function err(code, message, details, runId, phase) {
	return { ok: false, error: { code: code, message: message, details: details || {}, runId: runId || null, phase: phase || null } };
}
function path(id) { return ROOT + '/' + id + '.json'; }
function control_path(id) { return ROOT + '/' + id + '.control'; }
function safe_id(id) { return type(id) == 'string' && match(id, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/); }
function alive(pid) { return type(pid) == 'int' && pid > 1 && run('kill -0 ' + pid + ' 2>/dev/null').rc == 0; }
function identity(pid, start) { return alive(pid) && start && proc_starttime(pid) == start; }
function has(array, value) { for (let item in array || []) if (item == value) return true; return false; }
function clear_controls(id) {
	try { unlink(control_path(id)); } catch (e) { }
	try { unlink(ROOT + '/' + id + '.pause'); } catch (e) { }
	try { unlink(ROOT + '/' + id + '.stop'); } catch (e) { }
}
function hash_text(text, suffix) {
	let file = '/tmp/z2m-corpus-run-hash.' + time() + '.' + (suffix || 'x');
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
function registry_snapshot() {
	let set = profile_set(null, 'all');
	if (!set || type(set.profiles) != 'array') return null;
	let profiles = [], canonical = '';
	for (let candidate in set.profiles) {
		if (!candidate || candidate.compatibilityStatus == 'unsupported' || candidate.protocol != PROTOCOL)
			continue;
		if (type(candidate.id) != 'string' || type(candidate.opt) != 'string')
			continue;
		push(profiles, candidate);
		canonical += candidate.id + '\t' + candidate.opt + '\n';
	}
	if (!length(profiles) || length(profiles) > MAX_CANDIDATES) return null;
	return {
		profiles: profiles,
		revision: set.revision,
		digest: hash_text(canonical, 'registry')
	};
}
function current_active() {
	let response = orchestra_run_status({});
	return response && response.ok === true && response.run ? response.run : null;
}
function make_targets(domains) {
	let targets = [];
	for (let i = 0; i < length(domains); i++)
		push(targets, { id: sprintf('d%03d', i + 1), domain: domains[i], protocols: [PROTOCOL], probe: 'https' });
	return targets;
}
function initial_control(id, timestamp) {
	return { runId: id, pauseRequested: false, stopRequested: false, revision: 0, updatedAt: timestamp };
}

export const orchestra_corpus_run_start = function(input) {
	input = input || {};
	if (input.targetType != 'corpus') return err('EINPUT', 'targetType must be corpus');
	if (input.candidateMode != null && input.candidateMode != 'all')
		return err('EINPUT', 'the full corpus run requires candidateMode=all');
	if (type(input.candidateIds) == 'array' && length(input.candidateIds))
		return err('EINPUT', 'the full corpus run does not accept a candidate subset');
	let repeats = +(input.repeats == null ? 1 : input.repeats);
	let perAttemptTimeoutSec = +(input.perAttemptTimeoutSec == null ? 15 : input.perAttemptTimeoutSec);
	let totalTimeoutSec = +(input.totalTimeoutSec == null ? MAX_TIMEOUT : input.totalTimeoutSec);
	if (repeats < 1 || repeats > 2 || perAttemptTimeoutSec < 1 || perAttemptTimeoutSec > 120 || totalTimeoutSec < perAttemptTimeoutSec || totalTimeoutSec > MAX_TIMEOUT)
		return err('EINPUT', 'corpus repeat or timeout bounds are invalid');
	if (current_active()) return err('EBUSY', 'an orchestration run is already active');

	let corpus = orchestra_corpus_get();
	if (!corpus || corpus.ok !== true) return corpus || err('ECORPUS', '61-domain corpus is unavailable');
	let registry = registry_snapshot();
	if (!registry || !registry.digest) return err('ESTATE', 'no compatible trusted TCP strategies are available');
	let attempts = length(corpus.domains) * length(registry.profiles) * repeats;
	if (attempts < 1 || attempts > MAX_ATTEMPTS)
		return err('EBOUND', 'full corpus work exceeds the supported attempt bound', { attempts: attempts, maxAttempts: MAX_ATTEMPTS });

	let created = time();
	let nonce = sprintf('%04x', (created * 1103515245) & 0xffff);
	let id = 'or-' + sprintf('%08x', created) + '-' + nonce;
	let ids = [];
	for (let profile in registry.profiles) push(ids, profile.id);
	let targets = make_targets(corpus.domains);
	let control = initial_control(id, created);
	let runState = {
		schema: 1,
		runId: id,
		createdAt: created,
		startedAt: created,
		deadlineAt: created + totalTimeoutSec,
		startedMonoSec: null,
		deadlineMonoSec: null,
		runTimeoutSec: totalTimeoutSec,
		phase: 'queued',
		target: 'domains-61',
		targetType: 'corpus',
		corpusVersion: corpus.version,
		corpusDigest: corpus.digest,
		targetCount: length(targets),
		targets: targets,
		candidateMode: 'all',
		candidateIds: ids,
		candidateRegistryDigest: registry.digest,
		catalogRevision: registry.revision,
		protocols: [PROTOCOL],
		repeats: repeats,
		perAttemptTimeoutSec: perAttemptTimeoutSec,
		totalTimeoutSec: totalTimeoutSec,
		maxCandidates: length(ids),
		maxAttempts: attempts,
		totalCandidates: length(ids),
		totalAttempts: attempts,
		totalCount: attempts,
		completedCount: 0,
		progress: 0,
		currentTargetId: null,
		currentDomain: null,
		currentProtocol: null,
		currentCandidate: null,
		currentAttempt: null,
		candidatePid: null,
		candidateStarttime: null,
		results: [],
		targetCandidateEvidence: [],
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

	try { mkdir('/tmp/zapret2-manager'); mkdir(ROOT); mkdir(ROOT + '/' + id); } catch (e) { }
	if (!stat(ROOT + '/' + id)) return err('EIO', 'could not create corpus run directory');
	if (!atomic_write(control_path(id), sprintf('%J', control) + '\n') || !save(runState))
		return err('EIO', 'could not create corpus run journal');
	add_event(runState, 'queued', 'Full 61-domain corpus run queued', {
		domains: length(targets), candidates: length(ids), attempts: attempts,
		corpusDigest: corpus.digest, registryDigest: registry.digest
	});
	if (!save(runState)) return err('EIO', 'could not save queued corpus run');
	let spawned = run("sh -c '/usr/bin/ucode " + WORKER + " " + id + " >/dev/null 2>&1 & echo $!'");
	let pid = +trim(spawned.out || ''), start = proc_starttime(pid);
	if (spawned.rc != 0 || !alive(pid) || !start) {
		runState.phase = 'failed';
		runState.finishedAt = time();
		runState.error = { code: 'EIO', message: 'could not start corpus worker', details: { rc: spawned.rc, pid: pid || null } };
		runState.cleanup = { status: 'completed', reason: 'worker spawn failed' };
		add_event(runState, 'failed', 'Could not start corpus worker', runState.error.details);
		save(runState);
		clear_controls(id);
		return err('EIO', 'could not start corpus worker', runState.error.details, id, runState.phase);
	}
	runState.workerPid = pid;
	runState.workerStarttime = start;
	runState.heartbeatAt = time();
	if (!save(runState)) return err('EIO', 'could not publish corpus worker state', {}, id, runState.phase);
	return { ok: true, run: runState };
};

function candidate_file(id, candidate) { return ROOT + '/' + id + '/' + candidate + '.' + PROTOCOL; }
function pid_file(id, candidate) { return candidate_file(id, candidate) + '.pid'; }
function start_file(id, candidate) { return candidate_file(id, candidate) + '.starttime'; }
function rc_file(id, candidate) { return candidate_file(id, candidate) + '.rc'; }
function log_file(id, candidate) { return candidate_file(id, candidate) + '.log'; }
function read_pid(file) { let value = +(trim(readfile(file) || '')); return value > 1 ? value : null; }
function write_candidate(id, candidate, line) {
	return atomic_write(candidate_file(id, candidate), line + '\n');
}
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
	let value = runState.perAttemptTimeoutSec;
	if (remaining < value) value = remaining;
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
	let set = profile_set(null, 'all');
	if (!set || type(set.profiles) != 'array') return null;
	let wanted = {}, selected = [], canonical = '';
	for (let id in runState.candidateIds) wanted[id] = true;
	for (let candidate in set.profiles) {
		if (!candidate || !wanted[candidate.id] || candidate.compatibilityStatus == 'unsupported' || candidate.protocol != PROTOCOL)
			continue;
		push(selected, candidate);
		canonical += candidate.id + '\t' + candidate.opt + '\n';
	}
	if (length(selected) != length(runState.candidateIds)) return null;
	let digest = hash_text(canonical, runState.runId);
	return digest == runState.candidateRegistryDigest ? selected : null;
}
function median(values) {
	if (!length(values)) return null;
	for (let i = 0; i < length(values); i++) for (let j = i + 1; j < length(values); j++)
		if (values[j] < values[i]) { let temporary = values[i]; values[i] = values[j]; values[j] = temporary; }
	let middle = length(values) / 2;
	return length(values) % 2 ? values[+sprintf('%.0f', middle - 0.5)] : (values[middle - 1] + values[middle]) / 2;
}
function rank(runState, candidates) {
	let rows = [];
	for (let candidate in candidates) {
		let domains = {}, passed = {}, failures = [], durations = [], attempts = 0, timeouts = 0;
		for (let result in runState.results) {
			if (result.candidateId != candidate.id) continue;
			domains[result.domain] = true;
			attempts++;
			if (result.passed === true) { passed[result.domain] = (passed[result.domain] || 0) + 1; push(durations, result.durationMs || 0); }
			if (result.timedOut === true || result.verdict == 'timeout') timeouts++;
		}
		let successCount = 0;
		for (let target in runState.targets) {
			if ((passed[target.domain] || 0) >= runState.repeats) successCount++;
			else push(failures, target.domain);
		}
		let medianDurationMs = median(durations);
		let score = successCount * 1000000 - timeouts * 10000 - (medianDurationMs || 0);
		push(rows, {
			candidateId: candidate.id,
			strategyId: candidate.canonicalStrategyId || candidate.id,
			name: candidate.displayName || candidate.name || candidate.id,
			source: candidate.source,
			sourcePath: candidate.sourcePath || null,
			successCount: successCount,
			targetCount: length(runState.targets),
			failedDomains: failures,
			attemptCount: attempts,
			timeoutCount: timeouts,
			medianDurationMs: medianDurationMs,
			percent: length(runState.targets) ? successCount * 100 / length(runState.targets) : null,
			score: score,
			verdict: successCount == length(runState.targets) ? 'complete' : successCount > 0 ? 'partial' : 'failed',
			reason: successCount == length(runState.targets) ? 'all 61 domains passed' : 'one or more corpus domains failed'
		});
	}
	for (let i = 0; i < length(rows); i++) for (let j = i + 1; j < length(rows); j++)
		if (rows[j].successCount > rows[i].successCount ||
			(rows[j].successCount == rows[i].successCount && (rows[j].medianDurationMs || 2147483647) < (rows[i].medianDurationMs || 2147483647)) ||
			(rows[j].successCount == rows[i].successCount && rows[j].medianDurationMs == rows[i].medianDurationMs && rows[j].candidateId < rows[i].candidateId)) {
			let temporary = rows[i]; rows[i] = rows[j]; rows[j] = temporary;
		}
	for (let i = 0; i < length(rows); i++) rows[i].rank = i + 1;
	return rows;
}

export const orchestra_corpus_worker_run = function(id) {
	if (!safe_id(id)) return false;
	let runState = orchestra_run_load({ runId: id });
	if (!runState || runState.targetType != 'corpus') return false;
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
	if (!corpus || corpus.ok !== true || corpus.digest != runState.corpusDigest || corpus.count != runState.targetCount)
		return terminal(runState, 'failed', 'ESTALE', '61-domain corpus changed before execution', {
			expectedDigest: runState.corpusDigest, actualDigest: corpus && corpus.digest || null
		});
	let candidates = registry_for_run(runState);
	if (!candidates) return terminal(runState, 'failed', 'ESTALE', 'strategy registry changed before corpus execution');

	runState.phase = 'preparing';
	add_event(runState, 'preparing', 'Trusted corpus and strategy registry resolved', {
		domains: runState.targetCount, candidates: length(candidates), attempts: runState.totalAttempts
	});
	save(runState);
	runState.phase = 'testing';
	add_event(runState, 'testing', 'Full strategy by domain matrix started');
	save(runState);

	for (let candidate in candidates) {
		let meta = corpus_translate(candidate.opt);
		if (!meta.ok) return terminal(runState, 'infrastructure-error', 'ECANDIDATE', 'trusted candidate could not be translated', { candidateId: candidate.id, reason: meta.reason });
		if (!write_candidate(id, candidate.id, meta.input))
			return terminal(runState, 'infrastructure-error', 'EWRITELIST', 'could not write candidate input', { candidateId: candidate.id });
		let candidateStarted = time(), candidatePassed = 0;
		for (let target in runState.targets) for (let attempt = 1; attempt <= runState.repeats; attempt++) {
			runState = orchestra_run_load({ runId: id });
			if (!runState) return false;
			let control = control_load(id);
			runState.control = control;
			if (control.stopRequested) return terminal(runState, 'stopped', null, 'Full corpus run stopped by user');
			while (control.pauseRequested) {
				if (runState.phase != 'paused') { runState.phase = 'paused'; add_event(runState, 'paused', 'Corpus run paused between attempts'); save(runState); }
				run('sleep 1');
				runState = orchestra_run_load({ runId: id });
				control = control_load(id);
				if (control.stopRequested) return terminal(runState, 'stopped', null, 'Full corpus run stopped by user');
			}
			if (runState.phase == 'paused') { runState.phase = 'testing'; add_event(runState, 'resumed', 'Corpus run resumed'); save(runState); }
			let timeout = attempt_timeout(runState);
			if (timeout < 1) return terminal(runState, 'timed-out', 'ETIMEOUT', 'Full corpus run reached its immutable deadline');
			let started = time();
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
			push(runState.results, result);
			push(runState.targetCandidateEvidence, result);
			if (result.passed === true) candidatePassed++;
			runState.completedCount++;
			runState.progress = runState.totalCount ? runState.completedCount * 100 / runState.totalCount : 0;
			runState.candidatePid = null;
			runState.candidateStarttime = null;
			runState.heartbeatAt = time();
			add_event(runState, 'attempt', 'Corpus candidate attempt finished', {
				candidateId: candidate.id, domain: target.domain, attempt: attempt, verdict: result.verdict
			});
			save(runState);
		}
		runState = orchestra_run_load({ runId: id });
		push(runState.candidateProgress, {
			candidateId: candidate.id,
			completedAt: time(),
			durationSec: time() - candidateStarted,
			positiveAttempts: candidatePassed,
			totalAttempts: runState.targetCount * runState.repeats
		});
		add_event(runState, 'candidate-completed', 'Candidate completed the full 61-domain corpus', {
			candidateId: candidate.id, positiveAttempts: candidatePassed, totalAttempts: runState.targetCount * runState.repeats
		});
		save(runState);
	}

	runState = orchestra_run_load({ runId: id });
	runState.phase = 'ranking';
	add_event(runState, 'ranking', 'Ranking complete corpus evidence');
	save(runState);
	let rankings = rank(runState, candidates);
	runState.rankedResults = rankings;
	if (length(rankings) && rankings[0].successCount > 0) {
		runState.selectedWinner = {
			candidateId: rankings[0].candidateId,
			strategyId: rankings[0].strategyId,
			name: rankings[0].name,
			source: rankings[0].source,
			successCount: rankings[0].successCount,
			targetCount: rankings[0].targetCount,
			failedDomains: rankings[0].failedDomains,
			medianLatencyMs: rankings[0].medianDurationMs,
			score: rankings[0].score,
			corpusDigest: runState.corpusDigest,
			registryDigest: runState.candidateRegistryDigest
		};
	}
	runState.corpusResult = {
		version: runState.corpusVersion,
		digest: runState.corpusDigest,
		targetCount: runState.targetCount,
		candidateCount: runState.totalCandidates,
		attemptCount: runState.totalAttempts,
		completedCount: runState.completedCount,
		winner: runState.selectedWinner
	};
	runState.applyAllowed = false;
	return terminal(runState, 'completed', null, 'Full 61-domain corpus ranking completed', {
		winner: runState.selectedWinner && runState.selectedWinner.candidateId || null,
		opened: runState.selectedWinner && runState.selectedWinner.successCount || 0,
		total: runState.targetCount
	});
};
