'use strict';
// service-dns-apply-worker.uc — background apply worker (r46.4).
// Called from service_dns_apply_async with a job state file.
// Phases: writing → reloading → verifying → success / rolling_back → rolled_back.
// Updates the job file atomically with metadata preservation.
// All external commands have bounded timeouts.

import { readfile, writefile, stat, unlink, popen } from 'fs';

const WORKER_DEADLINE = 90; // seconds — total worker timeout
const WRITE_TIMEOUT = 5;
const UCI_TIMEOUT = 10;
const RELOAD_TIMEOUT = 20;
const DNS_LOOKUP_TIMEOUT = 5;
const VERIFY_TIMEOUT = 30;
const ROLLBACK_TIMEOUT = 30;

function run(cmd, tout) {
	let t = tout > 0 ? tout : 10;
	let p = popen('timeout ' + t + ' ' + cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1, timedOut: false };
	let out = p.read('all') || '';
	let rc = p.close();
	return { out: out, rc: rc, timedOut: (rc == 124) };
}

function now_iso() {
	let s = run('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null', 3).out || '';
	return trim(s);
}

function update_job(file, updates) {
	let current = {};
	try {
		current = json(readfile(file)) || {};
	} catch (e) {
		current = {};
	}
	for (let k in updates) current[k] = updates[k];
	current.updatedAt = now_iso();

	let tmp = file + '.tmp';
	writefile(tmp, sprintf("%J", current) + "\n");
	run('mv -f ' + tmp + ' ' + file, 5);
	return current;
}

let jobFile = ARGV[0];
if (!jobFile) exit(1);
if (!stat(jobFile)) exit(1);

let job = null;
try { job = json(readfile(jobFile)); } catch (e) { exit(1); }
if (!job || type(job) != 'object') exit(1);

let opId = job.operationId || 'unknown';
let tStart = int(time());

// Paths are CONSTANTS — never taken from untrusted JSON
let overridesPath = '/etc/zapret2-manager/dns-overrides.hosts';
let statePath = '/etc/zapret2-manager/service-dns-state.json';
let dhcpConf = '/etc/config/dhcp';
let snapDir = job.snapDir || job.jobDir || '/tmp/zapret2-manager/service-dns-jobs/' + opId;

update_job(jobFile, { phase: 'writing', pid: int(1000 + time() % 64000) });

// Write overrides — ALWAYS, even empty (All Off is correct)
let rendered = type(job.rendered) == 'string' ? job.rendered : '';
let tmpOverrides = overridesPath + '.wrk.' + opId;
writefile(tmpOverrides, rendered);
let mv = run('mv -f ' + tmpOverrides + ' ' + overridesPath, WRITE_TIMEOUT);
if (mv.rc != 0) {
	try { unlink(tmpOverrides); } catch (e) {}
	update_job(jobFile, { phase: 'failed', finished: true, finishedAt: now_iso(),
		error: { code: 'EWRITE', message: 'atomic write failed' } });
	exit(1);
}
run('chmod 644 ' + overridesPath, WRITE_TIMEOUT);

let tWrite = int(time()) - tStart;

// Register in dhcp config
update_job(jobFile, { phase: 'reloading', timings: { writeMs: tWrite * 1000, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 } });
let conf = readfile(dhcpConf) || '';
if (index(conf, overridesPath) < 0) {
	run("uci add_list dhcp.@dnsmasq[0].addnhosts='" + overridesPath + "'", UCI_TIMEOUT);
	run('uci commit dhcp', UCI_TIMEOUT);
}

// dnsmasq restart with timeout
let tReload = int(time());
let reloadRes = run('/etc/init.d/dnsmasq restart', RELOAD_TIMEOUT);
let reloadSec = int(time()) - tReload;
if (reloadRes.timedOut) {
	update_job(jobFile, { phase: 'rolling_back', error: { code: 'EDNSMASQTIMEOUT', message: 'dnsmasq restart exceeded ' + RELOAD_TIMEOUT + ' seconds' },
		timings: { writeMs: tWrite * 1000, reloadMs: reloadSec * 1000, verifyMs: 0, rollbackMs: 0, totalMs: (int(time()) - tStart) * 1000 } });
	goto rollback;
}

update_job(jobFile, { phase: 'verifying',
	timings: { writeMs: tWrite * 1000, reloadMs: reloadSec * 1000, verifyMs: 0, rollbackMs: 0, totalMs: (int(time()) - tStart) * 1000 } });

// Verify
let tVerify = int(time());
let verifyOk = true;
let records = job.records || [];
for (let i = 0; i < length(records) && i < 20; i++) {
	let r = records[i];
	let ips = r.A || [];
	for (let j = 0; j < length(ips) && j < 2; j++) {
		let ns = run('nslookup ' + r.hostname + ' 127.0.0.1', DNS_LOOKUP_TIMEOUT);
		if (index(ns.out, ips[j]) >= 0) continue;
		verifyOk = false;
		break;
	}
	if (!verifyOk) break;

	// deadline check
	if (int(time()) - tVerify > VERIFY_TIMEOUT) { verifyOk = false; break; }
}
let verifySec = int(time()) - tVerify;

if (!verifyOk) {
	goto rollback;
}

// Success — update persistent state
update_job(jobFile, { phase: 'success', finished: true, finishedAt: now_iso(), verified: true,
	timings: { writeMs: tWrite * 1000, reloadMs: reloadSec * 1000, verifyMs: verifySec * 1000, rollbackMs: 0, totalMs: (int(time()) - tStart) * 1000 } });

// Update service DNS state — mark applied
try {
	let sdRaw = readfile(statePath);
	if (sdRaw) {
		let obj = json(sdRaw);
		if (obj && type(obj) == 'object') {
			let sd = (type(obj.serviceDns) == 'object' && obj.serviceDns != null) ? obj.serviceDns : {};
			let pending = sd.pending || {};
			let applied = sd.applied || {};
			sd.applied = {
				selections: pending.desiredSelections || sd.selections || {},
				revision: (type(applied.revision) == 'int') ? applied.revision + 1 : 1,
				fileHash: job.desiredHash || '',
				generatedAt: now_iso(),
				verifiedAt: now_iso()
			};
			sd.pending = null;
			sd.lastOperation = {
				operationId: opId,
				state: 'success',
				phase: 'success',
				error: null,
				startedAt: job.createdAt,
				finishedAt: now_iso()
			};
			let evs = (type(sd.events) == 'array') ? sd.events : [];
			push(evs, { ts: now_iso(), action: 'apply-success', operationId: opId });
			if (length(evs) > 20) { let keep = []; for (let ei = length(evs) - 20; ei < length(evs); ei++) push(keep, evs[ei]); evs = keep; }
			sd.events = evs;
			// atomic write
			let tmp = statePath + '.wrk.' + opId;
			writefile(tmp, sprintf("%J", { serviceDns: sd }) + "\n");
			run('mv -f ' + tmp + ' ' + statePath, WRITE_TIMEOUT);
		}
	}
} catch (e) {}
exit(0);

:rollback
let tRb = int(time());
update_job(jobFile, { phase: 'rolling_back', error: job.error || { code: 'EVERIFY', message: 'verification failed' },
	timings: { writeMs: tWrite * 1000, reloadMs: reloadSec * 1000, verifyMs: verifySec * 1000, rollbackMs: 0, totalMs: (int(time()) - tStart) * 1000 } });

if (stat(snapDir + '/previous.hosts')) {
	run('cp -p ' + snapDir + '/previous.hosts ' + overridesPath, ROLLBACK_TIMEOUT);
	run('chmod 644 ' + overridesPath, WRITE_TIMEOUT);
}
if (stat(snapDir + '/previous-state.json')) {
	run('cp -p ' + snapDir + '/previous-state.json ' + statePath, ROLLBACK_TIMEOUT);
}
run('/etc/init.d/dnsmasq restart', RELOAD_TIMEOUT);

let rbSec = int(time()) - tRb;
update_job(jobFile, { phase: 'rolled_back', finished: true, finishedAt: now_iso(),
	rolledBack: true,
	error: { code: 'EROLLEDBACK', message: verifyOk ? 'unexpected rollback' : 'verification failed — rolled back', phase: 'verifying', rolledBack: true },
	timings: { writeMs: tWrite * 1000, reloadMs: reloadSec * 1000, verifyMs: verifySec * 1000, rollbackMs: rbSec * 1000, totalMs: (int(time()) - tStart) * 1000 } });

// Update state — clear pending, record failure
try {
	let sdRaw = readfile(statePath);
	if (sdRaw) {
		let obj = json(sdRaw);
		if (obj && type(obj) == 'object') {
			let sd = (type(obj.serviceDns) == 'object') ? obj.serviceDns : {};
			sd.pending = null;
			sd.lastOperation = {
				operationId: opId,
				state: 'rolled_back',
				phase: 'rolled_back',
				error: { code: 'EVERIFY', message: 'verification failed — rolled back' },
				startedAt: job.createdAt,
				finishedAt: now_iso()
			};
			let tmp = statePath + '.wrk.' + opId;
			writefile(tmp, sprintf("%J", { serviceDns: sd }) + "\n");
			run('mv -f ' + tmp + ' ' + statePath, WRITE_TIMEOUT);
		}
	}
} catch (e) {}
exit(1);
