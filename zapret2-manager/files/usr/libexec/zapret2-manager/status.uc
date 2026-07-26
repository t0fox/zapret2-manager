#!/usr/bin/ucode
'use strict';
// status.uc — three-level status collector for zapret2-manager.
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
// [VERIFY] markers note upstream integration points to confirm on the target
// device — see docs/upstream-mapping.md. The collection *structure* does not
// depend on those; only the exact source paths/commands do.

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
	return out ?? '';
}

function now() {
	return time();   // [VERIFY] ucode time() returns unix seconds
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
	// Scan /proc for processes whose cmdline contains the daemon name.
	// Robust against ps format drift; the task wants ps as a source too, so
	// we also capture a ps line per pid for the human-readable view.
	let pids = [];
	let entries = lsdir('/proc') ?? [];
	for (let i = 0; i < length(entries); i++) {
		let name = entries[i];
		if (!match(name, /^[0-9]+$/)) continue;
		let cl = readfile('/proc/' + name + '/cmdline') ?? '';
		if (!length(cl)) continue;
		let human = replace(cl, '\x00', ' ');   // NUL-separated → space
		if (index(human, DAEMON) >= 0) {
			let pst = stat('/proc/' + name);
			push(pids, {
				pid: +name,
				cmdline: trim(human),
				start_time: pst ? pst.mtime : null   // /proc/<pid> dir mtime ≈ start
			});
		}
	}
	return pids;
}

function runtime_level() {
	let pids = find_pids();
	let ps_summary = '';
	try {
		// `ps w` filtered in-language (no shell grep on bracketed output).
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
		// [VERIFY] exact list_table invocation/output shape (upstream).
		let raw = sh('list_table');
		strategies = length(raw) ? trim(raw) : null;
	} catch (e) { strategies = null; }

	return {
		present: length(pids) > 0,
		pids: pids,
		count: length(pids),
		ps_summary: ps_summary,
		strategies: strategies,
		collected_at: now()
	};
}

// ---- APPLIED: on-disk config + uci ------------------------------------------

function applied_level() {
	let conf = stat(PATHS.applied_conf);
	let uci_dump = null;
	try {
		// [VERIFY] uci package name 'zapret2'. Best-effort structured dump.
		let raw = sh('uci show zapret2');
		uci_dump = length(raw) ? trim(raw) : null;
	} catch (e) { uci_dump = null; }

	// generation marker: best-effort. [VERIFY] where upstream stores it.
	let generation = null;
	try {
		let raw = sh('uci -q get zapret2.@general[0].generation 2>/dev/null');
		if (length(raw)) generation = +trim(raw);
	} catch (e) { }

	return {
		config_path: PATHS.applied_conf,
		config_present: !!conf,
		config_mtime: conf ? conf.mtime : null,
		config_size: conf ? conf.size : null,
		uci: uci_dump,
		generation: generation
	};
}

// ---- DRAFT: manager's own staged state --------------------------------------

function draft_level() {
	return read_json(PATHS.draft_state, {});
}

// ---- third liveness signal: NFQUEUE queue block -----------------------------
//
// Raw queue values come from the shared parser (qlen.uc). The cycle-based
// signals (queue_total three-consecutive → critical; queue_dropped delta →
// warn) are computed by the WATCHDOG on its 60s cycle and persisted to
// qlen.state.json; the collector only READS that state for display, so the UI
// and the watchdog see the same picture. If the watchdog has not run yet, the
// signal state is unknown.

function queues_block() {
	let q = parse_queue();
	let sig = read_json(PATHS.qlen_state, null);

	let warning = null;
	if (!q.registered) warning = 'queue_not_registered';

	return {
		number: NFQUEUE,
		registered: q.registered,
		reason: q.reason ?? null,
		warning: warning,
		queue_total: q.queue_total,           // instantaneous; threshold 50 applies
		copy_range: q.copy_range,
		queue_dropped: q.queue_dropped,       // cumulative raw; delta-only downstream
		queue_user_dropped: q.queue_user_dropped,
		signals: {
			state: sig ? (sig.last_state ?? 'unknown') : 'unknown',
			consecutive: sig ? (sig.consecutive ?? 0) : 0,
			dropped_delta: sig ? (sig.dropped_delta ?? null) : null,
			user_dropped_delta: sig ? (sig.user_dropped_delta ?? null) : null,
			updated_at: sig ? (sig.updated_at ?? null) : null
		}
	};
}

// ---- rules present (nft table zapret2) --------------------------------------

function rules_present() {
	try {
		// [VERIFY:ROUTER] table family. `nft list table <name>` resolves by name.
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
// exists we use the sha256-INTERMEDIATE basis allowed by REVIEW 2: hashes of
// BOTH applied sources (/opt/zapret2/config AND /etc/config/zapret2) captured
// at apply time into /tmp/zapret2-manager/applied.sha256, compared each
// collection. mtime is NOT used (package updates, backup restores, and any file
// touch change mtime without content → false positives; and edits in the UCI
// file alone were never noticed). Both sources are hashed, never one alone.
//
// If there is no stored apply hash (e.g. fresh boot before any apply), drift
// is unknown, not divergent — the UI must not cry wolf.
function sha256_file(path) {
	if (!stat(path)) return null;
	try {
		let raw = sh('sha256sum ' + path + " 2>/dev/null | awk '{print $1}'");
		let h = trim(raw);
		return length(h) ? h : null;
	} catch (e) { return null; }
}

function drift_block(runtime, rules) {
	let cur_config = sha256_file(PATHS.applied_conf);
	let cur_uci    = sha256_file(PATHS.uci_conf);
	let stored = read_json('/tmp/zapret2-manager/applied.sha256', null);

	// Also carry the normalized runtime argv for the future argv-render basis.
	let norm = null;
	try {
		let parts = [];
		let pids = runtime.pids || [];
		for (let i = 0; i < length(pids); i++)
			push(parts, trim(pids[i].cmdline || ''));
		// normalization: sort instance lines so order is not significant; per-
		// instance arg order is preserved (it IS significant for nfqws2).
		parts.sort();
		norm = join(parts, '\n');
	} catch (e) { norm = null; }

	if (!runtime.present) {
		return { divergent: false, reason: 'process absent (nothing to compare)',
			basis: 'sha256-intermediate', applied_sha256: stored,
			current_sha256: { config: cur_config, uci: cur_uci },
			normalized_runtime: norm };
	}
	if (!stored) {
		return { divergent: false, reason: 'no stored apply hash (run an apply first)',
			basis: 'sha256-intermediate', applied_sha256: null,
			current_sha256: { config: cur_config, uci: cur_uci },
			normalized_runtime: norm };
	}
	let divergent = (stored.config != null && cur_config != null && stored.config != cur_config) ||
		(stored.uci != null && cur_uci != null && stored.uci != cur_uci);
	return { divergent: divergent,
		reason: divergent ? 'applied sha256 mismatch (config or uci changed since last apply)' : 'applied hash matches',
		basis: 'sha256-intermediate', applied_sha256: stored,
		current_sha256: { config: cur_config, uci: cur_uci },
		normalized_runtime: norm };
}

// ---- service state (backend-computed; UI only renders) ----------------------

function service_state(runtime, rules, queues) {
	let qsig = (queues && queues.signals) || {};
	if (!runtime.present)
		return { state: 'stopped', label: 'stopped', cls: 'bad' };
	if (queues && queues.registered === false)
		return { state: 'degraded', label: 'degraded: queue not registered', cls: 'bad' };
	if (qsig.state === 'critical')
		return { state: 'degraded', label: 'degraded: queue jammed', cls: 'bad' };
	if (!rules)
		return { state: 'partial', label: 'partial: no rules', cls: 'warn' };
	if (qsig.state === 'warn')
		return { state: 'warn', label: 'running (qlen warn)', cls: 'warn' };
	return { state: 'running', label: 'running', cls: 'ok' };
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

// ---- meta: version, autostart symlinks, upgradable badge, autohostlist -----

// nfqws2 version, resolved in a fixed order: read /opt/zapret2/version first;
// if absent, ask the binary; if that yields nothing, return null. null means
// "checked, no value" (distinct from the key being absent = "not checked") —
// the UI renders the two differently (status.schema.json meta.nfqws2_version).
function nfqws2_version() {
	try {
		let raw = readfile(PATHS.applied_version);
		if (raw) { let v = trim(raw); if (length(v)) return v; }
	} catch (e) { }
	// Binary fallback: the exact version flag is unconfirmed, so try the common
	// forms and take the first non-empty line. [VERIFY:ROUTER] which flag the
	// binary answers — answered by smoke.sh 02 (status.nfqws2_version is a
	// string on a device where /opt/zapret2/version is absent).
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
			// strip a leading/trailing quote pair if present
			if (length(v) >= 2 && substr(v, 0, 1) == '"' && substr(v, length(v) - 1, 1) == '"')
				v = substr(v, 1, length(v) - 2);
			out[k] = length(v) ? v : null;
		}
	} catch (e) { return null; }
	return out;
}

function meta_info() {
	let version = nfqws2_version();

	// Autostart: ACTUAL /etc/rc.d symlink check (informational only — the
	// authoritative test is a real reboot, run in tools/smoke.sh autostart).
	let autostart = { enabled: false, symlinks: [] };
	try {
		let entries = lsdir('/etc/rc.d') ?? [];
		let links = [];
		for (let i = 0; i < length(entries); i++)
			if (index(entries[i], 'zapret2') >= 0) push(links, entries[i]);
		autostart.symlinks = links;
		for (let i = 0; i < length(links); i++)
			if (substr(links[i], 0, 1) == 'S') { autostart.enabled = true; break; }
	} catch (e) { }

	let upgradable = null;
	try {
		// [VERIFY:ROUTER] apk version subcommand on 25.12. null = unknown.
		let raw = sh('apk version -c 2>/dev/null');
		if (length(raw)) upgradable = index(raw, 'nfqws2') >= 0;
	} catch (e) { }

	return {
		nfqws2_version: version,
		autostart: autostart,
		versions: { upgradable: upgradable },
		autohostlist: autohostlist_vars()
	};
}

// ---- assemble ----------------------------------------------------------------

function collect() {
	// Ensure runtime dir exists (volatile; created on demand).
	try { mkdir('/tmp/zapret2-manager'); } catch (e) { }

	let runtime, applied, draft, queues, rules, meta;
	try { runtime = runtime_level(); } catch (e) { runtime = { error: 'runtime collect failed: ' + e }; }
	try { applied = applied_level(); } catch (e) { applied = { error: 'applied collect failed: ' + e }; }
	try { draft = draft_level(); } catch (e) { draft = { error: 'draft read failed: ' + e }; }
	try { queues = queues_block(); } catch (e) { queues = { error: 'queues read failed: ' + e }; }
	try { rules = rules_present(); } catch (e) { rules = false; }
	try { meta = meta_info(); } catch (e) { meta = { error: 'meta collect failed: ' + e }; }

	// Backend-computed conclusions (REVIEW 2): the UI renders these, it does not
	// recompute. The watchdog (no UI) reads the same status, so everyone sees
	// the same picture.
	let drift, svc_state, prof_count;
	try { drift = drift_block(runtime, rules); } catch (e) { drift = { divergent: false, reason: 'drift compute failed: ' + e, basis: 'sha256-intermediate' }; }
	try { svc_state = service_state(runtime, rules, queues); } catch (e) { svc_state = { state: 'unknown', label: 'unknown', cls: '' }; }
	try { prof_count = profile_count(runtime.strategies); } catch (e) { prof_count = null; }
	if (runtime && prof_count != null) runtime.profile_count = prof_count;

	let status = {
		collected_at: now(),
		cache_ttl: CACHE_TTL_SEC,
		runtime: runtime,
		applied: applied,
		draft: draft,
		queues: queues,
		drift: drift,
		service_state: svc_state,
		passthrough: (draft && draft.passthrough && draft.passthrough.enabled) || false,
		meta: meta,
		signals: {
			process_present: runtime.present ?? false,
			rules_present: rules
		}
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
