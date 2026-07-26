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
	NFQUEUE, QLEN_WARN, QLEN_CRIT_CONSECUTIVE, QLEN_FIELD_INDEX, CACHE_TTL_SEC,
	DAEMON, NFT_TABLE, PATHS
} from './constants.uc';

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

// tokenize on whitespace without relying on regex split edge cases
function tokenize(s) {
	let out = [];
	let cur = '';
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == ' ' || c == '\t' || c == '\r') {
			if (length(cur)) { push(out, cur); cur = ''; }
		} else {
			cur += c;
		}
	}
	if (length(cur)) push(out, cur);
	return out;
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

// ---- third liveness signal: NFQUEUE qlen ------------------------------------

function qlen_signal() {
	let raw = readfile(PATHS.nfqueue_proc);
	if (!raw)
		return { qlen: null, state: 'unknown', consecutive: 0, error: 'no nfnetlink_queue' };

	let qlen = null;
	let row = null;
	for (let line of split(raw, '\n')) {
		line = trim(line);
		if (!length(line)) continue;
		let f = tokenize(line);
		if (length(f) > QLEN_FIELD_INDEX && f[0] == '' + NFQUEUE) {
			qlen = +f[QLEN_FIELD_INDEX];
			row = line;
			break;
		}
	}
	if (qlen == null)
		return { qlen: null, state: 'unknown', consecutive: 0, error: 'queue ' + NFQUEUE + ' not found' };

	// Persist + update the consecutive-exceedance counter across collections.
	let prev = read_json(PATHS.qlen_state, { consecutive: 0, last_qlen: null });
	let consecutive = (qlen > QLEN_WARN) ? (prev.consecutive ?? 0) + 1 : 0;

	let state;
	if (consecutive >= QLEN_CRIT_CONSECUTIVE) state = 'critical';
	else if (qlen > QLEN_WARN) state = 'warn';
	else state = 'nominal';

	let st = { consecutive: consecutive, last_qlen: qlen, last_state: state, updated_at: now() };
	try { writefile(PATHS.qlen_state, jstringify(st) + '\n'); } catch (e) { }

	return { qlen: qlen, state: state, consecutive: consecutive, row: row };
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

	let runtime, applied, draft, qlen, rules, meta;
	try { runtime = runtime_level(); } catch (e) { runtime = { error: 'runtime collect failed: ' + e }; }
	try { applied = applied_level(); } catch (e) { applied = { error: 'applied collect failed: ' + e }; }
	try { draft = draft_level(); } catch (e) { draft = { error: 'draft read failed: ' + e }; }
	try { qlen = qlen_signal(); } catch (e) { qlen = { error: 'qlen read failed: ' + e }; }
	try { rules = rules_present(); } catch (e) { rules = false; }
	try { meta = meta_info(); } catch (e) { meta = { error: 'meta collect failed: ' + e }; }

	let status = {
		collected_at: now(),
		cache_ttl: CACHE_TTL_SEC,
		runtime: runtime,
		applied: applied,
		draft: draft,
		passthrough: (draft && draft.passthrough && draft.passthrough.enabled) || false,
		meta: meta,
		signals: {
			process_present: runtime.present ?? false,
			rules_present: rules,
			qlen: qlen
		}
		// Note: runtime-vs-applied divergence is computed by the Overview page
		// (branch 03) from the raw runtime/applied data above, not here; a
		// collector-side heuristic would be a misleading second opinion.
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
