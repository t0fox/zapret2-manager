#!/usr/bin/ucode
'use strict';
// Three-level status collector: runtime, applied and draft. The optional
// zapret2 engine is reported independently so its absence is not mislabeled
// as a cleanly stopped runtime.

import { readfile, writefile, stat, mkdir, lsdir, popen } from 'fs';
import {
	NFQUEUE, QLEN_WARN, QLEN_CRIT_CONSECUTIVE, CACHE_TTL_SEC,
	DAEMON, NFT_TABLE, PATHS
} from './constants.uc';
import { parse_queue } from './qlen.uc';
import { read_var } from './apply.uc';
import { runtime_summary } from './runtime-summary.uc';

function sh(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	p.close();
	return out ? out : '';
}

function iso_now() {
	let s = trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
	return length(s) ? s : null;
}

function iso_from_unix(sec) {
	if (sec == null) return null;
	let s = trim(sh("date -u -d @" + sec + " +%Y-%m-%dT%H:%M:%SZ 2>/dev/null"));
	if (length(s) && index(s, 'T') >= 0) return s;
	s = trim(sh("date -u -r " + sec + " +%Y-%m-%dT%H:%M:%SZ 2>/dev/null"));
	if (length(s) && index(s, 'T') >= 0) return s;
	return null;
}

function read_json(path, fallback) {
	try {
		let raw = readfile(path);
		return raw ? json(raw) : fallback;
	} catch (e) {
		return fallback;
	}
}

function engine_level() {
	let packagePresent = false;
	try { packagePresent = length(trim(sh('apk info -e zapret2'))) > 0; }
	catch (e) { packagePresent = false; }
	let binaryPresent = !!stat(PATHS.nfqws_bin);
	let servicePresent = !!stat(PATHS.upstream_init);
	return {
		installed: packagePresent && binaryPresent && servicePresent,
		packagePresent: packagePresent,
		binaryPresent: binaryPresent,
		servicePresent: servicePresent
	};
}

function find_pids() {
	let pids = [];
	let entries = lsdir('/proc');
	if (!entries) entries = [];
	for (let i = 0; i < length(entries); i++) {
		let name = entries[i];
		if (!match(name, /^[0-9]+$/)) continue;
		let cl = readfile('/proc/' + name + '/cmdline');
		if (!cl || !length(cl)) continue;
		let argv = split(cl, chr(0));
		let human = join(' ', argv);
		let bin = (length(argv) && length(argv[0])) ? argv[0] : '';
		if (index(bin, '/' + DAEMON) < 0 && bin != DAEMON) continue;
		let pst = stat('/proc/' + name);
		let pid = +name;
		let rss = null;
		try {
			let st_raw = readfile('/proc/' + name + '/status');
			if (st_raw) {
				let m = match(st_raw, /VmRSS:[ ]+([0-9]+)/);
				if (m) rss = +m[1];
			}
		} catch (e) { rss = null; }
		push(pids, {
			pid: pid,
			binary: (length(argv) && length(argv[0])) ? argv[0] : null,
			cmdline: trim(human),
			startTime: iso_from_unix(pst ? pst.mtime : null),
			rssKb: rss
		});
	}
	return pids;
}

function runtime_level(rules) {
	let pids = find_pids();
	let ps_summary = '';
	try {
		let raw = sh('ps w');
		let lines = split(raw, '\n');
		let hit = [];
		for (let i = 0; i < length(lines); i++)
			if (index(lines[i], DAEMON) >= 0 && index(lines[i], 'ps w') < 0)
				push(hit, trim(lines[i]));
		ps_summary = join('\n', hit);
	} catch (e) { ps_summary = ''; }
	let strategies = null;
	try {
		let raw = sh('list_table');
		strategies = length(raw) ? trim(raw) : null;
	} catch (e) { strategies = null; }
	return {
		present: length(pids) > 0,
		instances: pids,
		count: length(pids),
		psSummary: ps_summary,
		strategies: strategies,
		rulesPresent: !!rules
	};
}

function applied_level() {
	let conf = stat(PATHS.applied_conf);
	let uci_dump = null;
	try {
		let raw = sh('uci show zapret2');
		uci_dump = length(raw) ? trim(raw) : null;
	} catch (e) { uci_dump = null; }
	let generation = null;
	try {
		let raw = sh('uci -q get zapret2.@general[0].generation 2>/dev/null');
		if (length(raw)) generation = +trim(raw);
	} catch (e) { }
	return {
		configPath: PATHS.applied_conf,
		configPresent: !!conf,
		configMtime: conf ? iso_from_unix(conf.mtime) : null,
		configSize: conf ? conf.size : null,
		uci: uci_dump,
		generation: generation
	};
}

function draft_level() {
	return read_json(PATHS.draft_state, {});
}

function health_block() {
	let q = parse_queue();
	let sig = read_json(PATHS.qlen_state, null);
	let qstate = sig ? (sig.last_state ? sig.last_state : 'unknown') : 'unknown';
	let consec = sig ? (sig.consecutive ? sig.consecutive : 0) : 0;
	let qlenHealth = {
		state: qstate,
		threshold: QLEN_WARN,
		consecutiveOverThreshold: consec,
		critTurns: QLEN_CRIT_CONSECUTIVE
	};
	let checks = [];
	push(checks, { id: 'queue_health', state: qstate, registered: q.registered,
		queueTotal: q.queue_total });
	let queue = {
		number: NFQUEUE,
		registered: q.registered,
		reason: q.reason ? q.reason : null,
		peerPortid: q.peer_portid,
		ownerPid: null,
		ownerConflict: false,
		queueTotal: q.queue_total,
		copyRange: q.copy_range,
		queueDropped: q.queue_dropped,
		queueUserDropped: q.queue_user_dropped,
		updatedAt: sig ? iso_from_unix(sig.updated_at ? sig.updated_at : null) : null
	};
	return { qlenHealth: qlenHealth, checks: checks, queue: queue };
}

function rules_present() {
	try {
		let raw = sh('nft list table inet ' + NFT_TABLE);
		return length(raw) && index(raw, 'chain ') >= 0;
	} catch (e) {
		return false;
	}
}

function sha256_file(path) {
	if (!stat(path)) return null;
	try {
		let raw = sh("sha256sum " + path + " 2>/dev/null | awk '{print $1}'");
		let h = trim(raw);
		return length(h) ? h : null;
	} catch (e) { return null; }
}

function drift_block(runtime, rules) {
	let cur_config = sha256_file(PATHS.applied_conf);
	let cur_uci = sha256_file(PATHS.uci_conf);
	let stored = read_json('/tmp/zapret2-manager/applied.sha256', null);
	let norm = null;
	try {
		let parts = [];
		let pids = runtime.instances || [];
		for (let i = 0; i < length(pids); i++) push(parts, trim(pids[i].cmdline || ''));
		parts.sort();
		norm = join('\n', parts);
	} catch (e) { norm = null; }
	if (!runtime.present) {
		return { divergent: false, reason: 'process absent (nothing to compare)',
			basis: 'sha256-intermediate', appliedSha256: stored,
			currentSha256: { config: cur_config, uci: cur_uci }, normalizedRuntime: norm };
	}
	if (!stored) {
		return { divergent: false, reason: 'no stored apply hash (run an apply first)',
			basis: 'sha256-intermediate', appliedSha256: null,
			currentSha256: { config: cur_config, uci: cur_uci }, normalizedRuntime: norm };
	}
	let stored_config = stored.config ? stored.config : null;
	let stored_uci = stored.uci ? stored.uci : null;
	let divergent = (stored_config != null && cur_config != null && stored_config != cur_config) ||
		(stored_uci != null && cur_uci != null && stored_uci != cur_uci);
	return { divergent: divergent,
		reason: divergent ? 'applied sha256 mismatch (config or uci changed since last apply)' : 'applied hash matches',
		basis: 'sha256-intermediate', appliedSha256: stored,
		currentSha256: { config: cur_config, uci: cur_uci }, normalizedRuntime: norm };
}

function join_pids(pids) {
	let s = [];
	for (let i = 0; i < length(pids); i++) push(s, '' + pids[i].pid);
	return join(',', s);
}

function reconcile_queue_owner(runtime, health) {
	let q = (health && health.queue) ? health.queue : null;
	if (!q || !q.registered) return null;
	let pp = q.peerPortid;
	let pids = (runtime && runtime.instances) ? runtime.instances : [];
	let ownedByNfqws = false;
	for (let i = 0; i < length(pids); i++) {
		if (pids[i].pid == pp) { ownedByNfqws = true; break; }
	}
	q.ownerPid = pp;
	q.ownerConflict = !ownedByNfqws;
	if (q.ownerConflict) {
		if (length(pids))
			return 'QNUM ' + NFQUEUE + ' registered to PID ' + pp +
				', not to the detected nfqws2 process(es) [' + join_pids(pids) + ']';
		return 'QNUM ' + NFQUEUE + ' registered to PID ' + pp +
			' but no nfqws2 process is running (stale/unknown owner)';
	}
	return null;
}

function service_state(runtime, rules, health, draft, engine) {
	let qh = (health && health.qlenHealth) ? health.qlenHealth : null;
	let q = (health && health.queue) ? health.queue : null;
	let present = runtime && runtime.present;
	if (!engine || engine.installed !== true) return 'engine_missing';
	if (stat(PATHS.paused_flag)) return present ? 'error' : 'paused';
	if (draft && draft.passthrough && draft.passthrough.enabled)
		return present ? 'passthrough' : 'error';
	if (!present) {
		if (q && q.registered) return 'error';
		return 'stopped';
	}
	if (!rules) return 'partial';
	if (q && q.registered === false) return 'error';
	if (q && q.registered && q.ownerConflict) return 'error';
	if (qh && qh.state === 'critical') return 'error';
	return 'running';
}

const PROFILE_SEP = '--new';
function profile_count(opt_value) {
	if (opt_value == null) return null;
	let n = 0;
	let i = 0;
	let len = length(opt_value);
	let mlen = length(PROFILE_SEP);
	while (i < len) {
		let p = index(substr(opt_value, i), PROFILE_SEP);
		if (p < 0) break;
		n++;
		i = i + p + mlen;
	}
	return n + 1;
}

function nfqws2_version() {
	try {
		let raw = readfile(PATHS.applied_version);
		if (raw) { let v = trim(raw); if (length(v)) return v; }
	} catch (e) { }
	let flags = ['--version', '-V', 'version'];
	let bin = trim(sh('command -v nfqws2 2>/dev/null'));
	if (!length(bin)) bin = PATHS.nfqws_bin;
	for (let i = 0; i < length(flags); i++) {
		try {
			let raw = sh(bin + ' ' + flags[i] + ' 2>/dev/null | head -n 1');
			let v = trim(raw);
			if (length(v)) return v;
		} catch (e) { }
	}
	return null;
}

function autohostlist_vars() {
	let out = {};
	try {
		let raw = readfile(PATHS.applied_conf);
		if (!raw) return null;
		let lines = split(raw, '\n');
		for (let i = 0; i < length(lines); i++) {
			let line = trim(lines[i]);
			if (!length(line) || substr(line, 0, 12) != 'AUTOHOSTLIST') continue;
			let eq = index(line, '=');
			if (eq < 0) continue;
			let k = trim(substr(line, 0, eq));
			let v = trim(substr(line, eq + 1));
			if (length(v) >= 2 && substr(v, 0, 1) == '"' && substr(v, length(v) - 1, 1) == '"')
				v = substr(v, 1, length(v) - 2);
			out[k] = length(v) ? v : null;
		}
	} catch (e) { return null; }
	return out;
}

function system_info() {
	let autostart = { enabled: false, symlinks: [] };
	try {
		let entries = lsdir('/etc/rc.d');
		if (!entries) entries = [];
		let links = [];
		for (let i = 0; i < length(entries); i++)
			if (index(entries[i], 'zapret2') >= 0) push(links, entries[i]);
		autostart.symlinks = links;
		for (let i = 0; i < length(links); i++)
			if (substr(links[i], 0, 1) == 'S') { autostart.enabled = true; break; }
	} catch (e) { }
	let upgradable = null;
	try {
		let raw = sh('apk version -c 2>/dev/null');
		if (length(raw)) upgradable = index(raw, 'nfqws2') >= 0;
	} catch (e) { }
	return { autostart: autostart, upgradable: upgradable };
}

function upstream_info() {
	return { nfqws2Version: nfqws2_version(), autohostlist: autohostlist_vars() };
}

function collect() {
	try { mkdir('/tmp/zapret2-manager'); } catch (e) { }
	let engine, runtime, applied, draft, health, rules, system, upstream;
	try { engine = engine_level(); }
	catch (e) { engine = { installed: false, packagePresent: false, binaryPresent: false, servicePresent: false }; }
	try { rules = rules_present(); } catch (e) { rules = false; }
	try { runtime = runtime_level(rules); } catch (e) { runtime = { error: 'runtime collect failed: ' + e }; }
	try { applied = applied_level(); } catch (e) { applied = { error: 'applied collect failed: ' + e }; }
	try { draft = draft_level(); } catch (e) { draft = { error: 'draft read failed: ' + e }; }
	try { health = health_block(); } catch (e) { health = { error: 'health collect failed: ' + e }; }
	try { system = system_info(); } catch (e) { system = { error: 'system collect failed: ' + e }; }
	try { upstream = upstream_info(); } catch (e) { upstream = { error: 'upstream collect failed: ' + e }; }
	let ownerWarn = null;
	try { ownerWarn = reconcile_queue_owner(runtime, health); } catch (e) { ownerWarn = null; }
	let drift, svc_state, prof_count;
	try { drift = drift_block(runtime, rules); }
	catch (e) { drift = { divergent: false, reason: 'drift compute failed: ' + e, basis: 'sha256-intermediate' }; }
	try { svc_state = service_state(runtime, rules, health, draft, engine); }
	catch (e) { svc_state = 'error'; }
	try { prof_count = profile_count(read_var('NFQWS2_OPT')); } catch (e) { prof_count = null; }
	let instances = runtime.instances || [];
	let runtime_out = {
		present: runtime.present ? true : false,
		count: runtime.count ? runtime.count : 0,
		instances: instances,
		strategies: runtime.strategies ? runtime.strategies : null,
		profileCount: prof_count,
		psSummary: runtime.psSummary ? runtime.psSummary : '',
		rulesPresent: runtime.rulesPresent ? true : false
	};
	let generation = (applied && applied.generation != null) ? applied.generation : null;
	let applied_out = {
		configPath: applied.configPath ? applied.configPath : PATHS.applied_conf,
		configPresent: applied.configPresent ? true : false,
		configMtime: applied.configMtime ? applied.configMtime : null,
		configSize: applied.configSize ? applied.configSize : null,
		uci: applied.uci ? applied.uci : null
	};
	let warnings = [];
	if (ownerWarn) push(warnings, ownerWarn);
	if (!engine.installed) push(warnings, {
		code: 'engine_missing', message: 'Optional zapret2 engine is not installed or its runtime contract is incomplete.', severity: 'warn'
	});
	let status = {
		schema: 3,
		generatedAt: iso_now(),
		generation: generation,
		serviceState: svc_state,
		engine: engine,
		runtime: runtime_out,
		applied: applied_out,
		draft: draft,
		drift: drift,
		health: health,
		system: system,
		upstream: upstream,
		jobs: [],
		warnings: warnings,
		runtimeSummary: null
	};
	status.runtimeSummary = runtime_summary(status);
	try { writefile(PATHS.status_json, sprintf("%J", status) + '\n'); } catch (e) { }
	return status;
}

if (length(ARGV) == 0 || ARGV[0] != '--no-print') {
	let s = collect();
	print(sprintf("%J", s) + '\n');
} else {
	collect();
}
