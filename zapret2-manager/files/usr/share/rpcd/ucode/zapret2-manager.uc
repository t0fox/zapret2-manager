#!/usr/bin/ucode
'use strict';
// rpcd ucode plugin: registers ubus object `zapret2-manager`.
//
// CONTRACT: this file lives in /usr/share/rpcd/ucode/ — that is where rpcd
// loads ucode plugins that RETURN A SIGNATURE OBJECT describing ubus objects
// and their methods. /usr/libexec/rpcd/ is for exec-plugins (a different
// contract: an executable reading JSON on stdin, writing JSON on stdout,
// answering `list`). The two must not be mixed; only ubus-registering ucode
// scripts live here. Internal libraries stay under /usr/libexec/zapret2-manager/.
// See docs/architecture.md §8.
//
// The returned signature's TOP-LEVEL KEY is the ubus object name — it must
// match the ACL group name in
// luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json
// symbol for symbol, or the object registers but LuCI gets a permission denial
// (renders as an empty page with no error).
//
// [VERIFY:ROUTER] exact rpcd-ucode method-def shape (methods → function vs
// methods → {call: function}, and the request param path req.args vs req) —
// answered by smoke.sh 01/02: `ubus call zapret2-manager status` returns JSON
// and a permissioned LuCI call succeeds. If the shape is wrong the object
// does not register at all.

import { stat, readfile, writefile, unlink, popen } from 'fs';

const STATUS_JSON = '/tmp/zapret2-manager/status.json';
const COLLECTOR   = '/usr/libexec/zapret2-manager/status.uc';
const SERVICE     = '/usr/libexec/zapret2-manager/service.uc';
const CACHE_TTL   = 3;

function now() { return time(); }

function cache_fresh() {
	let st = stat(STATUS_JSON);
	if (!st) return false;
	return (now() - st.mtime) <= CACHE_TTL;
}

function refresh() {
	let p = popen('/usr/bin/ucode ' + COLLECTOR + ' --no-print 2>/dev/null', 'r');
	if (p) { p.read('all'); p.close(); }
}

function status_method(req) {
	if (!cache_fresh()) refresh();
	let raw = readfile(STATUS_JSON);
	if (!raw) return { error: 'status unavailable', generatedAt: null };
	try { return json(raw); }
	catch (e) { return { error: 'status parse failed', raw: raw }; }
}

function service_action(action) {
	let cmd = '/usr/bin/ucode ' + SERVICE + ' ' + action + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) return { ok: false, error: 'popen failed' };
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	// explicit null check (no nullish-coalescing — point 6): jparse returns
	// null on 'null' or nothing-parsable; only null falls back to the
	// no-output envelope.
	try {
		let parsed = json(out);
		if (parsed != null) return parsed;
		return { ok: false, error: 'no output', raw: out };
	}
	catch (e) { return { ok: false, error: 'parse failed', raw: out }; }
}

// passthrough takes {enabled:bool}. Param access is explicit key-existence +
// null checks (no optional-chaining — point 6): the rpcd param path
// (req.args vs req) is [VERIFY:ROUTER], so check both defensively.
function passthrough_method(req) {
	let en = null;
	try { if (req && req.args && req.args.enabled != null) en = req.args.enabled; } catch (e) { }
	if (en == null) { try { if (req && req.enabled != null) en = req.enabled; } catch (e) { } }
	if (en == null) return { ok: false, error: 'missing enabled param' };
	let on = (en == true || en == 'true' || en == 1 || en == '1');
	return service_action('passthrough ' + (on ? 'true' : 'false'));
}

// ---- lists methods (ЦЕЛЬ ДВА — ui/07-lists-page) ---------------------------
const LISTS_CLI = '/usr/libexec/zapret2-manager/lists-cli.uc';
function lists_action(sub) {
	let cmd = '/usr/bin/ucode ' + LISTS_CLI + ' ' + sub + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) return { ok: false, error: 'popen failed' };
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	try {
		let parsed = json(out);
		if (parsed != null) return parsed;
		return { ok: false, error: 'no output', raw: out };
	} catch (e) { return { ok: false, error: 'parse failed', raw: out }; }
}

function lists_get_method(req) { return lists_action('get'); }
function lists_check_domain_method(req) {
	let d = null;
	try { if (req && req.args && req.args.domain != null) d = req.args.domain; } catch (e) { }
	if (d == null) { try { if (req && req.domain != null) d = req.domain; } catch (e) { } }
	if (d == null) return { ok: false, error: 'missing domain param' };
	return lists_action('check ' + d);
}
// lists_set: the frontend sends `edit` as a JSON STRING (rpcd params are
// strings). We check it IS a string, write it VERBATIM to a temp file (NO
// sprintf("%J") re-encode — that would double-encode a JSON string), and hand
// the file to lists-cli.uc 'set <file>'. lists_set parses the string ONCE
// (json(edit)) and validates the object/keys/values. A file (not argv) carries
// multi-line lists and avoids shell injection.
function lists_set_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: 'missing edit param' };
	if (type(edit) != 'string') return { ok: false, error: 'edit must be a JSON string', got: type(edit) };
	let tmp = '/tmp/z2m-lists-edit.' + time();
	writefile(tmp, edit);   // verbatim — no sprintf("%J"), no double-encode
	let cmd = '/usr/bin/ucode ' + LISTS_CLI + ' set ' + tmp + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) return { ok: false, error: 'popen failed' };
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	try { unlink(tmp); } catch (e) { }
	try {
		let parsed = json(out);
		if (parsed != null) return parsed;
		return { ok: false, error: 'no output', raw: out };
	} catch (e) { return { ok: false, error: 'parse failed', raw: out }; }
}

// Signature: top-level key == ubus object name (matches ACL). Methods nested.
// Signature: top-level key == ubus object name (matches ACL). Per the rpcd
// ucode plugin contract (verified against the on-device `luci` plugin):
// each method is a DICT with a `call` field holding the function, NOT a bare
// function — a bare function does NOT register. `args` is an optional schema
// dict for request params. No `methods:` wrapper (not in the contract).
return {
	'zapret2-manager': {
		status:            { call: function (req) { return status_method(req); } },
		start:             { call: function (req) { return service_action('start'); } },
		stop:              { call: function (req) { return service_action('stop'); } },
		restart:           { call: function (req) { return service_action('restart'); } },
		restart_daemons:   { call: function (req) { return service_action('restart_daemons'); } },
		start_fw:          { call: function (req) { return service_action('start_fw'); } },
		reload_ifsets:     { call: function (req) { return service_action('reload_ifsets'); } },
		confirm_alive:     { call: function (req) { return service_action('confirm_alive'); } },
		rollback:          { call: function (req) { return service_action('rollback'); } },
		passthrough:       { args: { enabled: 'boolean' }, call: function (req) { return passthrough_method(req); } },
		lists_get:         { call: function (req) { return lists_get_method(req); } },
		lists_check_domain: { args: { domain: 'string' }, call: function (req) { return lists_check_domain_method(req); } },
		lists_set:         { args: { edit: 'string' }, call: function (req) { return lists_set_method(req); } }
	}
};
