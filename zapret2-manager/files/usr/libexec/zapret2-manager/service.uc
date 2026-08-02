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
import { PATHS, PASSTHROUGH_PROFILE_NAME,
	NFQWS2_ENABLE_VAR, PAUSE_STOPS_FW,
	ROLLBACK_TIMEOUT_ENABLED, ROLLBACK_TTL } from './constants.uc';
import { read_var, set_var } from './apply.uc';

const UPSTREAM_INIT = '/etc/init.d/zapret2';
const LASTGOOD_DIR  = '/tmp/zapret2-manager/last-good';
const PREV_ENABLE   = LASTGOOD_DIR + '/nfqws2_enable.prev';
const PENDING       = '/tmp/zapret2-manager/pending-rollback';
const USER_PRESETS = '/etc/zapret2-manager/presets';
const FACTORY_PRESETS = '/usr/share/zapret2-manager/presets';
const PRESET_FILES = [ 'tcp_https.txt', 'stun_voice.txt', 'udp_games.txt' ];
const DAEMON_LOG_ENABLE = 'DAEMON_LOG_ENABLE';

function preset_token(token) {
	// Keep this list to options accepted by the installed nfqws2. In particular,
	// `--wf-udp-out` is a legacy nfqws1 option: passing it makes nfqws2 exit
	// before it reaches any profile. Preset preambles and unrecognized options
	// are intentionally retained in the files, but never reach the daemon.
	// `old` is a fixture placeholder in the shipped factory documents, not a
	// function provided by the target Lua bundle. It must not reach nfqws2.
	if (token == '--lua-desync=old') return false;
	let prefixes = [ '--filter-tcp=', '--filter-udp=', '--hostlist-domains=', '--hostlist=', '--ipset=', '--filter-l7=', '--payload=', '--out-range=', '--in-range=', '--lua-desync=', '--new' ];
	for (let i = 0; i < length(prefixes); i++) if (token == prefixes[i] || substr(token, 0, length(prefixes[i])) == prefixes[i]) return true;
	return false;
}

// Render the effective preset set into the upstream's NFQWS2_OPT. A user
// file wins by name; factory files are only the fallback. Preamble comments
// and manager-only unknown options never become nfqws2 argv tokens.
function sync_effective_presets() {
	let tokens = [];
	for (let i = 0; i < length(PRESET_FILES); i++) {
		let user = USER_PRESETS + '/' + PRESET_FILES[i], factory = FACTORY_PRESETS + '/' + PRESET_FILES[i];
		let text = readfile(stat(user) ? user : factory);
		if (!text) continue;
		for (let line in split(text, '\n')) {
			line = trim(line);
			if (!length(line) || substr(line, 0, 1) == '#') continue;
			for (let token in split(line, ' ')) if (preset_token(token)) push(tokens, token);
		}
	}
	if (!length(tokens)) return null;
	// Factory UDP profiles name these two optional lists. They must exist even
	// before the operator has populated them; nfqws2 otherwise exits at init.
	// Never overwrite an existing operator-managed list.
	try {
		mkdir('/etc/zapret2-manager/ipset');
		if (!stat('/etc/zapret2-manager/ipset/games.txt')) writefile('/etc/zapret2-manager/ipset/games.txt', '');
		if (!stat('/etc/zapret2-manager/ipset/steam.txt')) writefile('/etc/zapret2-manager/ipset/steam.txt', '');
	} catch (e) { }
	let rendered = join(' ', tokens);
	set_var('NFQWS2_OPT', rendered);
	return rendered;
}

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
		let line = sprintf("%J", ev) + '\n';
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

// ---- shared apply/rollback helpers -----------------------------------------
// These four were originally defined in the "90s rollback scaffold" section
// BELOW their call sites — ucode does NOT hoist declarations in either mode
// (proven on target: script mode fails with "not a function", module mode
// with "undeclared variable"), so start/stop/restart/pause failed at runtime
// whenever they reached capture_applied_hash / snapshot_last_good /
// schedule_rollback. They are declared BEFORE apply_nfqws2_enable now.

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
		writefile('/tmp/zapret2-manager/applied.sha256', sprintf("%J", st) + '\n');
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
	// The MECHANISM stays (rollback / confirm_alive + the snapshot in
	// snapshot_last_good), but the AUTOMATIC timer is NOT armed by default —
	// ROLLBACK_TIMEOUT_ENABLED is false until the timer path is confirmed on
	// the device. A premature rollback drops the link, and a stale-timer
	// defect was already found here. When enabled, arm a pending marker with
	// an expiry timestamp + a detached timer; confirm_alive removes it; if it
	// survives past the timer, rollback() restores last-good and restarts.
	if (!ROLLBACK_TIMEOUT_ENABLED) return;
	try {
		writefile(PENDING, '' + (time() + ROLLBACK_TTL) + '\n');
		run('setsid sh -c "sleep ' + ROLLBACK_TTL + '; [ -f ' + PENDING +
			' ] && /usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback" >/dev/null 2>&1 &');
	} catch (e) { }
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
	sync_effective_presets();
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
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function restart() {
	set_paused(false);
	snapshot_last_good();
	sync_effective_presets();
	let r = run(UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'restart', 'info', 'restart rc=' + r.rc + (ROLLBACK_TIMEOUT_ENABLED ? ' (rollback armed ' + ROLLBACK_TTL + 's)' : ' (snapshot taken; auto-rollback off by default)'),
		{ reason: 'manual_ui', rc: r.rc, rollback_ttl: ROLLBACK_TTL });
	return { ok: r.rc == 0, action: 'restart', rc: r.rc, out: r.out,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

function restart_daemons() {
	set_paused(false);
	snapshot_last_good();
	sync_effective_presets();
	// [VERIFY] upstream daemon-only restart; fall back to full restart.
	let r = run(UPSTREAM_INIT + ' restart_daemons 2>/dev/null || ' + UPSTREAM_INIT + ' restart');
	schedule_rollback();
	event('ui', 'restart', 'info', 'restart_daemons rc=' + r.rc,
		{ reason: 'manual_ui', rc: r.rc });
	return { ok: r.rc == 0, action: 'restart_daemons', rc: r.rc, out: r.out,
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

// CLI-only diagnostic switch. Upstream maps DAEMON_LOG_ENABLE=1 to
// --debug=@/tmp/zapret2+nfqws2+1+main.log, so the exact nfqws2 decisions are
// retained without adding a UI or changing RPC contracts.
function debug(enabled) {
	let on = enabled == '1' || enabled == 'true';
	set_var(DAEMON_LOG_ENABLE, on ? '1' : '0');
	sync_effective_presets();
	let r = run(UPSTREAM_INIT + ' restart_daemons 2>/dev/null || ' + UPSTREAM_INIT + ' restart');
	return { ok: r.rc == 0, action: 'debug', enabled: on, rc: r.rc, out: r.out };
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
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
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
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

// ---- 90s rollback scaffold --------------------------------------------------
// (sha256_file / capture_applied_hash / snapshot_last_good /
// schedule_rollback moved ABOVE the actions — ucode does not hoist.)

function confirm_alive() {
	try { unlink(PENDING); } catch (e) { }
	event('ui', 'rollback', 'info', 'link confirmed alive; rollback cancelled');
	return { ok: true, action: 'confirm_alive', rollback_pending: false };
}

function rollback(force) {
	try {
		// MANUAL rollback (force=true, from the ubus 'rollback' method) restores
		// last-good UNCONDITIONALLY — the operator is explicitly undoing a bad
		// apply/passthrough. This is the safety net; it must work even when the
		// automatic timer is OFF (ROLLBACK_TIMEOUT_ENABLED=false, the default),
		// because then PENDING is never written and a PENDING gate would make
		// manual rollback a silent no-op.
		//
		// TIMER rollback (force=false, from the detached sleep timer) honors the
		// expiry timestamp: a stale timer must NOT roll back if the marker is
		// gone or its expiry is still in the future (a newer action re-armed it).
		if (!force) {
			let pending = readfile(PENDING);
			if (!pending) return { ok: true, action: 'rollback', skipped: true,
				reason: 'no pending rollback marker' };
			let expiry = +trim(pending);
			if (expiry && time() < expiry)
				return { ok: true, action: 'rollback', skipped: true,
					reason: 'marker expiry in the future (a newer action re-armed it)' };
		}
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
		// If out is empty (first KEPT token), drop the leading separator — it
		// was before a dropped token and would be an orphan (leading space/nl).
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
		rollback_pending: ROLLBACK_TIMEOUT_ENABLED, rollback_ttl: ROLLBACK_TTL };
}

// ---- CLI dispatch -----------------------------------------------------------

let arg = ARGV[0];
if (arg == 'passthrough') {
	// ucode service.uc passthrough <true|false|1|0>
	let on = ARGV[1];
	let enabled = (on == 'true' || on == '1');
	print(sprintf("%J", passthrough(enabled)) + '\n');
} else if (arg == 'rollback') {
	// CLI/ubus 'rollback' = MANUAL (force=true): restore last-good
	// unconditionally (the automatic timer path passes no arg = not forced).
	print(sprintf("%J", rollback(true)) + '\n');
} else if (arg == 'debug') {
	print(sprintf("%J", debug(ARGV[1])) + '\n');
} else if (arg == 'start' || arg == 'stop' || arg == 'restart' ||
           arg == 'restart_daemons' || arg == 'start_fw' || arg == 'reload_ifsets' ||
           arg == 'confirm_alive') {
	let m = { start: start, stop: stop, restart: restart, restart_daemons: restart_daemons,
		start_fw: start_fw, reload_ifsets: reload_ifsets,
		confirm_alive: confirm_alive };
	print(sprintf("%J", m[arg]()) + '\n');
} else {
	let argval = arg ? arg : '';
	print(sprintf("%J", { ok: false, error: 'unknown action: ' + argval }) + '\n');
	exit(1);
}
