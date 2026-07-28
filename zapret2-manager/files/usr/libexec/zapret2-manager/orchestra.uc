'use strict';
// orchestra.uc — read-only Orchestra capability/observability adapter
// (Phase D). Mirrors tests/lib/orchestra-logic.mjs.
//
// Upstream zapret-auto.lua already owns packet-time orchestration (autostate
// in-process). This adapter READS what is genuinely readable without
// mutation and returns honest available:false with reason+evidence for
// everything else — never empty arrays pretending success. No second
// orchestration layer is created here, ever.

import { readfile, readlink, stat, lsdir, popen } from 'fs';
import { maint_lua_compat } from './maintenance.uc';
import { PATHS } from './constants.uc';

const ORCHESTRA_VERSION = '0.9.20260307';
const ORCHESTRA_UPSTREAM_COMMIT = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';
const LUA_DIR = '/opt/zapret2/lua';

function run(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return '';
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	return out;
}

function sha256_file(path) {
	if (!stat(path)) return null;
	let h = trim(run("sha256sum " + path + " 2>/dev/null | awk '{print $1}'"));
	return (length(h) == 64) ? h : null;
}

// ---- engine detection ---------------------------------------------------------

function nfqws2_cmdline() {
	let pid = trim(run('pidof nfqws2'));
	if (pid == '') return null;
	let parts = split(pid, ' ');
	pid = parts[0];
	let raw = readfile('/proc/' + pid + '/cmdline');
	if (!raw) return null;
	return { pid: +pid, cmdline: raw };
}

function detect_engine(cmdline) {
	return {
		auto: index(cmdline, 'zapret-auto.lua') >= 0,
		antidpi: index(cmdline, 'zapret-antidpi.lua') >= 0,
		lib: index(cmdline, 'zapret-lib.lua') >= 0
	};
}

function debug_enabled(cmdline) {
	return (index(cmdline, '--debug') >= 0);
}

// ---- config reads (verbatim, no manager thresholds) ----------------------------

function parse_autohostlist_vars(text) {
	let out = {};
	let lines = split(text != null ? text : '', '\n');
	for (let i = 0; i < length(lines); i++) {
		let t = trim(lines[i]);
		if (substr(t, 0, 1) == '#') continue;
		if (substr(t, 0, 13) != 'AUTOHOSTLIST_') continue;
		let eq = index(t, '=');
		if (eq < 0) continue;
		let k = substr(t, 0, eq);
		let v = substr(t, eq + 1);
		if (substr(v, 0, 1) == '"' && substr(v, length(v) - 1) == '"' && length(v) >= 2)
			v = substr(v, 1, length(v) - 2);
		out[k] = v;
	}
	return out;
}

// ---- capability matrix (static-unavailable items carry evidence, never fake) --

function unavailable(reason, evidence) {
	return { available: false, reason: reason, evidence: evidence };
}

function capability_matrix(engine, luaFiles, debugEnabled) {
	let engineLoaded = engine.auto == true;
	return [
		{
			capability: 'engine-loaded',
			available: engineLoaded,
			reason: engineLoaded ? null : 'zapret-auto.lua is not in the live nfqws2 argv',
			evidence: ['live process argv (/proc/<pid>/cmdline)']
		},
		{
			capability: 'lua-bundle-present',
			available: length(luaFiles) > 0,
			reason: null,
			evidence: (function () { let o = []; for (let i = 0; i < length(luaFiles) && i < 8; i++) push(o, luaFiles[i].path); return o; })()
		},
		{
			capability: 'autostate-model',
			available: engineLoaded,
			reason: 'state records live in the Lua global autostate (autostate.<askey>.<hostkey>), created at packet time — IN-PROCESS MEMORY ONLY (no persistence calls exist in zapret-auto.lua)',
			evidence: ['zapret-auto.lua:48-57 (autostate creation)']
		},
		unavailable('Zapret2GUI slm_preload_blocked/slm_preload_locked/slm_preload_history do NOT exist in the pinned upstream zapret-auto.lua — there is no way to read autostate from outside the process',
			['grep slm_preload zapret-auto.lua @d3b3011 → empty', 'upstream commit ' + ORCHESTRA_UPSTREAM_COMMIT]),
		unavailable('no event stream exists: DLOG is gated by b_debug (' + (debugEnabled ? 'present' : 'ABSENT') + ' in the live argv) and AUTOHOSTLIST_DEBUGLOG=0 in the applied config',
			['zapret-auto.lua DLOG/b_debug usage', 'applied config AUTOHOSTLIST_DEBUGLOG=0']),
		unavailable('no upstream interface exists for strategy lock/block/whitelist management — implementing one would require a second orchestration layer, which is architecturally forbidden',
			['docs/architecture.md invariants (upstream owns packet-time orchestration)'])
	];
}

// capability matrix needs capability ids on unavailable items too — keep the
// shape explicit (id + available + reason + evidence).
function with_ids(matrix) {
	let ids = ['engine-loaded', 'lua-bundle-present', 'autostate-model', 'preload-apis', 'event-stream', 'lock-block-whitelist-mutation'];
	let out = [];
	for (let i = 0; i < length(matrix) && i < length(ids); i++) {
		let m = matrix[i];
		m.capability = ids[i];
		push(out, m);
	}
	push(out, {
		capability: 'autohostlist-config',
		available: true,
		reason: null,
		evidence: ['AUTOHOSTLIST_* in /opt/zapret2/config (verbatim)']
	});
	return out;
}

function unavailable_result(what, reason, evidence) {
	return {
		available: false,
		what: what,
		reason: reason,
		evidence: evidence,
		upstreamVersion: ORCHESTRA_VERSION,
		upstreamCommit: ORCHESTRA_UPSTREAM_COMMIT,
		note: 'returned as unavailable instead of an empty array pretending success'
	};
}

// ---- public API -----------------------------------------------------------------

export const orchestra_capabilities = function() {
	let cmd = nfqws2_cmdline();
	let engine = cmd != null ? detect_engine(cmd.cmdline) : { auto: false, antidpi: false, lib: false };
	let luaFiles = [];
	let names = lsdir(LUA_DIR);
	if (type(names) == 'array') {
		for (let i = 0; i < length(names) && length(luaFiles) < 8; i++) {
			let p = LUA_DIR + '/' + names[i];
			if (substr(p, length(p) - 4) == '.lua')
				push(luaFiles, { path: p, sha256: sha256_file(p) });
		}
	}
	let dbg = (cmd != null) ? debug_enabled(cmd.cmdline) : false;
	return {
		ok: true,
		upstreamVersion: ORCHESTRA_VERSION,
		upstreamCommit: ORCHESTRA_UPSTREAM_COMMIT,
		engine: engine,
		matrix: with_ids(capability_matrix(engine, luaFiles, dbg))
	};
};

export const orchestra_status = function() {
	let cmd = nfqws2_cmdline();
	let engine = cmd != null ? detect_engine(cmd.cmdline) : { auto: false, antidpi: false, lib: false };
	let verRaw = readfile('/opt/zapret2/version');
	let ver = verRaw ? trim(split(verRaw, '\n')[0]) : null;
	return {
		ok: true,
		engineInArgv: engine,
		daemonPid: (cmd != null) ? cmd.pid : null,
		nfqws2Version: ver,
		luaCompatVer: maint_lua_compat(),
		debugEnabled: (cmd != null) ? debug_enabled(cmd.cmdline) : false,
		autohostlist: parse_autohostlist_vars(readfile(PATHS.applied_conf)),
		autostate: {
			model: 'in-process Lua global autostate (autostate.<askey>.<hostkey>)',
			persisted: false,
			reason: 'no persistence calls exist in zapret-auto.lua (only an in-memory execution-plan copy)'
		}
	};
};

export const orchestra_events = function() {
	return unavailable_result('events',
		'no event stream exists: zapret-auto.lua DLOG is gated by b_debug (ABSENT in the live argv) and the applied config has AUTOHOSTLIST_DEBUGLOG=0 — nothing is emitted anywhere to consume',
		['live argv has no --debug', '/opt/zapret2/config AUTOHOSTLIST_DEBUGLOG=0', 'zapret-auto.lua DLOG/b_debug usage']);
};

export const orchestra_history = function() {
	return unavailable_result('history',
		'autostate (autostate.<askey>.<hostkey>) lives in the running nfqws2 process memory only — it is never persisted, and the pinned upstream has NO preload API to read it (slm_preload_* exist only in Zapret2GUI, a different product)',
		['zapret-auto.lua:48-57 (autostate creation, no save)', 'grep slm_preload zapret-auto.lua @d3b3011 → empty', 'upstream commit ' + ORCHESTRA_UPSTREAM_COMMIT]);
};
