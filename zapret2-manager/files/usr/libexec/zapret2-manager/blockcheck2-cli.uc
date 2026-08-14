'use strict';

import { readfile, writefile, stat, unlink, popen, lsdir, readlink } from 'fs';
import * as model from './blockcheck2-model.uc';

const ROOT = '/tmp/zapret2-manager/jobs';
const RUNNER = '/usr/libexec/zapret2-manager/blockcheck2-run.sh';
const TERMINAL = { completed: true, cancelled: true, error: true };
const MAX_OUTPUT = 262144;

function object(value) { return type(value) == 'object' && value != null; }
function path(id, suffix) { return ROOT + '/' + id + (suffix || '.json'); }
function err(code, message) { return { ok: false, error: { code: code, message: message } }; }
function read(id) { if (type(id) != 'string' || !match(id, /^bc2-[0-9]+-[0-9]+$/)) return null; let raw = readfile(path(id)); if (!raw) return null; try { let value = json(raw); return object(value) && value.id == id ? value : null; } catch (e) { return null; } }
function save_record(job) { writefile(path(job.id), sprintf('%J', job) + '\n'); }
function seq() { let raw = readfile(ROOT + '/.bc2-seq'), n = raw ? (+trim(raw) || 0) : 0; n++; writefile(ROOT + '/.bc2-seq', '' + n + '\n'); return n; }
function shell(value) { let s = '' + value, out = "'"; for (let i = 0; i < length(s); i++) out += substr(s, i, 1) == "'" ? "'\\''" : substr(s, i, 1); return out + "'"; }
function command(cmd) { let p = popen(cmd + ' 2>/dev/null', 'r'); if (!p) return ''; let value = p.read('all') || ''; p.close(); return value; }
function process_identity(pid) {
	if (type(pid) != 'int' || pid <= 0 || !stat('/proc/' + pid)) return null;
	let raw = readfile('/proc/' + pid + '/stat'), close = raw ? index(raw, ')') : -1;
	if (close < 0) return null;
	let fields = split(trim(substr(raw, close + 1)), ' '), start = length(fields) > 19 ? +fields[19] : 0;
	if (!start) return null;
	return { pid: pid, startTime: start, exe: readlink('/proc/' + pid + '/exe') || '', cmdline: readfile('/proc/' + pid + '/cmdline') || '' };
}
function attach_identity(job, field, pid, fingerprint) {
	let value = process_identity(pid); if (!value) return false;
	value.fingerprint = fingerprint; job[field] = value; return true;
}
function owned(job, field, fingerprint) {
	let expected = job[field], actual = object(expected) ? process_identity(expected.pid) : null;
	if (!actual || actual.startTime != expected.startTime || (expected.exe && actual.exe != expected.exe)) return null;
	return expected.fingerprint == fingerprint && index(actual.cmdline, fingerprint) >= 0 ? actual : null;
}
function kill_owned(job, field, fingerprint) {
	let value = owned(job, field, fingerprint); if (!value) return false;
	command('kill -TERM ' + value.pid);
	return true;
}
function recover(job) {
	if (!job || TERMINAL[job.status]) return job;
	if (owned(job, 'runner', 'blockcheck2-run.sh')) return job;
	kill_owned(job, 'child', 'blockcheck2.sh');
	job.status = 'error'; job.phase = 'recovery'; job.recovery = { state: 'uncertain', reason: 'owned BlockCheck2 runner disappeared' };
	job.error = { code: 'ESTALE', message: 'stale BlockCheck2 worker recovered fail-closed' }; job.finishedAt = time(); save_record(job); return job;
}
function latest() { let names = lsdir(ROOT), out = null; if (type(names) != 'array') return null; for (let name in names) if (substr(name, 0, 4) == 'bc2-' && substr(name, -5) == '.json') { let j = read(substr(name, 0, length(name) - 5)); if (j && (out == null || j.createdAt > out.createdAt)) out = j; } return recover(out); }
function active() { let j = latest(); return j && !TERMINAL[j.status] ? j : null; }
function public_job(job) { if (!job) return null; return { id: job.id, product: 'blockcheck2', status: job.status, phase: job.phase, mode: job.request.mode, domains: job.request.domains, options: job.request.options, script: job.script, progress: job.progress, total: job.total, startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode, error: job.error, recovery: job.recovery, outputCursor: job.outputCursor || 0, parsed: job.parsed || null }; }
function script_candidates() { return ['/opt/zapret2/blockcheck2.sh', '/opt/zapret2/blockcheck.sh', '/opt/zapret/blockcheck2.sh']; }
function find_script() { let candidates = script_candidates(), found = []; for (let p in candidates) if (stat(p)) push(found, p); return found; }
function output_state(job, cursor) {
	let raw = readfile(path(job.id, '.log')) || '', base = 0;
	if (length(raw) > MAX_OUTPUT) { base = length(raw) - MAX_OUTPUT; raw = substr(raw, base); }
	let requested = type(cursor) == 'int' && cursor >= 0 ? cursor : base;
	if (requested < base) return { ok: true, cursor: base, nextCursor: base, reset: true, chunk: '', terminal: TERMINAL[job.status] == true };
	if (requested > base + length(raw)) requested = base + length(raw);
	let local = requested - base, max = 65536, take = length(raw) - local > max ? max : length(raw) - local;
	let chunk = take > 0 ? substr(raw, local, take) : '';
	return { ok: true, cursor: requested, nextCursor: requested + length(chunk), chunk: chunk, terminal: TERMINAL[job.status] == true, exitCode: job.exitCode };
}
function parse(job) { let raw = readfile(path(job.id, '.log')) || ''; return model.blockcheck2_parse_output(raw); }

export const blockcheck2_script = function() { let found = find_script(); return { ok: true, found: length(found) > 0, scripts: found, selected: length(found) ? found[0] : null, candidates: script_candidates(), serverOwned: true }; };
export const blockcheck2_start = function(input) {
	if (active()) return err('ECONFLICT', 'BlockCheck2 is already running');
	let value = object(input) ? input : {}, built = model.blockcheck2_env_build(value); if (!built.ok) return built;
	let scripts = find_script(); if (!length(scripts)) return err('EDEPENDENCY', 'official blockcheck2.sh is unavailable');
	let id = 'bc2-' + time() + '-' + seq(), request = { mode: value.mode, domains: built.domains, options: object(value.options) ? value.options : {} };
	let job = { id: id, product: 'blockcheck2', request: request, script: scripts[0], status: 'pending', phase: 'queued', progress: 0, total: 0,
		createdAt: time(), startedAt: null, finishedAt: null, runner: null, child: null, exitCode: null, error: null, recovery: { state: 'not_required' }, outputCursor: 0, parsed: null };
	save_record(job); writefile(path(id, '.log'), '');
	let env = 'SCRIPT=' + shell(scripts[0]) + '\nTIMEOUT=2400\n'; for (let key in built.env) env += key + '=' + shell(built.env[key]) + '\n'; writefile(path(id, '.env'), env);
	let pid = +trim(command('setsid ash ' + shell(RUNNER) + ' ' + shell(id) + ' </dev/null >/dev/null 2>&1 & echo $!')); if (!pid) { job.status = 'error'; job.error = { code: 'EDEPENDENCY', message: 'BlockCheck2 runner did not start' }; job.finishedAt = time(); save_record(job); return err('EDEPENDENCY', 'BlockCheck2 runner did not start'); }
	if (!attach_identity(job, 'runner', pid, 'blockcheck2-run.sh')) { job.status = 'error'; job.error = { code: 'EOWNERSHIP', message: 'BlockCheck2 runner identity is not verifiable' }; job.finishedAt = time(); save_record(job); return err('EOWNERSHIP', 'BlockCheck2 runner identity is not verifiable'); }
	save_record(job); return { ok: true, job: public_job(job) };
};
export const blockcheck2_status = function() { return { ok: true, job: public_job(latest()) }; };
export const blockcheck2_output = function(input) { let job = input && input.id ? read(input.id) : latest(); if (!job) return { ok: true, output: null }; job = recover(job); let cursor = input && input.cursor; let out = output_state(job, cursor); out.id = job.id; out.product = 'blockcheck2'; return out; };
export const blockcheck2_stop = function(input) { let job = input && input.id ? read(input.id) : active(); if (!job) return { ok: true, status: 'idle' }; job = recover(job); if (TERMINAL[job.status]) return err('ESTATE', 'BlockCheck2 is already terminal'); if (!owned(job, 'runner', 'blockcheck2-run.sh')) return err('EOWNERSHIP', 'BlockCheck2 runner identity is not owned'); writefile(path(job.id, '.cancel'), '' + time() + '\n'); job.status = 'cancelling'; job.phase = 'cancelling'; save_record(job); command('kill -TERM -' + job.runner.pid); return { ok: true, id: job.id, status: 'cancelling' }; };
export const blockcheck2_results = function(input) { let job = input && input.id ? read(input.id) : latest(); if (!job) return { ok: true, results: null }; job = recover(job); let parsed = job.parsed || parse(job); let strategies = []; if (parsed.outcome == 'found') for (let found in parsed.found) { let converted = model.blockcheck2_strategy_from_found(found); if (converted.ok) push(strategies, converted.strategy); } return { ok: true, result: { schema: 1, id: job.id, product: 'blockcheck2', status: job.status, parse: parsed, strategies: strategies, handoff: length(strategies) ? { previewRequired: true, validateRequired: true, applyAuthority: 'strategy' } : null } }; };
export const blockcheck2_mark_running = function(id, pid) { let job = read(id); if (!job) return err('ESTATE', 'job not found'); if (!attach_identity(job, 'runner', pid, 'blockcheck2-run.sh')) return err('EOWNERSHIP', 'runner identity is not verifiable'); job.status = 'running'; job.phase = 'running'; job.startedAt = time(); save_record(job); return { ok: true }; };
export const blockcheck2_mark_child = function(id, pid) { let job = read(id); if (!job || !owned(job, 'runner', 'blockcheck2-run.sh')) return err('EOWNERSHIP', 'runner is not owned'); if (!attach_identity(job, 'child', pid, 'blockcheck2.sh')) return err('EOWNERSHIP', 'BlockCheck2 child identity is not verifiable'); save_record(job); return { ok: true }; };
export const blockcheck2_mark_finished = function(id, rc, finalStatus) { let job = read(id); if (!job) return err('ESTATE', 'job not found'); job.exitCode = rc; job.status = finalStatus || (rc == 0 ? 'completed' : 'error'); job.phase = job.status; job.finishedAt = time(); job.recovery = { state: 'verified' }; job.parsed = parse(job); if (job.status == 'completed' && job.parsed.outcome == 'parser_error') job.status = 'error'; if (job.status == 'error' && !job.error) job.error = { code: job.parsed.outcome == 'parser_error' ? 'EPARSER' : 'EUPSTREAM', message: 'official BlockCheck2 execution did not produce a valid terminal result' }; save_record(job); return { ok: true }; };

let commandName = ARGV[0];
if (commandName != null) { let boot = popen('/usr/libexec/zapret2-manager/z2m-root-bootstrap runtime 2>/dev/null', 'r'); if (!boot || boot.close() != 0) exit(1); let input = null; if (ARGV[1]) { let raw = readfile(ARGV[1]); try { input = raw ? json(raw) : null; } catch (e) { input = null; } } let answer = commandName == 'script' ? blockcheck2_script() : commandName == 'start' ? blockcheck2_start(input) : commandName == 'status' ? blockcheck2_status() : commandName == 'output' ? blockcheck2_output(input) : commandName == 'stop' ? blockcheck2_stop(input) : commandName == 'results' ? blockcheck2_results(input) : commandName == 'mark-running' ? blockcheck2_mark_running(ARGV[1], +ARGV[2]) : commandName == 'mark-child' ? blockcheck2_mark_child(ARGV[1], +ARGV[2]) : commandName == 'mark-finished' ? blockcheck2_mark_finished(ARGV[1], +ARGV[2], ARGV[3]) : err('EINPUT', 'unknown command'); print(sprintf('%J', answer) + '\n'); }
