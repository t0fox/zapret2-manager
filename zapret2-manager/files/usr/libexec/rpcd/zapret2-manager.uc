#!/usr/bin/ucode
'use strict';
// rpcd ucode plugin: ubus object `zapret2-manager`.
//
// Methods:
//   status           — cached three-level state (branch 02)
//   start            — clear paused, upstream start              (branch 04)
//   stop             — set paused, upstream stop                 (branch 04)
//   restart          — clear paused, upstream restart + 90s rollback arm
//   restart_daemons  — upstream daemon restart + 90s rollback arm
//   start_fw         — `fw4 reload_ifsets` ONLY (never full fw restart) + arm
//   confirm_alive    — cancel a pending 90s rollback
//   rollback         — force rollback now (manual)
//
// Service actions shell out to service.uc (CLI) and parse its JSON. The plugin
// itself owns no service/firewall logic — that lives in service.uc, which
// calls upstream's own init (docs/upstream-mapping.md).
//
// [VERIFY] registration shape (rpcd-ucode return-method-table convention) and
// load path (task spec: /usr/libexec/rpcd/; some builds use
// /usr/share/rpcd/ucode/ — move this file if `ubus call` reports not-found).

import { stat, readfile, popen } from 'fs';
import { parse as jparse } from 'json';

const STATUS_JSON = '/tmp/zapret2-manager/status.json';
const COLLECTOR   = '/usr/libexec/zapret2-manager/status.uc';
const SERVICE     = '/usr/libexec/zapret2-manager/service.uc';
const CACHE_TTL   = 3;

function now() { return time(); }   // [VERIFY] ucode time() → unix seconds

function cache_fresh() {
	let st = stat(STATUS_JSON);
	if (!st) return false;
	return (now() - st.mtime) <= CACHE_TTL;   // [VERIFY] stat().mtime in seconds
}

function refresh() {
	let p = popen('/usr/bin/ucode ' + COLLECTOR + ' --no-print 2>/dev/null', 'r');
	if (p) { p.read('all'); p.close(); }
}

function status_method(req) {
	if (!cache_fresh()) refresh();
	let raw = readfile(STATUS_JSON);
	if (!raw) return { error: 'status unavailable', collected_at: null };
	try { return jparse(raw); }
	catch (e) { return { error: 'status parse failed', raw: raw }; }
}

// Run a service.uc action and parse its single-line JSON result.
function service_action(action, params) {
	let cmd = '/usr/bin/ucode ' + SERVICE + ' ' + action + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	let out = p ? (p.read('all') ?? '') : '';
	if (p) p.close();
	try { return jparse(out) ?? { ok: false, error: 'no output', raw: out }; }
	catch (e) { return { ok: false, error: 'parse failed', raw: out }; }
}

// passthrough (branch 05): toggle no-fake diagnostic mode. Takes {enabled:bool}.
// [VERIFY] rpcd-ucode param access shape (req.args vs req) — handled defensively.
function passthrough_method(req) {
	let en = null;
	try { en = req?.args?.enabled; } catch (e) { }
	if (en == null) { try { en = req?.enabled; } catch (e) { } }
	if (en == null) return { ok: false, error: 'missing enabled param' };
	let on = (en == true || en == 'true' || en == 1 || en == '1');
	let cmd = '/usr/bin/ucode ' + SERVICE + ' passthrough ' + (on ? 'true' : 'false') + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	let out = p ? (p.read('all') ?? '') : '';
	if (p) p.close();
	try { return jparse(out) ?? { ok: false, error: 'no output', raw: out }; }
	catch (e) { return { ok: false, error: 'parse failed', raw: out }; }
}

return {
	status: status_method,
	start:           function (req) { return service_action('start'); },
	stop:            function (req) { return service_action('stop'); },
	restart:         function (req) { return service_action('restart'); },
	restart_daemons: function (req) { return service_action('restart_daemons'); },
	start_fw:        function (req) { return service_action('start_fw'); },
	confirm_alive:   function (req) { return service_action('confirm_alive'); },
	rollback:        function (req) { return service_action('rollback'); },
	passthrough:     passthrough_method
};
