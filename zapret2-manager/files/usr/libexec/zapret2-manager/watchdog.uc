#!/usr/bin/ucode
'use strict';
// watchdog.uc — 60s health monitor for zapret2-manager (branch 06).
//
// Each cycle (if the paused flag is ABSENT):
//   - process:   if nfqws2 is gone and not paused → unexpected crash → recover
//                 via upstream start (the ONLY auto-recovery; thresholds never
//                 self-heal, they only alert).
//   - rules:     nft table `zapret2` present + non-empty → else alert (we never
//                 rebuild it; that is upstream's job).
//   - qlen:      queue 300 depth; critical after 3 consecutive >50 → alert.
//   - cpu:       warn 70% sustained 180s (3×60s); crit 90% sustained 60s (1×60s).
//   - ram:       free < 40 MB → crit.
//   - overlay:   /overlay usage > 90% → crit.
//   - cooldown:  600s between repeated alerts for the same condition.
// Events → /tmp/zapret2-manager/events.ndjson with a `source` field from
//   ui | watchdog | qlen | lists | hotplug.
// Autohostlist log rotation (>1 MB → last 500 lines) via log-rotate.sh.
//
// If /tmp/zapret2-manager/paused exists, the WHOLE cycle is skipped — no
// recovery, no events — so a deliberate stop stays stopped.
//
// Run modes:
//   ucode watchdog.uc          — daemon loop (60s sleep)
//   ucode watchdog.uc check    — one cycle and exit (smoke.sh)

import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { parse as jparse, stringify as jstringify } from 'json';
import { NFQUEUE, QLEN_WARN, QLEN_CRIT_CONSECUTIVE, QLEN_FIELD_INDEX,
	DAEMON, NFT_TABLE, PATHS } from './constants.uc';

const CYCLE_SEC    = 60;
const CLK_TCK      = 100;          // [VERIFY] sysconf(_SC_CLK_TCK) on target
const CPU_WARN_PCT = 70;
const CPU_WARN_WIN = 3;            // 3 × 60s = 180s
const CPU_CRIT_PCT = 90;
const RAM_CRIT_KB  = 40 * 1024;    // 40 MB
const OVERLAY_CRIT = 90;
const COOLDOWN_SEC = 600;
const STATE_FILE   = '/tmp/zapret2-manager/watchdog.state.json';

function sh(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	p.close();
	return out ?? '';
}

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	let out = p ? (p.read('all') ?? '') : '';
	let rc = p ? p.close() : -1;
	return { out: out, rc: rc };
}

function now() { return time(); }

function read_state() {
	try { let raw = readfile(STATE_FILE); return raw ? jparse(raw) : {}; }
	catch (e) { return {}; }
}

function write_state(st) {
	try { mkdir('/tmp/zapret2-manager'); writefile(STATE_FILE, jstringify(st) + '\n'); }
	catch (e) { }
}

function event(source, msg, level) {
	try {
		mkdir('/tmp/zapret2-manager');
		let line = jstringify({ ts: now(), source: source, level: level || 'info', msg: msg }) + '\n';
		let prev = readfile(PATHS.events_ndjson) ?? '';
		writefile(PATHS.events_ndjson, prev + line);
	} catch (e) { }
}

// Alert only if the cooldown for this condition has elapsed.
function alert_if(cond, source, msg, level, st) {
	let last = (st.last_alert || {})[cond] || 0;
	if ((now() - last) < COOLDOWN_SEC) return false;
	st.last_alert = st.last_alert || {};
	st.last_alert[cond] = now();
	event(source, msg, level);
	return true;
}

// ---- checks -----------------------------------------------------------------

function find_pids() {
	let pids = [];
	let entries = sh('ls /proc');
	for (let name of split(entries, '\n')) {
		if (!match(name, /^[0-9]+$/)) continue;
		let cl = readfile('/proc/' + name + '/cmdline') ?? '';
		if (!length(cl)) continue;
		if (index(replace(cl, '\x00', ' '), DAEMON) >= 0)
			push(pids, +name);
	}
	return pids;
}

function cpu_ticks(pids) {
	let total = 0;
	for (let pid of pids) {
		let s = readfile('/proc/' + pid + '/stat') ?? '';
		let p = rindex(s, ')');
		if (p < 0) continue;
		let f = split(trim(substr(s, p + 1)), /[ ]+/);
		// after ')': state[0] ppid[1] ... utime[11] stime[12]
		let utime = +f[11];
		let stime = +f[12];
		total += utime + stime;
	}
	return total;
}

function read_qlen() {
	let raw = readfile(PATHS.nfqueue_proc);
	if (!raw) return null;
	for (let line of split(raw, '\n')) {
		line = trim(line);
		if (!length(line)) continue;
		let f = split(line, /[ ]+/);
		if (length(f) > QLEN_FIELD_INDEX && f[0] == '' + NFQUEUE)
			return +f[QLEN_FIELD_INDEX];
	}
	return null;
}

function free_ram_kb() {
	let raw = readfile('/proc/meminfo') ?? '';
	let m = match(raw, /MemAvailable:[ ]+([0-9]+)/);
	if (m) return +m[1];
	// fallback: MemFree + Buffers + Cached
	let mf = match(raw, /MemFree:[ ]+([0-9]+)/) || [0, 0];
	let b  = match(raw, /Buffers:[ ]+([0-9]+)/) || [0, 0];
	let c  = match(raw, /Cached:[ ]+([0-9]+)/) || [0, 0];
	return (+mf[1]) + (+b[1]) + (+c[1]);
}

function overlay_usage_pct() {
	let raw = sh('df -P /overlay | tail -n 1');
	// Filesystem 1K-blocks Used Avail Use% Mountedon
	let f = split(trim(raw), /[ ]+/);
	if (length(f) < 5) return null;
	let use = f[4];   // e.g. "92%"
	return +replace(use, '%', '');
}

// ---- one cycle ---------------------------------------------------------------

function check_cycle() {
	let st = read_state();

	// Paused → skip the WHOLE cycle. No recovery, no events.
	if (stat(PATHS.paused_flag)) {
		write_state(st);
		return { skipped: true };
	}

	mkdir('/tmp/zapret2-manager');

	// 1) process — crash recovery only (not thresholds)
	let pids = find_pids();
	if (!length(pids)) {
		// unexpected crash (we are not paused): recover via upstream start
		let r = run('/etc/init.d/zapret2 start');   // [VERIFY] upstream init
		alert_if('process_gone', 'watchdog',
			'nfqws2 process gone; recovery start rc=' + r.rc, 'crit', st);
	} else {
		st.last_seen_process = now();
	}

	// 2) rules — alert only, never rebuild (upstream owns the table)
	try {
		let raw = sh('nft list table ' + NFT_TABLE);
		if (!length(raw) || index(raw, 'chain ') < 0)
			alert_if('rules_gone', 'watchdog',
				'nft table ' + NFT_TABLE + ' missing or empty', 'crit', st);
	} catch (e) { }

	// 3) qlen — critical after 3 consecutive >50 (state shared with collector)
	let qlen = read_qlen();
	if (qlen != null && qlen > QLEN_WARN) {
		let qst = jparse(readfile(PATHS.qlen_state) ?? '{"consecutive":0}');
		if ((qst.consecutive || 0) >= QLEN_CRIT_CONSECUTIVE)
			alert_if('qlen_critical', 'qlen',
				'NFQUEUE ' + NFQUEUE + ' jammed: qlen=' + qlen +
				' (' + qst.consecutive + ' consecutive)', 'crit', st);
	}

	// 4) cpu — sustained over a rolling window
	let ticks = cpu_ticks(pids);
	let t = now();
	let prev = st.cpu_prev || { ticks: ticks, time: t };
	let elapsed = t - prev.time;
	let cpu_pct = (elapsed > 0) ? ((ticks - prev.ticks) / (CLK_TCK * elapsed)) * 100 : 0;
	st.cpu_prev = { ticks: ticks, time: t };
	st.cpu_samples = st.cpu_samples || [];
	push(st.cpu_samples, cpu_pct);
	if (length(st.cpu_samples) > CPU_WARN_WIN)
		st.cpu_samples = st.cpu_samples[length(st.cpu_samples) - CPU_WARN_WIN:];
	if (length(st.cpu_samples) >= 1) {
		let last1 = st.cpu_samples[length(st.cpu_samples) - 1];
		if (last1 >= CPU_CRIT_PCT)
			alert_if('cpu_crit', 'watchdog',
				'nfqws2 CPU ' + last1 + '% (>= ' + CPU_CRIT_PCT + '% over 60s)', 'crit', st);
	}
	if (length(st.cpu_samples) >= CPU_WARN_WIN) {
		let sum = 0;
		for (let v of st.cpu_samples) sum += v;
		let avg = sum / length(st.cpu_samples);
		if (avg >= CPU_WARN_PCT)
			alert_if('cpu_warn', 'watchdog',
				'nfqws2 CPU ' + avg + '% avg over ' + (CPU_WARN_WIN * CYCLE_SEC) + 's', 'warn', st);
	}

	// 5) ram
	let ram = free_ram_kb();
	if (ram != null && ram < RAM_CRIT_KB)
		alert_if('ram_low', 'watchdog',
			'free RAM ' + ram + ' KB (< ' + RAM_CRIT_KB + ' KB)', 'crit', st);

	// 6) overlay
	let ov = overlay_usage_pct();
	if (ov != null && ov > OVERLAY_CRIT)
		alert_if('overlay_full', 'watchdog',
			'/overlay usage ' + ov + '% (> ' + OVERLAY_CRIT + '%)', 'crit', st);

	// 7) autohostlist log rotation (>1 MB → last 500 lines), source=lists
	try {
		run('/usr/libexec/zapret2-manager/log-rotate.sh');
	} catch (e) { }

	write_state(st);
	return { skipped: false, pids: length(pids), cpu: cpu_pct, ram: ram, overlay: ov, qlen: qlen };
}

// ---- entry ------------------------------------------------------------------

let mode = ARGV[0];
if (mode == 'check') {
	print(jstringify(check_cycle()) + '\n');
} else {
	// daemon loop
	while (true) {
		try { check_cycle(); } catch (e) { event('watchdog', 'cycle error: ' + e, 'error'); }
		sleep(CYCLE_SEC);   // [VERIFY] ucode sleep() seconds
	}
}
