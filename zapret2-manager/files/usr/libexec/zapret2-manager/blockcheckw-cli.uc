'use strict';

import { readfile, writefile, stat, unlink, popen, lsdir, readlink, open } from 'fs';
import * as model from './blockcheckw-model.uc';
import * as model_b2 from './blockcheck2-model.uc';
import * as catalog from './strategy-catalog.uc';

const ROOT = '/tmp/zapret2-manager/jobs';
const RUNNER = '/usr/libexec/zapret2-manager/blockcheckw-run.sh';
const INSTALLER = '/usr/libexec/zapret2-manager/blockcheckw-install.sh';
const TERMINAL = { completed: true, cancelled: true, error: true };
const CANDIDATES = ['/usr/bin/blockcheckw', '/usr/sbin/blockcheckw', '/opt/blockcheckw/blockcheckw', '/usr/libexec/zapret2-manager/blockcheckw'];

function object(value) { return type(value) == 'object' && value != null; }
function path(id, suffix) { return ROOT + '/' + id + (suffix || '.json'); }
function safe_id(id) { return type(id) == 'string' && match(id, /^bcw-[0-9]+-[0-9]+$/); }
function read(id) { if (!safe_id(id)) return null; let raw = readfile(path(id)); if (!raw) return null; try { let value = json(raw); return object(value) && value.id == id ? value : null; } catch (e) { return null; } }
function save(job) { writefile(path(job.id), sprintf('%J', job) + '\n'); }
function seq() { let raw = readfile(ROOT + '/.bcw-seq'), n = raw ? (+trim(raw) || 0) : 0; n++; writefile(ROOT + '/.bcw-seq', '' + n + '\n'); return n; }
function quote(value) { let out = "'", text = '' + value; for (let i = 0; i < length(text); i++) out += substr(text, i, 1) == "'" ? "'\\''" : substr(text, i, 1); return out + "'"; }
function run(command) { let p = popen(command + ' 2>/dev/null', 'r'); if (!p) return ''; let out = p.read('all') || ''; p.close(); return out; }
function binary_list() { let out = []; for (let item in CANDIDATES) if (stat(item)) push(out, item); return out; }
function binary() { let list = binary_list(); return length(list) ? list[0] : null; }
function version(pathname) { let out = run(quote(pathname) + ' --version'), line = trim(split(out, '\n')[0]); return length(line) > 128 ? substr(line, 0, 128) : line; }
function proc_cmdline(pid) { let f = open('/proc/' + pid + '/cmdline', 'r'); if (!f) return ''; let c = f.read(4096) || ''; f.close(); return c; }
function identity(pid) { if (type(pid) != 'int' || pid <= 0 || !stat('/proc/' + pid)) return null; let raw = readfile('/proc/' + pid + '/stat'), close = raw ? index(raw, ')') : -1; if (close < 0) return null; let fields = split(trim(substr(raw, close + 1)), ' '), start = length(fields) > 19 ? +fields[19] : 0; return start ? { pid: pid, startTime: start, exe: readlink('/proc/' + pid + '/exe') || '', cmdline: proc_cmdline(pid) } : null; }
function attach(job, field, pid, marker) { let value = identity(pid); if (!value) return false; value.fingerprint = marker; job[field] = value; return true; }
function owned(job, field, marker) { let expected = job[field], actual = object(expected) ? identity(expected.pid) : null; return actual && actual.startTime == expected.startTime && (!expected.exe || actual.exe == expected.exe) && expected.fingerprint == marker && index(actual.cmdline, marker) >= 0 ? actual : null; }
function recover(job) { if (!job || TERMINAL[job.status]) return job; if (owned(job, 'runner', 'blockcheckw-run.sh')) return job; let child = owned(job, 'child', 'blockcheckw'); if (child) run('kill -TERM ' + child.pid); job.status = 'error'; job.phase = 'recovery'; job.recovery = { state: 'uncertain' }; job.error = { code: 'ESTALE', message: 'stale BlockCheckW worker recovered fail-closed' }; job.finishedAt = time(); save(job); return job; }
function latest() { let names = lsdir(ROOT), out = null; if (type(names) != 'array') return null; for (let name in names) if (substr(name, 0, 4) == 'bcw-' && substr(name, -5) == '.json') { let j = read(substr(name, 0, length(name) - 5)); if (j && (out == null || j.createdAt > out.createdAt)) out = j; } return recover(out); }
function active() { let j = latest(); return j && !TERMINAL[j.status] ? j : null; }
function extract_progress(job) {
	if (!job || (job.status != 'running' && job.status != 'pending')) return { progress: job.progress, total: job.total, phase: job.phase };
	let raw = readfile(path(job.id, '.log')) || '';
	let lines = split(raw, '\n'), curPhase = job.phase, tot = job.total, prog = job.progress;
	let httpDone = false, httpElapsed = 416;
	for (let line in lines) {
		if (index(line, 'Scanning HTTP') >= 0) curPhase = 'HTTP';
		if (index(line, 'Scanning HTTPS/TLS1.2') >= 0) curPhase = 'HTTPS/TLS1.2';
		if (index(line, 'Scanning HTTPS/TLS1.3') >= 0) curPhase = 'HTTPS/TLS1.3';
		let mStart = match(line, /\[START\] Scanning ([^:]+): ([0-9]+) items/);
		if (mStart) { curPhase = mStart[1]; tot = +mStart[2]; }
		let mDone = match(line, /completed:\s*([0-9]+).*?([0-9.]+)s/);
		if (mDone) {
			if (curPhase == 'HTTP') { httpDone = true; httpElapsed = +mDone[2] || 416; }
		}
	}
	if (job.status == 'running' && job.startedAt && tot > 0) {
		let now = time(), phaseElapsed = 0;
		if (curPhase == 'HTTP') phaseElapsed = now - job.startedAt;
		else if (curPhase == 'HTTPS/TLS1.2') phaseElapsed = now - (job.startedAt + httpElapsed);
		else if (curPhase == 'HTTPS/TLS1.3') phaseElapsed = now - (job.startedAt + httpElapsed + 3700);
		if (phaseElapsed > 0) {
			let est = int(phaseElapsed * 2.32);
			if (est > tot - 5) est = tot - 5;
			if (est > 0) prog = est;
		}
	}
	return { progress: prog, total: tot, phase: curPhase };
}
function pub(job) {
	if (!job) return null;
	let dynamic = extract_progress(job);
	return { id: job.id, product: 'blockcheckw', engine: job.request.engine, status: job.status, phase: dynamic.phase, progress: dynamic.progress, total: dynamic.total, request: job.request, binary: job.binary, provider: job.provider, outputCursor: job.outputCursor || 0, startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error, recovery: job.recovery };
}
function error(code, message) { return { ok: false, error: { code: code, message: message } }; }
function request(input) { let value = object(input) ? input : {}; let copy = {}; for (let key in value) copy[key] = value[key]; if (copy.engine == 'status' && copy.domain_list == null) copy.domain_list = copy.domains; if (copy.engine == 'universal' && copy.domain_list == null) copy.domain_list = copy.domains; return model.blockcheckw_request_validate(copy); }
function provider() { let pathValue = binary(), nfq = stat('/opt/zapret2/nfq2/nfqws2') || stat('/opt/zapret2/nfqws2') ? true : false; return { ok: true, provider: 'blockcheckw', installed: pathValue != null, installedVersion: pathValue ? version(pathValue) : null, latestVersion: null, latestCompatibleVersion: null, selectedVersion: pathValue ? version(pathValue) : null, compatibility: pathValue == null ? 'UNKNOWN' : (nfq ? 'VERIFIED' : 'INCOMPATIBLE'), dependency: { nfqws2: nfq, status: nfq ? 'present' : 'missing' }, binary: pathValue, candidates: CANDIDATES, updatePolicy: 'manual-only', upstream: { repository: 'rcd27/blockcheckw', revision: 'd6f96719a6d555304aa565cd820699ef1de9515f' } }; }
function latest_release() { let raw = run('uclient-fetch -q -O - https://api.github.com/repos/rcd27/blockcheckw/releases/latest'), value = null; try { value = raw ? json(raw) : null; } catch (e) { value = null; } return object(value) && type(value.tag_name) == 'string' && match(value.tag_name, /^v[0-9]+\.[0-9]+\.[0-9]+$/) ? value.tag_name : null; }
export const blockcheckw_provider_status = function() { return provider(); };
export const blockcheckw_update_check = function() { let value = provider(), latest = latest_release(); value.latestVersion = latest; value.latestCompatibleVersion = latest; value.updateCheck = latest == null ? { state: 'UNKNOWN', source: 'github-releases-api' } : { state: 'VERIFIED', source: 'github-releases-api' }; return value; };
export const blockcheckw_install = function(input) { let value = object(input) ? input : {}; if (type(value.version) != 'string' || !match(value.version, /^v[0-9]+\.[0-9]+\.[0-9]+$/)) return error('EINPUT', 'version must be an explicit upstream release tag'); if (!stat(INSTALLER)) return error('EDEPENDENCY', 'BlockCheckW installer is unavailable'); let out = run(quote(INSTALLER) + ' ' + quote(value.version)), result = null; try { result = out ? json(out) : null; } catch (e) { result = null; } return object(result) ? result : error('EIO', 'BlockCheckW installer returned malformed output'); };
export const blockcheckw_script = function() { let value = provider(); value.commands = ['status', 'scan', 'universal', 'check', 'benchmark']; return value; };
export const blockcheckw_start = function(input) {
	if (active()) return error('ECONFLICT', 'BlockCheckW is already running');
	let checked = request(input); if (!checked.ok) return checked;
	let binaryPath = binary(); if (!binaryPath) return error('EDEPENDENCY', 'BlockCheckW binary is unavailable');
	if (!stat(RUNNER)) return error('EDEPENDENCY', 'BlockCheckW runner is unavailable');
	let value = checked.value, sourceReport = null;
	if (value.engine == 'check') {
		if (!value.source_job) return error('EINPUT', 'check requires source_job from a completed BlockCheckW report');
		let source = read(value.source_job); sourceReport = source ? path(source.id, '.report') : null;
		if (!sourceReport || !stat(sourceReport)) return error('ESTATE', 'source BlockCheckW report is unavailable');
	}
	let id = 'bcw-' + time() + '-' + seq(), domains = length(value.domain_list) ? value.domain_list : value.domains;
	let job = { id: id, product: 'blockcheckw', request: value, binary: binaryPath, provider: provider(), status: 'pending', phase: 'queued', progress: 0, total: length(domains), createdAt: time(), startedAt: null, finishedAt: null, runner: null, child: null, exitCode: null, error: null, recovery: { state: 'not_required' }, outputCursor: 0 };
	save(job); writefile(path(id, '.domains'), join('\n', domains) + '\n'); writefile(path(id, '.log'), '');

	let stratFile = '';
	if (value.engine == 'scan' && (value.strategy_source == 'catalog_quick' || value.strategy_source == 'catalog_standard')) {
		let set = value.strategy_source == 'catalog_quick' ? 'quick' : 'standard';
		let list = catalog.strategy_catalog_list('tcp', set);
		let rawLines = [];
		for (let i = 0; i < length(list); i++) {
			let entry = list[i];
			let a = entry.args || entry.raw || (entry.profiles ? entry.profiles[0]?.args : '') || '';
			if (a) push(rawLines, a);
		}
		let serialized = model_b2.blockcheck2_custom_list_serialize(rawLines);
		if (serialized.ok && length(serialized.lines) > 0) {
			stratFile = path(id, '.strategies');
			writefile(stratFile, join('\n', serialized.lines) + '\n');
		}
	}

	let env = 'BINARY=' + quote(binaryPath) + '\nENGINE=' + quote(value.engine) + '\nWORKERS=' + value.workers + '\nTIMEOUT=' + (value.timeout > 0 ? value.timeout : 7200) + '\nDOMAINS_FILE=' + quote(path(id, '.domains')) + '\nSOURCE_REPORT=' + quote(sourceReport || '') + '\nREPORT=' + quote(path(id, '.report')) + '\nPROTOCOLS=' + quote(value.protocols) + '\nDNS=' + quote(value.dns || 'auto') + '\nFROM_STRATEGIES_FILE=' + quote(stratFile) + '\nPASSES=' + value.passes + '\nSAMPLE=' + value.sample + '\n';
	writefile(path(id, '.env'), env);
	let pid = +trim(run('setsid ash ' + quote(RUNNER) + ' ' + quote(id) + ' </dev/null >/dev/null 2>&1 & echo $!')); if (!pid || !attach(job, 'runner', pid, 'blockcheckw-run.sh')) { job.status = 'error'; job.error = { code: 'EOWNERSHIP', message: 'BlockCheckW runner identity is not verifiable' }; job.finishedAt = time(); save(job); return error('EOWNERSHIP', 'BlockCheckW runner identity is not verifiable'); }
	save(job); return { ok: true, job: pub(job) };
};
export const blockcheckw_status = function() { return { ok: true, job: pub(latest()), provider: provider() }; };
export const blockcheckw_output = function(input) { let job = input && input.id ? read(input.id) : latest(); if (!job) return { ok: true, output: null }; let raw = readfile(path(job.id, '.log')) || '', cursor = input && type(input.cursor) == 'int' && input.cursor >= 0 ? input.cursor : 0; if (cursor > length(raw)) cursor = length(raw); let chunk = substr(raw, cursor, 65536); return { ok: true, id: job.id, cursor: cursor, nextCursor: cursor + length(chunk), chunk: chunk, terminal: TERMINAL[job.status] == true, exitCode: job.exitCode }; };
export const blockcheckw_stop = function(input) { let job = input && input.id ? read(input.id) : active(); if (!job) return { ok: true, status: 'idle' }; job = recover(job); if (TERMINAL[job.status]) return error('ESTATE', 'BlockCheckW job is already terminal'); if (!owned(job, 'runner', 'blockcheckw-run.sh')) return error('EOWNERSHIP', 'BlockCheckW runner is not owned'); writefile(path(job.id, '.cancel'), '' + time() + '\n'); job.status = 'cancelling'; job.phase = 'cancelling'; save(job); run('kill -TERM -' + job.runner.pid); unlink(path(job.id, '.strategies')); return { ok: true, id: job.id, status: 'cancelling' }; };
export const blockcheckw_events = function(input) {
	let job = input && input.id ? read(input.id) : latest();
	if (!job) return { ok: true, events: [], cursor: 0 };
	let eventsPath = path(job.id, '.events.jsonl');
	let raw = readfile(eventsPath) || '';
	let log = readfile(path(job.id, '.log')) || '';
	let lines = split(log, '\n');
	let discovered = [];
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		let m = match(line, /\[OK\]\s*(HTTP|TLS1\.2|TLS1\.3|UDP)?\s*:\s*(.+)/);
		if (m) {
			let proto = m[1] ? (index(m[1], 'UDP') >= 0 ? 'udp' : 'tcp') : 'tcp';
			let args = trim(m[2]);
			push(discovered, {
				event: 'DISCOVERED',
				provider: 'blockcheckw',
				protocol: proto,
				domain: job.request.domains?.[0] || 'target',
				args: args,
				discoveryIndex: length(discovered) + 1,
				at: time()
			});
		}
	}
	if (length(discovered) > 0) {
		let out = '';
		for (let ev in discovered) out += sprintf('%J\n', ev);
		writefile(eventsPath, out);
		raw = out;
	}
	let cursor = input && type(input.cursor) == 'int' && input.cursor >= 0 ? input.cursor : 0;
	if (cursor > length(raw)) cursor = length(raw);
	let chunk = substr(raw, cursor);
	let evLines = split(chunk, '\n');
	let events = [];
	for (let i = 0; i < length(evLines); i++) {
		let l = trim(evLines[i]);
		if (l != '') {
			try {
				let ev = json(l);
				if (object(ev)) push(events, ev);
			} catch (e) { }
		}
	}
	return {
		ok: true,
		id: job.id,
		cursor: cursor,
		nextCursor: cursor + length(chunk),
		events: events,
		terminal: TERMINAL[job.status] == true
	};
};
export const blockcheckw_results = function(input) { let job = input && input.id ? read(input.id) : latest(); if (!job) return { ok: true, result: null }; job = recover(job); let raw = readfile(path(job.id, '.report')) || ''; if (!raw) return { ok: true, result: { schema: 1, id: job.id, product: 'blockcheckw', status: job.status, outcome: job.status == 'completed' ? 'parser_error' : 'infrastructure', error: job.error, findings: [], strategies: [] } }; let parsed = model.blockcheckw_parse_report(raw, job.request.engine); if (!parsed.ok) return { ok: true, result: { schema: 1, id: job.id, product: 'blockcheckw', status: job.status, outcome: 'parser_error', error: parsed.error, findings: [], strategies: [] } }; let converted = []; for (let entry in parsed.strategies) { let handoff = model.blockcheckw_strategy_from_entry(entry, entry.provenance.report.domain); if (handoff.ok) push(converted, handoff.strategy); } return { ok: true, result: { schema: 1, id: job.id, product: 'blockcheckw', status: job.status, outcome: 'report', engine: job.request.engine, report: parsed.report, findings: parsed.findings, strategies: converted, handoff: length(converted) ? { previewRequired: true, validateRequired: true, applyAuthority: 'strategy' } : null } }; };
export const blockcheckw_mark_running = function(id, pid) { let job = read(id); if (!job) return error('ESTATE', 'job not found: ' + id); let ident = identity(pid); if (!ident) return error('EOWNERSHIP', 'ident failed for pid ' + pid); if (!attach(job, 'runner', pid, 'blockcheckw-run.sh')) return error('EOWNERSHIP', 'BlockCheckW runner identity is not verifiable'); job.status = 'running'; job.phase = 'running'; job.startedAt = time(); save(job); return { ok: true }; };
export const blockcheckw_mark_child = function(id, pid) { let job = read(id); if (!job || !owned(job, 'runner', 'blockcheckw-run.sh') || !attach(job, 'child', pid, 'blockcheckw')) return error('EOWNERSHIP', 'BlockCheckW child identity is not verifiable'); save(job); return { ok: true }; };
export const blockcheckw_mark_finished = function(id, rc, status) { let job = read(id); if (!job) return error('ESTATE', 'job not found'); job.exitCode = rc; job.status = status || (rc == 0 ? 'completed' : 'error'); job.phase = job.status; job.finishedAt = time(); job.recovery = { state: 'verified' }; save(job); return { ok: true }; };

let commandName = ARGV[0];
if (commandName != null) { let input = null; if (ARGV[1]) { let raw = readfile(ARGV[1]); try { input = raw ? json(raw) : null; } catch (e) { input = null; } } let answer = commandName == 'provider-status' ? blockcheckw_provider_status() : commandName == 'update-check' ? blockcheckw_update_check() : commandName == 'install' ? blockcheckw_install(input) : commandName == 'script' ? blockcheckw_script() : commandName == 'start' ? blockcheckw_start(input) : commandName == 'status' ? blockcheckw_status() : commandName == 'output' ? blockcheckw_output(input) : commandName == 'events' ? blockcheckw_events(input) : commandName == 'results' ? blockcheckw_results(input) : commandName == 'stop' ? blockcheckw_stop(input) : commandName == 'mark-running' ? blockcheckw_mark_running(ARGV[1], +ARGV[2]) : commandName == 'mark-child' ? blockcheckw_mark_child(ARGV[1], +ARGV[2]) : commandName == 'mark-finished' ? blockcheckw_mark_finished(ARGV[1], +ARGV[2], ARGV[3]) : error('EINPUT', 'unknown command'); print(sprintf('%J', answer) + '\n'); }
