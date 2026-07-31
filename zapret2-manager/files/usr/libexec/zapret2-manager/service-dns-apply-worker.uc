'use strict';
// service-dns-apply-worker.uc — background apply worker (r46.4.1).
// No closures over let variables (ucode limitation).
// Phases: writing → reloading → verifying → success / rolling_back.

import { readfile, writefile, stat, unlink, popen } from 'fs';

function now_iso() {
	let s = '';
	let p = popen('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null', 'r');
	if (p) { s = p.read('all') || ''; p.close(); }
	return trim(s);
}

function write_job(jf, obj) {
	let tmp = jf + '.tmp';
	writefile(tmp, sprintf("%J", obj) + "\n");
	let p = popen('mv -f ' + tmp + ' ' + jf + ' 2>/dev/null', 'r');
	if (p) p.close();
}

function runcmd(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	let rc = p.close();
	return { out: out, rc: rc };
}

// ---- main ----
let jf = ARGV[0];
if (!jf) exit(1);
if (!stat(jf)) exit(1);
let jr = null;
try { jr = json(readfile(jf)); } catch (e) { exit(1); }
if (!jr || type(jr) != 'object') exit(1);

let opId = jr.operationId || 'unknown';
let t0 = int(time());
let ovp = '/etc/zapret2-manager/dns-overrides.hosts';
let stp = '/etc/zapret2-manager/service-dns-state.json';
let lockf = '/tmp/zapret2-manager/service-dns-apply.lock';
let dhp = '/etc/config/dhcp';
let sdp = jr.snapDir || jr.jobDir || '/tmp/zapret2-manager/service-dns-jobs/' + opId;

// Phase: writing
let job = {};
job.phase = 'writing';
job.pid = int(1000 + time() % 64000);
job.updatedAt = now_iso();
write_job(jf, job);

let ren = type(jr.rendered) == 'string' ? jr.rendered : '';
let tmp = ovp + '.wrk.' + opId;
writefile(tmp, ren);
let mv = runcmd('mv -f ' + tmp + ' ' + ovp);
if (mv.rc != 0) {
	try { unlink(tmp); } catch (e) {}
	job.phase = 'failed';
	job.finished = true;
	job.finishedAt = now_iso();
	job.error = { code: 'EWRITE', message: 'atomic write failed' };
	write_job(jf, job);
	exit(1);
}
runcmd('chmod 644 ' + ovp);
let tw = int(time()) - t0;
if ((int(time()) - t0) > 90) exit(1);

// Phase: reloading
job.phase = 'reloading';
job.timings = { writeMs: tw * 1000, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 };
job.updatedAt = now_iso();
write_job(jf, job);

let conf = readfile(dhp) || '';
if (index(conf, ovp) < 0) {
	runcmd("uci add_list dhcp.@dnsmasq[0].addnhosts='" + ovp + "'");
	runcmd('uci commit dhcp');
}
let tr = int(time());
runcmd('/etc/init.d/dnsmasq restart');
let rs = int(time()) - tr;
if ((int(time()) - t0) > 90) {
	// deadline — rollback
	job.phase = 'rolling_back';
	job.timings.writeMs = tw * 1000;
	job.timings.reloadMs = rs * 1000;
	job.error = { code: 'EDEADLINE', message: 'worker deadline exceeded' };
	job.updatedAt = now_iso();
	write_job(jf, job);
	if (stat(sdp + '/previous.hosts')) { runcmd('cp -p ' + sdp + '/previous.hosts ' + ovp); runcmd('chmod 644 ' + ovp); }
	if (stat(sdp + '/previous-state.json')) { runcmd('cp -p ' + sdp + '/previous-state.json ' + stp); }
	runcmd('/etc/init.d/dnsmasq restart');
	job.phase = 'rolled_back';
	job.finished = true;
	job.finishedAt = now_iso();
	job.rolledBack = true;
	job.timings.totalMs = (int(time()) - t0) * 1000;
	write_job(jf, job);
	try { unlink(lockf); } catch (e) {}
	exit(1);
}

// Phase: verifying
job.phase = 'verifying';
job.timings.writeMs = tw * 1000;
job.timings.reloadMs = rs * 1000;
job.timings.totalMs = (int(time()) - t0) * 1000;
job.updatedAt = now_iso();
write_job(jf, job);

let tv = int(time());
let vok = true;
let recs = jr.records || [];
for (let i = 0; i < length(recs) && i < 20; i++) {
	let r = recs[i];
	let ips = r.A || [];
	for (let j = 0; j < length(ips) && j < 2; j++) {
		let ns = runcmd('nslookup ' + r.hostname + ' 127.0.0.1');
		if (index(ns.out, ips[j]) >= 0) continue;
		vok = false;
		break;
	}
	if (!vok) break;
	if (int(time()) - tv > 30) { vok = false; break; }
}
let vs = int(time()) - tv;

if (!vok) {
	// verification failed — rollback
	job.phase = 'rolling_back';
	job.timings.verifyMs = vs * 1000;
	job.timings.totalMs = (int(time()) - t0) * 1000;
	job.error = { code: 'EVERIFY', message: 'verification failed' };
	job.updatedAt = now_iso();
	write_job(jf, job);
	if (stat(sdp + '/previous.hosts')) { runcmd('cp -p ' + sdp + '/previous.hosts ' + ovp); runcmd('chmod 644 ' + ovp); }
	if (stat(sdp + '/previous-state.json')) { runcmd('cp -p ' + sdp + '/previous-state.json ' + stp); }
	runcmd('/etc/init.d/dnsmasq restart');
	job.phase = 'rolled_back';
	job.finished = true;
	job.finishedAt = now_iso();
	job.rolledBack = true;
	job.timings.totalMs = (int(time()) - t0) * 1000;
	write_job(jf, job);
	// Clear pending in state
	try {
		let sdr = readfile(stp);
		if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: 'EVERIFY', message: 'verification failed — rolled back' }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } }
	} catch (e) {}
	try { unlink(lockf); } catch (e) {}
	exit(1);
}

// Phase: success
job.phase = 'success';
job.finished = true;
job.finishedAt = now_iso();
job.verified = true;
job.timings.verifyMs = vs * 1000;
job.timings.totalMs = (int(time()) - t0) * 1000;
job.updatedAt = now_iso();
write_job(jf, job);

// Update persistent state
try {
	let sdr = readfile(stp);
	if (sdr) {
		let obj = json(sdr);
		if (obj && type(obj) == 'object') {
			let sd = type(obj.serviceDns) == 'object' && obj.serviceDns != null ? obj.serviceDns : {};
			let pn = sd.pending || {};
			let ap = sd.applied || {};
			sd.applied = { selections: pn.desiredSelections || sd.selections || {}, revision: type(ap.revision) == 'int' ? ap.revision + 1 : 1, fileHash: jr.desiredHash || '', generatedAt: now_iso(), verifiedAt: now_iso() };
			sd.pending = null;
			sd.lastOperation = { operationId: opId, state: 'success', phase: 'success', error: null, startedAt: jr.createdAt, finishedAt: now_iso() };
			let evs = type(sd.events) == 'array' ? sd.events : [];
			push(evs, { ts: now_iso(), action: 'apply-success', operationId: opId });
			if (length(evs) > 20) { let keep = []; for (let ei = length(evs) - 20; ei < length(evs); ei++) push(keep, evs[ei]); evs = keep; }
			sd.events = evs;
			let t2 = stp + '.wrk.' + opId;
			writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n");
			runcmd('mv -f ' + t2 + ' ' + stp);
		}
	}
} catch (e) {}
try { unlink(lockf); } catch (e) {}
exit(0);
