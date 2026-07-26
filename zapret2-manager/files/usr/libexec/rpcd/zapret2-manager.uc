#!/usr/bin/ucode
'use strict';
// rpcd ucode plugin: ubus object `zapret2-manager`, method `status`.
//
// Serves /tmp/zapret2-manager/status.json with a 3s TTL. On a cache miss
// (file missing or older than CACHE_TTL_SEC) it re-runs the collector
// (/usr/libexec/zapret2-manager/status.uc) and then returns the fresh file.
// The plugin does no collection itself — that lives in the collector, which
// is independently runnable and testable.
//
// [VERIFY] registration shape: this file uses the rpcd-ucode convention of
// returning an object whose keys are method names. If your build's rpcd-ucode
// runtime instead expects ubus.module_register({...}) or a { methods: {...} }
// wrapper, adapt only this adapter — the collector is unaffected. Confirm the
// load path too: task spec said /usr/libexec/rpcd/ (used here); some builds
// load ucode plugins from /usr/share/rpcd/ucode/ — move this file if needed.

import { stat, readfile, popen } from 'fs';
import { parse as jparse } from 'json';

// Inlined from constants.uc to avoid cross-directory import fragility.
// Keep in sync with /usr/libexec/zapret2-manager/constants.uc.
const STATUS_JSON = '/tmp/zapret2-manager/status.json';
const COLLECTOR   = '/usr/libexec/zapret2-manager/status.uc';
const CACHE_TTL   = 3;

function now() { return time(); }   // [VERIFY] ucode time() → unix seconds

function cache_fresh() {
	let st = stat(STATUS_JSON);
	if (!st) return false;
	return (now() - st.mtime) <= CACHE_TTL;   // [VERIFY] stat().mtime in seconds
}

function refresh() {
	// Run the collector silently; it writes STATUS_JSON as a side effect.
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

// rpcd-ucode convention: return method table → registered as ubus object
// named after this file (zapret2-manager).
return {
	status: status_method
};
