#!/usr/bin/ucode
'use strict';
// status.uc — three-level status collector for zapret2-manager (schema v2,
// camelCase — see docs/contracts/status.schema.json).
//
// Collects, never mixes, three independent levels (docs/architecture.md §3):
//   RUNTIME  — ps + list_table + actual /proc/<pid>/cmdline of nfqws2
//   APPLIED  — /opt/zapret2/config + /etc/config/zapret2 (on-disk intent)
//   DRAFT    — /etc/zapret2-manager/state.json (manager's staged edits)
//
// Plus the third liveness signal: NFQUEUE qlen for queue 300, with a
// consecutive-exceedance counter (warn >50, critical after 3 in a row).
//
// Run as a CLI it writes PATHS.status_json and prints it. The rpcd plugin
// (usr/libexec/rpcd/zapret2-manager.uc) re-runs this on cache miss.
//
// The collector computes the backend conclusions (serviceState, drift,
// qlenHealth, checks) so the UI and the watchdog see the same picture; the UI
// only renders. [VERIFY] markers note upstream integration points to confirm
// on the target device — see docs/upstream-mapping.md. The collection
// *structure* does not depend on those; only the exact source paths/commands.

import { readfile, writefile, stat, mkdir, lsdir, popen } from 'fs';
import { parse as jparse, stringify as jstringify } from 'json';
import {
	NFQUEUE, QLEN_WARN, QLEN_CRIT_CONSECUTIVE, CACHE_TTL_SEC,
	DAEMON, NFT_TABLE, PATHS
} from './constants.uc';
import { parse_queue } from './qlen.uc';

// ---- helpers ----------------------------------------------------------------

function sh(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	p.close();
	return out ? out : '';
}

// ISO-8601 UTC with timezone. Wall-clock, not monotonic. [VERIFY] date -u
// format on target — smoke.sh 02 reads status.generatedAt as an ISO string.
function iso_now() {
	let s = trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
	return length(s) ? s : null;
}

// Convert a unix-seconds value to ISO-8601 UTC, or null if the input is null.
function iso_from_unix(sec) {
	if (sec == null) return null;
	let s = trim(sh('date -u -d @' + sec + ' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
	if (length(s)) return s;
	// fallback: busybox date may not support -d @N; format manually is not
	// possible without gmtime, so fall back to a unix-stamp string marker.
	return null;
}

function mtime_of(path) {
	let st = stat(path);
	return st ? st.mtime : null;   // [VERIFY] stat().mtime in seconds
}

function read_json(path, fallback) {
	try {
		let raw = readfile(path);
		return raw ? jparse(raw) : fallback;
	} catch (e) {
		return fallback;
	}
}

// ---- RUNTIME: process + strategies + actual cmdline -------------------------

function find_pids() {
	let pids = [];
	let entries = lsdir('/proc');
	if (!entries) entries = [];
	for (let i = 0; i < length(entries); i++) {
		let name = entries[i];
		if (!match(name, /^[0-9]+$/)) continue;
		let cl = readfile('/proc/' + name + '/cmdline');
		if (!cl || !length(cl)) continue;
		let human = replace(cl, '\x00', ' ');   // NUL-separated → space
		if (index(human, DAEMON) < 0) continue;
		let pst = stat('/proc/' + name);
		let pid = +name;
		// RSS in KB from /proc/<pid>/status (VmRSS line). null if unreadable.
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
		ps_summary = join(hit, '\n');
	} catch (e) { ps_summary = ''; }

	let strategies = null;
	try {
		let raw = sh('list_table');
		strategies = length(raw) ? trim(raw) : null;
	} catch (e) { strategies = null; }

	return {
		present: length(pids) > 0,
		pids_internal: pids,            // renamed to instances below
		count: length(pids),
		psSummary: ps_summary,
		strategies: strategies,
		rulesPresent: !!rules,
		collected: iso_now()
	};
}

// ---- APPLIED: on-disk config + uci ------------------------------------------

function applied_level() {
	let conf = stat(PATHS.applied_conf);
	let uci_dump = null;
	try {
		let raw = sh('uci show zapret2');
		uci_dump = length(raw) ? trim(raw) : null;   // null if /etc/config/zapret2 absent
	} catch (e) { uci_dump = null; }

	// generation marker: best-effort. [VERIFY] where upstream stores it.
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
		// generation is hoisted to the top-level `generation` field in collect()
		_generation: generation
	};
}

// ---- DRAFT: manager's own staged state --------------------------------------

function draft_level() {
	return read_json(PATHS.draft_state, {});
}

// ---- health: qlen signal + checks -------------------------------------------
//
// qlenHealth (state, threshold, consecutiveOverThreshold, critTurns) is
// backend-computed from the watchdog's persisted qlen.state.json; the UI only
// renders it. Raw queue values live in health.queue; the discrete checks in
// health.checks[] carry id from a closed set. A null result field = "checked,
// no value"; an absent field = "not checked" (the UI renders these differently).

function health_block() {
	let q = parse_queue();
	let sig = read_json(PATHS.qlen_state, null);

	let qstate = sig ? (sig.last_state ? sig.last_state : 'unknown') : 'unknown';
	let consec = sig ? (sig.consecutive ? sig.consecutive : 0) : 0;

	let qlenHealth = {
		state: qstate,
		threshold: QLEN_WARN,                 // 50
		consecutiveOverThreshold: consec,
		critTurns: QLEN_CRIT_CONSECUTIVE      // 3
	};

	let checks = [];
	// queue_health is always emitted (we always read the queue). Other checks
	// (dns_consistency, tls12_reachable, udp443_quic, lua_version_match) are
	// future; they are ABSENT here = "not checked" until wired.
	push(checks, { id: 'queue_health', state: qstate, registered: q.registered,
		queueTotal: q.queue_total });

	let queue = {
		number: NFQUEUE,
		registered: q.registered,
		reason: q.reason ? q.reason : null,
		queueTotal: q.queue_total,           // instantaneous; threshold 50 applies
		copyRange: q.copy_range,
		queueDropped: q.queue_dropped,       // cumulative raw; delta-only downstream
		queueUserDropped: q.queue_user_dropped,
		updatedAt: sig ? iso_from_unix(sig.updated_at ? sig.updated_at : null) : null
	};

	return { qlenHealth: qlenHealth, checks: checks, queue: queue };
}

// ---- rules present (nft table zapret2) --------------------------------------

function rules_present() {
	try {
		let raw = sh('nft list table ' + NFT_TABLE);
		return length(raw) && index(raw, 'chain ') >= 0;
	} catch (e) {
		return false;
	}
}

// ---- drift (RUNTIME vs APPLIED), backend-computed ---------------------------
//
// Ground truth is: does the running argv match what the applied state would
// generate? The full argv-render basis is the target; until that renderer
// exists we use the sha256-INTERMEDIATE basis: hashes of BOTH applied sources
// captured at apply time into /tmp/zapret2-manager/applied.sha256, compared
// each collection. Both sources are hashed, never one alone. If there is no
// stored apply hash, drift is unknown, not divergent — the UI must not cry wolf.
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
	let cur_uci    = sha256_file(PATHS.uci_conf);
	let stored = read_json('/tmp/zapret2-manager/applied.sha256', null);

	let norm = null;
	try {
		let parts = [];
		let pids = runtime.pids_internal || [];
		for (let i = 0; i < length(pids); i++)
			push(parts, trim(pids[i].cmdline || ''));
		parts.sort();
		norm = join(parts, '\n');
	} catch (e) { norm = null; }

	if (!runtime.present) {
		return { divergent: false, reason: 'process absent (nothing to compare)',
			basis: 'sha256-intermediate',
			appliedSha256: stored,
			currentSha256: { config: cur_config, uci: cur_uci },
			normalizedRuntime: norm };
	}
	if (!stored) {
		return { divergent: false, reason: 'no stored apply hash (run an apply first)',
			basis: 'sha256-intermediate', appliedSha256: null,
			currentSha256: { config: cur_config, uci: cur_uci },
			normalizedRuntime: norm };
	}
	let stored_config = stored.config ? stored.config : null;
	let stored_uci = stored.uci ? stored.uci : null;
	let divergent = (stored_config != null && cur_config != null && stored_config != cur_config) ||
		(stored_uci != null && cur_uci != null && stored_uci != cur_uci);
	return { divergent: divergent,
		reason: divergent ? 'applied sha256 mismatch (config or uci changed since last apply)' : 'applied hash matches',
		basis: 'sha256-intermediate',
		appliedSha256: stored,
		currentSha256: { config: cur_config, uci: cur_uci },
		normalizedRuntime: norm };
}

// ---- serviceState (backend-computed; UI only renders) -----------------------
//
// Closed enum: running, stopped, partial, error, paused, passthrough. paused
// and passthrough are self-standing states. priority: paused > passthrough >
// stopped > partial > error > running. qlen warn does NOT change serviceState
// away from running (it is carried in health.qlenHealth.state).

function service_state(runtime, rules, health, draft) {
	let qh = (health && health.qlenHealth) ? health.qlenHealth : null;
	// paused indicator (manager-only, /tmp) — the intended pause stance.
	if (stat(PATHS.paused_flag)) return 'paused';
	// passthrough profile active in draft
	if (draft && draft.passthrough && draft.passthrough.enabled) return 'passthrough';
	if (!runtime.present) return 'stopped';
	if (!rules) return 'partial';
	if (health && health.queue && health.queue.registered === false) return 'error';
	if (qh && qh.state === 'critical') return 'error';
	return 'running';
}

// profile count from list_table output (backend-computed; UI only renders).
function profile_count(strategies) {
	if (!strategies || !length(strategies)) return null;
	let n = 0;
	let lines = split(strategies, '\n');
	for (let i = 0; i < length(lines); i++)
		if (length(trim(lines[i]))) n++;
	return n;
}

// ---- system + upstream (split from the old meta block) ----------------------

// nfqws2 version, resolved in a fixed order: read /opt/zapret2/version first;
// if absent, ask the binary; if that yields nothing, return null. null means
// "checked, no value" (distinct from the key being absent = "not checked") —
// the UI renders the two differently.
function nfqws2_version() {
	try {
		let raw = readfile(PATHS.applied_version);
		if (raw) { let v = trim(raw); if (length(v)) return v; }
	} catch (e) { }
	// Binary fallback: the exact version flag is unconfirmed, so try the common
	// forms and take the first non-empty line. [VERIFY:ROUTER] which flag the
	// binary answers — answered by smoke.sh 02 (status.upstream.nfqws2Version is
	// a string on a device where /opt/zapret2/version is absent). NOTE: the real
	// binary is /opt/zapret2/nfq2/nfqws2 (may not be in PATH as 'nfqws2').
	let flags = ['--version', '-V', 'version'];
	for (let i = 0; i < length(flags); i++) {
		try {
			let raw = sh('nfqws2 ' + flags[i] + ' 2>/dev/null | head -n 1');
			let v = trim(raw);
			if (length(v)) return v;
		} catch (e) { }
	}
	return null;
}

// AUTOHOSTLIST* vars from /opt/zapret2/config, read verbatim and shown as-is.
// The manager applies NO thresholds of its own here — these are upstream's
// knobs, displayed for the operator. Values are null when unset.
function autohostlist_vars() {
	let out = {};
	try {
		let raw = readfile(PATHS.applied_conf);
		if (!raw) return null;
		let lines = split(raw, '\n');
		for (let i = 0; i < length(lines); i++) {
			let line = trim(lines[i]);
			if (!length(line)) continue;
			if (substr(line, 0, 12) != 'AUTOHOSTLIST') continue;
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
	return {
		nfqws2Version: nfqws2_version(),
		autohostlist: autohostlist_vars()
	};
}

// ---- assemble ----------------------------------------------------------------

function collect() {
	try { mkdir('/tmp/zapret2-manager'); } catch (e) { }

	let runtime, applied, draft, health, rules, system, upstream;
	try { rules = rules_present(); } catch (e) { rules = false; }
	try { runtime = runtime_level(rules); } catch (e) { runtime = { error: 'runtime collect failed: ' + e }; }
	try { applied = applied_level(); } catch (e) { applied = { error: 'applied collect failed: ' + e }; }
	try { draft = draft_level(); } catch (e) { draft = { error: 'draft read failed: ' + e }; }
	try { health = health_block(); } catch (e) { health = { error: 'health collect failed: ' + e }; }
	try { system = system_info(); } catch (e) { system = { error: 'system collect failed: ' + e }; }
	try { upstream = upstream_info(); } catch (e) { upstream = { error: 'upstream collect failed: ' + e }; }

	// Backend-computed conclusions (the UI renders these, it does not recompute).
	let drift, svc_state, prof_count;
	try { drift = drift_block(runtime, rules); } catch (e) { drift = { divergent: false, reason: 'drift compute failed: ' + e, basis: 'sha256-intermediate' }; }
	try { svc_state = service_state(runtime, rules, health, draft); } catch (e) { svc_state = 'error'; }
	try { prof_count = profile_count(runtime.strategies); } catch (e) { prof_count = null; }

	// Re-key runtime: pids_internal → instances, drop the helper fields.
	let instances = runtime.pids_internal || [];
	let runtime_out = {
		present: runtime.present ? true : false,
		count: runtime.count ? runtime.count : 0,
		instances: instances,
		strategies: runtime.strategies ? runtime.strategies : null,
		profileCount: prof_count,
		psSummary: runtime.psSummary ? runtime.psSummary : '',
		rulesPresent: runtime.rulesPresent ? true : false
	};

	// generation hoisted to top-level (from applied._generation).
	let generation = (applied && applied._generation != null) ? applied._generation : null;
	let applied_out = {
		configPath: applied.configPath ? applied.configPath : PATHS.applied_conf,
		configPresent: applied.configPresent ? true : false,
		configMtime: applied.configMtime ? applied.configMtime : null,
		configSize: applied.configSize ? applied.configSize : null,
		uci: applied.uci ? applied.uci : null
	};

	let status = {
		schema: 2,
		generatedAt: iso_now(),
		generation: generation,
		serviceState: svc_state,
		runtime: runtime_out,
		applied: applied_out,
		draft: draft,
		drift: drift,
		health: health,
		system: system,
		upstream: upstream,
		jobs: [],
		warnings: []
	};

	try { writefile(PATHS.status_json, jstringify(status, null, '  ') + '\n'); } catch (e) { }
	return status;
}

// ---- CLI entry ---------------------------------------------------------------

if (length(ARGV) == 0 || ARGV[0] != '--no-print') {
	let s = collect();
	print(jstringify(s, null, '  ') + '\n');
} else {
	collect();
}
