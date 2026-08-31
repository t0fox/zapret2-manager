#!/usr/bin/ucode
'use strict';
// Service control for zapret2-manager. Every engine-dependent action is
// rejected before config writes or upstream init calls when zapret2 is absent.

import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { PATHS, PASSTHROUGH_PROFILE_NAME,
	NFQWS2_ENABLE_VAR, PAUSE_STOPS_FW,
	ROLLBACK_TIMEOUT_ENABLED, ROLLBACK_TTL } from './constants.uc';
import { read_var, set_var, restore_whole_file, config_sha256, commit_applied_identity } from './apply.uc';
import { fetch_list } from './list-fetcher.uc';
import { collect_observations } from './core/status-collector.uc';
import { append_ndjson, event_id } from './events.uc';

const UPSTREAM_INIT = '/etc/init.d/zapret2';
const LASTGOOD_DIR = '/tmp/zapret2-manager/last-good';
const PREV_ENABLE = LASTGOOD_DIR + '/nfqws2_enable.prev';
const PENDING = '/tmp/zapret2-manager/pending-rollback';
const DAEMON_LOG_ENABLE = 'DAEMON_LOG_ENABLE';
const WHITELIST_PATH = '/etc/zapret2-manager/lists/whitelist.txt';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}

function upstream_command(action) {
	return 'sh /etc/rc.common ' + shell_escape(UPSTREAM_INIT) + ' ' + shell_escape(action);
}

function sh(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	p.close();
	return out ? out : '';
}

function engine_available() {
	return !!stat(PATHS.nfqws_bin) && !!stat(PATHS.upstream_init);
}

function engine_missing(action) {
	return {
		ok: false,
		action: action,
		code: 'EENGINE_MISSING',
		state: 'engine_missing',
		error: 'zapret2 engine is not installed'
	};
}

function requires_engine(action) {
	let actions = [ 'passthrough', 'rollback', 'debug', 'start', 'stop', 'restart',
		'restart_daemons', 'start_fw', 'reload_ifsets' ];
	for (let i = 0; i < length(actions); i++) if (actions[i] == action) return true;
	return false;
}

function event(source, category, severity, msg, extra) {
	try {
		let ts = trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null'));
		if (!length(ts)) ts = '' + time();
		let ev = extra ? extra : {};
		ev.schema = 'events.v1'; ev.ts = ts; ev.id = event_id(source);
		ev.category = category; ev.severity = severity; ev.source = source; ev.msg = msg;
		append_ndjson(PATHS.events_ndjson, ev);
	} catch (e) { }
}

function set_paused(on) {
	if (on) {
		try { writefile(PATHS.paused_flag, ''); } catch (e) { }
	} else {
		try { unlink(PATHS.paused_flag); } catch (e) { }
	}
}

function basename(p) {
	let parts = split(p, '/');
	return parts[length(parts) - 1];
}

function save_prev_enable(prev) {
	try {
		try { mkdir(LASTGOOD_DIR); } catch (e) { }
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

function sha256_file(path) {
	if (!stat(path)) return null;
	try {
		let raw = run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'");
		let h = trim(raw.out);
		return length(h) ? h : null;
	} catch (e) { return null; }
}

function capture_applied_hash() {
	try { commit_applied_identity(); } catch (e) { }
}

function verify_engine_runtime(stage, expectedConfigSha) {
	let last = null;
	for (let attempt = 1; attempt <= 5; attempt++) {
		let observations = null;
		try { observations = collect_observations(); } catch (e) { observations = null; }
		let runtime = observations && observations.runtime ? observations.runtime : {};
		let health = observations && observations.health ? observations.health : {};
		let queue = health.queue ? health.queue : {};
		let instances = runtime.instances && type(runtime.instances) == 'array' ? runtime.instances : [];
		let processPresent = length(instances) > 0;
		let singleInstance = length(instances) == 1;
		let process = singleInstance ? instances[0] : null;
		let executable = process != null && process.exe == PATHS.nfqws_bin;
		let queueRegistered = queue.registered == true;
		let ownerMatch = process != null && queue.peerPortid != null && queue.peerPortid == process.pid;
		let rulesPresent = runtime.rulesPresent == true;
		let currentConfigSha = config_sha256();
		let configMatch = expectedConfigSha != null && currentConfigSha == expectedConfigSha;
		let checks = {
			processPresent: processPresent,
			singleInstance: singleInstance,
			executable: executable,
			rulesPresent: rulesPresent,
			queueRegistered: queueRegistered,
			ownerMatch: ownerMatch,
			configMatch: configMatch
		};
		last = { attempt: attempt, checks: checks, process: process,
			queue: queue, configSha256: currentConfigSha, expectedConfigSha256: expectedConfigSha,
			serviceState: observations && observations.serviceState ? observations.serviceState : null };
		if (checks.processPresent && checks.singleInstance && checks.executable &&
			checks.rulesPresent && checks.queueRegistered && checks.ownerMatch && checks.configMatch)
			return { ok: true, stage: stage, attempts: attempt, evidence: last };
		if (attempt < 5) run('sleep 1');
	}
	return { ok: false, code: 'ESTARTVERIFY', stage: stage, attempts: 5, evidence: last };
}

function runtime_failure(action, initResult, verification) {
	event('ui', 'runtime', 'crit', action + ' rc=0 but runtime verification failed',
		{ action: action, code: 'ESTARTVERIFY', stage: verification.stage, evidence: verification.evidence });
	return { ok: false, action: action, rc: initResult.rc, code: 'ESTARTVERIFY',
		stage: verification.stage, error: 'upstream init returned rc=0 but nfqws2 runtime is not verified',
		out: initResult.out, verification: verification };
}

function snapshot_last_good() {
	try {
		try { mkdir(LASTGOOD_DIR); } catch (e) { }
		let configBytes = readfile(PATHS.applied_conf);
		let uciBytes = readfile(PATHS.uci_conf);
		if (configBytes == null) configBytes = '';
		if (uciBytes == null) uciBytes = '';
		writefile(LASTGOOD_DIR + '/' + basename(PATHS.applied_conf), configBytes);
		writefile(LASTGOOD_DIR + '/' + basename(PATHS.uci_conf), uciBytes);
	} catch (e) { }
}

function schedule_rollback() {
	if (!ROLLBACK_TIMEOUT_ENABLED) return;
	try {
		writefile(PENDING, '' + (time() + ROLLBACK_TTL) + '\n');
		run('setsid sh -c "sleep ' + ROLLBACK_TTL + '; [ -f ' + PENDING +
			' ] && /usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback" >/dev/null 2>&1 &');
	} catch (e) { }
}

function apply_nfqws2_enable(value) {
	let written = set_var(NFQWS2_ENABLE_VAR, '' + value);
	if (written == null) return null;
	event('ui', 'config', 'info',
		NFQWS2_ENABLE_VAR + '=' + value + ' written to /opt/zapret2/config via apply.uc',
		{ var: NFQWS2_ENABLE_VAR, value: value });
	return value;
}

function start() {
	set_paused(false);
	try { unlink(PENDING); } catch (e) { }
	let prev = read_prev_enable();
	let restored = (prev == null) ? 1 : prev;
	if (apply_nfqws2_enable(restored) == null)
		return { ok: false, action: 'start', error: 'config write failed' };
	let expectedConfigSha = config_sha256();
	let r = run(upstream_command('start'));
	if (r.rc == 0) {
		let verification = verify_engine_runtime('start', expectedConfigSha);
		if (!verification.ok) return runtime_failure('start', r, verification);
		capture_applied_hash();
	}
	event('ui', 'pause', 'info',
		'start rc=' + r.rc + ' (resumed; NFQWS2_ENABLE=' + restored + ')',
		{ reason: 'manual_ui', rc: r.rc, pause: 'exit', nfqws2_enable: restored });
	return { ok: r.rc == 0, action: 'start', rc: r.rc, out: r.out };
}

function stop() {
	let prev = read_var(NFQWS2_ENABLE_VAR);
	set_paused(true);
	snapshot_last_good();
	save_prev_enable(prev);
	if (apply_nfqws2_enable(0) == null)
		return { ok: false, action: 'stop', error: 'config write failed' };
	if (PAUSE_STOPS_FW) run(upstream_command('stop_fw'));
	let r = run(upstream_command('stop'));
	if (r.rc == 0) capture_applied_hash();
	schedule_rollback();
	event('ui', 'pause', 'info',
		'stop rc=' + r.rc + ' (paused; NFQWS2_ENABLE=0; prev=' + (prev == null ? 'null' : prev) + ')',
		{ pause: 'enter', rc: r.rc, prev: prev });
	return { ok: r.rc == 0, action: 'stop', rc: r.rc, out: r.out, paused: true,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function restart() {
	set_paused(false);
	snapshot_last_good();
	let expectedConfigSha = config_sha256();
	let r = run(upstream_command('restart'));
	if (r.rc == 0) {
		let verification = verify_engine_runtime('restart', expectedConfigSha);
		if (!verification.ok) return runtime_failure('restart', r, verification);
		capture_applied_hash();
	}
	schedule_rollback();
	event('ui', 'restart', 'info', 'restart rc=' + r.rc +
		(ROLLBACK_TIMEOUT_ENABLED ? ' (rollback armed ' + ROLLBACK_TTL + 's)' : ' (snapshot taken; auto-rollback off by default)'),
		{ reason: 'manual_ui', rc: r.rc, rollback_ttl: ROLLBACK_TTL });
	return { ok: r.rc == 0, action: 'restart', rc: r.rc, out: r.out,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function restart_daemons() {
	set_paused(false);
	snapshot_last_good();
	let expectedConfigSha = config_sha256();
	let r = run(upstream_command('restart_daemons') + ' 2>/dev/null || ' + upstream_command('restart'));
	if (r.rc == 0) {
		let verification = verify_engine_runtime('restart_daemons', expectedConfigSha);
		if (!verification.ok) return runtime_failure('restart_daemons', r, verification);
		capture_applied_hash();
	}
	schedule_rollback();
	event('ui', 'restart', 'info', 'restart_daemons rc=' + r.rc,
		{ reason: 'manual_ui', rc: r.rc });
	return { ok: r.rc == 0, action: 'restart_daemons', rc: r.rc, out: r.out,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function debug(enabled) {
	let on = enabled == '1' || enabled == 'true';
	if (set_var(DAEMON_LOG_ENABLE, on ? '1' : '0') == null)
		return { ok: false, action: 'debug', enabled: on, error: 'config write failed' };
	let expectedConfigSha = config_sha256();
	let r = run(upstream_command('restart_daemons') + ' 2>/dev/null || ' + upstream_command('restart'));
	if (r.rc == 0) {
		let verification = verify_engine_runtime('debug', expectedConfigSha);
		if (!verification.ok) return runtime_failure('debug', r, verification);
		capture_applied_hash();
	}
	return { ok: r.rc == 0, action: 'debug', enabled: on, rc: r.rc, out: r.out };
}

function start_fw() {
	snapshot_last_good();
	let r = run(upstream_command('start_fw'));
	schedule_rollback();
	event('ui', 'config', 'info', 'start_fw rc=' + r.rc, { rc: r.rc });
	return { ok: r.rc == 0, action: 'start_fw', rc: r.rc, out: r.out,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function reload_ifsets() {
	snapshot_last_good();
	let r = run(upstream_command('reload_ifsets'));
	schedule_rollback();
	event('ui', 'config', 'info', 'reload_ifsets rc=' + r.rc, { rc: r.rc });
	return { ok: r.rc == 0, action: 'reload_ifsets', rc: r.rc, out: r.out,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function confirm_alive() {
	try { unlink(PENDING); } catch (e) { }
	event('ui', 'rollback', 'info', 'link confirmed alive; rollback cancelled');
	return { ok: true, action: 'confirm_alive', rollback_pending: false };
}

function rollback(force) {
	try {
		if (!force) {
			let pending = readfile(PENDING);
			if (!pending) return { ok: true, action: 'rollback', skipped: true,
				reason: 'no pending rollback marker' };
			let expiry = +trim(pending);
			if (expiry && time() < expiry)
				return { ok: true, action: 'rollback', skipped: true,
					reason: 'marker expiry in the future (a newer action re-armed it)' };
		}
		let configSnapshot = LASTGOOD_DIR + '/' + basename(PATHS.applied_conf);
		let uciSnapshot = LASTGOOD_DIR + '/' + basename(PATHS.uci_conf);
		if (!stat(configSnapshot) || !stat(uciSnapshot))
			return { ok: false, action: 'rollback', code: 'ENOLASTGOOD', error: 'no last-good snapshot' };
		let configBytes = readfile(configSnapshot);
		let uciBytes = readfile(uciSnapshot);
		if (configBytes == null || uciBytes == null)
			return { ok: false, action: 'rollback', code: 'ENOLASTGOOD', error: 'snapshot read failed' };
		let expected = sha256_file(configSnapshot);
		let restored = restore_whole_file(PATHS.applied_conf, configBytes);
		writefile(PATHS.uci_conf, uciBytes);
		let configRestored = restored != null && config_sha256() == expected && readfile(PATHS.applied_conf) == configBytes;
		if (!configRestored)
			return { ok: false, action: 'rollback', code: 'EROLLBACK', error: 'exact config restore verification failed', configRestored: false };
		try { unlink(PENDING); } catch (e) { }
		let r = run(upstream_command('restart'));
		if (r.rc == 0) capture_applied_hash();
		event('ui', 'rollback', 'crit', 'ROLLBACK exact snapshot restored rc=' + r.rc,
			{ rc: r.rc, rollback_ttl: ROLLBACK_TTL, configRestored: configRestored });
		return { ok: r.rc == 0, action: 'rollback', rc: r.rc, configRestored: configRestored };
	} catch (e) {
		return { ok: false, action: 'rollback', error: '' + e };
	}
}

// ---- passthrough -------------------------------------------------------------
const PREV_OPT = LASTGOOD_DIR + '/nfqws2_opt.orig';

function save_orig_opt(v) {
	try { mkdir(LASTGOOD_DIR); writefile(PREV_OPT, (v == null ? '' : v) + '\n'); }
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

const LUA_DESYNC_TOKEN = '--lua-desync=';
function _is_ws(c) { return c == ' ' || c == '\n' || c == '\t' || c == '\r'; }
function strip_lua_desync(value) {
	if (value == null) return '';
	let out = '';
	let i = 0;
	let n = length(value);
	while (i < n) {
		let wsStart = i;
		while (i < n && _is_ws(substr(value, i, 1))) i++;
		let ws = substr(value, wsStart, i - wsStart);
		let tokStart = i;
		while (i < n && !_is_ws(substr(value, i, 1))) i++;
		let tok = substr(value, tokStart, i - tokStart);
		if (length(tok) == 0) {
			if (length(ws)) out += ws;
			break;
		}
		if (substr(tok, 0, length(LUA_DESYNC_TOKEN)) == LUA_DESYNC_TOKEN) continue;
		if (length(out) == 0) out += tok;
		else out += ws + tok;
	}
	return out;
}

function read_state() {
	try { let raw = readfile(PATHS.draft_state); return raw ? json(raw) : {}; }
	catch (e) { return {}; }
}

function write_state(st) {
	try { mkdir('/etc/zapret2-manager'); writefile(PATHS.draft_state, sprintf("%J", st) + '\n'); }
	catch (e) { }
}

function passthrough(enabled) {
	let on = !!enabled;
	let st = read_state();
	set_paused(false);
	snapshot_last_good();
	if (on) {
		let cur = read_var('NFQWS2_OPT');
		if (cur == null) {
			event('ui', 'config', 'warn', 'passthrough ON skipped: no NFQWS2_OPT in /opt/zapret2/config to strip',
				{ passthrough: true, reason: 'no_nfqws2_opt' });
			return { ok: false, action: 'passthrough', enabled: true, error: 'no NFQWS2_OPT in /opt/zapret2/config' };
		}
		save_orig_opt(cur);
		if (set_var('NFQWS2_OPT', strip_lua_desync(cur)) == null)
			return { ok: false, action: 'passthrough', enabled: true, error: 'config write failed' };
		st.active_profile = { name: PASSTHROUGH_PROFILE_NAME, strategies: [] };
		st.passthrough = { enabled: true };
		write_state(st);
	} else {
		let orig = read_orig_opt();
		if (orig != null) {
			if (set_var('NFQWS2_OPT', orig) == null)
				return { ok: false, action: 'passthrough', enabled: false, error: 'config write failed' };
		}
		st.active_profile = { name: 'default', strategies: null };
		st.passthrough = { enabled: false };
		write_state(st);
	}
	let r = run(upstream_command('restart'));
	if (r.rc == 0) capture_applied_hash();
	schedule_rollback();
	event('ui', 'config', 'info', 'passthrough ' + (on ? 'ON' : 'OFF') + ' (profile=' +
		(on ? PASSTHROUGH_PROFILE_NAME : 'default') + ') rc=' + r.rc,
		{ passthrough: on, profile: (on ? PASSTHROUGH_PROFILE_NAME : 'default'), rc: r.rc });
	return { ok: r.rc == 0, action: 'passthrough', enabled: on, rc: r.rc,
		profile: (on ? PASSTHROUGH_PROFILE_NAME : 'default'),
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

let arg = ARGV[0];
if (requires_engine(arg) && !engine_available()) {
	print(sprintf("%J", engine_missing(arg ? arg : '')) + '\n');
	exit(0);
}
if (arg == 'passthrough') {
	let on = ARGV[1];
	print(sprintf("%J", passthrough(on == 'true' || on == '1')) + '\n');
} else if (arg == 'rollback') {
	print(sprintf("%J", rollback(true)) + '\n');
} else if (arg == 'debug') {
	print(sprintf("%J", debug(ARGV[1])) + '\n');
} else if (arg == 'start' || arg == 'stop' || arg == 'restart' ||
	arg == 'restart_daemons' || arg == 'start_fw' || arg == 'reload_ifsets' ||
	arg == 'confirm_alive') {
	let m = { start: start, stop: stop, restart: restart, restart_daemons: restart_daemons,
		start_fw: start_fw, reload_ifsets: reload_ifsets, confirm_alive: confirm_alive };
	print(sprintf("%J", m[arg]()) + '\n');
} else if (arg == 'sync_lists') {
	print(sprintf("%J", fetch_list({ name: 'ru-blocked.txt' })) + '\n');
} else {
	let argval = arg ? arg : '';
	print(sprintf("%J", { ok: false, error: 'unknown action: ' + argval }) + '\n');
	exit(1);
}
