'use strict';
// jobs.uc — generic job infrastructure (SLICE 4) + the blockcheck wrapper.
// Mirrors tests/lib/jobs-logic.mjs (v2 lifecycle) and
// tests/lib/blockcheck-logic.mjs (mode env, domain validation, summary
// parsing). Records: one JSON file per job in /tmp/zapret2-manager/jobs/.
//
// Contract (docs/contracts/ubus.md "Long operations"):
//   pending → running → succeeded | failed
//           (any non-terminal) → cancelled
//           (any) → rolled_back   (reserved; used by future rollback jobs)
//           (succeeded|failed) → expired
// Transitions are forward-only; an invalid move returns null (never a silent
// no-op). The scanner (/opt/zapret2/blockcheck2.sh) is CALLED, never
// reimplemented. Cancel sends INT so the scanner unpreparse its own firewall
// artifacts. No fabricated progress percentage — elapsed seconds only.

import { readfile, writefile, stat, unlink, popen, mkdir, lsdir } from 'fs';

const JDIR = '/tmp/zapret2-manager/jobs';
const RUNNER = '/usr/libexec/zapret2-manager/blockcheck-run.sh';
const SCANNER = '/opt/zapret2/blockcheck2.sh';
const JOB_TTL_SEC = 600;
const JOB_MAX_HISTORY = 10;
const LOG_TAIL_BYTES = 4096;
const LOG_MAX_BYTES = 262144;
const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'rolled_back', 'expired'];

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function err(code, message) {
	return { ok: false, error: { code: code, message: message } };
}

function is_terminal(status) {
	return (status == 'succeeded' || status == 'failed' || status == 'cancelled'
		|| status == 'rolled_back' || status == 'expired');
}

// ---------------------------------------------------------------------------
// record IO
// ---------------------------------------------------------------------------
function ensure_jdir() {
	try { mkdir('/tmp/zapret2-manager'); } catch (e) { }
	try { mkdir(JDIR); } catch (e) { }
}

function record_path(id) { return JDIR + '/' + id + '.json'; }

function write_record(job) {
	ensure_jdir();
	writefile(record_path(job.id), sprintf("%J", job) + '\n');
}

function parse_record(raw) {
	if (!raw) return { ok: false, malformed: true, reason: 'empty record' };
	let obj = null;
	try { obj = json(raw); } catch (e) { return { ok: false, malformed: true, reason: 'not valid JSON' }; }
	if (type(obj) != 'object' || obj == null || type(obj.id) != 'string')
		return { ok: false, malformed: true, reason: 'record missing id' };
	let known = false;
	for (let i = 0; i < length(JOB_STATUSES); i++) if (obj.status == JOB_STATUSES[i]) known = true;
	if (!known) return { ok: false, malformed: true, reason: 'unknown status' };
	return { ok: true, record: obj };
}

function read_record(id) {
	if (type(id) != 'string' || index(id, '/') >= 0 || index(id, '..') >= 0) return null;
	let raw = readfile(record_path(id));
	let pr = parse_record(raw);
	return pr.ok ? pr.record : null;
}

// list_records() → array of { id, parsed: bool, record } in file order.
function list_records() {
	ensure_jdir();
	let names = lsdir(JDIR);
	let out = [];
	if (type(names) != 'array') return out;
	for (let i = 0; i < length(names); i++) {
		let n = names[i];
		if (substr(n, 0, 4) != 'job-') continue;
		if (substr(n, length(n) - 5) != '.json') continue;
		let id = substr(n, 0, length(n) - 5);
		let pr = parse_record(readfile(JDIR + '/' + n));
		if (pr.ok) push(out, { id: id, parsed: true, record: pr.record });
		else push(out, { id: id, parsed: false, record: null });
	}
	return out;
}

function sort_by_created(records) {
	for (let i = 1; i < length(records); i++) {
		let v = records[i];
		let j = i - 1;
		while (j >= 0 && (records[j].createdAt || 0) > (v.createdAt || 0)) { records[j + 1] = records[j]; j--; }
		records[j + 1] = v;
	}
	return records;
}

// ---------------------------------------------------------------------------
// transitions + sweep + crash recovery (lazy, on every public call)
// ---------------------------------------------------------------------------
function transition2(job, to, extra) {
	let ok = false;
	if (job.status == 'pending' && (to == 'running' || to == 'cancelled' || to == 'rolled_back')) ok = true;
	else if (job.status == 'running' && (to == 'succeeded' || to == 'failed' || to == 'cancelled' || to == 'rolled_back')) ok = true;
	else if ((job.status == 'succeeded' || job.status == 'failed' || job.status == 'cancelled') && to == 'expired') ok = true;
	if (!ok) return null;
	let now = time();
	job.status = to;
	if (to == 'running' && job.startedAt == null) job.startedAt = now;
	if (is_terminal(to) && job.finishedAt == null) job.finishedAt = now;
	if (type(extra) == 'object' && extra != null) {
		let ks = keys(extra);
		for (let i = 0; i < length(ks); i++) job[ks[i]] = extra[ks[i]];
	}
	return job;
}

function proc_alive(pid, fingerprint) {
	if (pid == null) return false;
	let d = '/proc/' + pid;
	if (!stat(d)) return false;
	if (fingerprint == null) return true;
	let cmd = readfile(d + '/cmdline');
	if (!cmd) return false;
	return (index(cmd, fingerprint) >= 0);
}

// crash_recover_all() — a non-terminal job whose runner is dead is failed
// (crash recovery); a surviving scanner child is INT-signalled so it
// unpreparse its own firewall artifacts.
function crash_recover_all() {
	let recs = list_records();
	for (let i = 0; i < length(recs); i++) {
		if (!recs[i].parsed) continue;
		let job = recs[i].record;
		if (is_terminal(job.status)) continue;
		if (proc_alive(job.runnerPid, 'blockcheck-run.sh')) continue;
		if (proc_alive(job.childPid, 'blockcheck2.sh')) {
			run('kill -INT -' + job.childPid + ' 2>/dev/null || kill -INT ' + job.childPid + ' 2>/dev/null');
		}
		let t = transition2(job, 'failed', { error: 'runner died (crash recovery)' });
		if (t) write_record(t);
	}
}

// sweep() — expire old terminal records, remove malformed files, cap history.
function sweep() {
	let recs = list_records();
	let now = time();
	let kept = [];
	// remove malformed record files (never kept, never preserved as valid)
	for (let i = 0; i < length(recs); i++) {
		if (!recs[i].parsed) { try { unlink(JDIR + '/' + recs[i].id + '.json'); } catch (e) { } continue; }
		let job = recs[i].record;
		if (is_terminal(job.status) && job.status != 'expired' && job.finishedAt != null
			&& (now - job.finishedAt) > JOB_TTL_SEC) {
			let t = transition2(job, 'expired', null);
			if (t) { write_record(t); job = t; }
		}
		push(kept, job);
	}
	if (length(kept) > JOB_MAX_HISTORY) {
		let sorted = sort_by_created(kept);
		let excess = length(kept) - JOB_MAX_HISTORY;
		let newkept = [];
		for (let i = 0; i < length(sorted); i++) {
			if (excess > 0 && is_terminal(sorted[i].status)) {
				try { unlink(record_path(sorted[i].id)); } catch (e) { }
				try { unlink(JDIR + '/' + sorted[i].id + '.log'); } catch (e) { }
				excess--;
				continue;
			}
			push(newkept, sorted[i]);
		}
		return newkept;
	}
	return kept;
}

// ---------------------------------------------------------------------------
// blockcheck logic mirrors (mode env, domain validation, summary parsing)
// ---------------------------------------------------------------------------
function mode_env(mode) {
	// timeouts empirically grounded (acceptance: a real 1-domain quick scan
	// was still mid-strategy-set at 304s on the target)
	if (mode == 'quick') return { scanlevel: 'quick', enableHttp: 1, enableTls12: 1, enableTls13: 0, enableHttp3: 0, repeats: 1, timeoutSec: 600 };
	if (mode == 'domains') return { scanlevel: 'standard', enableHttp: 1, enableTls12: 1, enableTls13: 0, enableHttp3: 0, repeats: 1, timeoutSec: 1200 };
	if (mode == 'full') return { scanlevel: 'force', enableHttp: 1, enableTls12: 1, enableTls13: 1, enableHttp3: 1, repeats: 1, timeoutSec: 2400 };
	return null;
}

function domain_chars_ok(d) {
	for (let i = 0; i < length(d); i++) {
		let c = ord(substr(d, i, 1));
		let ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)
			|| c == 46 || c == 95 || c == 126 || c == 47 || c == 37 || c == 43 || c == 45;
		if (!ok) return false;
	}
	return true;
}

function validate_domains(input) {
	// input: array or space-separated string → { ok, domains } | { ok:false, reason }
	let list = [];
	if (type(input) == 'array') list = input;
	else if (type(input) == 'string') {
		let parts = split(input, ' ');
		for (let i = 0; i < length(parts); i++) if (length(trim(parts[i]))) push(list, trim(parts[i]));
	} else {
		return { ok: false, reason: 'missing domains' };
	}
	let clean = [];
	for (let i = 0; i < length(list); i++) {
		let d = trim('' + list[i]);
		if (length(d)) push(clean, d);
	}
	if (length(clean) == 0) return { ok: false, reason: 'no domains given' };
	if (length(clean) > 10) return { ok: false, reason: 'too many domains (max 10)' };
	let total = 0;
	for (let i = 0; i < length(clean); i++) {
		total += length(clean[i]) + 1;
		if (total > 512) return { ok: false, reason: 'domains too long (total > 512)' };
		if (!domain_chars_ok(clean[i])) return { ok: false, reason: 'invalid characters in domain ' + clean[i] };
	}
	return { ok: true, domains: clean };
}

function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}

// parse_summary(logText) → { recommendations, summary, common } — mirrors
// tests/lib/blockcheck-logic.mjs. Manual prefix scanning (no regex).
function parse_success_line(l) {
	// !!!!! <testf>: working strategy found for ipv<N> <dom> : <daemon> <strategy> !!!!!
	if (substr(l, 0, 6) != '!!!!! ') return null;
	let tail = substr(l, length(l) - 6);
	if (tail != ' !!!!!' && tail != '!!!!!') return null;
	let body = substr(l, 6, length(l) - 12);
	let marker = ': working strategy found for ';
	let mp = index(body, marker);
	if (mp < 0) return null;
	let testf = substr(body, 0, mp);
	let rest = substr(body, mp + length(marker));
	let sp = index(rest, ' ');
	if (sp < 0) return null;
	let ipver = substr(rest, 0, sp);
	let rest2 = substr(rest, sp + 1);
	let sep = index(rest2, ' : ');
	if (sep < 0) return null;
	let dom = substr(rest2, 0, sep);
	let rest3 = substr(rest2, sep + 3);
	let sp2 = index(rest3, ' ');
	if (sp2 < 0) return null;
	return { test: testf, ipver: ipver, domain: dom, daemon: substr(rest3, 0, sp2), strategy: substr(rest3, sp2 + 1), raw: l };
}

function parse_summary(logText) {
	let lines = split(logText, '\n');
	let recommendations = [];
	let summary = [];
	let common = [];
	let section = 'run';
	for (let i = 0; i < length(lines); i++) {
		let l = lines[i];
		if (substr(l, length(l) - 1) == '\r') l = substr(l, 0, length(l) - 1);
		if (l == '* SUMMARY') { section = 'summary'; continue; }
		if (l == '* COMMON') { section = 'common'; continue; }
		let rec = parse_success_line(l);
		if (rec != null) { push(recommendations, rec); continue; }
		let t = trim(l);
		if (t == '') continue;
		if (section == 'summary') {
			// <testf> ipv<N> <dom> : <result> — skip prose lines
			let sp = index(t, ' ');
			if (sp <= 0) continue;
			let testf = substr(t, 0, sp);
			let rest = substr(t, sp + 1);
			if (substr(rest, 0, 3) != 'ipv') continue;
			let sp2 = index(rest, ' ');
			if (sp2 < 0) continue;
			let ipver = substr(rest, 0, sp2);
			let rest2 = substr(rest, sp2 + 1);
			let sep = index(rest2, ' : ');
			if (sep < 0) continue;
			push(summary, { test: testf, ipver: ipver, domain: substr(rest2, 0, sep), result: substr(rest2, sep + 3) });
			continue;
		}
		if (section == 'common') {
			let sp = index(t, ' ');
			if (sp <= 0) continue;
			let testf = substr(t, 0, sp);
			let rest = substr(t, sp + 1);
			if (substr(rest, 0, 3) != 'ipv') continue;
			let sep = index(rest, ' : ');
			if (sep < 0) continue;
			let ipver = substr(rest, 0, sep);
			push(common, { test: testf, ipver: ipver, result: substr(rest, sep + 3) });
		}
	}
	return { recommendations: recommendations, summary: summary, common: common };
}

function truncate_log_text(text, maxBytes) {
	if (length(text) <= maxBytes) return text;
	let tail = substr(text, length(text) - maxBytes);
	let nl = index(tail, '\n');
	let body = (nl >= 0) ? substr(tail, nl + 1) : tail;
	return '[log truncated to last ' + maxBytes + ' bytes]\n' + body;
}

function log_tail(id, maxBytes) {
	let raw = readfile(JDIR + '/' + id + '.log');
	if (!raw) return '';
	let tail = (length(raw) > maxBytes) ? substr(raw, length(raw) - maxBytes) : raw;
	return tail;
}

function elapsed_sec(job) {
	if (job.startedAt == null) return null;
	let end = (job.finishedAt != null) ? job.finishedAt : time();
	return (end > job.startedAt) ? (end - job.startedAt) : 0;
}

function public_job(job) {
	return {
		id: job.id, kind: job.kind, mode: job.mode, domains: job.domains,
		status: job.status, createdAt: job.createdAt, startedAt: job.startedAt,
		finishedAt: job.finishedAt, timeoutSec: job.timeoutSec,
		rc: job.rc, error: job.error, cancelled: job.cancelled,
		engineRunning: job.engineRunning,
		elapsedSec: elapsed_sec(job),
		recommendations: (job.recommendations != null) ? job.recommendations : [],
		summary: (job.summaryParsed != null) ? job.summaryParsed : null
	};
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
export const job_list = function() {
	crash_recover_all();
	let kept = sweep();
	let out = [];
	for (let i = length(kept) - 1; i >= 0; i--) push(out, public_job(kept[i]));
	return { ok: true, jobs: out };
};

export const job_get = function(input) {
	crash_recover_all();
	sweep();
	let id = (type(input) == 'object' && input != null) ? input.id : null;
	if (type(id) != 'string') return err('EINPUT', 'missing job id');
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	let out = public_job(job);
	out.logTail = log_tail(id, LOG_TAIL_BYTES);
	return { ok: true, job: out };
};

function next_seq() {
	ensure_jdir();
	let n = 0;
	let raw = readfile(JDIR + '/.seq');
	if (raw) n = +trim(raw) || 0;
	n++;
	writefile(JDIR + '/.seq', '' + n + '\n');
	return n;
}

function engine_running() {
	let r = run('pidof nfqws2');
	return (trim(r.out) != '') ? true : false;
}

export const blockcheck_start = function(input) {
	crash_recover_all();
	sweep();
	let mode = (type(input) == 'object' && input != null && type(input.mode) == 'string') ? input.mode : 'quick';
	let env = mode_env(mode);
	if (env == null) return err('EINPUT', 'unknown mode ' + mode + ' (quick|domains|full)');
	// upstream TEST set: 'standard' (default) or 'custom' (the operator's
	// small 10-list.sh set — the bounded drill surface). Whitelist only.
	let testset = 'standard';
	if (type(input) == 'object' && input != null && type(input.test) == 'string') {
		if (input.test != 'standard' && input.test != 'custom')
			return err('EINPUT', 'unknown test set ' + input.test + ' (standard|custom)');
		testset = input.test;
	}
	let domainsInput = (type(input) == 'object' && input != null) ? input.domains : null;
	let vd = validate_domains(domainsInput != null ? domainsInput : 'rutracker.org');
	if (!vd.ok) return err('EINPUT', vd.reason);
	if (!stat(SCANNER)) return err('ETARGET', 'upstream scanner not found at ' + SCANNER + ' (blockcheck is unavailable, not simulated)');
	if (!stat(RUNNER)) return err('EINTERNAL', 'job runner not installed at ' + RUNNER);

	// at most ONE active blockcheck job
	let recs = list_records();
	for (let i = 0; i < length(recs); i++) {
		if (!recs[i].parsed) continue;
		let job = recs[i].record;
		if (job.kind == 'blockcheck' && !is_terminal(job.status))
			return err('ECONFLICT', 'blockcheck job ' + job.id + ' is already ' + job.status);
	}

	let now = time();
	let id = 'job-' + now + '-' + next_seq();
	let job = {
		version: 2, id: id, kind: 'blockcheck', mode: mode, testset: testset, domains: vd.domains,
		status: 'pending', createdAt: now, startedAt: null, finishedAt: null,
		runnerPid: null, childPid: null,
		timeoutSec: env.timeoutSec,
		logPath: JDIR + '/' + id + '.log',
		rc: null, error: null, cancelled: false,
		engineRunning: engine_running(),
		recommendations: [], summaryParsed: null,
		provenance: { source: 'upstream blockcheck2.sh', mode: mode, domains: vd.domains, engineRunning: engine_running() }
	};

	// the runner's env file (constants + validated domains, single-quote escaped)
	let envtext = "BATCH='1'\nTEST=" + shell_escape(testset) + "\nIPVS='4'\nSCANLEVEL=" + shell_escape('' + env.scanlevel) + '\n'
		+ 'ENABLE_HTTP=' + shell_escape('' + env.enableHttp) + '\n'
		+ 'ENABLE_HTTPS_TLS12=' + shell_escape('' + env.enableTls12) + '\n'
		+ 'ENABLE_HTTPS_TLS13=' + shell_escape('' + env.enableTls13) + '\n'
		+ 'ENABLE_HTTP3=' + shell_escape('' + env.enableHttp3) + '\n'
		+ 'REPEATS=' + shell_escape('' + env.repeats) + '\n'
		+ "PARALLEL='0'\n"
		+ 'TIMEOUT=' + shell_escape('' + env.timeoutSec) + '\n'
		+ 'DOMAINS=' + shell_escape(join(' ', vd.domains)) + '\n';
	ensure_jdir();
	writefile(JDIR + '/' + id + '.env', envtext);
	writefile(JDIR + '/' + id + '.log', '');
	write_record(job);

	// spawn the detached runner (returns immediately)
	let p = popen('setsid ash ' + RUNNER + ' ' + id + ' </dev/null >/dev/null 2>&1 &', 'r');
	if (p) p.close();

	return { ok: true, job: public_job(job), warning: job.engineRunning ? 'nfqws2 is running — upstream warns bypass should be disabled during a scan; results may be unreliable' : null };
};

export const blockcheck_cancel = function(input) {
	crash_recover_all();
	sweep();
	let id = (type(input) == 'object' && input != null) ? input.id : null;
	if (type(id) != 'string') return err('EINPUT', 'missing job id');
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	if (is_terminal(job.status)) return err('ESTATE', 'job ' + id + ' is already ' + job.status);
	// the runner polls this flag and INT-signals the scanner (which then
	// unpreparse its own firewall artifacts) — cancel is REAL, not a flag
	writefile(JDIR + '/' + id + '.cancel', '' + time() + '\n');
	return { ok: true, cancelling: true, id: id };
};

export const blockcheck_status = function() {
	crash_recover_all();
	let kept = sweep();
	if (length(kept) == 0) return { ok: true, job: null, note: 'no blockcheck jobs yet' };
	// the active job, else the newest
	let active = null;
	for (let i = 0; i < length(kept); i++) {
		if (!is_terminal(kept[i].status)) { active = kept[i]; break; }
	}
	let job = (active != null) ? active : kept[length(kept) - 1];
	let out = public_job(job);
	out.logTail = log_tail(job.id, LOG_TAIL_BYTES);
	return { ok: true, job: out };
};

// ---------------------------------------------------------------------------
// runner callbacks (jobs-cli.uc mark-* — the only writers of transitions)
// ---------------------------------------------------------------------------
export const mark_running = function(id, runnerPid) {
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	let t = transition2(job, 'running', { runnerPid: runnerPid, runnerFingerprint: 'blockcheck-run.sh' });
	if (t == null) return err('ESTATE', 'invalid transition to running');
	write_record(t);
	return { ok: true };
};

export const mark_child = function(id, childPid) {
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	if (is_terminal(job.status)) return err('ESTATE', 'job already ' + job.status);
	job.childPid = childPid;
	job.childFingerprint = 'blockcheck2.sh';
	write_record(job);
	return { ok: true };
};

function finish_common(id, to, extra) {
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	let t = transition2(job, to, extra);
	if (t == null) return err('ESTATE', 'invalid transition to ' + to + ' from ' + job.status);
	// parse the log into recommendations + truncate to the cap
	let raw = readfile(JDIR + '/' + id + '.log');
	if (raw) {
		let parsed = parse_summary(raw);
		let prov = (t.provenance != null) ? t.provenance : { source: 'upstream blockcheck2.sh', mode: t.mode, domains: t.domains, engineRunning: t.engineRunning };
		let recs = [];
		for (let i = 0; i < length(parsed.recommendations); i++) {
			let r = parsed.recommendations[i];
			r.provenance = prov;
			push(recs, r);
		}
		t.recommendations = recs;
		t.summaryParsed = { summary: parsed.summary, common: parsed.common };
		if (length(raw) > LOG_MAX_BYTES) writefile(JDIR + '/' + id + '.log', truncate_log_text(raw, LOG_MAX_BYTES));
	}
	write_record(t);
	return { ok: true };
}

export const mark_finished = function(id, rc) {
	return finish_common(id, (rc == 0) ? 'succeeded' : 'failed', { rc: rc, error: (rc == 0) ? null : ('scanner exited ' + rc) });
};

export const mark_cancelled = function(id) {
	return finish_common(id, 'cancelled', { cancelled: true, error: 'cancelled by operator' });
};

export const mark_failed = function(id, reason) {
	return finish_common(id, 'failed', { error: '' + reason });
};
