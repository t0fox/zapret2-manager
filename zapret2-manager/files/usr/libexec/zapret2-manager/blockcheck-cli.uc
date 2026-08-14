'use strict';

import { readfile, writefile, stat, unlink, popen, lsdir, readlink } from 'fs';
import * as model from './blockcheck-model.uc';

const ROOT = '/tmp/zapret2-manager/jobs';
const RUNNER = '/usr/libexec/zapret2-manager/blockcheck-diagnostic-run.sh';
const MAX_LOG = 262144;
const TERMINAL = { completed: true, cancelled: true, error: true };
const DOMAIN_FILE = '/etc/zapret2-manager/blockcheck-domains.json';
const DEFAULT_DOMAINS = ['youtube.com', 'discord.com', 'github.com', 'googlevideo.com'];

function path(id, suffix) { return ROOT + '/' + id + (suffix || '.json'); }
function object(value) { return type(value) == 'object' && value != null; }
function error(code, message) { return { ok: false, error: { code: code, message: message } }; }
function read(id) { let raw = readfile(path(id)); if (!raw) return null; try { let value = json(raw); return object(value) && value.id == id ? value : null; } catch (e) { return null; } }
function save_record(job) { writefile(path(job.id), sprintf('%J', job) + '\n'); }
function safe_id(id) { return type(id) == 'string' && match(id, /^bcdiag-[0-9]+-[0-9]+$/); }
function now() { return time(); }
function next_seq() { let raw = readfile(ROOT + '/.bcdiag-seq'), n = raw ? (+trim(raw) || 0) : 0; n++; writefile(ROOT + '/.bcdiag-seq', '' + n + '\n'); return n; }
function quote(value) { let out = "'", s = '' + value; for (let i = 0; i < length(s); i++) out += substr(s, i, 1) == "'" ? "'\\''" : substr(s, i, 1); return out + "'"; }
function run(command) { let p = popen(command + ' 2>/dev/null', 'r'); if (!p) return ''; let out = p.read('all') || ''; p.close(); return out; }
function identity(pid) {
	if (type(pid) != 'int' || pid <= 0 || !stat('/proc/' + pid)) return null;
	let raw = readfile('/proc/' + pid + '/stat'); if (!raw) return null;
	let close = index(raw, ')'); if (close < 0) return null;
	let fields = split(trim(substr(raw, close + 1)), ' '), exe = readlink('/proc/' + pid + '/exe');
	let start = length(fields) > 19 ? +fields[19] : 0;
	return { pid: pid, startTime: start, exe: exe || '', argv: readfile('/proc/' + pid + '/cmdline') || '' };
}
function owned(job, key) {
	let expected = job[key]; if (!object(expected)) return null;
	let actual = identity(expected.pid);
	if (!actual || actual.startTime != expected.startTime || (expected.exe && actual.exe != expected.exe)) return null;
	if (!expected.fingerprint || index(actual.argv, expected.fingerprint) >= 0) return actual;
	return null;
}
function attach_identity(job, key, pid, fingerprint) { let value = identity(pid); if (value == null) return false; value.fingerprint = fingerprint; job[key] = value; return true; }
function recover(job) {
	if (!job || TERMINAL[job.status]) return job;
	if (owned(job, 'runner') != null) return job;
	let child = owned(job, 'child');
	if (child != null) run('kill -TERM ' + child.pid);
	job.status = 'error'; job.phase = 'recovery'; job.recovery = { state: 'uncertain', reason: 'owned diagnostic runner disappeared' };
	job.error = { code: 'ESTALE', message: 'stale diagnostic worker recovered fail-closed' }; job.finishedAt = now(); save_record(job); return job;
}
function latest() {
	let names = lsdir(ROOT), chosen = null;
	if (type(names) != 'array') return null;
	for (let name in names) {
		if (substr(name, 0, 7) != 'bcdiag-' || substr(name, -5) != '.json') continue;
		let id = substr(name, 0, length(name) - 5), job = read(id); if (!job) continue;
		if (chosen == null || (job.createdAt || 0) > (chosen.createdAt || 0)) chosen = job;
	}
	return recover(chosen);
}
function active() { let job = latest(); return job && !TERMINAL[job.status] ? job : null; }
function public_job(job) {
	if (!job) return null;
	return { id: job.id, kind: 'blockcheck', product: 'blockcheck', status: job.status, phase: job.phase,
		mode: job.request.mode, domains: job.request.domains, extra_domains: job.request.extra_domains,
		progress: job.progress, total: job.total, startedAt: job.startedAt, finishedAt: job.finishedAt,
		error: job.error, recovery: job.recovery, cancellationRequested: job.cancellationRequested,
		elapsedSec: job.startedAt == null ? 0 : ((job.finishedAt || now()) - job.startedAt), evidenceCount: job.evidenceCount || 0 };
}
function request(input) {
	let value = object(input) ? input : {}, prepared = {};
	for (let key in value) prepared[key] = value[key];
	if (prepared.domains == null && prepared.extra_domains == null) { let configured = readfile(DOMAIN_FILE); try { prepared.domains = configured ? json(configured) : DEFAULT_DOMAINS; } catch (e) { prepared.domains = DEFAULT_DOMAINS; } }
	let checked = model.blockcheck_request_validate(prepared);
	if (!checked.ok) return checked;
	if (length(checked.value.domains) == 0 && length(checked.value.extra_domains) == 0) return error('EINPUT', 'at least one configured or explicit domain is required');
	let all = [], seen = {};
	for (let d in checked.value.domains) { seen[d] = true; push(all, d); }
	for (let d in checked.value.extra_domains) if (!seen[d]) { seen[d] = true; push(all, d); }
	checked.value.domains = all;
	return checked;
}
function evidence_lines(id) {
	let raw = readfile(path(id, '.evidence')), rows = [];
	if (!raw) return rows;
	let lines = split(raw, '\n');
	for (let line in lines) { let l = trim(line); if (!l) continue; try { let value = json(l); if (object(value)) push(rows, value); else push(rows, { malformed: true, preview: substr(l, 0, 160) }); } catch (e) { push(rows, { malformed: true, preview: substr(l, 0, 160) }); } }
	return rows;
}
function results(job) {
	let findings = [], infrastructure = [], evidence = evidence_lines(job.id);
	for (let row in evidence) {
		if (row.malformed) { push(infrastructure, { code: 'malformed_probe_evidence', evidence: row }); continue; }
		let classified = model.blockcheck_classify_observation(row);
		if (classified.outcome == 'infrastructure') push(infrastructure, classified.infrastructure);
		else if (classified.finding && classified.finding.classification != 'none') push(findings, classified.finding);
	}
	return { schema: 1, id: job.id, status: job.status, request: job.request, findings: findings, infrastructure: infrastructure,
		cancellation: job.status == 'cancelled' ? { requested: true, verified: job.recovery && job.recovery.state == 'verified' } : null,
		evidence: evidence, recommendation: length(findings) ? findings[0].recommendation : 'none', provenance: { product: 'blockcheck', runner: RUNNER } };
}

export const blockcheck_diag_start = function(input) {
	let checked = request(input); if (!checked.ok) return checked;
	let existing = active(); if (existing) return error('ECONFLICT', 'BlockCheck diagnostic is already running');
	if (!stat(RUNNER)) return error('EDEPENDENCY', 'BlockCheck diagnostic runner is unavailable');
	let id = 'bcdiag-' + now() + '-' + next_seq(), value = { id: id, kind: 'blockcheck', product: 'blockcheck', request: checked.value,
		status: 'pending', phase: 'queued', progress: 0, total: length(checked.value.domains), evidenceCount: 0,
		createdAt: now(), startedAt: null, finishedAt: null, runner: null, child: null, cancellationRequested: false,
		recovery: { state: 'not_required' }, error: null };
	save_record(value); writefile(path(id, '.evidence'), '');
	let env = 'MODE=' + quote(checked.value.mode) + '\nDOMAINS=' + quote(join(checked.value.domains, ' ')) + '\n';
	writefile(path(id, '.env'), env);
	let out = run('setsid ash ' + quote(RUNNER) + ' ' + quote(id) + ' </dev/null >/dev/null 2>&1 & echo $!');
	let pid = +trim(out); if (!pid) { value.status = 'error'; value.error = { code: 'EDEPENDENCY', message: 'diagnostic worker did not start' }; value.finishedAt = now(); save_record(value); return error('EDEPENDENCY', 'diagnostic worker did not start'); }
	attach_identity(value, 'runner', pid, 'blockcheck-diagnostic-run.sh'); save_record(value);
	return { ok: true, job: public_job(value) };
};
export const blockcheck_diag_status = function() { let job = latest(); return { ok: true, job: public_job(job) }; };
export const blockcheck_diag_results = function(input) { let job = input && input.id ? read(input.id) : latest(); if (!job) return { ok: true, results: null }; job = recover(job); return { ok: true, results: results(job) }; };
export const blockcheck_diag_stop = function(input) { let job = input && input.id ? read(input.id) : active(); if (!job) return { ok: true, status: 'idle' }; job = recover(job); if (TERMINAL[job.status]) return error('ESTATE', 'BlockCheck diagnostic is already terminal'); if (!owned(job, 'runner')) return error('EOWNERSHIP', 'diagnostic runner identity is not owned'); writefile(path(job.id, '.cancel'), '' + now() + '\n'); job.cancellationRequested = true; job.phase = 'cancelling'; save_record(job); run('kill -TERM -' + job.runner.pid); return { ok: true, id: job.id, status: 'cancelling' }; };
export const blockcheck_diag_domains = function(input) {
	if (input && input.set === true) { let checked = model.blockcheck_request_validate({ mode: 'quick', domains: input.domains }); if (!checked.ok) return checked; writefile(DOMAIN_FILE, sprintf('%J', checked.value.domains) + '\n'); return { ok: true, domains: checked.value.domains, source: 'manager-configured' }; }
	let raw = readfile(DOMAIN_FILE), domains = DEFAULT_DOMAINS; if (raw) try { let parsed = json(raw), checked = model.blockcheck_request_validate({ mode: 'quick', domains: parsed }); if (checked.ok) domains = checked.value.domains; } catch (e) { }
	return { ok: true, domains: domains, source: raw ? 'manager-configured' : 'catalog-defaults' };
};
export const blockcheck_diag_traceroute = function(input) {
	let host = input && input.host; if (type(host) != 'string' || !match(host, /^[A-Za-z0-9.-]{1,253}$/)) return error('EINPUT', 'traceroute host is invalid');
	let result = run('traceroute -m 12 -w 1 ' + quote(host));
	return { ok: true, host: host, available: length(result) > 0, output: substr(result, 0, 8192), provenance: { product: 'blockcheck', probe: 'traceroute' } };
};

export const blockcheck_diag_mark_running = function(id, runnerPid) { let job = read(id); if (!job) return error('ESTATE', 'job not found'); if (!attach_identity(job, 'runner', runnerPid, 'blockcheck-diagnostic-run.sh')) return error('EOWNERSHIP', 'runner identity is not verifiable'); job.status = 'running'; job.phase = 'probes'; job.startedAt = now(); save_record(job); return { ok: true }; };
export const blockcheck_diag_mark_child = function(id, childPid) { let job = read(id); if (!job || owned(job, 'runner') == null) return error('EOWNERSHIP', 'runner identity is not owned'); if (!attach_identity(job, 'child', childPid, 'blockcheck2-diagnostic-probe')) return error('EOWNERSHIP', 'probe identity is not verifiable'); save_record(job); return { ok: true }; };
export const blockcheck_diag_mark_progress = function(id, progress, total, phase) { let job = read(id); if (!job || TERMINAL[job.status]) return error('ESTATE', 'job is not running'); job.progress = progress; job.total = total; job.phase = substr('' + phase, 0, 64); job.evidenceCount = length(evidence_lines(id)); save_record(job); return { ok: true }; };
export const blockcheck_diag_mark_finished = function(id, status, message) { let job = read(id); if (!job) return error('ESTATE', 'job not found'); job.status = status; job.phase = status; job.finishedAt = now(); job.recovery = { state: 'verified' }; if (message) job.error = { code: status == 'cancelled' ? 'ECANCELLED' : 'EPROBE', message: substr('' + message, 0, 256) }; job.evidenceCount = length(evidence_lines(id)); save_record(job); return { ok: true }; };

let command = ARGV[0];
if (command != null) {
	let bootstrap = popen('/usr/libexec/zapret2-manager/z2m-root-bootstrap runtime 2>/dev/null', 'r'); if (!bootstrap || bootstrap.close() != 0) exit(1);
	let input = null; if (ARGV[1]) { let raw = readfile(ARGV[1]); try { input = raw ? json(raw) : null; } catch (e) { input = null; } }
	let answer = command == 'start' ? blockcheck_diag_start(input) : command == 'status' ? blockcheck_diag_status() : command == 'results' ? blockcheck_diag_results(input) : command == 'stop' ? blockcheck_diag_stop(input) : command == 'domains' ? blockcheck_diag_domains(input) : command == 'traceroute' ? blockcheck_diag_traceroute(input) : command == 'mark-running' ? blockcheck_diag_mark_running(ARGV[1], +ARGV[2]) : command == 'mark-child' ? blockcheck_diag_mark_child(ARGV[1], +ARGV[2]) : command == 'mark-progress' ? blockcheck_diag_mark_progress(ARGV[1], +ARGV[2], +ARGV[3], ARGV[4]) : command == 'mark-finished' ? blockcheck_diag_mark_finished(ARGV[1], ARGV[2], ARGV[3]) : error('EINPUT', 'unknown command');
	print(sprintf('%J', answer) + '\n');
}
