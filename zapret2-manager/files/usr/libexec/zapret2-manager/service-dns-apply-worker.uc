'use strict';
// service-dns-apply-worker.uc — routing apply worker (r46.5.1).
// Writes routing conf → validates dnsmasq config → reload → verify.
// Rollback restores previous routing conf + state.
// No undeclared variables. All join() calls use correct (separator, array) order.

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
let rules = type(jr.rules) == 'object' ? jr.rules : {};
let routeCount = length(keys(rules));
let desiredHash = jr.desiredHash || '';

// Phase: writing — confirm routing conf exists and is valid
write_job(jf, { phase: 'writing', pid: int(1000 + time() % 64000), finished: false });

if (!stat(rcp)) {
	write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'ENOCONF', message: 'routing conf missing' } });
	try { unlink(lockf); } catch (e) {} exit(1);
}

// Verify routing conf content is valid
let confContent = readfile(rcp) || '';
let confHash = '';
let h = popen('sha256sum ' + rcp + ' 2>/dev/null', 'r');
if (h) { let hout = h.read('all') || ''; h.close(); let parts = split(trim(hout), ' '); if (length(parts)) confHash = parts[0]; }

// Count actual directives
let dCount = 0;
let confLines = split(confContent, '\n');
for (let i = 0; i < length(confLines); i++) {
	if (substr(trim(confLines[i]), 0, 8) == 'server=/') dCount++;
}

// Validate: if routeCount > 0, dCount must be > 0
if (routeCount > 0 && dCount == 0) {
	write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EROUTINGCONF_EMPTY', message: 'routeCount=' + routeCount + ' but directiveCount=0' } });
	try { unlink(lockf); } catch (e) {} exit(1);
}

// Validate hash
let hashMatch = (desiredHash && confHash && desiredHash == confHash);
if (desiredHash && !hashMatch) {
	write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EHASHMISMATCH', message: 'conf hash ' + confHash + ' != desired ' + desiredHash } });
	try { unlink(lockf); } catch (e) {} exit(1);
}

let tw = int(time()) - t0;

// Register conf_file in dhcp
write_job(jf, { phase: 'registering' });
let dhcpConf = readfile('/etc/config/dhcp') || '';
if (index(dhcpConf, rcp) < 0) {
	let uciAdd = runcmd("uci add_list dhcp.@dnsmasq[0].conf_file='" + rcp + "'");
	if (uciAdd.rc != 0) {
		write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EUCIADD', message: 'uci add_list failed' } });
		try { unlink(lockf); } catch (e) {} exit(1);
	}
	let uciCommit = runcmd('uci commit dhcp');
	if (uciCommit.rc != 0) {
		write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EUCICOMMIT', message: 'uci commit failed' } });
		try { unlink(lockf); } catch (e) {} exit(1);
	}
}

// Phase: reloading
write_job(jf, { phase: 'reloading', timings: { writeMs: tw * 1000, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 } });

// Test config first
let testRes = runcmd('dnsmasq --test 2>&1');
if (testRes.rc != 0) {
	write_job(jf, { phase: 'rolling_back', error: { code: 'ECONFIGTEST', message: 'dnsmasq --test failed' } });
	if (stat(sdp + '/previous-routing.conf')) { runcmd('cp -p ' + sdp + '/previous-routing.conf ' + rcp); } else { try { unlink(rcp); } catch (e) {} }
	if (stat(sdp + '/previous-state.json')) runcmd('cp -p ' + sdp + '/previous-state.json ' + stp);
	runcmd('/etc/init.d/dnsmasq restart');
	write_job(jf, { phase: 'rolled_back', finished: true, finishedAt: now_iso(), rolledBack: true, error: { code: 'ECONFIGTEST', message: 'dnsmasq config test failed — rolled back' } });
	try { let sdr = readfile(stp); if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: 'ECONFIGTEST', message: 'dnsmasq config test failed' }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } } } catch (e) {}
	try { unlink(lockf); } catch (e) {} exit(1);
}

let tr = int(time());
let restartRes = runcmd('/etc/init.d/dnsmasq restart');
let rs = int(time()) - tr;
if (restartRes.rc != 0) {
	write_job(jf, { phase: 'rolling_back', error: { code: 'ERESTART', message: 'dnsmasq restart failed (rc=' + restartRes.rc + ')' } });
	if (stat(sdp + '/previous-routing.conf')) { runcmd('cp -p ' + sdp + '/previous-routing.conf ' + rcp); } else { try { unlink(rcp); } catch (e) {} }
	if (stat(sdp + '/previous-state.json')) runcmd('cp -p ' + sdp + '/previous-state.json ' + stp);
	runcmd('/etc/init.d/dnsmasq restart');
	write_job(jf, { phase: 'rolled_back', finished: true, finishedAt: now_iso(), rolledBack: true, error: { code: 'ERESTART', message: 'dnsmasq restart failed — rolled back' } });
	try { let sdr = readfile(stp); if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: 'ERESTART', message: 'dnsmasq restart failed' }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } } } catch (e) {}
	try { unlink(lockf); } catch (e) {} exit(1);
}

// Phase: verifying
write_job(jf, { phase: 'verifying', timings: { writeMs: tw * 1000, reloadMs: rs * 1000, verifyMs: 0, rollbackMs: 0, totalMs: (int(time()) - t0) * 1000 } });
let tv = int(time());
let vok = true;

// Verify dnsmasq running via ubus
let ubus = runcmd('ubus call service list \'{"name":"dnsmasq"}\'');
let running = false;
try { let obj = json(ubus.out); if (obj && obj.dnsmasq) { let insts = obj.dnsmasq.instances || {}; for (let k in insts) { if (insts[k].running) { running = true; break; } } } } catch (e) {}
if (!running) vok = false;

// Verify routing conf still valid
let verifyConf = readfile(rcp) || '';
let vDCount = 0; let vLines = split(verifyConf, '\n');
for (let i = 0; i < length(vLines); i++) { if (substr(trim(vLines[i]), 0, 8) == 'server=/') vDCount++; }
if (routeCount > 0 && vDCount == 0) vok = false;

let vs = int(time()) - tv;

if (!vok) {
	write_job(jf, { phase: 'rolling_back', error: { code: 'EVERIFY', message: 'verification failed' } });
	if (stat(sdp + '/previous-routing.conf')) { runcmd('cp -p ' + sdp + '/previous-routing.conf ' + rcp); } else { try { unlink(rcp); } catch (e) {} }
	runcmd('chmod 644 ' + rcp);
	if (stat(sdp + '/previous-state.json')) runcmd('cp -p ' + sdp + '/previous-state.json ' + stp);
	runcmd('/etc/init.d/dnsmasq restart');
	write_job(jf, { phase: 'rolled_back', finished: true, finishedAt: now_iso(), rolledBack: true });
	try { let sdr = readfile(stp); if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: 'EVERIFY', message: 'verification failed' }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } } } catch (e) {}
	try { unlink(lockf); } catch (e) {} exit(1);
}

// Success
write_job(jf, { phase: 'success', finished: true, finishedAt: now_iso(), verified: true, timings: { writeMs: tw * 1000, reloadMs: rs * 1000, verifyMs: vs * 1000, rollbackMs: 0, totalMs: (int(time()) - t0) * 1000 }, directiveCount: dCount, routeCount: routeCount });

// Update persistent state
try {
	let sdr = readfile(stp);
	if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' && obj.serviceDns != null ? obj.serviceDns : {}; let pn = sd.pending || {}; let ap = type(sd.applied) == 'object' ? sd.applied : {}; sd.applied = { selections: pn.desiredSelections || sd.selections || {}, revision: type(ap.revision) == 'int' ? ap.revision + 1 : 1, routingHash: desiredHash, routes: rules, generatedAt: now_iso(), verifiedAt: now_iso(), verification: { config: 'ok', dnsmasq: running ? 'ok' : 'unknown', providerRouting: vok ? 'ok' : 'failed' } }; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'success', phase: 'success', error: null, startedAt: jr.createdAt, finishedAt: now_iso() }; let evs = type(sd.events) == 'array' ? sd.events : []; push(evs, { ts: now_iso(), action: 'apply-success', operationId: opId }); if (length(evs) > 20) { let keep = []; for (let ei = length(evs) - 20; ei < length(evs); ei++) push(keep, evs[ei]); evs = keep; } sd.events = evs; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } }
} catch (e) {}
try { unlink(lockf); } catch (e) {} exit(0);
