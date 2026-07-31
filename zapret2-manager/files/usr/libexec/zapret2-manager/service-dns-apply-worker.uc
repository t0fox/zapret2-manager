'use strict';
// The worker is the only Service DNS production mutator. It owns the native
// dnsmasq UCI cutover and restores the complete snapshot on every failure.

import { readfile, writefile, stat, unlink, popen } from 'fs';
let uci = require('uci');

const MANAGER_CONFDIR = '/etc/zapret2-manager/service-dns-routing.d';
let jobFile = null;
let job = null;
let statePath = null;
let lockFile = '/tmp/zapret2-manager/service-dns-apply.lock';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}

function now() { return trim(run('date -u +%Y-%m-%dT%H:%M:%SZ').out); }
function list_hash(values) { let h = 2166136261, raw = join('\n', values || []) + '\n'; for (let i = 0; i < length(raw); i++) h = (h ^ ord(substr(raw, i, 1))) * 16777619; return sprintf('%x', h); }
function copy_list(values) { let out = []; for (let i = 0; i < length(values || []); i++) push(out, values[i]); return out; }
function same_list(a, b) { return list_hash(a) == list_hash(b); }

function write_job(updates) {
	let cur = {}; try { cur = json(readfile(jobFile)) || {}; } catch (e) {}
	for (let key in updates) cur[key] = updates[key];
	cur.updatedAt = now();
	writefile(jobFile + '.tmp', sprintf('%J', cur) + '\n');
	run('mv -f ' + jobFile + '.tmp ' + jobFile);
}

function load_cursor(section) {
	let c = uci.cursor();
	if (!c.load('dhcp')) return null;
	let all = c.get_all('dhcp', section);
	if (!all || all['.type'] != 'dnsmasq') return null;
	return { cursor: c, all: all };
}
function list_value(all, key) {
	let raw = all[key];
	if (type(raw) == 'array') return copy_list(raw);
	if (type(raw) == 'string' && raw != '') return [raw];
	return [];
}
function set_list(c, section, key, values) {
	if (!length(values)) return c.delete('dhcp', section, key);
	return c.set('dhcp', section, key, values);
}
function remove_manager_confdir(values) {
	let out = [];
	for (let i = 0; i < length(values); i++) if (values[i] != MANAGER_CONFDIR) push(out, values[i]);
	return out;
}
function contains(values, value) { for (let i = 0; i < length(values); i++) if (values[i] == value) return true; return false; }

function active_dnsmasq() {
	let r = run("ubus call service list '{\"name\":\"dnsmasq\"}'");
	let root = null; try { root = json(r.out); } catch (e) {}
	let instances = root && root.dnsmasq ? root.dnsmasq.instances || {} : {};
	for (let section in instances) {
		let inst = instances[section];
		if (!inst.running || !match('' + inst.pid, /^[0-9]+$/)) continue;
		let pid = int(inst.pid);
		let pids = [pid];
		let children = trim(readfile('/proc/' + pid + '/task/' + pid + '/children') || '');
		let childrenList = split(children, ' ');
		for (let i = 0; i < length(childrenList); i++) if (match(childrenList[i], /^[0-9]+$/)) push(pids, int(childrenList[i]));
		for (let i = 0; i < length(pids); i++) {
			let cmdline = run("tr '\\000' ' ' < /proc/" + pids[i] + '/cmdline').out || '';
			let m = match(cmdline, /-C ([^ ]+)/);
			if (m && m[1]) return { section: section, pid: pids[i], config: m[1] };
		}
	}
	return null;
}

function fail_before_write(code, message) {
	write_job({ phase: 'failed', finished: true, error: { code: code, message: message }, finishedAt: now() });
	try { unlink(lockFile); } catch (e) {}
	exit(1);
}
function restore_state() {
	if (type(job.previousState) == 'string') {
		writefile(statePath + '.rollback', job.previousState);
		if (run('mv -f ' + statePath + '.rollback ' + statePath).rc != 0) return false;
	}
	return true;
}
function restore_uci() {
	let lc = load_cursor(job.nativeUciPrecondition.activeSection);
	if (!lc) return false;
	if (set_list(lc.cursor, job.nativeUciPrecondition.activeSection, 'server', job.previousUciServerEntries) === false) return false;
	if (set_list(lc.cursor, job.nativeUciPrecondition.activeSection, 'confdir', job.previousUciConfdirEntries) === false) return false;
	return lc.cursor.commit('dhcp') !== false;
}
function restore_legacy_files() {
	if (type(job.previousLegacyFragment) == 'string') {
		run('mkdir -p ' + MANAGER_CONFDIR);
		writefile(MANAGER_CONFDIR + '/10-routing.conf', job.previousLegacyFragment);
	} else try { unlink(MANAGER_CONFDIR + '/10-routing.conf'); } catch (e) {}
	return true;
}
function fail_and_rollback(code, message) {
	write_job({ phase: 'rolling_back', error: { code: code, message: message } });
	let ok = restore_uci() && restore_legacy_files() && restore_state();
	let restart = run('/etc/init.d/dnsmasq restart').rc == 0;
	if (!ok || !restart) {
		write_job({ phase: 'rollback_failed', finished: true, error: { code: 'EROLLBACK', message: 'rollback failed after ' + code }, finishedAt: now() });
		try { unlink(lockFile); } catch (e) {}
		exit(1);
	}
	write_job({ phase: 'rolled_back', finished: true, rolledBack: true, error: { code: code, message: message }, finishedAt: now() });
	try { unlink(lockFile); } catch (e) {}
	exit(1);
}

jobFile = ARGV[0];
if (!jobFile || !stat(jobFile)) exit(1);
try { job = json(readfile(jobFile)); } catch (e) {}
if (!job || type(job) != 'object') exit(1);
statePath = job.statePath || '/etc/zapret2-manager/service-dns-state.json';
let pre = job.nativeUciPrecondition;
if (!pre || type(pre) != 'object') fail_before_write('EJOBPRECONDITION', 'native UCI precondition missing');

let active = active_dnsmasq();
if (!active || active.section != pre.activeSection) fail_before_write('ECONFLICT', 'active dnsmasq section changed');
let loaded = load_cursor(active.section);
if (!loaded) fail_before_write('ETARGET', 'active dnsmasq UCI section unavailable');
let currentServer = list_value(loaded.all, 'server');
let currentConfdir = list_value(loaded.all, 'confdir');
if (list_hash(currentServer) != pre.serverListHash || list_hash(currentConfdir) != pre.confdirListHash)
	fail_before_write('ECONFLICT', 'dnsmasq UCI list changed since preview');

write_job({ phase: 'mutating', finished: false });
// One logical UCI transaction: native routes appear and the legacy confdir is
// disconnected before any config or runtime verification takes place.
if (set_list(loaded.cursor, active.section, 'server', job.resultingServerEntries) === false)
	fail_before_write('EUCIWRITE', 'cannot set native server entries');
if (set_list(loaded.cursor, active.section, 'confdir', remove_manager_confdir(currentConfdir)) === false)
	fail_before_write('EUCIWRITE', 'cannot remove manager confdir');
if (loaded.cursor.commit('dhcp') === false) fail_and_rollback('EUCICOMMIT', 'dhcp commit failed');

loaded = load_cursor(active.section);
if (!loaded || !same_list(list_value(loaded.all, 'server'), job.resultingServerEntries))
	fail_and_rollback('EUCIREADBACK', 'server list readback mismatch');
if (contains(list_value(loaded.all, 'confdir'), MANAGER_CONFDIR))
	fail_and_rollback('EUCIREADBACK', 'legacy confdir remains registered');

active = active_dnsmasq();
if (!active || !stat(active.config)) fail_and_rollback('ECONFIGPATH', 'effective dnsmasq config unavailable');
if (run('dnsmasq --test -C ' + active.config).rc != 0) fail_and_rollback('ECONFIGTEST', 'effective config test failed');
write_job({ phase: 'reloading' });
if (run('/etc/init.d/dnsmasq restart').rc != 0) fail_and_rollback('ERESTART', 'dnsmasq restart failed');
let restartWait = 0;
active = null;
while (restartWait < 10) {
	active = active_dnsmasq();
	if (active && stat(active.config)) break;
	run('sleep 1');
	restartWait++;
}
if (!active || !stat(active.config)) fail_and_rollback('EVERIFY', 'dnsmasq not running after restart');
let effective = readfile(active.config) || '';
for (let i = 0; i < length(job.resultingServerEntries); i++) {
	let entry = job.resultingServerEntries[i];
	if (substr(entry, 0, 1) == '/' && index(effective, 'server=' + entry) < 0)
		fail_and_rollback('EVERIFY', 'effective config misses native server entry');
}
let check = load_cursor(active.section);
if (!check || contains(list_value(check.all, 'confdir'), MANAGER_CONFDIR))
	fail_and_rollback('EVERIFY', 'legacy confdir remains registered');

let state = {}; try { state = json(readfile(statePath)) || {}; } catch (e) {}
let sd = state.serviceDns || {};
sd.applied = { selections: job.desiredSelections || {}, revision: job.revision, managedServerEntries: job.managedServerEntries || [], externallySatisfiedEntries: job.externallySatisfiedEntries || [], verification: { config: 'ok', dnsmasq: 'ok', routingRegistered: true, providerRouting: 'unverified' }, verifiedAt: now() };
sd.pending = null;
sd.lastOperation = { operationId: job.operationId, state: 'success', phase: 'success', error: null, finishedAt: now() };
state.serviceDns = sd;
writefile(statePath + '.worker', sprintf('%J', state) + '\n');
if (run('mv -f ' + statePath + '.worker ' + statePath).rc != 0) fail_and_rollback('ESTATE', 'state write failed');

// Legacy data is no longer live. Delete only the known manager fragment and
// remove its directory only when it has no other files.
try { unlink(MANAGER_CONFDIR + '/10-routing.conf'); } catch (e) {}
let foreign = trim(run("find " + MANAGER_CONFDIR + " -mindepth 1 -maxdepth 1 -type f ! -name 10-routing.conf -print").out);
if (!foreign) run('rmdir ' + MANAGER_CONFDIR + ' 2>/dev/null');
write_job({ phase: 'success', finished: true, verified: true, finishedAt: now() });
try { unlink(lockFile); } catch (e) {}
exit(0);
