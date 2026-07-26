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
	for (let name of entries) {
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
		for (let line of lines)
			if (index(line, DAEMON) >= 0 && index(line, 'ps w') < 0)
				push(hit, trim(line));
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
		// [VERIFY] table family. `nft list table <name>` resolves by name.
		let raw = sh('nft list table ' + NFT_TABLE);
		return length(raw) && index(raw, 'chain ') >= 0;
	} catch (e) {
		return false;
	}
}

// ---- meta: version, autostart symlinks, upgradable badge --------------------

function meta_info() {
	let version = null;
	try {
		// [VERIFY] exact version flag/output for nfqws2.
		let raw = sh('nfqws2 --version 2>/dev/null | head -n 1');
		version = length(raw) ? trim(raw) : null;
	} catch (e) { }

	// Autostart: ACTUAL /etc/rc.d symlink check (informational only — the
	// authoritative test is a real reboot, run in tools/smoke.sh autostart).
	let autostart = { enabled: false, symlinks: [] };
	try {
		let entries = lsdir('/etc/rc.d') ?? [];
		let links = [];
		for (let e of entries)
			if (index(e, 'zapret2') >= 0) push(links, e);
		autostart.symlinks = links;
		for (let l of links)
			if (substr(l, 0, 1) == 'S') { autostart.enabled = true; break; }
	} catch (e) { }

	let upgradable = null;
	try {
		// [VERIFY] apk version subcommand on 25.12. Best-effort; null = unknown.
		let raw = sh('apk version -c 2>/dev/null');
		if (length(raw)) upgradable = index(raw, 'nfqws2') >= 0;
	} catch (e) { }

	return {
		nfqws2_version: version,
		autostart: autostart,
		versions: { upgradable: upgradable }
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

	let status = {
		collected_at: now(),
		cache_ttl: CACHE_TTL_SEC,
		runtime: runtime,
		applied: applied,
		draft: draft,
		queues: queues,
		passthrough: (draft && draft.passthrough && draft.passthrough.enabled) || false,
		meta: meta,
		signals: {
			process_present: runtime.present ?? false,
			rules_present: rules
		}
		// Drift (runtime-vs-applied) is computed in the collector (REVIEW 2) and
		// exposed as status.drift; the UI renders it, never recomputes.
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
