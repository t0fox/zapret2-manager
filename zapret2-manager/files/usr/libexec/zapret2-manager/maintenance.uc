'use strict';
// maintenance.uc — versions, maintenance status, events tail, diagnostics
// export (SLICE 5). Mirrors tests/lib/maintenance-logic.mjs (events parsing
// + redaction rules).
//
// Honesty rules:
//   - versions are read from the SYSTEM (apk database, version files, OS
//     release) — update availability is null with an explicit note (no
//     fabricated "up to date");
//   - events_parse REPORTS malformed ndjson lines (never silently dropped);
//   - diagnostics_export redacts secrets by KEY name and VALUE pattern — a
//     future token field must never leak through the export.

import { readfile, stat, popen } from 'fs';
import { PATHS } from './constants.uc';

function run(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------
function apk_version(pkg) {
	// apk v3: `apk list -I <pkg>` prints "name-version arch repo" lines
	let r = run('apk list -I ' + pkg + ' 2>/dev/null');
	let lines = split(trim(r.out), '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (substr(l, 0, length(pkg) + 1) == pkg + '-') {
			let rest = substr(l, length(pkg) + 1);
			let sp = index(rest, ' ');
			return (sp > 0) ? substr(rest, 0, sp) : rest;
		}
	}
	return null;
}

function read_first_line(path) {
	let raw = readfile(path);
	if (!raw) return null;
	let lines = split(raw, '\n');
	let v = trim(lines[0]);
	return length(v) ? v : null;
}

function lua_compat_ver() {
	let raw = readfile('/opt/zapret2/lua/zapret-lib.lua');
	if (!raw) return null;
	// NFQWS2_COMPAT_VER_REQUIRED = N (first match)
	let idx = index(raw, 'NFQWS2_COMPAT_VER_REQUIRED');
	if (idx < 0) return null;
	let rest = substr(raw, idx, 64);
	let eq = index(rest, '=');
	if (eq < 0) return null;
	let num = '';
	for (let i = eq + 1; i < length(rest); i++) {
		let c = ord(substr(rest, i, 1));
		if (c >= 48 && c <= 57) num += substr(rest, i, 1);
		else if (length(num)) break;
	}
	return length(num) ? (+num) : null;
}

// export alias for the orchestra adapter (one compat reader, no duplication)
export const maint_lua_compat = lua_compat_ver;

export const versions = function() {
	let os = null;
	let rel = readfile('/etc/openwrt_release');
	if (rel) {
		let lines = split(rel, '\n');
		for (let i = 0; i < length(lines); i++) {
			if (substr(lines[i], 0, 19) == 'DISTRIB_DESCRIPTION') {
				let l = lines[i];
				let q1 = index(l, "'");
				let q2 = (q1 >= 0) ? index(substr(l, q1 + 1), "'") : -1;
				if (q1 >= 0 && q2 > 0) os = substr(l, q1 + 1, q2);
			}
		}
	}
	return {
		ok: true,
		manager: { name: 'zapret2-manager', version: apk_version('zapret2-manager') },
		luciApp: { name: 'luci-app-zapret2-manager', version: apk_version('luci-app-zapret2-manager') },
		upstreamPkg: { name: 'zapret2', version: apk_version('zapret2') },
		nfqws2: read_first_line('/opt/zapret2/version'),
		luaCompatVer: lua_compat_ver(),
		os: os,
		updateAvailable: null,
		note: 'installed versions read from the system; update availability is not checked here (no network fetch)'
	};
};

// ---------------------------------------------------------------------------
// events tail
// ---------------------------------------------------------------------------
export const events_tail = function(input) {
	let limit = 50;
	let since_seq = 0;
	if (type(input) == 'object' && input != null) {
		if (type(input.limit) == 'int') limit = input.limit;
		else if (type(input.n) == 'int') limit = input.n;
		if (type(input.since_seq) == 'int') since_seq = input.since_seq;
	}
	if (limit < 1) limit = 1;
	if (limit > 500) limit = 500;
	let raw = readfile(PATHS.events_ndjson);
	if (!raw) return { ok: true, events: [], malformed: [], total: 0, last_seq: 0, note: 'no events file yet' };
	let lines = split(raw, '\n');
	let nonEmpty = [];
	for (let i = 0; i < length(lines); i++) if (length(trim(lines[i]))) push(nonEmpty, lines[i]);
	let start = (length(nonEmpty) > limit) ? (length(nonEmpty) - limit) : 0;
	let events = [];
	let malformed = [];
	for (let i = start; i < length(nonEmpty); i++) {
		let ev = null;
		try { ev = json(nonEmpty[i]); } catch (e) { ev = null; }
		if (ev != null) {
			ev.seq = i + 1;
			if (ev.seq > since_seq) push(events, ev);
		}
		else push(malformed, { preview: substr(nonEmpty[i], 0, 120) });
	}
	return { ok: true, events: events, malformed: malformed, total: length(nonEmpty), last_seq: length(nonEmpty) };
};

// ---------------------------------------------------------------------------
// maintenance status
// ---------------------------------------------------------------------------
function df_percent(path) {
	let r = run("df " + path + " 2>/dev/null | awk 'NR==2{print $5}'");
	let v = trim(r.out);
	if (substr(v, length(v) - 1) == '%') v = substr(v, 0, length(v) - 1);
	return length(v) ? (+v) : null;
}

function meminfo_avail_kb() {
	let raw = readfile('/proc/meminfo');
	if (!raw) return null;
	let lines = split(raw, '\n');
	for (let i = 0; i < length(lines); i++) {
		if (substr(lines[i], 0, 13) == 'MemAvailable:') {
			let parts = split(trim(substr(lines[i], 13)), ' ');
			for (let j = 0; j < length(parts); j++)
				if (length(parts[j]) && (+parts[j]) > 0) return +parts[j];
		}
	}
	return null;
}

export const maintenance_status = function() {
	let uptime = null;
	let up = readfile('/proc/uptime');
	if (up) {
		let sp = index(up, ' ');
		uptime = (sp > 0) ? (+substr(up, 0, sp)) : null;
	}
	// backups summary (dir presence only — the full list is backup_list)
	let backups = {};
	let scopes = ['engineConfig', 'ourState', 'lists', 'profiles'];
	for (let i = 0; i < length(scopes); i++) {
		let cur = '/etc/zapret2-manager/backups/' + scopes[i] + '/current';
		backups[scopes[i]] = { hasBackup: stat(cur) ? true : false };
	}
	// events summary
	let evCount = 0;
	let lastSeverity = null;
	let ev = events_tail({ n: 1 });
	if (ev.total != null) evCount = ev.total;
	if (length(ev.events) > 0) lastSeverity = ev.events[0].severity;
	return {
		ok: true,
		uptimeSec: uptime,
		memory: { availableKb: meminfo_avail_kb() },
		storage: { overlayPercent: df_percent('/overlay'), tmpPercent: df_percent('/tmp') },
		backups: backups,
		events: { total: evCount, lastSeverity: lastSeverity },
		rebootRequired: false,
		note: 'rebootRequired is always false — this manager never requires a reboot for its own changes'
	};
};

// ---------------------------------------------------------------------------
// diagnostics export (redacted)
// ---------------------------------------------------------------------------
const SECRET_KEY_PARTS = ['token', 'secret', 'passw', 'api_key', 'apikey', 'private_key', 'session', 'cookie', 'authorization'];

function key_is_secret(key) {
	let lk = '';
	for (let i = 0; i < length(key); i++) {
		let c = ord(substr(key, i, 1));
		lk += (c >= 65 && c <= 90) ? chr(c + 32) : substr(key, i, 1);
	}
	for (let i = 0; i < length(SECRET_KEY_PARTS); i++)
		if (index(lk, SECRET_KEY_PARTS[i]) >= 0) return true;
	return false;
}

function value_is_secret_shape(v) {
	// telegram-bot-token shape (8-10 digits : 30+ token chars) / Bearer X
	if (length(v) < 16) return false;
	if (substr(v, 0, 7) == 'Bearer ') return true;
	let colon = index(v, ':');
	if (colon >= 8 && colon <= 10) {
		let digits = true;
		for (let i = 0; i < colon; i++) {
			let c = ord(substr(v, i, 1));
			if (c < 48 || c > 57) { digits = false; break; }
		}
		if (digits && length(v) - colon - 1 >= 30) return true;
	}
	return false;
}

function redact_value(v, key, counter) {
	if (key_is_secret(key)) {
		if (v != null && v != '') { counter[0]++; return '<redacted>'; }
		return v;
	}
	if (type(v) == 'string') {
		if (value_is_secret_shape(v)) { counter[0]++; return '<redacted>'; }
		return v;
	}
	if (type(v) == 'array') {
		let out = [];
		for (let i = 0; i < length(v); i++) push(out, redact_value(v[i], key, counter));
		return out;
	}
	if (type(v) == 'object' && v != null) {
		let out = {};
		let ks = keys(v);
		for (let i = 0; i < length(ks); i++)
			out[ks[i]] = redact_value(v[ks[i]], ks[i], counter);
		return out;
	}
	return v;
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let r = run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'");
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

export const diagnostics_export = function() {
	let bundle = {
		generatedAt: time(),
		versions: versions(),
		maintenance: maintenance_status(),
		status: null,
		events: events_tail({ n: 50 }),
		hashes: {
			config: sha256_file(PATHS.applied_conf),
			state: sha256_file(PATHS.draft_state)
		},
		notes: ['status block is the last collected snapshot (may be up to 3s old)']
	};
	let raw = readfile(PATHS.status_json);
	if (raw) {
		let sj = null;
		try { sj = json(raw); } catch (e) { sj = null; }
		bundle.status = sj;
	}
	let counter = [0];
	let redacted = redact_value(bundle, '', counter);
	redacted.redactedFields = counter[0];
	return { ok: true, export: redacted };
};
