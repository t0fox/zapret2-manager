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

import { stat, readfile, popen } from 'fs';
import { parse as jparse } from 'json';

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
	if (!raw) return { error: 'status unavailable', collected_at: null };
	try { return jparse(raw); }
	catch (e) { return { error: 'status parse failed', raw: raw }; }
}

function service_action(action) {
	let cmd = '/usr/bin/ucode ' + SERVICE + ' ' + action + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	let out = p ? (p.read('all') ?? '') : '';
	if (p) p.close();
	try { return jparse(out) ?? { ok: false, error: 'no output', raw: out }; }
	catch (e) { return { ok: false, error: 'parse failed', raw: out }; }
}

// passthrough takes {enabled:bool}. Param access is defensive — see [VERIFY] above.
function passthrough_method(req) {
	let en = null;
	try { en = req?.args?.enabled; } catch (e) { }
	if (en == null) { try { en = req?.enabled; } catch (e) { } }
	if (en == null) return { ok: false, error: 'missing enabled param' };
	let on = (en == true || en == 'true' || en == 1 || en == '1');
	return service_action('passthrough ' + (on ? 'true' : 'false'));
}

// Signature: top-level key == ubus object name (matches ACL). Methods nested.
return {
	'zapret2-manager': {
		methods: {
			status:           status_method,
			start:            function (req) { return service_action('start'); },
			stop:             function (req) { return service_action('stop'); },
			restart:          function (req) { return service_action('restart'); },
			restart_daemons:  function (req) { return service_action('restart_daemons'); },
			start_fw:         function (req) { return service_action('start_fw'); },
			reload_ifsets:    function (req) { return service_action('reload_ifsets'); },
			confirm_alive:    function (req) { return service_action('confirm_alive'); },
			rollback:         function (req) { return service_action('rollback'); },
			passthrough:      passthrough_method
		}
	}
};
