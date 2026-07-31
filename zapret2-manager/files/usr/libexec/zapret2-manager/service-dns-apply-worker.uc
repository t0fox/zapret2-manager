'use strict';
// service-dns-apply-worker.uc — background apply worker.
// Called from service_dns_apply_async with a job state file.
// Does: write → dnsmasq reload → verify → rollback on failure.
// Updates the job file atomically at each phase.

import { readfile, writefile, stat, unlink, popen } from 'fs';

const WORK_DIR = '/tmp/zapret2-manager';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function now_iso() {
	let s = run('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null').out || '';
	return trim(s);
}

function update_job(file, phase, extra) {
	let tmp = file + '.tmp';
	let obj = {};
	if (extra != null) for (let k in extra) obj[k] = extra[k];
	obj.phase = phase;
	obj.updatedAt = now_iso();
	writefile(tmp, sprintf("%J", obj) + "\n");
	run('mv -f ' + tmp + ' ' + file);
}

let jobFile = ARGV[0];
if (!jobFile) { print(sprintf("%J", { ok: false, error: 'no job file' }) + '\n'); exit(1); }
if (!stat(jobFile)) { print(sprintf("%J", { ok: false, error: 'job file not found' }) + '\n'); exit(1); }

let job = json(readfile(jobFile));
if (!job || type(job) != 'object') { exit(1); }

let opId = job.operationId || 'unknown';
let statePath = job.statePath || '/etc/zapret2-manager/service-dns-state.json';
let overridesPath = job.overridesPath || '/etc/zapret2-manager/dns-overrides.hosts';
let snapDir = job.snapDir || '/tmp/zapret2-manager/last-good/service-dns';

update_job(jobFile, 'writing', {});

// write overrides
let rendered = job.rendered || '';
let tmpOverrides = overridesPath + '.tmp.' + int(time());
if (rendered) {
	writefile(tmpOverrides, rendered);
	let mv = run('mv -f ' + tmpOverrides + ' ' + overridesPath);
	if (mv.rc != 0) {
		try { unlink(tmpOverrides); } catch (e) {}
		update_job(jobFile, 'failed', { error: 'write failed' });
		exit(1);
	}
	run('chmod 644 ' + overridesPath);
}

// register in dhcp
update_job(jobFile, 'reloading', {});
let conf = readfile('/etc/config/dhcp') || '';
if (index(conf, overridesPath) < 0) {
	run("uci add_list dhcp.@dnsmasq[0].addnhosts='" + overridesPath + "'");
	run('uci commit dhcp');
}

// dnsmasq reload
let t0 = time();
run('/etc/init.d/dnsmasq restart');
let reloadSec = time() - t0;

update_job(jobFile, 'verifying', { reloadMs: reloadSec * 1000 });

// verify
let verifyOk = true;
let records = job.records || [];
for (let i = 0; i < length(records) && i < 20; i++) {
	let r = records[i];
	let ips = r.A || [];
	for (let j = 0; j < length(ips) && j < 2; j++) {
		let ns = run('nslookup ' + r.hostname + ' 127.0.0.1 2>/dev/null');
		if (index(ns.out, ips[j]) >= 0) continue;
		verifyOk = false;
		break;
	}
	if (!verifyOk) break;
}

if (!verifyOk) {
	update_job(jobFile, 'rolling_back', {});
	if (stat(snapDir + '/overrides.hosts')) {
		run('cp -p ' + snapDir + '/overrides.hosts ' + overridesPath);
	}
	if (stat(snapDir + '/service-dns-state.json')) {
		run('cp -p ' + snapDir + '/service-dns-state.json ' + statePath);
	}
	run('/etc/init.d/dnsmasq restart');
	update_job(jobFile, 'rolled_back', { error: 'verification failed', finished: true, finishedAt: now_iso() });
	exit(1);
}

update_job(jobFile, 'success', { finished: true, finishedAt: now_iso(), verified: true });
exit(0);
