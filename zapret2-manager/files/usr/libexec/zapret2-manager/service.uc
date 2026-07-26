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

const UPSTREAM_INIT = '/etc/init.d/zapret2';
const LASTGOOD_DIR  = '/tmp/zapret2-manager/last-good';
const PENDING       = '/tmp/zapret2-manager/pending-rollback';
const ROLLBACK_TTL  = 90;

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	let out = p ? (p.read('all') ?? '') : '';
	let rc = p ? p.close() : -1;     // [VERIFY] popen close() returns exit code
	return { out: out, rc: rc };
}

// Append an events.v1 ndjson event. Telemetry never blocks: any failure is
// swallowed. See docs/contracts/events.v1.json. extra (optional object) is
// merged in to carry self-contained context (rc, threshold, cycle count...).
function event(source, category, severity, msg, extra) {
	try {
		mkdir('/tmp/zapret2-manager');
		let ts = trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
		if (!length(ts)) ts = '' + time();
		let prev = readfile(PATHS.events_ndjson) ?? '';
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
// NOT edit upstream's files; the write is done by the config-generation apply
// mechanism, which renders the applied config (including NFQWS2_ENABLE) from
// our draft state and writes it through the sanctioned apply path.
//
// [ASK] That apply mechanism is not yet built (the strategy-editor branch was
// deferred). Until it lands, apply_nfqws2_enable() records the intent in draft
// state and logs, but does not write the applied config — so the PRIMARY pause
// mechanism is not yet effective and the guard hook remains the active stop.
// When the apply branch lands, fill in the single write step here; the
// PAUSE_STOPS_FW flag and the smoke.sh pause_fw_effect check do not change.
// See the branch report's [ASK] section.
function apply_nfqws2_enable(value) {
	let st = read_state();
	st.nfqws2_enable = value;   // 0 on pause, 1 on resume
	write_state(st);
	event('ui', 'config', 'info',
		NFQWS2_ENABLE_VAR + '=' + value + ' intent recorded (apply pending config-generation branch)',
		{ var: NFQWS2_ENABLE_VAR, value: value });
	return value;
}

// ---- actions ----------------------------------------------------------------

function start() {
	set_paused(false);
	apply_nfqws2_enable(1);
	let r = run(UPSTREAM_INIT + ' start');
	event('ui', 'pause', 'info', 'start rc=' + r.rc, { reason: 'manual_ui', rc: r.rc });
	return { ok: r.rc == 0, action: 'start', rc: r.rc, out: r.out };
}

function stop() {
	// Pause: set the indicator, drive NFQWS2_ENABLE=0 through the config
	// mechanism (no-op until the apply branch lands — see apply_nfqws2_enable),
	// optionally stop_fw if NFQWS2_ENABLE=0 does not also stop fw rules
	// (PAUSE_STOPS_FW, answered by smoke.sh pause_fw_effect), then stop the
	// daemon. Snapshot + arm the 90s rollback so a pause that breaks the link
	// is auto-reversed — pause is a diagnostic stance, not a persistent pref.
	set_paused(true);
	apply_nfqws2_enable(0);
	snapshot_last_good();
	if (PAUSE_STOPS_FW)
		run(UPSTREAM_INIT + ' stop_fw');
	let r = run(UPSTREAM_INIT + ' stop');
	schedule_rollback();
	event('ui', 'pause', 'info', 'stop rc=' + r.rc + ' (paused; NFQWS2_ENABLE=0 intent)',
		{ pause: 'enter', rc: r.rc });
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
		if (stat(LASTGOOD_DIR + '/' + basename(PATHS.applied_conf)))
			run('cp -f ' + LASTGOOD_DIR + '/' + basename(PATHS.applied_conf) + ' ' + PATHS.applied_conf);
		if (stat(LASTGOOD_DIR + '/' + basename(PATHS.uci_conf)))
			run('cp -f ' + LASTGOOD_DIR + '/' + basename(PATHS.uci_conf) + ' ' + PATHS.uci_conf);
		try { unlink(PENDING); } catch (e) { }
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
// Passthrough is NOT a UCI flag (upstream has no passthrough option and will
// not grow one; a separate flag would desync from reality and create a 4th
// state level). It is modelled as a PROFILE WITH NO STRATEGIES: the instance
// is up, filters are in place, and not a single lua-desync argument is passed
// to nfqws2. Passthrough is therefore a property of the generated nfqws2
// options string — it flows through config generation, rolls back by the
// standard mechanism, and is visible in the live process argv.
//
// What this function owns: toggling which profile is active in the draft
// state. The active profile is recorded as { name, strategies: [] } for
// passthrough-on. Applying that profile to the running daemon (rendering the
// no-lua-desync argv and starting nfqws2 with it) is the config-generation
// mechanism's job; until that branch lands, passthrough is modelled here and
// surfaced in status, but not yet enforced on the live argv. See
// docs/upstream-mapping.md and the [ASK] note in the branch report.

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
	// The passthrough profile: no strategies → no lua-desync args in the
	// generated options string. 'default' is a placeholder for the normal
	// profile; the config-generation branch will define real profiles.
	if (on) {
		st.active_profile = { name: PASSTHROUGH_PROFILE_NAME, strategies: [] };
		st.passthrough = { enabled: true };
	} else {
		st.active_profile = { name: 'default', strategies: null };
		st.passthrough = { enabled: false };
	}
	write_state(st);
	set_paused(false);
	snapshot_last_good();
	// Restart via upstream so the daemon reflects the current applied config.
	// (Full enforcement of the no-lua-desync argv awaits config generation.)
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
	print(jstringify({ ok: false, error: 'unknown action: ' + (arg ?? '') }) + '\n');
	exit(1);
}
