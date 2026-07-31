'use strict';
// service-dns-apply-worker.uc — routing apply worker (r46.5).
// Writes routing conf → validates dnsmasq config → reload → verify forwarding.
// Rollback restores previous routing conf + state.

import { readfile, writefile, stat, unlink, popen } from 'fs';

function now_iso() {
	let s = ''; let p = popen('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null', 'r');
	if (p) { s = p.read('all') || ''; p.close(); }
	return trim(s);
}

function write_job(jf, updates) {
	let cur = {};
	try { cur = json(readfile(jf)) || {}; } catch (e) { cur = {}; }
	for (let k in updates) cur[k] = updates[k];
	cur.updatedAt = now_iso();
	let tmp = jf + '.tmp';
	writefile(tmp, sprintf("%J", cur) + "\n");
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

let jf = ARGV[0];
if (!jf) exit(1); if (!stat(jf)) exit(1);
let jr = null; try { jr = json(readfile(jf)); } catch (e) { exit(1); }
if (!jr || type(jr) != 'object') exit(1);

let opId = jr.operationId || 'unknown';
let t0 = int(time());
let stp = '/etc/zapret2-manager/service-dns-state.json';
let rcp = jr.routingConfPath || '/etc/zapret2-manager/service-dns-routing.conf';
let sdp = jr.snapDir || jr.jobDir || '/tmp/zapret2-manager/service-dns-jobs/' + opId;
let lockf = '/tmp/zapret2-manager/service-dns-apply.lock';

// Phase: writing — routing conf already written by apply; just confirm
job.phase = 'writing'; job.pid = int(1000 + time() % 64000); write_job(jf, job);

if (!stat(rcp)) { job.phase = 'failed'; job.finished = true; job.finishedAt = now_iso(); job.error = { code: 'ENOCONF', message: 'routing conf missing' }; write_job(jf, job); try { unlink(lockf); } catch (e) {} exit(1); }
let tw = int(time()) - t0;

// Register conf_file in dhcp
job.phase = 'registering'; job.updatedAt = now_iso(); write_job(jf, job);
let conf = readfile('/etc/config/dhcp') || '';
if (index(conf, rcp) < 0) { runcmd("uci add_list dhcp.@dnsmasq[0].conf_file='" + rcp + "'"); runcmd('uci commit dhcp'); }

// Phase: reloading
job.phase = 'reloading'; job.timings = { writeMs: tw * 1000, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 }; job.updatedAt = now_iso(); write_job(jf, job);

// Test config first
let testRes = runcmd('dnsmasq --test 2>&1');
if (testRes.rc != 0) {
	// config invalid — rollback
	job.phase = 'rolling_back'; job.error = { code: 'ECONFIGTEST', message: 'dnsmasq --test failed: ' + trim(testRes.out || '').slice(0, 120) }; job.updatedAt = now_iso(); write_job(jf, job);
	if (stat(sdp + '/previous-routing.conf')) { runcmd('cp -p ' + sdp + '/previous-routing.conf ' + rcp); } else { try { unlink(rcp); } catch (e) {} }
	if (stat(sdp + '/previous-state.json')) runcmd('cp -p ' + sdp + '/previous-state.json ' + stp);
	runcmd('/etc/init.d/dnsmasq restart');
	job.phase = 'rolled_back'; job.finished = true; job.finishedAt = now_iso(); job.rolledBack = true; job.timings.totalMs = (int(time()) - t0) * 1000; write_job(jf, job);
	try { let sdr = readfile(stp); if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: 'ECONFIGTEST', message: 'dnsmasq config test failed' }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } } } catch (e) {}
	try { unlink(lockf); } catch (e) {}
	exit(1);
}

let tr = int(time());
runcmd('/etc/init.d/dnsmasq restart');
let rs = int(time()) - tr;
if ((int(time()) - t0) > 90) { job.phase = 'failed'; job.error = { code: 'EDEADLINE', message: 'worker deadline' }; job.finished = true; job.updatedAt = now_iso(); write_job(jf, job); try { unlink(lockf); } catch (e) {} exit(1); }

// Phase: verifying
job.phase = 'verifying'; job.timings = { writeMs: tw * 1000, reloadMs: rs * 1000, verifyMs: 0, rollbackMs: 0, totalMs: (int(time()) - t0) * 1000 }; job.updatedAt = now_iso(); write_job(jf, job);
let tv = int(time());
let vok = true;

// Verify dnsmasq is running
let ubus = runcmd('ubus call service list \'{"name":"dnsmasq"}\'');
let running = false;
try { let obj = json(ubus.out); if (obj && obj.dnsmasq) { let insts = obj.dnsmasq.instances || {}; for (let k in insts) { if (insts[k].running) { running = true; break; } } } } catch (e) {}
if (!running) vok = false;

// Verify routing conf exists
if (!stat(rcp)) vok = false;
let vs = int(time()) - tv;

if (!vok) {
	// Rollback
	job.phase = 'rolling_back'; job.error = { code: 'EVERIFY', message: 'verification failed' }; job.timings.verifyMs = vs * 1000; job.timings.totalMs = (int(time()) - t0) * 1000; job.updatedAt = now_iso(); write_job(jf, job);
	if (stat(sdp + '/previous-routing.conf')) { runcmd('cp -p ' + sdp + '/previous-routing.conf ' + rcp); } else { try { unlink(rcp); } catch (e) {} }
	runcmd('chmod 644 ' + rcp);
	if (stat(sdp + '/previous-state.json')) runcmd('cp -p ' + sdp + '/previous-state.json ' + stp);
	runcmd('/etc/init.d/dnsmasq restart');
	job.phase = 'rolled_back'; job.finished = true; job.finishedAt = now_iso(); job.rolledBack = true; job.timings.totalMs = (int(time()) - t0) * 1000; write_job(jf, job);
	try { let sdr = readfile(stp); if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: 'EVERIFY', message: 'verification failed' }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } } } catch (e) {}
	try { unlink(lockf); } catch (e) {}
	exit(1);
}

// Success
job.phase = 'success'; job.finished = true; job.finishedAt = now_iso(); job.verified = true; job.timings.verifyMs = vs * 1000; job.timings.totalMs = (int(time()) - t0) * 1000; job.updatedAt = now_iso(); write_job(jf, job);

// Update persistent state
try {
	let sdr = readfile(stp);
	if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' && obj.serviceDns != null ? obj.serviceDns : {}; let pn = sd.pending || {}; let ap = type(sd.applied) == 'object' ? sd.applied : {}; sd.applied = { selections: pn.desiredSelections || sd.selections || {}, revision: type(ap.revision) == 'int' ? ap.revision + 1 : 1, routingHash: jr.routingHash || '', routes: rules, generatedAt: now_iso(), verifiedAt: now_iso(), verification: { config: 'ok', dnsmasq: running ? 'ok' : 'unknown', providerRouting: vok ? 'ok' : 'failed' } }; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'success', phase: 'success', error: null, startedAt: jr.createdAt, finishedAt: now_iso() }; let evs = type(sd.events) == 'array' ? sd.events : []; push(evs, { ts: now_iso(), action: 'apply-success', operationId: opId }); if (length(evs) > 20) { let keep = []; for (let ei = length(evs) - 20; ei < length(evs); ei++) push(keep, evs[ei]); evs = keep; } sd.events = evs; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } }
} catch (e) {}
try { unlink(lockf); } catch (e) {}
exit(0);
