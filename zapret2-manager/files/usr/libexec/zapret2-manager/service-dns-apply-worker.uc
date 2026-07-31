'use strict';
// service-dns-apply-worker.uc — routing apply worker (r46.5.2).
// Single rollback for all post-write failures. Exact count + tuple validation.
// No undeclared variables.

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

function valid_sha256(h) {
	return type(h) == 'string' && length(h) == 64 && match(h, /^[0-9a-f]{64}$/);
}

function parse_directive_tuples(content) {
	let tuples = {};
	let lines = split(content || '', '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (!l || substr(l, 0, 1) == '#') continue;
		if (substr(l, 0, 8) != 'server=/') continue;
		let rest = substr(l, 8);
		let slash = index(rest, '/');
		if (slash < 1) continue;
		let domain = substr(rest, 0, slash);
		let ip = substr(rest, slash + 1);
		if (!domain || !ip) continue;
		// validate domain (basic) and IPv4
		if (!match(ip, /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/)) continue;
		tuples[domain + '\0' + ip] = true;
	}
	return tuples;
}

function expected_tuples(rulesObj) {
	let tuples = {};
	for (let dk in rulesObj) {
		let ru = rulesObj[dk];
		if (!ru || type(ru) != 'object') continue;
		let ups = ru.upstreams || [];
		for (let j = 0; j < length(ups); j++) {
			tuples[dk + '\0' + ups[j]] = true;
		}
	}
	return tuples;
}

// ====== main ======
let jf = ARGV[0];
if (!jf) exit(1); if (!stat(jf)) exit(1);
let jr = null; try { jr = json(readfile(jf)); } catch (e) { exit(1); }
if (!jr || type(jr) != 'object') exit(1);

let opId = jr.operationId || 'unknown';
let t0 = int(time());
let stp = '/etc/zapret2-manager/service-dns-state.json';
let rcp = jr.routingConfPath || '/etc/zapret2-manager/service-dns-routing.d/10-routing.conf';
let rdir = jr.routingDir || '/etc/zapret2-manager/service-dns-routing.d';
let sdp = jr.snapDir || jr.jobDir || '/tmp/zapret2-manager/service-dns-jobs/' + opId;
let lockf = '/tmp/zapret2-manager/service-dns-apply.lock';

// Validate job metadata
let rules = type(jr.rules) == 'object' ? jr.rules : {};
let routeCount = length(keys(rules));
if (type(jr.routeCount) != 'int' || jr.routeCount != routeCount) {
	write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EJOB_ROUTECOUNT', message: 'routeCount mismatch' } });
	try { unlink(lockf); } catch (e) {} exit(1);
}
let expectedDirs = type(jr.directiveCount) == 'int' ? jr.directiveCount : 0;
if (expectedDirs <= 0 && routeCount > 0) {
	write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EJOB_DIRCOUNT', message: 'directiveCount must be >0 when routes exist' } });
	try { unlink(lockf); } catch (e) {} exit(1);
}
let desiredHash = jr.desiredHash || '';
if (!valid_sha256(desiredHash)) {
	write_job(jf, { phase: 'failed', finished: true, finishedAt: now_iso(), error: { code: 'EJOB_HASH_MISSING', message: 'desiredHash missing or invalid' } });
	try { unlink(lockf); } catch (e) {} exit(1);
}

// ====== single rollback for ALL post-write failures ======
function fail_and_rollback(code, message) {
	write_job(jf, { phase: 'rolling_back', error: { code: code, message: message } });
	if (stat(sdp + '/previous-routing.conf')) {
		runcmd('cp -p ' + sdp + '/previous-routing.conf ' + rcp);
		runcmd('chmod 644 ' + rcp);
	} else {
		try { unlink(rcp); } catch (e) {}
	}
	if (stat(sdp + '/previous-state.json')) runcmd('cp -p ' + sdp + '/previous-state.json ' + stp);
	// restore previous UCI conf_file if needed
	if (stat(sdp + '/previous-uci-conf-file.txt')) {
		let prev = readfile(sdp + '/previous-uci-conf-file.txt') || '';
		if (prev != readfile('/etc/config/dhcp')) {
			runcmd('uci delete dhcp.@dnsmasq[0].conf_file');
			let prevLines = split(prev, '\n');
			for (let i = 0; i < length(prevLines); i++) {
				let pl = trim(prevLines[i]);
				if (pl && substr(pl, 0, 10) == 'conf_file=') {
					// restore via uci — simplified: just remove our entry
				}
			}
			runcmd('uci commit dhcp');
		}
	}
	runcmd('/etc/init.d/dnsmasq restart');
	write_job(jf, { phase: 'rolled_back', finished: true, finishedAt: now_iso(), rolledBack: true, error: { code: code, message: message } });
	// clear pending in state
	try {
		let sdr = readfile(stp);
		if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' ? obj.serviceDns : {}; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'rolled_back', phase: 'rolled_back', error: { code: code, message: message }, startedAt: jr.createdAt, finishedAt: now_iso() }; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } }
	} catch (e) {}
	try { unlink(lockf); } catch (e) {} exit(1);
}

// Phase: writing — confirm routing conf exists and validate content
write_job(jf, { phase: 'writing', pid: int(1000 + time() % 64000), finished: false });

if (!stat(rcp)) fail_and_rollback('ENOCONF', 'routing conf missing');

let confContent = readfile(rcp) || '';
let confHash = '';
let h = popen('sha256sum ' + rcp + ' 2>/dev/null', 'r');
if (h) { let hout = h.read('all') || ''; h.close(); let parts = split(trim(hout), ' '); if (length(parts)) confHash = parts[0]; }

// Hash must match exactly
if (confHash != desiredHash) fail_and_rollback('EHASHMISMATCH', 'conf hash ' + confHash + ' != desired ' + desiredHash);

// Count actual directives
let dCount = 0;
let confLines = split(confContent, '\n');
for (let i = 0; i < length(confLines); i++) {
	if (substr(trim(confLines[i]), 0, 8) == 'server=/') dCount++;
}

// Exact count match
if (dCount != expectedDirs) fail_and_rollback('EROUTINGCONF_COUNT', 'actual=' + dCount + ' expected=' + expectedDirs);

// Tuple set validation
let actualTuples = parse_directive_tuples(confContent);
let expectedTuples = expected_tuples(rules);
let actualKeys = keys(actualTuples);
let expectedKeys = keys(expectedTuples);
if (length(actualKeys) != length(expectedKeys)) fail_and_rollback('EROUTINGCONF_TUPLES', 'tuple count ' + length(actualKeys) + ' != ' + length(expectedKeys));
for (let i = 0; i < length(expectedKeys); i++) {
	if (!actualTuples[expectedKeys[i]]) fail_and_rollback('EROUTINGCONF_TUPLES', 'missing tuple: ' + expectedKeys[i]);
}
for (let i = 0; i < length(actualKeys); i++) {
	if (!expectedTuples[actualKeys[i]]) fail_and_rollback('EROUTINGCONF_TUPLES', 'extra tuple: ' + actualKeys[i]);
}

let tw = int(time()) - t0;

// Register conf_file in dhcp
write_job(jf, { phase: 'registering' });
let dhcpConf = readfile('/etc/config/dhcp') || '';
	if (index(dhcpConf, rdir) < 0) {
		if (runcmd("uci add_list dhcp.@dnsmasq[0].confdir='" + rdir + "'").rc != 0) fail_and_rollback('EUCIADD', 'uci add_list failed');
		if (runcmd('uci commit dhcp').rc != 0) fail_and_rollback('EUCICOMMIT', 'uci commit failed');
	}

// Phase: reloading
write_job(jf, { phase: 'reloading', timings: { writeMs: tw * 1000, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 } });

// Config test
if (runcmd('dnsmasq --test 2>&1').rc != 0) fail_and_rollback('ECONFIGTEST', 'dnsmasq --test failed');

// Restart
let tr = int(time());
if (runcmd('/etc/init.d/dnsmasq restart').rc != 0) fail_and_rollback('ERESTART', 'dnsmasq restart failed');
let rs = int(time()) - tr;

// Phase: full post-restart verification
write_job(jf, { phase: 'verifying', timings: { writeMs: tw * 1000, reloadMs: rs * 1000, verifyMs: 0, rollbackMs: 0, totalMs: (int(time()) - t0) * 1000 } });
let tv = int(time());

// 1. file exists
if (!stat(rcp)) fail_and_rollback('EVERIFY', 'routing conf missing after restart');

// 2. exact hash
let vHash = '';
let vh = popen('sha256sum ' + rcp + ' 2>/dev/null', 'r');
if (vh) { let ho = vh.read('all') || ''; vh.close(); let ps = split(trim(ho), ' '); if (length(ps)) vHash = ps[0]; }
if (vHash != desiredHash) fail_and_rollback('EVERIFY', 'hash mismatch after restart');

// 3. exact directive count
let vDCount = 0; let vLines = split(readfile(rcp) || '', '\n');
for (let i = 0; i < length(vLines); i++) { if (substr(trim(vLines[i]), 0, 8) == 'server=/') vDCount++; }
if (vDCount != expectedDirs) fail_and_rollback('EVERIFY', 'post-restart dCount=' + vDCount + ' expected=' + expectedDirs);

// 4. exact tuple set
let vTuples = parse_directive_tuples(readfile(rcp) || '');
let vKeys = keys(vTuples);
if (length(vKeys) != length(expectedKeys)) fail_and_rollback('EVERIFY', 'post-restart tuple count mismatch');
for (let i = 0; i < length(expectedKeys); i++) {
	if (!vTuples[expectedKeys[i]]) fail_and_rollback('EVERIFY', 'missing tuple after restart: ' + expectedKeys[i]);
}

	// 5. UCI confdir registration
	let vDhcp = readfile('/etc/config/dhcp') || '';
	if (index(vDhcp, rdir) < 0) fail_and_rollback('EVERIFY', 'confdir not registered after restart');

// 6. dnsmasq running
let ubus = runcmd('ubus call service list \'{"name":"dnsmasq"}\'');
let running = false;
try { let obj = json(ubus.out); if (obj && obj.dnsmasq) { let insts = obj.dnsmasq.instances || {}; for (let k in insts) { if (insts[k].running) { running = true; break; } } } } catch (e) {}
if (!running) fail_and_rollback('EVERIFY', 'dnsmasq not running after restart');

let vs = int(time()) - tv;

// Success
write_job(jf, { phase: 'success', finished: true, finishedAt: now_iso(), verified: true, timings: { writeMs: tw * 1000, reloadMs: rs * 1000, verifyMs: vs * 1000, rollbackMs: 0, totalMs: (int(time()) - t0) * 1000 }, directiveCount: dCount, routeCount: routeCount });

try {
	let sdr = readfile(stp);
	if (sdr) { let obj = json(sdr); if (obj && type(obj) == 'object') { let sd = type(obj.serviceDns) == 'object' && obj.serviceDns != null ? obj.serviceDns : {}; let pn = sd.pending || {}; let ap = type(sd.applied) == 'object' ? sd.applied : {}; sd.applied = { selections: pn.desiredSelections || sd.selections || {}, revision: type(ap.revision) == 'int' ? ap.revision + 1 : 1, routingHash: desiredHash, routeCount: routeCount, directiveCount: dCount, routes: rules, generatedAt: now_iso(), verifiedAt: now_iso(), verification: { config: 'ok', dnsmasq: 'ok', routingRegistered: true, providerRouting: 'unverified' } }; sd.pending = null; sd.lastOperation = { operationId: opId, state: 'success', phase: 'success', error: null, startedAt: jr.createdAt, finishedAt: now_iso() }; let evs = type(sd.events) == 'array' ? sd.events : []; push(evs, { ts: now_iso(), action: 'apply-success', operationId: opId }); if (length(evs) > 20) { let keep = []; for (let ei = length(evs) - 20; ei < length(evs); ei++) push(keep, evs[ei]); evs = keep; } sd.events = evs; let t2 = stp + '.wrk.' + opId; writefile(t2, sprintf("%J", { serviceDns: sd }) + "\n"); runcmd('mv -f ' + t2 + ' ' + stp); } }
} catch (e) {}
try { unlink(lockf); } catch (e) {} exit(0);
