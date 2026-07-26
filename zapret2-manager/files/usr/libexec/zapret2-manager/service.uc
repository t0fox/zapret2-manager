#!/usr/bin/ucode
'use strict';
// service.uc — service control for zapret2-manager. CLI-first: invoked as
//   ucode service.uc <action>
// by the rpcd plugin (usr/libexec/rpcd/zapret2-manager.uc) and by the
// detached rollback timer. Prints one JSON object on stdout.
//
// Calls UPSTREAM's init for actual start/stop/restart — we do not re-implement
// daemon launch or firewall rules (docs/upstream-mapping.md). We own only:
//   - the paused flag (/tmp/zapret2-manager/paused)
//   - the safe firewall refresh: start_fw = `fw4 reload_ifsets` ONLY. Never a
//     full fw restart — that destroys the whole nft table (incident r12).
//   - the 90s link-alive rollback scaffold for disruptive ops
//
// [VERIFY] UPSTREAM_INIT path and the restart_daemons subcommand on the target.

import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { parse as jparse, stringify as jstringify } from 'json';
import { PATHS } from './constants.uc';
import { PASSTHROUGH } from './constants.uc';

const UPSTREAM_INIT = '/etc/init.d/zapret2';          // [VERIFY] upstream init
const LASTGOOD_DIR  = '/tmp/zapret2-manager/last-good';
const PENDING       = '/tmp/zapret2-manager/pending-rollback';
const ROLLBACK_TTL  = 90;

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	let out = p ? (p.read('all') ?? '') : '';
	let rc = p ? p.close() : -1;     // [VERIFY] popen close() returns exit code
	return { out: out, rc: rc };
}

function event(source, msg) {
	// Append an ndjson event with a source field (arch §6).
	try {
		mkdir('/tmp/zapret2-manager');
		let line = jstringify({ ts: time(), source: source, msg: msg }) + '\n';
		let prev = readfile(PATHS.events_ndjson) ?? '';
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

// ---- actions ----------------------------------------------------------------

function start() {
	set_paused(false);
	let r = run(UPSTREAM_INIT + ' start');
	event('ui', 'start rc=' + r.rc);
	return { ok: r.rc == 0, action: 'start', rc: r.rc, out: r.out };
}

function stop() {
	set_paused(true);
	let r = run(UPSTREAM_INIT + ' stop');
	event('ui', 'stop rc=' + r.rc + ' (paused flag set)');
	return { ok: r.rc == 0, action: 'stop', rc: r.rc, out: r.out, paused: true };
}

function restart() {
	set_paused(false);
	snapshot_last_good();
	let r = run(UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'restart rc=' + r.rc + ' (rollback scheduled ' + ROLLBACK_TTL + 's)');
	return { ok: r.rc == 0, action: 'restart', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

function restart_daemons() {
	set_paused(false);
	snapshot_last_good();
	// [VERIFY] upstream daemon-only restart; fall back to full restart.
	let r = run(UPSTREAM_INIT + ' restart_daemons 2>/dev/null || ' + UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'restart_daemons rc=' + r.rc);
	return { ok: r.rc == 0, action: 'restart_daemons', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

function start_fw() {
	// The ONLY firewall-touching command we issue. Never `service firewall
	// stop` / fw4 wholesale restart (incident r12). reload_ifsets refreshes
	// interface sets without rebuilding the table.
	snapshot_last_good();
	let r = run('fw4 reload_ifsets');   // [VERIFY] subcommand name on 25.12
	schedule_rollback();
	event('ui', 'start_fw reload_ifsets rc=' + r.rc);
	return { ok: r.rc == 0, action: 'start_fw', rc: r.rc, out: r.out,
		rollback_pending: true, rollback_ttl: ROLLBACK_TTL };
}

// ---- 90s rollback scaffold --------------------------------------------------

function snapshot_last_good() {
	try {
		run('mkdir -p ' + LASTGOOD_DIR);
		run('cp -f ' + PATHS.applied_conf + ' ' + LASTGOOD_DIR + '/ 2>/dev/null');
		run('cp -f ' + PATHS.uci_conf + ' ' + LASTGOOD_DIR + '/ 2>/dev/null');
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
	event('ui', 'link confirmed alive; rollback cancelled');
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
		event('ui', 'ROLLBACK applied (link not confirmed within ' + ROLLBACK_TTL + 's) rc=' + r.rc);
		return { ok: r.rc == 0, action: 'rollback', rc: r.rc };
	} catch (e) {
		return { ok: false, action: 'rollback', error: '' + e };
	}
}

// ---- passthrough (branch 05) -----------------------------------------------

function read_state() {
	try { let raw = readfile(PATHS.draft_state); return raw ? jparse(raw) : {}; }
	catch (e) { return {}; }
}

function write_state(st) {
	try { mkdir('/etc/zapret2-manager'); writefile(PATHS.draft_state, jstringify(st) + '\n'); }
	catch (e) { }
}

function passthrough(enabled) {
	// Toggle no-fake mode: set the upstream UCI option, persist manager state,
	// and restart via upstream so nfqws2 picks up the change. Rules stay in
	// place (we only restart the daemon, not the firewall).
	let on = !!enabled;
	try {
		let val = on ? '1' : '0';
		run('uci set zapret2.@' + PASSTHROUGH.uci_section + '[0].' + PASSTHROUGH.uci_option + '=' + val);
		run('uci commit zapret2');
	} catch (e) { }
	let st = read_state();
	st.passthrough = { enabled: on };
	write_state(st);
	set_paused(false);
	snapshot_last_good();
	let r = run(UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'passthrough ' + (on ? 'ON' : 'OFF') + ' rc=' + r.rc);
	return { ok: r.rc == 0, action: 'passthrough', enabled: on, rc: r.rc,
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
           arg == 'restart_daemons' || arg == 'start_fw' ||
           arg == 'confirm_alive' || arg == 'rollback') {
	let m = { start: start, stop: stop, restart: restart, restart_daemons: restart_daemons,
		start_fw: start_fw, confirm_alive: confirm_alive, rollback: rollback };
	print(jstringify(m[arg]()) + '\n');
} else {
	print(jstringify({ ok: false, error: 'unknown action: ' + (arg ?? '') }) + '\n');
	exit(1);
}
