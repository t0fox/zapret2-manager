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
import { NFQUEUE, QLEN_WARN, QLEN_CRIT_CONSECUTIVE,
	DAEMON, NFT_TABLE, PATHS } from './constants.uc';
import { parse_queue } from './qlen.uc';
import { auto_controller_tick } from './auto-strategy.uc';
import { healthcheck_scheduler_tick } from './strategies-ops.uc';

const CYCLE_SEC    = 60;
const CPU_WARN_PCT = 70;
const CPU_WARN_WIN = 3;            // 3 × 60s = 180s
const CPU_CRIT_PCT = 90;
const RAM_CRIT_KB  = 40 * 1024;    // 40 MB
const OVERLAY_CRIT = 90;
const COOLDOWN_SEC = 600;
const STATE_FILE   = PATHS.watchdog_state;
const QLEN_STATE   = PATHS.qlen_state;

function sh(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	p.close();
	return out ? out : '';
}

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function now() { return time(); }

function read_state() {
	try { let raw = readfile(STATE_FILE); return raw ? json(raw) : {}; }
	catch (e) { return {}; }
}

function write_state(st) {
	try { writefile(STATE_FILE, sprintf("%J", st) + '\n'); }
	catch (e) { }
}

// The pause marker is the normal manual-stop guard.  Read the upstream
// desired flag as a second, source-level guard so a short file/flag race can
// never turn an intentional NFQWS2_ENABLE=0 state into an outage event.
function desired_running() {
	try {
		let raw = readfile(PATHS.applied_conf);
		if (!raw) return true;
		let prefix = 'NFQWS2_ENABLE=';
		for (let line in split(raw, '\n')) {
			line = trim(line);
			if (!length(line) || substr(line, 0, 1) == '#') continue;
			if (substr(line, 0, length(prefix)) != prefix) continue;
			let value = trim(substr(line, length(prefix)));
			if (substr(value, 0, 1) == '"') value = replace(value, '"', '');
			return value != '0';
		}
	} catch (e) { }
	return true;
}

// Append an events.v1 ndjson event. Telemetry never blocks. See
// docs/contracts/events.v1.json. extra (optional) carries self-contained
// context (actual values, threshold, cycle count...).
function event(source, category, severity, msg, extra) {
	try {
		let ts = trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
		if (!length(ts)) ts = '' + now();
		let prev = readfile(PATHS.events_ndjson);
		if (!prev) prev = '';
		let id = source + '-' + now() + '-' + length(split(prev, '\n'));
		let ev = extra ? extra : {};
		ev.schema = 'events.v1'; ev.ts = ts; ev.id = id;
		ev.category = category; ev.severity = severity; ev.source = source; ev.msg = msg;
		writefile(PATHS.events_ndjson, prev + sprintf("%J", ev) + '\n');
	} catch (e) { }
}

// Alert only if the cooldown for this condition has elapsed.
function alert_if(cond, category, source, msg, level, st, extra) {
	let last = (st.last_alert || {})[cond] || 0;
	if ((now() - last) < COOLDOWN_SEC) return false;
	st.last_alert = st.last_alert || {};
	st.last_alert[cond] = now();
	event(source, category, level, msg, extra);
	return true;
}

// ---- checks -----------------------------------------------------------------

function find_pids() {
	let pids = [];
	let entries = sh('ls /proc');
	let names = split(entries, '\n');
	for (let i = 0; i < length(names); i++) {
		let name = names[i];
		if (!match(name, /^[0-9]+$/)) continue;
		let cl = readfile('/proc/' + name + '/cmdline');
		if (!cl) cl = '';
		if (!length(cl)) continue;
		// /proc/<pid>/cmdline is NUL-delimited. ucode's replace() treats
		// NUL as a string terminator on this target and corrupts the argv.
		let argv = split(cl, chr(0));
		let bin = length(argv) ? argv[0] : '';
		if (bin == DAEMON || index(bin, '/' + DAEMON) >= 0)
			push(pids, +name);
	}
	return pids;
}

// CLK_TCK: read from the system rather than hardcode 100. [VERIFY:ROUTER]
// answered by smoke.sh 06 (watchdog cycle runs without error → the value is
// sane). Fallback 100 if getconf is unavailable.
function clk_tck() {
	let v = trim(sh('getconf CLK_TCK 2>/dev/null'));
	if (length(v) && match(v, /^[0-9]+$/)) return +v;
	return 100;
}

function cpu_ticks(pids) {
	let total = 0;
	for (let i = 0; i < length(pids); i++) {
		let s = readfile('/proc/' + pids[i] + '/stat');
		if (!s) s = '';
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

// ---- queue signals (the ONLY place cycle-based qlen state is computed) -------
//
// queue_total is instantaneous: threshold 50, three consecutive cycles above
// → critical. queue_dropped / queue_user_dropped are CUMULATIVE monotonic
// counters: we compute the per-cycle delta vs the previous cycle's value
// (persisted in qlen.state.json). delta > 0 means the kernel had nowhere to
// put packets — a warn that appears BEFORE queue_total grows. If the new
// value is less than the stored one, the queue was recreated (counter reset);
// the delta cannot be computed this cycle, so we rewrite the base and skip —
// never emit a negative delta.

function read_qlen_prev() {
	try { let raw = readfile(QLEN_STATE); return raw ? json(raw) : null; }
	catch (e) { return null; }
}

function write_qlen_state(st) {
	try { writefile(QLEN_STATE, sprintf("%J", st) + '\n'); }
	catch (e) { }
}

function qlen_cycle(st) {
	let q = parse_queue();
	let prev = read_qlen_prev();
	if (!prev) prev = {};
	let t = now();

	if (!q.registered) {
		// Queue not registered in the kernel at all — nfqws2 not connected.
		let next = {
			consecutive: 0,
			prev_dropped: null, prev_user_dropped: null,
			dropped_delta: null, user_dropped_delta: null,
			last_state: 'unknown', last_qlen: null, updated_at: t
		};
		write_qlen_state(next);
		alert_if('queue_not_registered', 'queue', 'qlen',
			'NFQUEUE ' + NFQUEUE + ' not registered in kernel (nfqws2 not connected)',
			'crit', st, { code: 'queue_not_registered', queue: NFQUEUE,
				desiredState: 'running' });
		return { registered: false, queue_total: null };
	}

	// queue_total: instantaneous, three-consecutive rule.
	let prev_consecutive = (prev && prev.consecutive != null) ? prev.consecutive : 0;
	let consecutive = (q.queue_total > QLEN_WARN) ? prev_consecutive + 1 : 0;

	// dropped deltas (cumulative → delta vs prev cycle, with reset handling).
	let dd = null, udd = null;
	// explicit key-existence + null checks (no nullish-coalescing — point 6).
	// 0 is a valid counter value and must be preserved, so test != null, not
	// truthiness.
	let prev_d = (prev && prev.prev_dropped != null) ? prev.prev_dropped : null;
	let prev_ud = (prev && prev.prev_user_dropped != null) ? prev.prev_user_dropped : null;
	if (prev_d == null) {
		// first observed cycle: no baseline yet, just record it.
	} else if (q.queue_dropped < prev_d) {
		// counter went backwards → queue recreated; no delta this cycle.
	} else {
		dd = q.queue_dropped - prev_d;
	}
	if (prev_ud == null) {
		// no baseline
	} else if (q.queue_user_dropped < prev_ud) {
		// reset → no delta
	} else {
		udd = q.queue_user_dropped - prev_ud;
	}

	// state: worst of (critical > warn > nominal). Dropped delta is a warn only.
	let state = 'nominal';
	if (consecutive >= QLEN_CRIT_CONSECUTIVE) state = 'critical';
	else if (q.queue_total > QLEN_WARN) state = 'warn';
	else if (dd != null && dd > 0) state = 'warn';

	let next = {
		consecutive: consecutive,
		prev_dropped: q.queue_dropped,
		prev_user_dropped: q.queue_user_dropped,
		dropped_delta: dd,
		user_dropped_delta: udd,
		last_state: state,
		last_qlen: q.queue_total,
		updated_at: t
	};
	write_qlen_state(next);

	// Events (each carries actual values + threshold + cycle count, not a
	// bare label — see docs/contracts/events.v1.json).
	if (consecutive >= QLEN_CRIT_CONSECUTIVE)
		alert_if('qlen_critical', 'restart', 'qlen',
			'queue_total=' + q.queue_total + ' > ' + QLEN_WARN + ' for ' +
			consecutive + ' consecutive cycles', 'crit', st,
			{ reason: 'queue_length', queue_total: q.queue_total, threshold: QLEN_WARN, consecutive: consecutive });
	if (dd != null && dd > 0)
		alert_if('queue_dropped_delta', 'queue', 'qlen',
			'queue_dropped delta=' + dd + ' (kernel could not enqueue packets; ' +
			'warn appears before queue_total grows)', 'warn', st,
			{ dropped_delta: dd });
	if (udd != null && udd > 0)
		alert_if('queue_user_dropped_delta', 'queue', 'qlen',
			'queue_user_dropped delta=' + udd, 'warn', st,
			{ user_dropped_delta: udd });

	return { registered: true, queue_total: q.queue_total };
}

function free_ram_kb() {
	let raw = readfile('/proc/meminfo');
	if (!raw) raw = '';
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

	// Manual start/restart owns a short convergence window.  Do not turn the
	// expected intermediate absence of process/NFQUEUE/rules into fault events;
	// once the marker expires, normal checks resume and a real loss is critical.
	try {
		let rawTransition = readfile(PATHS.manual_transition);
		let transition = rawTransition ? json(rawTransition) : null;
		if (transition && transition.until != null && now() < +transition.until) {
			write_state(st);
			return { skipped: true, reason: 'manual_transition', action: transition.action,
				until: transition.until };
		}
		if (transition) unlink(PATHS.manual_transition);
	} catch (e) { }

	if (!desired_running()) {
		write_state(st);
		return { skipped: true, reason: 'desired_stopped' };
	}

	// 1) process — crash recovery only (not thresholds)
	let pids = find_pids();
	if (!length(pids)) {
		// unexpected crash (we are not paused): recover via upstream start
		let r = run('/etc/init.d/zapret2 start');   // [VERIFY] upstream init
		alert_if('process_gone', 'restart', 'watchdog',
			'nfqws2 process gone; recovery start rc=' + r.rc, 'crit', st,
			{ code: 'process_unexpected_loss', reason: 'process_crash', rc: r.rc,
				desiredState: 'running', manualTransition: false });
	} else {
		st.last_seen_process = now();
	}

	// 2) rules — alert only, never rebuild (upstream owns the table)
	try {
		let raw = sh('nft list table inet ' + NFT_TABLE);
		if (!length(raw) || index(raw, 'chain ') < 0)
			alert_if('rules_gone', 'health', 'watchdog',
				'nft table ' + NFT_TABLE + ' missing or empty', 'crit', st,
				{ code: 'rules_missing', table: NFT_TABLE, desiredState: 'running' });
	} catch (e) { }

	// 3) queue signals — queue_total three-consecutive critical, dropped delta
	// warn, queue-not-registered. Computed here (60s cycle) and persisted to
	// qlen.state.json; the collector reads it for display.
	let qres = qlen_cycle(st);
	let qlen = qres.queue_total;

	// 4) cpu — sustained over a rolling window
	let ticks = cpu_ticks(pids);
	let t = now();
	let prev = st.cpu_prev || { ticks: ticks, time: t };
	let elapsed = t - prev.time;
	let cpu_pct = (elapsed > 0) ? ((ticks - prev.ticks) / (clk_tck() * elapsed)) * 100 : 0;
	st.cpu_prev = { ticks: ticks, time: t };
	st.cpu_samples = st.cpu_samples || [];
	push(st.cpu_samples, cpu_pct);
	// Keep only the last CPU_WARN_WIN samples (avoid slice syntax — rebuild).
	if (length(st.cpu_samples) > CPU_WARN_WIN) {
		let tail = [];
		let start = length(st.cpu_samples) - CPU_WARN_WIN;
		for (let i = start; i < length(st.cpu_samples); i++) push(tail, st.cpu_samples[i]);
		st.cpu_samples = tail;
	}
	if (length(st.cpu_samples) >= 1) {
		let last1 = st.cpu_samples[length(st.cpu_samples) - 1];
		if (last1 >= CPU_CRIT_PCT)
			alert_if('cpu_crit', 'health', 'watchdog',
				'nfqws2 CPU ' + last1 + '% (>= ' + CPU_CRIT_PCT + '% over 60s)', 'crit', st,
				{ cpu_pct: last1, threshold: CPU_CRIT_PCT, window_s: 60 });
	}
	if (length(st.cpu_samples) >= CPU_WARN_WIN) {
		let sum = 0;
		for (let i = 0; i < length(st.cpu_samples); i++) sum += st.cpu_samples[i];
		let avg = sum / length(st.cpu_samples);
		if (avg >= CPU_WARN_PCT)
			alert_if('cpu_warn', 'health', 'watchdog',
				'nfqws2 CPU ' + avg + '% avg over ' + (CPU_WARN_WIN * CYCLE_SEC) + 's', 'warn', st,
				{ cpu_pct: avg, threshold: CPU_WARN_PCT, window_s: CPU_WARN_WIN * CYCLE_SEC });
	}

	// 5) ram
	let ram = free_ram_kb();
	if (ram != null && ram < RAM_CRIT_KB)
		alert_if('ram_low', 'health', 'watchdog',
			'free RAM ' + ram + ' KB (< ' + RAM_CRIT_KB + ' KB)', 'crit', st,
			{ free_ram_kb: ram, threshold_kb: RAM_CRIT_KB });

	// 6) overlay
	let ov = overlay_usage_pct();
	if (ov != null && ov > OVERLAY_CRIT)
		alert_if('overlay_full', 'health', 'watchdog',
			'/overlay usage ' + ov + '% (> ' + OVERLAY_CRIT + '%)', 'crit', st,
			{ overlay_pct: ov, threshold_pct: OVERLAY_CRIT });

	// 7) autohostlist log rotation (>1 MB → last 500 lines), source=lists
	try {
		run('/usr/libexec/zapret2-manager/log-rotate.sh');
	} catch (e) { }

	// Auto Strategy shares this procd-owned lifecycle; the controller itself
	// owns its persistent state and may only start the existing bounded health
	// matrix.  It never changes firewall state from the watchdog.
	let auto = null;
	try { auto = auto_controller_tick(); }
	catch (e) { event('watchdog', 'auto-strategy', 'error', 'auto controller tick failed: ' + e); }
	let healthcheck = null;
	try { healthcheck = healthcheck_scheduler_tick(); }
	catch (e) { event('watchdog', 'healthcheck', 'error', 'healthcheck scheduler tick failed: ' + e); }

	write_state(st);
	return { skipped: false, pids: length(pids), cpu: cpu_pct, ram: ram, overlay: ov, qlen: qlen, auto: auto, healthcheck: healthcheck };
}

// ---- entry ------------------------------------------------------------------

let mode = ARGV[0];
if (mode == 'check') {
	print(sprintf("%J", check_cycle()) + '\n');
} else {
	// daemon loop
	while (true) {
		try { check_cycle(); } catch (e) { event('watchdog', 'watchdog', 'error', 'cycle error: ' + e); }
		sleep(CYCLE_SEC);   // [VERIFY] ucode sleep() seconds
	}
}
