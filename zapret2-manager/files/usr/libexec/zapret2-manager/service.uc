#!/usr/bin/ucode
'use strict';
// service.uc — service control for zapret2-manager. CLI-first: invoked as
//   ucode service.uc <action>
// by the rpcd plugin (usr/libexec/rpcd/zapret2-manager.uc) and by the
// detached rollback timer. Prints one JSON object on stdout.
//
// Calls UPSTREAM's init for every daemon/firewall action — we never re-implement
// daemon launch or nft rules (docs/upstream-mapping.md). The full, exhaustive
// list of /etc/init.d/zapret2 subcommands we may call (do not invent others):
//   start stop restart start_daemons stop_daemons restart_daemons
//   start_fw stop_fw restart_fw reload_ifsets list_ifsets list_table
//
// FIREWALL PROHIBITION (incident r12 + a router reset to factory defaults from
// touching fw4's ruleset): never issue a wholesale firewall stop or restart —
// stopping or restarting the firewall service, or stopping/restarting fw4 as a
// whole, destroys OTHER packages' nft tables. Only upstream's own start_fw /
// reload_ifsets (which touch the zapret2 table only) are allowed. Do not add a
// "restart firewall" UI button no matter how convenient it seems.
//
// start_fw and reload_ifsets are TWO DIFFERENT operations:
//   start_fw      — install the zapret2 nft rules (after they are missing).
//   reload_ifsets — re-read interface sets after an interface came/went.
// They are not interchangeable.
//
// [VERIFY:ROUTER] exact ucode API (popen close rc, time) — smoke.sh 06.

import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { parse as jparse, stringify as jstringify } from 'json';
import { PATHS, PASSTHROUGH_PROFILE_NAME,
	NFQWS2_ENABLE_VAR, PAUSE_STOPS_FW } from './constants.uc';
import { read_var, set_var } from './apply.uc';

const UPSTREAM_INIT = '/etc/init.d/zapret2';
const LASTGOOD_DIR  = '/tmp/zapret2-manager/last-good';
const PREV_ENABLE   = LASTGOOD_DIR + '/nfqws2_enable.prev';
const PENDING       = '/tmp/zapret2-manager/pending-rollback';
const ROLLBACK_TTL  = 90;

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();     // [VERIFY] popen close() returns exit code
	return { out: out, rc: rc };
}

// sh() runs a command and returns its stdout (stderr discarded). event()
// below uses it for the ISO timestamp. Pre-existing: service.uc called sh()
// without defining it, so event() threw into its own try/catch and the WHOLE
// event was silently dropped — pause/restart/rollback events were never
// written. Defined here (matching status.uc/watchdog.uc) so pause events
// actually fire. No optional-chaining or nullish-coalescing — explicit
// truthiness check (point 6 clean).
function sh(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	p.close();
	return out ? out : '';
}

// Append an events.v1 ndjson event. Telemetry never blocks: any failure is
// swallowed. See docs/contracts/events.v1.json. extra (optional object) is
// merged in to carry self-contained context (rc, threshold, cycle count...).
function event(source, category, severity, msg, extra) {
	try {
		mkdir('/tmp/zapret2-manager');
		let ts = trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
		if (!length(ts)) ts = '' + time();
		let prev = readfile(PATHS.events_ndjson);
		if (!prev) prev = '';
		// id unique within the file: source + unixseconds + current line count
		let id = source + '-' + time() + '-' + length(split(prev, '\n'));
		// Build the event on top of `extra` (avoids for-in object iteration, whose
		// key-vs-value semantics are not relied on). extra is a caller literal.
		let ev = extra ? extra : {};
		ev.schema = 'events.v1'; ev.ts = ts; ev.id = id;
		ev.category = category; ev.severity = severity; ev.source = source; ev.msg = msg;
		let line = jstringify(ev) + '\n';
		// best-effort append (read-modify-write; events are low-rate)
		writefile(PATHS.events_ndjson, prev + line);
	} catch (e) { }
}

function set_paused(on) {
	if (on) {
		try { mkdir('/tmp/zapret2-manager'); writefile(PATHS.paused_flag, ''); } catch (e) { }
	} else {
		try { unlink(PATHS.paused_flag); } catch (e) { }
	}
}

function basename(p) {
	let parts = split(p, '/');
	return parts[length(parts) - 1];
}

// ---- NFQWS2_ENABLE apply (pause mechanism) -----------------------------------
//
// Setting NFQWS2_ENABLE in the APPLIED config is the pause mechanism: with
// NFQWS2_ENABLE=0, upstream's start is a no-op by upstream's own logic. We do
// NOT edit upstream's files; the write goes through apply.uc, the SINGLE
// sanctioned writer for /opt/zapret2/config. The previous value is captured
// to last-good before the change and restored on resume (NOT hardcoded 1).
// The change flows through the generation mechanism (snapshot_last_good +
// schedule_rollback are called by the caller), so a pause that breaks the
// link rolls back the same way as any edit — including the 90s timeout
// rollback. The PAUSE_STOPS_FW flag and the smoke.sh pause_fw_effect check
// answer whether NFQWS2_ENABLE=0 also clears fw rules (one constant, one
// place). See docs/architecture.md §10.3 and apply.uc.
//
// apply.uc is the apply MECHANISM (write a var), not the deferred full
// options-string CONSTRUCTOR from profiles (strategy-editor branch). Writing
// NFQWS2_ENABLE has no side effect on NFQWS2_OPT — set_var is surgical.

// Capture/restore the pre-pause NFQWS2_ENABLE value alongside the last-good
// config snapshot, so resume restores the real previous value, not a hard 1.
function save_prev_enable(prev) {
	try {
		run('mkdir -p ' + LASTGOOD_DIR);
		writefile(PREV_ENABLE, (prev == null ? '' : prev) + '\n');
	} catch (e) { }
}

function read_prev_enable() {
	try {
		let raw = readfile(PREV_ENABLE);
		if (!raw) return null;
		let v = trim(raw);
		return length(v) ? v : null;
	} catch (e) { return null; }
}

function apply_nfqws2_enable(value) {
	// Write through apply.uc (single writer). Re-capture the applied hash AFTER
	// the write so drift sees the new config as the applied baseline (a
	// snapshot_last_good just before this captured the pre-change hash; this
	// overwrites it with the post-change hash that drift compares against).
	set_var(NFQWS2_ENABLE_VAR, '' + value);
	capture_applied_hash();
	event('ui', 'config', 'info',
		NFQWS2_ENABLE_VAR + '=' + value + ' written to /opt/zapret2/config via apply.uc',
		{ var: NFQWS2_ENABLE_VAR, value: value });
	return value;
}

// ---- actions ----------------------------------------------------------------

function start() {
	// Resume from pause: clear the indicator and restore the PREVIOUS
	// NFQWS2_ENABLE value captured at pause entry (not a hardcoded 1). If no
	// prior pause stored a value, default to 1. A deliberate start means the
	// link is alive, so CANCEL any armed rollback (otherwise a stale timer
	// from the prior pause/restart could fire and flap the service).
	set_paused(false);
	try { unlink(PENDING); } catch (e) { }
	let prev = read_prev_enable();
	let restored = (prev == null) ? 1 : prev;
	apply_nfqws2_enable(restored);
	let r = run(UPSTREAM_INIT + ' start');
	event('ui', 'pause', 'info',
		'start rc=' + r.rc + ' (resumed; NFQWS2_ENABLE=' + restored + ')',
		{ reason: 'manual_ui', rc: r.rc, pause: 'exit', nfqws2_enable: restored });
	return { ok: r.rc == 0, action: 'start', rc: r.rc, out: r.out };
}

function stop() {
	// Pause entry: capture the current NFQWS2_ENABLE BEFORE the change, snapshot
	// the pre-pause config to last-good, store the previous value alongside it,
	// then drive NFQWS2_ENABLE=0 through apply.uc. Optionally stop_fw if
	// NFQWS2_ENABLE=0 does not also stop fw rules (PAUSE_STOPS_FW, answered by
	// smoke.sh pause_fw_effect), then stop the daemon. Arm the 90s rollback so a
	// pause that breaks the link is auto-reversed — pause is a diagnostic
	// stance, not a persistent pref. With NFQWS2_ENABLE=0 in the applied config,
	// an external `start` (init, hotplug, manual) is a no-op by upstream's own
	// logic, so the pause survives even a restart of the service.
	let prev = read_var(NFQWS2_ENABLE_VAR);
	set_paused(true);
	snapshot_last_good();
	save_prev_enable(prev);
	apply_nfqws2_enable(0);
	if (PAUSE_STOPS_FW)
		run(UPSTREAM_INIT + ' stop_fw');
	let r = run(UPSTREAM_INIT + ' stop');
	schedule_rollback();
	event('ui', 'pause', 'info',
		'stop rc=' + r.rc + ' (paused; NFQWS2_ENABLE=0; prev=' + (prev == null ? 'null' : prev) + ')',
		{ pause: 'enter', rc: r.rc, prev: prev });
	return { ok: r.rc == 0, action: 'stop', rc: r.rc, out: r.out, paused: true,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

function restart() {
	set_paused(false);
	snapshot_last_good();
	let r = run(UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'restart', 'info', 'restart rc=' + r.rc + ' (rollback scheduled ' + ROLLBACK_TTL + 's)',
		{ reason: 'manual_ui', rc: r.rc, rollback_ttl: ROLLBACK_TTL });
	return { ok: r.rc == 0, action: 'restart', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

function restart_daemons() {
	set_paused(false);
	snapshot_last_good();
	// [VERIFY] upstream daemon-only restart; fall back to full restart.
	let r = run(UPSTREAM_INIT + ' restart_daemons 2>/dev/null || ' + UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'restart', 'info', 'restart_daemons rc=' + r.rc,
		{ reason: 'manual_ui', rc: r.rc });
	return { ok: r.rc == 0, action: 'restart_daemons', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

// start_fw — INSTALL the zapret2 nft rules (use when the rules are missing,
// e.g. after the table was cleared). Delegates to upstream's own start_fw,
// which touches only the zapret2 table. NEVER a full firewall restart — see
// the prohibition in the file header.
function start_fw() {
	snapshot_last_good();
	let r = run(UPSTREAM_INIT + ' start_fw');
	schedule_rollback();
	event('ui', 'config', 'info', 'start_fw rc=' + r.rc, { rc: r.rc });
	return { ok: r.rc == 0, action: 'start_fw', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

// reload_ifsets — RE-READ interface sets after an interface came/went. Distinct
// from start_fw: the rules are already installed, only the ifset membership is
// stale. Also delegated to upstream. The fw4 binary has no reload-ifsets
// subcommand (that is a subcommand of the zapret2 init script), and a full fw
// restart is forbidden — see the file header.
function reload_ifsets() {
	snapshot_last_good();
	let r = run(UPSTREAM_INIT + ' reload_ifsets');
	schedule_rollback();
	event('ui', 'config', 'info', 'reload_ifsets rc=' + r.rc, { rc: r.rc });
	return { ok: r.rc == 0, action: 'reload_ifsets', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

// ---- 90s rollback scaffold --------------------------------------------------

function sha256_file(path) {
	if (!stat(path)) return null;
	try {
		let raw = run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'");
		let h = trim(raw.out);
		return length(h) ? h : null;
	} catch (e) { return null; }
}

// Capture the applied-config hashes at apply time, so the collector's drift
// check (REVIEW 2) can compare the current hashes to these. Both sources are
// hashed, never one alone. Written to /tmp/zapret2-manager/applied.sha256.
function capture_applied_hash() {
	try {
		let st = { config: sha256_file(PATHS.applied_conf),
			uci:    sha256_file(PATHS.uci_conf),
			captured_at: time() };
		mkdir('/tmp/zapret2-manager');
		writefile('/tmp/zapret2-manager/applied.sha256', jstringify(st) + '\n');
	} catch (e) { }
}

function snapshot_last_good() {
	try {
		run('mkdir -p ' + LASTGOOD_DIR);
		run('cp -f ' + PATHS.applied_conf + ' ' + LASTGOOD_DIR + '/ 2>/dev/null');
		run('cp -f ' + PATHS.uci_conf + ' ' + LASTGOOD_DIR + '/ 2>/dev/null');
		capture_applied_hash();
	} catch (e) { }
}

function schedule_rollback() {
	// (Re)arm a pending marker with an expiry timestamp + a detached timer.
	// confirm_alive removes the marker; if it survives past the timer, the
	// rollback action restores last-good and restarts.
	try {
		writefile(PENDING, '' + (time() + ROLLBACK_TTL) + '\n');
		run('setsid sh -c "sleep ' + ROLLBACK_TTL + '; [ -f ' + PENDING +
			' ] && /usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback" >/dev/null 2>&1 &');
	} catch (e) { }
}

function confirm_alive() {
	try { unlink(PENDING); } catch (e) { }
	event('ui', 'rollback', 'info', 'link confirmed alive; rollback cancelled');
	return { ok: true, action: 'confirm_alive', rollback_pending: false };
}

function rollback() {
	try {
		// Honor the expiry timestamp written by schedule_rollback. A stale
		// timer (e.g. from a prior pause that was resumed — start() cancels
		// PENDING, but a timer already firing races) must NOT roll back if the
		// marker is gone or its expiry is still in the future (a newer action
		// re-armed it). Without this, the timer fires under normal
		// pause-then-resume use and flaps the service.
		let pending = readfile(PENDING);
		if (!pending) return { ok: true, action: 'rollback', skipped: true,
			reason: 'no pending rollback marker' };
		let expiry = +trim(pending);
		if (expiry && time() < expiry)
			return { ok: true, action: 'rollback', skipped: true,
				reason: 'marker expiry in the future (a newer action re-armed it)' };
		if (stat(LASTGOOD_DIR + '/' + basename(PATHS.applied_conf)))
			run('cp -f ' + LASTGOOD_DIR + '/' + basename(PATHS.applied_conf) + ' ' + PATHS.applied_conf);
		if (stat(LASTGOOD_DIR + '/' + basename(PATHS.uci_conf)))
			run('cp -f ' + LASTGOOD_DIR + '/' + basename(PATHS.uci_conf) + ' ' + PATHS.uci_conf);
		try { unlink(PENDING); } catch (e) { }
		// Re-capture the applied hash for the RESTORED config so drift does not
		// false-positive against the pre-rollback (changed) baseline.
		capture_applied_hash();
		let r = run(UPSTREAM_INIT + ' restart');
		event('ui', 'rollback', 'crit',
			'ROLLBACK applied (link not confirmed within ' + ROLLBACK_TTL + 's) rc=' + r.rc,
			{ rc: r.rc, rollback_ttl: ROLLBACK_TTL });
		return { ok: r.rc == 0, action: 'rollback', rc: r.rc };
	} catch (e) {
		return { ok: false, action: 'rollback', error: '' + e };
	}
}

// ---- passthrough (our entity; no upstream option) ---------------------------
//
// Passthrough is NOT a UCI flag (upstream has no passthrough option; a flag
// would desync from reality and create a 4th state level). It is a property
// of the nfqws2 options string: the instance is up, filters and ports are in
// place, and not a single --lua-desync argument is passed. It flows through
// apply.uc (the single writer), rolls back by the standard 90s mechanism, and
// is visible in the live process argv AND in the applied config — not only in
// our draft state.
//
// ON:  snapshot + save the current NFQWS2_OPT to last-good, strip every
//      --lua-desync arg from it, write the stripped string via apply.uc,
//      capture the new applied hash, restart, arm rollback.
// OFF: restore the original NFQWS2_OPT from last-good via apply.uc, capture
//      the hash, restart, arm rollback.
//
// The from-profiles options-string CONSTRUCTOR is still deferred (strategy-
// editor branch); passthrough does not construct — it transforms the already
// applied NFQWS2_OPT (strip lua-desync) and writes it back through apply.uc.

const PREV_OPT = LASTGOOD_DIR + '/nfqws2_opt.orig';

function save_orig_opt(v) {
	try { run('mkdir -p ' + LASTGOOD_DIR); writefile(PREV_OPT, (v == null ? '' : v) + '\n'); }
	catch (e) { }
}

function read_orig_opt() {
	try {
		let raw = readfile(PREV_OPT);
		if (!raw) return null;
		let v = trim(raw);
		return length(v) ? v : null;
	} catch (e) { return null; }
}

// Remove every --lua-desync argument from an NFQWS2_OPT value, keeping the
// rest unchanged (order + separators preserved). Mirrors tests/lib/stripper.mjs;
// runtime confirmed on target via smoke.sh. ARG-based (followup 3): nfqws2 args
// are whitespace-separated (spaces OR newlines). Walks the value capturing a
// whitespace run (separator) then a token; a token starting with "--lua-desync="
// (exact prefix — --lua-init= and --lua-desync2= survive) is dropped together
// with its preceding separator, so no orphan separator is left. Handles several
// args on one line (the line-based version did not, and that silent defect
// reaches the user).
const LUA_DESYNC_TOKEN = '--lua-desync=';
function _is_ws(c) { return c == ' ' || c == '\n' || c == '\t' || c == '\r'; }
function strip_lua_desync(value) {
	if (value == null) return '';
	let out = '';
	let i = 0;
	let n = length(value);
	while (i < n) {
		// capture a whitespace run (separator before the next token)
		let wsStart = i;
		while (i < n && _is_ws(substr(value, i, 1))) i++;
		let ws = substr(value, wsStart, i - wsStart);
		// capture a token (non-whitespace run)
		let tokStart = i;
		while (i < n && !_is_ws(substr(value, i, 1))) i++;
		let tok = substr(value, tokStart, i - tokStart);
		if (length(tok) == 0) {
			if (length(ws)) out += ws;   // trailing whitespace only — keep it
			break;
		}
		if (substr(tok, 0, length(LUA_DESYNC_TOKEN)) == LUA_DESYNC_TOKEN)
			continue;                    // drop token + its preceding separator
		out += ws + tok;
	}
	return out;
}

function read_state() {
	try { let raw = readfile(PATHS.draft_state); return raw ? jparse(raw) : {}; }
	catch (e) { return {}; }
}

function write_state(st) {
	try { mkdir('/etc/zapret2-manager'); writefile(PATHS.draft_state, jstringify(st) + '\n'); }
	catch (e) { }
}

function passthrough(enabled) {
	let on = !!enabled;
	let st = read_state();
	set_paused(false);
	snapshot_last_good();
	if (on) {
		// Strip every --lua-desync from the CURRENT applied NFQWS2_OPT and write
		// the stripped string back through apply.uc. The original is saved to
		// last-good so OFF restores it. Passthrough is then visible in the live
		// argv (no --lua-desync) and in the applied config, not only our state.
		let cur = read_var('NFQWS2_OPT');
		if (cur == null) {
			event('ui', 'config', 'warn',
				'passthrough ON skipped: no NFQWS2_OPT in /opt/zapret2/config to strip',
				{ passthrough: true, reason: 'no_nfqws2_opt' });
			return { ok: false, action: 'passthrough', enabled: true,
				error: 'no NFQWS2_OPT in /opt/zapret2/config' };
		}
		save_orig_opt(cur);
		set_var('NFQWS2_OPT', strip_lua_desync(cur));
		capture_applied_hash();
		st.active_profile = { name: PASSTHROUGH_PROFILE_NAME, strategies: [] };
		st.passthrough = { enabled: true };
		write_state(st);
	} else {
		// Restore the original NFQWS2_OPT captured at ON-time.
		let orig = read_orig_opt();
		if (orig != null) {
			set_var('NFQWS2_OPT', orig);
			capture_applied_hash();
		}
		st.active_profile = { name: 'default', strategies: null };
		st.passthrough = { enabled: false };
		write_state(st);
	}
	let r = run(UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'config', 'info',
		'passthrough ' + (on ? 'ON' : 'OFF') + ' (profile=' +
		(on ? PASSTHROUGH_PROFILE_NAME : 'default') + ') rc=' + r.rc,
		{ passthrough: on, profile: (on ? PASSTHROUGH_PROFILE_NAME : 'default'), rc: r.rc });
	return { ok: r.rc == 0, action: 'passthrough', enabled: on, rc: r.rc,
		profile: (on ? PASSTHROUGH_PROFILE_NAME : 'default'),
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

// ---- CLI dispatch -----------------------------------------------------------

let arg = ARGV[0];
if (arg == 'passthrough') {
	// ucode service.uc passthrough <true|false|1|0>
	let on = ARGV[1];
	let enabled = (on == 'true' || on == '1');
	print(jstringify(passthrough(enabled)) + '\n');
} else if (arg == 'start' || arg == 'stop' || arg == 'restart' ||
           arg == 'restart_daemons' || arg == 'start_fw' || arg == 'reload_ifsets' ||
           arg == 'confirm_alive' || arg == 'rollback') {
	let m = { start: start, stop: stop, restart: restart, restart_daemons: restart_daemons,
		start_fw: start_fw, reload_ifsets: reload_ifsets,
		confirm_alive: confirm_alive, rollback: rollback };
	print(jstringify(m[arg]()) + '\n');
} else {
	let argval = arg ? arg : '';
	print(jstringify({ ok: false, error: 'unknown action: ' + argval }) + '\n');
	exit(1);
}
