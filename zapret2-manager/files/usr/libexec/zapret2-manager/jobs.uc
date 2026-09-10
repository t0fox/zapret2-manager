'use strict';
// jobs.uc — bounded service-health job lifecycle.
// Records: one JSON file per job in /tmp/zapret2-manager/jobs/.
//
// Contract (docs/contracts/ubus.md "Long operations"):
//   pending → running → succeeded | failed
//           (any non-terminal) → cancelled
//           (succeeded|failed) → expired
// Transitions are forward-only; an invalid move returns null (never a silent
// no-op). The health runner owns bounded network probes. No fabricated
// progress percentage — elapsed seconds only.

import { readfile, writefile, stat, unlink, popen, lsdir } from 'fs';
import { cat_load, cat_ledger, cat_domain_include_path } from './catalog.uc';

const JDIR = '/tmp/zapret2-manager/jobs';
const HEALTH_RUNNER = '/usr/libexec/zapret2-manager/health-run.sh';
const JOB_TTL_SEC = 600;
const JOB_MAX_HISTORY = 10;
const LOG_TAIL_BYTES = 4096;
const LOG_MAX_BYTES = 262144;
const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'expired'];

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

function normalize_health_domain(value) {
	if (type(value) != 'string') return null;
	let domain = lc(trim(value));
	if (substr(domain, 0, 7) == 'http://') domain = substr(domain, 7);
	else if (substr(domain, 0, 8) == 'https://') domain = substr(domain, 8);
	let cut = index(domain, '/');
	if (cut >= 0) domain = substr(domain, 0, cut);
	if (length(domain) > 253 || !match(domain, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)) return null;
	return domain;
}

function is_terminal(status) {
	return (status == 'succeeded' || status == 'failed' || status == 'cancelled' || status == 'expired');
}

// ---------------------------------------------------------------------------
// record IO
// ---------------------------------------------------------------------------
function ensure_jdir() {
	return stat(JDIR) != null;
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
	if (job.status == 'pending' && (to == 'running' || to == 'cancelled')) ok = true;
	else if (job.status == 'running' && (to == 'succeeded' || to == 'failed' || to == 'cancelled')) ok = true;
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

// crash_recover_all() — a non-terminal job whose runner is dead is failed.
function crash_recover_all() {
	let recs = list_records();
	for (let i = 0; i < length(recs); i++) {
		if (!recs[i].parsed) continue;
		let job = recs[i].record;
		if (is_terminal(job.status)) continue;
		let runnerFingerprint = job.runnerFingerprint || 'health-run.sh';
		if (proc_alive(job.runnerPid, runnerFingerprint)) continue;
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
// bounded service-health job records
// ---------------------------------------------------------------------------
function public_job(job) {
	return {
		id: job.id, kind: job.kind, mode: job.mode, services: job.services,
		status: job.status, createdAt: job.createdAt, startedAt: job.startedAt,
		finishedAt: job.finishedAt, timeoutSec: job.timeoutSec,
		rc: job.rc, error: job.error, cancelled: job.cancelled,
		engineRunning: job.engineRunning,
		elapsedSec: elapsed_sec(job)
	};
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
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

export const hm_cancel = function(input) {
	crash_recover_all();
	sweep();
	let id = (type(input) == 'object' && input != null) ? input.id : null;
	if (type(id) != 'string') return err('EINPUT', 'missing job id');
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	if (job.kind != 'healthmatrix') return err('ESTATE', 'job ' + id + ' is not a health matrix job (kind=' + job.kind + ')');
	if (is_terminal(job.status)) return err('ESTATE', 'job ' + id + ' is already ' + job.status);
	writefile(JDIR + '/' + id + '.cancel', '' + time() + '\n');
	return { ok: true, cancelling: true, id: id };
};

// ---------------------------------------------------------------------------
// health matrix (Phase C) — bounded per-layer probes over catalog services.
// Diagnostics, never a service-works verdict. Reuses THIS job infrastructure
// (records, transitions, sweep, crash recovery, cancel flag).
// ---------------------------------------------------------------------------
const HEALTH_CLASSES = ['pending', 'dns', 'connect', 'tls', 'http-application',
	'possible-geo-account', 'reachable-http', 'upstream-error',
	'unknown-timeout', 'unavailable-unknown', 'skipped'];

function classify_curl_stage(rc, httpCode) {
	if (rc == 6) return { outcome: 'fail', layer: 'dns' };
	if (rc == 7) return { outcome: 'fail', layer: 'connect' };
	if (rc == 28) return { outcome: 'fail', layer: 'timeout' };
	if (rc == 35 || rc == 60 || rc == 51 || rc == 58 || rc == 59 || rc == 90) return { outcome: 'fail', layer: 'tls' };
	if (rc == 0) {
		let code = +httpCode || 0;
		if (code >= 200 && code < 400) return { outcome: 'ok', layer: 'http', httpCode: code };
		if (code == 401 || code == 403) return { outcome: 'ok', layer: 'http', httpCode: code, note: 'auth/region class response' };
		if (code >= 500) return { outcome: 'ok', layer: 'http', httpCode: code, note: 'upstream 5xx' };
		return { outcome: 'ok', layer: 'http', httpCode: code };
	}
	return { outcome: 'fail', layer: 'unknown' };
}

function classify_service(probes) {
	// catalog presence is diagnostic only. A selected service still owns a
	// bounded probe even when the reduced catalog does not list its domains.
	if (probes.dns == null || probes.dns.ok != true)
		return { class: 'dns', reason: 'local resolution failed' };
	let tcp = (probes.tcp != null) ? classify_curl_stage(probes.tcp.rc, null) : { outcome: 'fail', layer: 'unknown' };
	if (tcp.outcome != 'ok' && tcp.layer == 'connect') return { class: 'connect', reason: 'TCP 443 connect failed' };
	if (tcp.outcome != 'ok' && tcp.layer == 'dns') return { class: 'dns', reason: 'curl-side resolution failed' };
	if (tcp.outcome != 'ok' && tcp.layer == 'timeout') return { class: 'unknown-timeout', reason: 'TCP probe timed out' };
	let tls = (probes.tls != null) ? classify_curl_stage(probes.tls.rc, null) : { outcome: 'fail', layer: 'unknown' };
	if (tls.outcome != 'ok') {
		if (tls.layer == 'tls') return { class: 'tls', reason: 'TLS/SNI handshake failed' };
		if (tls.layer == 'timeout') return { class: 'unknown-timeout', reason: 'TLS probe timed out' };
		if (tls.layer == 'connect') return { class: 'connect', reason: 'connect failed at TLS stage' };
		if (tls.layer == 'dns') return { class: 'dns', reason: 'resolution failed at TLS stage' };
		return { class: 'unavailable-unknown', reason: 'TLS probe inconclusive' };
	}
	let http = (probes.http != null) ? classify_curl_stage(probes.http.rc, probes.http.httpCode) : { outcome: 'fail', layer: 'unknown' };
	if (http.outcome != 'ok') return { class: 'http-application', reason: 'no HTTP response' };
	let code = http.httpCode || 0;
	if (code >= 200 && code < 400) return { class: 'reachable-http', reason: 'HTTP ' + code + ' — host responds at the application layer (NOT a service-availability claim)' };
	if (code == 401 || code == 403) return { class: 'possible-geo-account', reason: 'HTTP ' + code + ' — auth/region class response; account or GEO restriction is possible (not provable here)' };
	if (code >= 500) return { class: 'upstream-error', reason: 'HTTP ' + code + ' — upstream/application error' };
	return { class: 'http-application', reason: 'HTTP ' + code };
}

// parse_result_line(line) — the runner's raw evidence line:
// SVC|id|domain1,domain2|catalogPresent=0/1|dns=0/1|extdns=0/1/-|extev=<ip>|tcp=rc|tls=rc|http=rc|httpcode=N
function parse_result_line(line) {
	let parts = split(line, '|');
	if (length(parts) < 10) return null;
	let r = { id: parts[1], domains: split(parts[2], ',') };
	for (let i = 3; i < length(parts); i++) {
		let kv = split(parts[i], '=');
		if (length(kv) < 2) continue;
		let k = kv[0]; let v = kv[1];
		if (k == 'catalogPresent') r.catalog = { domainsPresent: v == '1' };
		else if (k == 'dns') r.dns = { ok: v == '1' };
		else if (k == 'extdns') r.extDns = (v == '-') ? null : { ok: v == '1' };
		else if (k == 'extev') { if (r.extDns != null) r.extDns.evidence = v; }
		else if (k == 'tcp') r.tcp = { rc: +v };
		else if (k == 'tls') r.tls = { rc: +v };
		else if (k == 'http') r.http = { rc: +v };
		else if (k == 'httpcode') { if (r.http != null) r.http.httpCode = +v; }
	}
	return r;
}

function read_matrix_results(id) {
	let raw = readfile(JDIR + '/' + id + '.result.jsonl');
	let rows = [];
	if (!raw) return rows;
	let lines = split(raw, '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (l == '') continue;
		if (substr(l, 0, 4) != 'SVC|') continue;
		let r = parse_result_line(l);
		if (r == null) { push(rows, { malformed: true, preview: substr(l, 0, 120) }); continue; }
		let cls;
		try { cls = classify_service(r); }
		catch (e) {
			// a classify crash must never kill the matrix — report it as an
			// honest unavailable row carrying the error text (debugging the
			// r24 in-module classify crash; the exact same call is clean in
			// isolation, so capture what the interpreter actually says)
			push(rows, { id: r.id, domains: r.domains, probes: { catalog: r.catalog, dns: r.dns, extDns: r.extDns, tcp: r.tcp, tls: r.tls, http: r.http }, class: 'unavailable-unknown', reason: 'classify error: ' + e });
			continue;
		}
		let row = {
			id: r.id,
			domains: r.domains,
			probes: {
				catalog: r.catalog, dns: r.dns, extDns: r.extDns,
				tcp: r.tcp, tls: r.tls, http: r.http
			},
			class: cls.class,
			reason: cls.reason
		};
		push(rows, row);
	}
	return rows;
}

function matrix_summary(rows) {
	let byClass = {};
	let malformed = 0;
	for (let i = 0; i < length(rows); i++) {
		if (rows[i].malformed) { malformed++; continue; }
		let c = rows[i].class;
		byClass[c] = (byClass[c] != null) ? byClass[c] + 1 : 1;
	}
	return { services: length(rows) - malformed, malformed: malformed, byClass: byClass,
		note: 'diagnostics per layer, not service-availability verdicts' };
}

export const health_matrix_start = function(input) {
	crash_recover_all();
	sweep();
	let lc = cat_load();
	if (!lc.ok) return err('ETARGET', 'catalog is invalid — health matrix unavailable', { errors: lc.errors });
	let ll = cat_ledger(lc.doc.digest);
	if (!ll.ok) return err('ESTATE', 'catalog ledger is malformed: ' + ll.reason);

	// targets: requested services, else ledger-enabled, else whole catalog.
	// Custom domains are validated here as well as in the settings owner so
	// the job runner never receives an arbitrary URL from a direct caller.
	let requested = (type(input) == 'object' && input != null && type(input.services) == 'array') ? input.services : null;
	let serviceIds = [];
	if (requested != null) {
		for (let i = 0; i < length(requested); i++) push(serviceIds, requested[i]);
	} else if (length(ll.ledger.enabled) > 0) {
		for (let i = 0; i < length(ll.ledger.enabled); i++) push(serviceIds, ll.ledger.enabled[i]);
	} else {
		for (let i = 0; i < length(lc.doc.services); i++) push(serviceIds, lc.doc.services[i].id);
	}
	let customInput = (type(input) == 'object' && input != null && input.custom_domains != null) ? input.custom_domains : [];
	if (type(customInput) != 'array') return err('EINPUT', 'custom_domains must be an array');
	let customDomains = [];
	for (let i = 0; i < length(customInput); i++) {
		let domain = normalize_health_domain(customInput[i]);
		if (domain == null) return err('EINPUT', 'custom_domains contains an invalid domain');
		if (index(customDomains, domain) < 0) push(customDomains, domain);
	}
	if (length(customDomains) > 16) return err('EINPUT', 'too many custom domains (max 16)');

	let targets = [];
	let unknown = [];
	for (let i = 0; i < length(serviceIds); i++) {
		let svc = null;
		for (let j = 0; j < length(lc.doc.services); j++)
			if (lc.doc.services[j].id == serviceIds[i]) { svc = lc.doc.services[j]; break; }
		if (svc == null) push(unknown, serviceIds[i]);
		else push(targets, svc);
	}
	if (length(unknown) > 0) return err('EINPUT', 'unknown service ids: ' + join(', ', unknown));
	for (let i = 0; i < length(customDomains); i++)
		push(targets, { id: 'custom' + (i + 1), domains: [customDomains[i]], custom: true });
	if (length(targets) == 0) return err('EINPUT', 'no services or custom domains to probe');
	if (length(targets) > 16) return err('EINPUT', 'too many targets (max 16 per matrix)');
	if (!stat(HEALTH_RUNNER)) return err('EINTERNAL', 'health runner not installed at ' + HEALTH_RUNNER);

	// at most ONE active healthmatrix job
	let recs = list_records();
	for (let i = 0; i < length(recs); i++) {
		if (!recs[i].parsed) continue;
		let job = recs[i].record;
		if (job.kind == 'healthmatrix' && !is_terminal(job.status))
			return err('ECONFLICT', 'health matrix job ' + job.id + ' is already ' + job.status);
	}

	let now = time();
	let id = 'job-' + now + '-' + next_seq();
	let timeoutSec = (length(targets) <= 4) ? 120 : 300;

	// env: SERVICES + per-service probe domains + upstream dns (evidence base)
	let upstreamDns = '';
	let resolvRaw = readfile('/tmp/resolv.conf.d/resolv.conf.auto');
	if (resolvRaw) {
		let lines = split(resolvRaw, '\n');
		for (let i = 0; i < length(lines); i++) {
			let l = trim(lines[i]);
			if (substr(l, 0, 11) == 'nameserver ') { upstreamDns = trim(substr(l, 11)); break; }
		}
	}
	let envtext = 'TIMEOUT=' + shell_escape('' + timeoutSec) + '\n'
		+ 'UPSTREAM_DNS=' + shell_escape(upstreamDns) + '\n'
		+ 'LISTFILE=' + shell_escape(cat_domain_include_path()) + '\n';
	let svcNames = '';
	let ids = [];
	for (let i = 0; i < length(targets); i++) {
		if (i > 0) svcNames += ' ';
		svcNames += targets[i].id;
		push(ids, targets[i].id);
		let doms = '';
		let domsArr = (type(targets[i].domains) == 'array') ? targets[i].domains : [];
		let maxD = (length(domsArr) > 2) ? 2 : length(domsArr);
		for (let j = 0; j < maxD; j++) {
			if (j > 0) doms += ' ';
			doms += targets[i].domains[j];
		}
		envtext += 'DOM_' + targets[i].id + '=' + shell_escape(doms) + '\n';
	}
	envtext = 'SERVICES=' + shell_escape(svcNames) + '\n' + envtext;

	let job = {
		version: 2, id: id, kind: 'healthmatrix', mode: 'matrix',
		services: ids,
		status: 'pending', createdAt: now, startedAt: null, finishedAt: null,
		runnerPid: null,
		timeoutSec: timeoutSec,
		logPath: JDIR + '/' + id + '.log',
		rc: null, error: null, cancelled: false,
		engineRunning: engine_running(),
		provenance: { source: 'service health matrix v1', catalogVersion: lc.doc.catalogVersion, digest: lc.doc.digest, custom_domains: customDomains, engineRunning: engine_running() }
	};
	ensure_jdir();
	writefile(JDIR + '/' + id + '.env', envtext);
	writefile(JDIR + '/' + id + '.log', '');
	writefile(JDIR + '/' + id + '.result.jsonl', '');
	write_record(job);

	let p = popen('setsid ash ' + HEALTH_RUNNER + ' ' + id + ' </dev/null >/dev/null 2>&1 &', 'r');
	if (p) p.close();

	return { ok: true, job: public_job(job), note: 'bounded probes over catalog and validated custom targets; classifications are per-layer diagnostics, not service-availability verdicts' };
};

export const health_matrix_get = function() {
	crash_recover_all();
	let kept = sweep();
	let newest = null;
	for (let i = 0; i < length(kept); i++) {
		if (kept[i].kind == 'healthmatrix') {
			if (newest == null || (kept[i].createdAt || 0) > (newest.createdAt || 0)) newest = kept[i];
		}
	}
	if (newest == null) return { ok: true, matrix: null, note: 'no health matrix run yet' };
	let rows = read_matrix_results(newest.id);
	let out = public_job(newest);
	out.rows = rows;
	out.summary = matrix_summary(rows);
	out.logTail = log_tail(newest.id, 2048);
	return { ok: true, matrix: out };
};

// ---------------------------------------------------------------------------
// runner callbacks (jobs-cli.uc mark-* — the only writers of transitions)
// ---------------------------------------------------------------------------
export const mark_running = function(id, runnerPid) {
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	let fingerprint = 'health-run.sh';
	let t = transition2(job, 'running', { runnerPid: runnerPid, runnerFingerprint: fingerprint });
	if (t == null) return err('ESTATE', 'invalid transition to running');
	write_record(t);
	return { ok: true };
};

function finish_common(id, to, extra) {
	let job = read_record(id);
	if (job == null) return err('ESTATE', 'no job with id ' + id);
	let t = transition2(job, to, extra);
	if (t == null) return err('ESTATE', 'invalid transition to ' + to + ' from ' + job.status);
	let raw = readfile(JDIR + '/' + id + '.log');
	if (raw && length(raw) > LOG_MAX_BYTES) writefile(JDIR + '/' + id + '.log', truncate_log_text(raw, LOG_MAX_BYTES));
	write_record(t);
	return { ok: true };
}

export const mark_finished = function(id, rc) {
	return finish_common(id, (rc == 0) ? 'succeeded' : 'failed', { rc: rc, error: (rc == 0) ? null : ('health runner exited ' + rc) });
};

export const mark_cancelled = function(id) {
	return finish_common(id, 'cancelled', { cancelled: true, error: 'cancelled by operator' });
};

export const mark_failed = function(id, reason) {
	return finish_common(id, 'failed', { error: '' + reason });
};
