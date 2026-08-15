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

import { stat, readfile, writefile, unlink, readlink, popen } from 'fs';
import { route_list, route_reconcile } from '/usr/libexec/zapret2-manager/unified-routing.uc';

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
function shell_escape(value) {
	let s = '' + (value == null ? '' : value), out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}
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
	return lists_action('check ' + shell_escape(d));
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

// ---- typed canonical assets ------------------------------------------------
const ASSET_CLI = '/usr/libexec/zapret2-manager/asset-registry-cli.uc';
function asset_args(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string') return null;
	try { let value = json(edit); return type(value) == 'object' && value != null ? value : null; } catch (e) { return null; }
}
function asset_cli_action(mode, argument) {
	let cmd = '/usr/bin/ucode ' + ASSET_CLI + ' ' + mode + (argument == null ? '' : ' ' + shell_escape(argument)) + ' 2>/dev/null';
	let p = popen(cmd, 'r'); if (!p) return { ok: false, error: { code: 'ETARGET', message: 'asset registry runner unavailable' } };
	let out = p.read('all') || ''; let rc = p.close();
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: 'EINTERNAL', message: 'asset registry returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'asset registry response was malformed' } }; }
}
function asset_tmpfile() { let p = popen('umask 077; mktemp /tmp/z2m-assets-edit.XXXXXX 2>/dev/null', 'r'); if (!p) return null; let path = trim(p.read('all') || ''); let rc = p.close(); return rc == 0 && index(path, '/tmp/z2m-assets-edit.') == 0 ? path : null; }
function asset_edit_action(mode, req, trailing) {
	let edit = null; try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > 32 * 1024 * 1024) return { ok: false, error: { code: 'EINPUT', message: 'asset edit must be a bounded JSON string' } };
	let tmp = asset_tmpfile(); if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'asset request temp file unavailable' } };
	try { writefile(tmp, edit); } catch (e) { try { unlink(tmp); } catch (x) {} return { ok: false, error: { code: 'EIO', message: 'asset request temp file could not be written' } }; }
	let command = '/usr/bin/ucode ' + ASSET_CLI + ' ' + mode + (trailing == null ? '' : ' ' + shell_escape(trailing)) + ' ' + shell_escape(tmp) + ' 2>/dev/null';
	let p = popen(command, 'r'); if (!p) { try { unlink(tmp); } catch (e) {} return { ok: false, error: { code: 'ETARGET', message: 'asset registry runner unavailable' } }; }
	let out = p.read('all') || ''; p.close(); try { unlink(tmp); } catch (e) {}
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: 'EINTERNAL', message: 'asset registry returned no response' } }; }
	catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'asset registry response was malformed' } }; }
}
function asset_id(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? args.id : null; }
function assets_list_method(req) { let args = asset_args(req); return asset_cli_action('list', args && type(args.type) == 'string' ? args.type : null); }
function assets_get_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('get', id); }
function assets_validate_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('validate', id); }
function assets_delete_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('delete', id); }
function assets_import_method(req) { return asset_edit_action('import', req); }
function assets_update_method(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? asset_edit_action('update', req, args.id) : { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } }; }
function assets_register_builtin_method(req) { return asset_edit_action('register-builtin', req); }
function assets_references_method(req) { return asset_edit_action('references', req); }
function assets_resolve_method(req) { return asset_edit_action('resolve', req); }

// ---- M6 bounded unified routing -------------------------------------------
// Route operations receive one bounded JSON request file. The Route owner
// validates typed asset references and delegates runtime mutation to the
// existing service-DNS writer; rpcd never accepts shell, nft, UCI, or paths.
const ROUTE_CLI = '/usr/libexec/zapret2-manager/unified-routing-cli.uc';
function route_tmpfile() {
	let p = popen('umask 077; mktemp /tmp/z2m-route-edit.XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let path = trim(p.read('all') || ''), rc = p.close();
	return rc == 0 && index(path, '/tmp/z2m-route-edit.') == 0 ? path : null;
}
function route_edit_action(mode, req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) == 0 || length(edit) > 256 * 1024)
		return { ok: false, error: { code: 'EINPUT', message: 'route edit must be a bounded JSON string' } };
	let tmp = route_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'route request temp file unavailable' } };
	try { writefile(tmp, edit); } catch (e) { try { unlink(tmp); } catch (x) {} return { ok: false, error: { code: 'EIO', message: 'route request temp file could not be written' } }; }
	let command = '/usr/bin/ucode ' + ROUTE_CLI + ' ' + mode + ' ' + shell_escape(tmp) + ' 2>/dev/null';
	let p = popen(command, 'r');
	if (!p) { try { unlink(tmp); } catch (e) {} return { ok: false, error: { code: 'ETARGET', message: 'route owner unavailable' } }; }
	let output = p.read('all') || '', rc = p.close();
	try { unlink(tmp); } catch (e) {}
	try { let result = json(output); return result != null ? result : { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'route owner returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'route owner response was malformed' } }; }
}
function route_list_method(req) { return route_list(); }
function route_get_method(req) { return route_edit_action('get', req); }
function route_create_method(req) { return route_edit_action('create', req); }
function route_update_method(req) { return route_edit_action('update', req); }
function route_preview_method(req) { return route_edit_action('preview', req); }
function route_validate_method(req) { return route_edit_action('validate', req); }
function route_apply_method(req) { return route_edit_action('apply', req); }
function route_status_method(req) { return route_edit_action('status', req); }
function route_remove_method(req) { return route_edit_action('remove', req); }
function route_reconcile_method(req) { return route_reconcile(); }

// ---- profiles methods (strategy read path — SLICE 1) -----------------------
const PROFILES_CLI = '/usr/libexec/zapret2-manager/profiles-cli.uc';
function profiles_action(sub) {
	let cmd = '/usr/bin/ucode ' + PROFILES_CLI + ' ' + sub + ' 2>/dev/null';
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
function profiles_list_method(req) { return profiles_action('list'); }

// profiles mutating/parametrized methods: the frontend sends `edit` as a JSON
// STRING (same wire pattern as lists_set): written verbatim to a temp file
// and handed to the CLI (a file, not argv, carries multi-line opts and
// avoids shell interpolation of content entirely).
function profiles_tmpfile() {
	let p = popen('umask 077; mktemp /tmp/z2m-profiles-edit.XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let tmp = trim(p.read('all') || '');
	let rc = p.close();
	if (rc != 0 || index(tmp, '/tmp/z2m-profiles-edit.') != 0) {
		if (length(tmp)) try { unlink(tmp); } catch (e) { }
		return null;
	}
	return tmp;
}
function profiles_edit_action(sub, req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	let tmp = profiles_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	writefile(tmp, edit);   // verbatim — no re-encode
	let cmd = '/usr/bin/ucode ' + PROFILES_CLI + ' ' + sub + ' ' + tmp + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: 'popen failed' }; }
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

function profiles_create_method(req) { return profiles_edit_action('create', req); }
function profiles_update_method(req) { return profiles_edit_action('update', req); }
function profiles_clone_method(req) { return profiles_edit_action('clone', req); }
function profiles_delete_method(req) { return profiles_edit_action('delete', req); }
function profiles_reorder_method(req) { return profiles_edit_action('reorder', req); }
function profiles_validate_method(req) { return profiles_edit_action('validate', req); }
function profiles_import_applied_method(req) { return profiles_action('import_applied'); }

const BLOCKCHECK_APPLY_CLI = '/usr/libexec/zapret2-manager/blockcheck-apply-cli.uc';
function blockcheck_apply_method(req) {
	let edit = null; try { if (req && req.args) edit = req.args.edit; } catch (e) {} if (edit == null) try { edit = req.edit; } catch (e) {}
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be JSON' } };
	let tmp = '/tmp/z2m-blockcheck-apply.' + time(); writefile(tmp, edit);
	let p = popen('/usr/bin/ucode ' + BLOCKCHECK_APPLY_CLI + ' ' + tmp + ' 2>/dev/null', 'r'); if (!p) return { ok: false, error: { code: 'ETARGET', message: 'apply runner unavailable' } };
	let out = p.read('all'); p.close(); try { unlink(tmp); } catch (e) {} try { return json(out); } catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'apply response parse failed' } }; }
}
function blockcheck_preview_method(req) { return blockcheck_apply_method(req); }
function blockcheck_rollback_method(req) { return blockcheck_apply_method(req); }

// ---- jobs + blockcheck (SLICE 4) --------------------------------------------
const JOBS_CLI = '/usr/libexec/zapret2-manager/jobs-cli.uc';

function jobs_action(sub) {
	let cmd = '/usr/bin/ucode ' + JOBS_CLI + ' ' + sub + ' 2>/dev/null';
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

// parametrized jobs methods: `edit` JSON string → temp file (same wire
// pattern as lists_set / profiles_*): content never touches the shell.
function jobs_edit_action(sub, req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	let tmp = '/tmp/z2m-jobs-edit.' + time();
	writefile(tmp, edit);
	let cmd = '/usr/bin/ucode ' + JOBS_CLI + ' ' + sub + ' ' + tmp + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: 'popen failed' }; }
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

function job_get_method(req) { return jobs_edit_action('get', req); }
function job_list_method(req) { return jobs_action('list'); }
function blockcheck_start_method(req) { return jobs_edit_action('start', req); }
function blockcheck_cancel_method(req) { return jobs_edit_action('cancel', req); }
function blockcheck_status_method(req) { return jobs_action('status'); }

// M5 product surfaces are intentionally separate from the legacy jobs wrapper:
// BlockCheck is a diagnostic/classification run, while BlockCheck2 is the
// official upstream subprocess and stream. Both use bounded JSON files, never
// generic command or argv input from the browser.
const BLOCKCHECK_DIAG_CLI = '/usr/libexec/zapret2-manager/blockcheck-cli.uc';
const BLOCKCHECK2_CLI = '/usr/libexec/zapret2-manager/blockcheck2-cli.uc';
const BLOCKCHECKW_CLI = '/usr/libexec/zapret2-manager/blockcheckw-cli.uc';
const BLOCK_DETECTOR_CLI = '/usr/libexec/zapret2-manager/block-detector-cli.uc';
function product_tmpfile(prefix) {
	let p = null, raw = '';
	try { p = popen('umask 077; mktemp /tmp/' + prefix + '.XXXXXX 2>/dev/null', 'r'); raw = p ? trim(p.read('all') || '') : ''; if (p) p.close(); } catch (e) { raw = ''; }
	return raw && match(raw, /^\/tmp\/[A-Za-z0-9._-]+$/) ? raw : null;
}
function product_export(cli, sub) {
	if (cli == BLOCKCHECK_DIAG_CLI) return sub == 'start' ? 'blockcheck_diag_start' : sub == 'status' ? 'blockcheck_diag_status' : sub == 'results' ? 'blockcheck_diag_results' : sub == 'stop' ? 'blockcheck_diag_stop' : sub == 'domains' ? 'blockcheck_diag_domains' : sub == 'traceroute' ? 'blockcheck_diag_traceroute' : null;
	if (cli == BLOCKCHECK2_CLI) return sub == 'script' ? 'blockcheck2_script' : sub == 'start' ? 'blockcheck2_start' : sub == 'status' ? 'blockcheck2_status' : sub == 'output' ? 'blockcheck2_output' : sub == 'results' ? 'blockcheck2_results' : sub == 'stop' ? 'blockcheck2_stop' : null;
	if (cli == BLOCKCHECKW_CLI) return sub == 'provider-status' ? 'blockcheckw_provider_status' : sub == 'update-check' ? 'blockcheckw_update_check' : sub == 'install' ? 'blockcheckw_install' : sub == 'script' ? 'blockcheckw_script' : sub == 'start' ? 'blockcheckw_start' : sub == 'status' ? 'blockcheckw_status' : sub == 'output' ? 'blockcheckw_output' : sub == 'results' ? 'blockcheckw_results' : sub == 'stop' ? 'blockcheckw_stop' : null;
	if (cli == BLOCK_DETECTOR_CLI) return sub == 'start' ? 'block_detector_start' : sub == 'status' ? 'block_detector_status' : sub == 'results' ? 'block_detector_results' : sub == 'stop' ? 'block_detector_stop' : null;
	return null;
}
function product_command(cli, sub, tmp) {
	let fn = product_export(cli, sub); if (!fn) return null;
	let expression = 'import * as api from "' + cli + '"; ';
	if (tmp) expression = 'import { readfile } from "fs"; ' + expression + 'let input = json(readfile("' + tmp + '")); print(sprintf("%J", api.' + fn + '(input)));';
	else expression += 'print(sprintf("%J", api.' + fn + '()));';
	return '/usr/bin/ucode -e ' + shell_escape(expression) + ' 2>/dev/null';
}
function product_edit_action(cli, sub, req, prefix) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string' || length(edit) > 32768) return { ok: false, error: { code: 'EINPUT', message: 'edit must be a bounded JSON string' } };
	let tmp = product_tmpfile(prefix);
	if (!tmp) return { ok: false, error: { code: 'EDEPENDENCY', message: 'temporary request file unavailable' } };
	writefile(tmp, edit);
	let command = product_command(cli, sub, tmp); if (!command) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EINPUT', message: 'unknown product operation' } }; }
	let p = popen(command, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EDEPENDENCY', message: 'product CLI unavailable' } }; }
	let out = p.read('all') || '', rc = -1;
	try { rc = p.close(); } catch (e) { rc = -1; }
	try { unlink(tmp); } catch (e) { }
	if (rc != 0) return { ok: false, error: { code: 'EDEPENDENCY', message: 'product CLI exited unsuccessfully' } };
	try { return json(out); } catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'product response parse failed' } }; }
}
function product_action(cli, sub) {
	let command = product_command(cli, sub, null); if (!command) return { ok: false, error: { code: 'EINPUT', message: 'unknown product operation' } };
	let p = popen(command, 'r');
	if (!p) return { ok: false, error: { code: 'EDEPENDENCY', message: 'product CLI unavailable' } };
	let out = p.read('all') || '', rc = -1;
	try { rc = p.close(); } catch (e) { rc = -1; }
	if (rc != 0) return { ok: false, error: { code: 'EDEPENDENCY', message: 'product CLI exited unsuccessfully' } };
	try { return json(out); } catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'product response parse failed' } }; }
}
function blockcheck_diag_start_method(req) { return product_edit_action(BLOCKCHECK_DIAG_CLI, 'start', req, 'z2m-bcdiag-edit'); }
function blockcheck_diag_status_method(req) { return product_action(BLOCKCHECK_DIAG_CLI, 'status'); }
function blockcheck_diag_results_method(req) { return product_edit_action(BLOCKCHECK_DIAG_CLI, 'results', req, 'z2m-bcdiag-edit'); }
function blockcheck_diag_stop_method(req) { return product_edit_action(BLOCKCHECK_DIAG_CLI, 'stop', req, 'z2m-bcdiag-edit'); }
function blockcheck_diag_domains_method(req) { return product_edit_action(BLOCKCHECK_DIAG_CLI, 'domains', req, 'z2m-bcdiag-edit'); }
function blockcheck_diag_traceroute_method(req) { return product_edit_action(BLOCKCHECK_DIAG_CLI, 'traceroute', req, 'z2m-bcdiag-edit'); }
function blockcheck2_script_method(req) { return product_action(BLOCKCHECK2_CLI, 'script'); }
function blockcheck2_start_method(req) { return product_edit_action(BLOCKCHECK2_CLI, 'start', req, 'z2m-bc2-edit'); }
function blockcheck2_status_method(req) { return product_action(BLOCKCHECK2_CLI, 'status'); }
function blockcheck2_output_method(req) { return product_edit_action(BLOCKCHECK2_CLI, 'output', req, 'z2m-bc2-edit'); }
function blockcheck2_results_method(req) { return product_edit_action(BLOCKCHECK2_CLI, 'results', req, 'z2m-bc2-edit'); }
function blockcheck2_stop_method(req) { return product_edit_action(BLOCKCHECK2_CLI, 'stop', req, 'z2m-bc2-edit'); }
function blockcheckw_provider_status_method(req) { return product_action(BLOCKCHECKW_CLI, 'provider-status'); }
function blockcheckw_update_check_method(req) { return product_action(BLOCKCHECKW_CLI, 'update-check'); }
function blockcheckw_install_method(req) { return product_edit_action(BLOCKCHECKW_CLI, 'install', req, 'z2m-bcw-install'); }
function blockcheckw_script_method(req) { return product_action(BLOCKCHECKW_CLI, 'script'); }
function blockcheckw_start_method(req) { return product_edit_action(BLOCKCHECKW_CLI, 'start', req, 'z2m-bcw-edit'); }
function blockcheckw_status_method(req) { return product_action(BLOCKCHECKW_CLI, 'status'); }
function blockcheckw_output_method(req) { return product_edit_action(BLOCKCHECKW_CLI, 'output', req, 'z2m-bcw-edit'); }
function blockcheckw_results_method(req) { return product_edit_action(BLOCKCHECKW_CLI, 'results', req, 'z2m-bcw-edit'); }
function blockcheckw_stop_method(req) { return product_edit_action(BLOCKCHECKW_CLI, 'stop', req, 'z2m-bcw-edit'); }
function block_detector_start_method(req) { return product_edit_action(BLOCK_DETECTOR_CLI, 'start', req, 'z2m-bdetector-edit'); }
function block_detector_status_method(req) { return product_action(BLOCK_DETECTOR_CLI, 'status'); }
function block_detector_results_method(req) { return product_action(BLOCK_DETECTOR_CLI, 'results'); }
function block_detector_stop_method(req) { return product_action(BLOCK_DETECTOR_CLI, 'stop'); }

// health matrix (Phase C) — job_get/cancel are the GENERIC job methods;
// these aliases give the matrix its own names per the contract.
function health_matrix_get_method(req) { return jobs_action('hm-get'); }
function health_matrix_start_method(req) { return jobs_edit_action('hm-start', req, 'health'); }
function health_matrix_job_get_method(req) { return job_get_method(req); }
function health_matrix_job_cancel_method(req) { return blockcheck_cancel_method(req); }

// ---- orchestra read-only adapter (Phase D) ---------------------------------------
const ORCH_CLI = '/usr/libexec/zapret2-manager/orchestra-cli.uc';
const AUTO_STRATEGY_CLI = '/usr/libexec/zapret2-manager/auto-strategy-cli.uc';
const DISCORD_CLI = '/usr/libexec/zapret2-manager/discord-profile-cli.uc';
// (method wrappers live below cli_action — ucode does not hoist declarations)

// ---- maintenance + backups (SLICE 5) -----------------------------------------
const BACKUP_CLI = '/usr/libexec/zapret2-manager/backup-cli.uc';
const MAINT_CLI = '/usr/libexec/zapret2-manager/maintenance-cli.uc';

const ORCH_MAX_OUTPUT = 131072;
function orch_tmpfile() {
	let p = popen('mktemp /tmp/z2m-orch-req.XXXXXX 2>/dev/null', 'r');
	if (!p) return null; let out = trim(p.read('all')); p.close();
	return length(out) ? out : null;
}
function orchestra_cmd(sub, arg) {
	// The target BusyBox image has no `timeout` applet. Keep the response bounded
	// without turning every Orchestra RPC into an empty parse-failed envelope.
	return '/usr/bin/ucode ' + ORCH_CLI + ' ' + sub + (arg ? ' ' + arg : '') + ' 2>/dev/null | head -c ' + ORCH_MAX_OUTPUT;
}
function cli_action(cli, sub) {
	let cmd = cli == ORCH_CLI ? orchestra_cmd(sub, null) : '/usr/bin/ucode ' + cli + ' ' + sub + ' 2>/dev/null';
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

function cli_edit_action(cli, sub, req, tag) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	let tmp = '/tmp/z2m-' + tag + '-edit.' + time();
	writefile(tmp, edit);
	let cmd = '/usr/bin/ucode ' + cli + ' ' + sub + ' ' + tmp + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: 'popen failed' }; }
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

function versions_method(req) { return cli_action(MAINT_CLI, 'versions'); }
function maintenance_status_method(req) { return cli_action(MAINT_CLI, 'status'); }
function events_tail_method(req) {
	// edit is OPTIONAL (defaults to the last 50 events)
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(MAINT_CLI, 'events', { edit: '{}' }, 'events');
	return cli_edit_action(MAINT_CLI, 'events', { edit: edit }, 'events');
}
function diagnostics_export_method(req) { return cli_action(MAINT_CLI, 'diagnostics'); }
function backup_list_method(req) { return cli_action(BACKUP_CLI, 'list'); }
function backup_create_method(req) { return cli_edit_action(BACKUP_CLI, 'create', req, 'backup'); }

// orchestra method wrappers (after cli_action — ucode does not hoist)
function orchestra_capabilities_method(req) { return cli_action(ORCH_CLI, 'capabilities'); }
function discord_profile_preview_method(req) { return cli_action(DISCORD_CLI, 'preview'); }
function discord_profile_apply_method(req) { return cli_edit_action(DISCORD_CLI, 'apply', req, 'discord-profile'); }
function discord_profile_rollback_method(req) { return cli_action(DISCORD_CLI, 'rollback'); }
function discord_profile_restore_previous_method(req) { return cli_action(DISCORD_CLI, 'restore_previous'); }
function orchestra_status_method(req) { return cli_action(ORCH_CLI, 'status'); }
function orchestra_events_method(req) { return cli_action(ORCH_CLI, 'events'); }
function orchestra_history_method(req) { return cli_action(ORCH_CLI, 'history'); }
function orchestra_ratings_get_method(req) { return cli_action(ORCH_CLI, 'ratings_get'); }
function orchestra_runid_method(req) { return cli_action(ORCH_CLI, 'runid'); }
function orchestra_parse_warnings_method(req) { return cli_action(ORCH_CLI, 'parse_warnings'); }
function orchestra_history_get_method(req) { return cli_action(ORCH_CLI, 'history_get'); }
function orchestra_request_args(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) == 'string') {
		try { let decoded = json(edit); if (type(decoded) == 'object' && decoded != null) return decoded; } catch (e) { }
	}
	try { if (req && req.args && type(req.args) == 'object') return req.args; } catch (e) { }
	return {};
}
function orchestra_reqfile_action(sub, req) {
	let tmp = orch_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	writefile(tmp, sprintf("%J", { args: orchestra_request_args(req) }) + '\n');
	let cmd = orchestra_cmd(sub, tmp);
	let p = popen(cmd, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: 'popen failed' }; }
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	try { unlink(tmp); } catch (e) { }
	try {
		let parsed = json(out);
		if (parsed != null) return parsed;
		return { ok: false, error: { code: 'invalid-run-response', message: 'Orchestra returned no response' } };
	} catch (e) { return { ok: false, error: { code: 'invalid-run-response', message: 'Orchestra response was invalid' } }; }
}
function auto_strategy_reqfile_action(sub, req) {
	let tmp = orch_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	writefile(tmp, sprintf("%J", { args: orchestra_request_args(req) }) + '\n');
	// Do not put a kill timeout around restore: its existing sanctioned apply is
	// transactional and must be allowed to finish or roll back safely.
	let p = popen('/usr/bin/ucode ' + AUTO_STRATEGY_CLI + ' ' + sub + ' ' + tmp + ' 2>/dev/null | head -c ' + ORCH_MAX_OUTPUT, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'ETARGET', message: 'Auto Strategy controller is unavailable' } }; }
	let out = p.read('all') || ''; p.close(); try { unlink(tmp); } catch (e) { }
	try { let parsed = json(out); return parsed != null ? parsed : { ok: false, error: { code: 'EINTERNAL', message: 'Auto Strategy returned no response' } }; }
	catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'Auto Strategy response was invalid' } }; }
}
function orchestra_history_paginated_method(req) { return orchestra_reqfile_action('history_paginated', req); }
function orchestra_history_export_method(req) { return orchestra_reqfile_action('history_export', req); }
function orchestra_history_clear_method(req) { return orchestra_reqfile_action('history_clear', req); }
function orchestra_history_stats_method(req) { return cli_action(ORCH_CLI, 'history_stats'); }
function orchestra_run_start_method(req) { return orchestra_reqfile_action('run_start', req); }
function orchestra_run_status_method(req) { return orchestra_reqfile_action('run_status', req); }
function orchestra_run_events_method(req) { return orchestra_reqfile_action('run_events', req); }
function orchestra_run_pause_method(req) { return orchestra_reqfile_action('run_pause', req); }
function orchestra_run_resume_method(req) { return orchestra_reqfile_action('run_resume', req); }
function orchestra_run_stop_method(req) { return orchestra_reqfile_action('run_stop', req); }
function orchestra_run_continue_method(req) { return orchestra_reqfile_action('run_continue', req); }
function orchestra_probe_preflight_method(req) { return cli_action(ORCH_CLI, 'probe_preflight'); }
function orchestra_run_invalidate_method(req) { return orchestra_reqfile_action('run_invalidate', req); }
function orchestra_run_history_method(req) { return cli_action(ORCH_CLI, 'run_history'); }
function orchestra_run_load_method(req) { return orchestra_reqfile_action('run_load', req); }
function orchestra_run_delete_method(req) { return orchestra_reqfile_action('run_delete', req); }
function orchestra_apply_best_method(req) { return orchestra_reqfile_action('apply_best', req); }
function orchestra_preview_best_method(req) { return orchestra_reqfile_action('preview_best', req); }
function orchestra_apply_status_method(req) { return orchestra_reqfile_action('apply_status', req); }
function orchestra_apply_events_method(req) { return orchestra_reqfile_action('apply_events', req); }
function orchestra_restore_previous_method(req) { return orchestra_reqfile_action('restore_previous', req); }
function orchestra_auto_status_method(req) { return auto_strategy_reqfile_action('status', req); }
function orchestra_auto_enable_method(req) { return auto_strategy_reqfile_action('enable', req); }
function orchestra_auto_disable_method(req) { return auto_strategy_reqfile_action('disable', req); }
function orchestra_auto_run_method(req) { return auto_strategy_reqfile_action('run', req); }
function orchestra_auto_stop_method(req) { return auto_strategy_reqfile_action('stop', req); }
function orchestra_auto_restore_method(req) { return auto_strategy_reqfile_action('restore', req); }

// ---- DNS providers + component diagnostics (Phase E) -----------------------------
const DNSPROV_CLI = '/usr/libexec/zapret2-manager/dnsprov-cli.uc';
function dnsprov_components_method(req) { return cli_action(DNSPROV_CLI, 'components'); }
function dnsprov_providers_method(req) { return cli_action(DNSPROV_CLI, 'providers'); }
function dnsprov_diagnose_method(req) { return cli_edit_action(DNSPROV_CLI, 'diagnose', req, 'dnsprov'); }
function dns_select_provider_method(req) { return cli_edit_action(DNSPROV_CLI, 'select', req, 'dnsprov'); }

// ---- TG WS Proxy adapter (Phase F: capabilities/status + functional slice) ------------
// capabilities/status stay read-only. The functional methods delegate to
// proxycfg.uc via the same CLI: validate/preview are write-free (registered in
// the READ ACL like dns_validate/catalog_preview); apply/start/stop/restart/
// autostart/secret_rotate mutate and belong to the WRITE ACL. There is NO
// install/download method — the optional package arrives only through the
// signed feed workflow.
const PROXY_CLI = '/usr/libexec/zapret2-manager/proxy-cli.uc';
function proxy_capabilities_method(req) { return cli_action(PROXY_CLI, 'capabilities'); }
function proxy_status_method(req) { return cli_action(PROXY_CLI, 'status'); }
function proxy_config_get_method(req) { return cli_action(PROXY_CLI, 'config_get'); }
function proxy_logs_tail_method(req) {
	// edit is OPTIONAL (defaults to the last 50 redacted lines)
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(PROXY_CLI, 'logs_tail', { edit: '{}' }, 'proxy');
	return cli_edit_action(PROXY_CLI, 'logs_tail', { edit: edit }, 'proxy');
}
function proxy_health_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(PROXY_CLI, 'health', { edit: '{}' }, 'proxy');
	return cli_edit_action(PROXY_CLI, 'health', { edit: edit }, 'proxy');
}
function proxy_link_info_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(PROXY_CLI, 'link_info', { edit: '{}' }, 'proxy');
	return cli_edit_action(PROXY_CLI, 'link_info', { edit: edit }, 'proxy');
}
function proxy_config_validate_method(req) { return cli_edit_action(PROXY_CLI, 'validate', req, 'proxy'); }
function proxy_config_preview_method(req) { return cli_edit_action(PROXY_CLI, 'preview', req, 'proxy'); }
function proxy_config_apply_method(req) { return cli_edit_action(PROXY_CLI, 'apply', req, 'proxy'); }
function proxy_start_method(req) { return cli_action(PROXY_CLI, 'start'); }
function proxy_stop_method(req) { return cli_action(PROXY_CLI, 'stop'); }
function proxy_restart_method(req) { return cli_action(PROXY_CLI, 'restart'); }
function proxy_autostart_set_method(req) { return cli_edit_action(PROXY_CLI, 'autostart', req, 'proxy'); }
function proxy_secret_rotate_method(req) { return cli_action(PROXY_CLI, 'secret_rotate'); }
function proxy_quick_install_method(req) { return cli_action(PROXY_CLI, 'quick_install'); }
function backup_restore_preview_method(req) { return cli_edit_action(BACKUP_CLI, 'preview', req, 'backup'); }
function backup_restore_method(req) { return cli_edit_action(BACKUP_CLI, 'restore', req, 'backup'); }
function backup_delete_method(req) { return cli_edit_action(BACKUP_CLI, 'delete', req, 'backup'); }

// ---- DNS (S6) ----------------------------------------------------------------
const DNS_CLI = '/usr/libexec/zapret2-manager/dns-cli.uc';
function dns_get_method(req) { return cli_action(DNS_CLI, 'get'); }
function dns_set_method(req) { return cli_edit_action(DNS_CLI, 'set', req, 'dns'); }
function dns_validate_method(req) { return cli_edit_action(DNS_CLI, 'validate', req, 'dns'); }
function dns_apply_method(req) {
	// {mode:"preview"|"apply"} — preview is read-only; apply runs the full
	// pipeline with snapshot + verify + rollback-on-failure
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	let mode = 'preview';
	if (edit != null && type(edit) == 'string') {
		let obj = null;
		try { obj = json(edit); } catch (e) { obj = null; }
		if (type(obj) == 'object' && obj != null && obj.mode == 'apply') mode = 'apply';
	}
	return cli_action(DNS_CLI, mode);
}
function dns_check_method(req) { return cli_edit_action(DNS_CLI, 'check', req, 'dns'); }
function dns_rollback_method(req) { return cli_action(DNS_CLI, 'rollback'); }
function dns_restore_auto_method(req) { return cli_action(DNS_CLI, 'restore-auto'); }

// ---- DNS global configuration (Slice 8) ----------------------------------------
const DNSGLOBAL_CLI = '/usr/libexec/zapret2-manager/dns-global-cli.uc';
function dns_global_get_method(req) { return cli_action(DNSGLOBAL_CLI, 'get'); }
function dns_global_set_method(req) { return cli_edit_action(DNSGLOBAL_CLI, 'set', req, 'dnsglobal'); }
function dns_global_preview_method(req) { return cli_action(DNSGLOBAL_CLI, 'preview'); }
function dns_global_apply_method(req) { return cli_action(DNSGLOBAL_CLI, 'apply'); }
function dns_global_rollback_method(req) { return cli_action(DNSGLOBAL_CLI, 'rollback'); }

// ---- canonical DNS product facade -----------------------------------------
// This surface composes the existing global-DNS, override-DNS and Service DNS
// writers. Callers can provide only the bounded JSON `edit` payload accepted
// by cli_edit_action, never a command or a path.
const DNS_PRODUCT_CLI = '/usr/libexec/zapret2-manager/dns-product-cli.uc';
function dns_product_action(sub) { return cli_action(DNS_PRODUCT_CLI, sub); }
function dns_product_edit_action(sub, req) { return cli_edit_action(DNS_PRODUCT_CLI, sub, req, 'dns-product'); }
function dns_product_get_method(req) { return dns_product_action('get'); }
function dns_product_providers_method(req) { return dns_product_action('providers'); }
function dns_product_status_method(req) { return dns_product_action('status'); }
function dns_product_preview_method(req) { return dns_product_edit_action('preview', req); }
function dns_product_validate_method(req) { return dns_product_edit_action('validate', req); }
function dns_product_apply_method(req) { return dns_product_edit_action('apply', req); }
function dns_product_rollback_method(req) { return dns_product_edit_action('rollback', req); }

// ---- Avatar Strategy API ----------------------------------------------------
// Strategy requests use the same private JSON-string edit convention as
// Profiles. The RPC layer chooses a fixed CLI mode; request content is carried
// only in a collision-resistant 0600 file and is never interpreted as shell.
const STRATEGY_CLI = '/usr/libexec/zapret2-manager/strategy-cli.uc';
const STRATEGY_UCODE_BIN = getenv('Z2M_STRATEGY_UCODE_BIN') || '/usr/bin/ucode';
const STRATEGY_STATE_FLOCK = getenv('Z2M_STRATEGY_STATE_FLOCK') || '/tmp/zapret2-manager/state.lock';
const STRATEGY_CONFIG_FLOCK = getenv('Z2M_STRATEGY_CONFIG_FLOCK') || '/opt/zapret2/config.lock';
const STRATEGY_REQUEST_UID = getenv('Z2M_STRATEGY_REQUEST_UID') || '0';
const STRATEGY_REQUEST_GID = getenv('Z2M_STRATEGY_REQUEST_GID') || '0';
const STRATEGY_MAX_REQUEST_BYTES = 524288;
const STRATEGY_MAX_CHILD_RESPONSE_BYTES = 4 * 1024 * 1024;
const STRATEGY_CHILD_RESPONSE_MARKER = '__Z2M_CHILD_RC__';

function strategy_mutating_mode(mode) {
	return mode == 'create' || mode == 'update' || mode == 'delete'
		|| mode == 'duplicate' || mode == 'favorite' || mode == 'apply'
		|| mode == 'import_profiles';
}

function strategy_lock_for(mode) {
	return strategy_mutating_mode(mode) ? STRATEGY_STATE_FLOCK : null;
}

function strategy_have_flock() {
	let p = null, output = '', rc = -1;
	try { p = popen('command -v flock 2>/dev/null', 'r'); } catch (e) { p = null; }
	if (!p) return false;
	try { output = p.read('all') || ''; } catch (e) { output = ''; }
	try { rc = p.close(); } catch (e) { rc = -1; }
	return rc == 0 && length(trim(output)) > 0;
}

function strategy_cleanup_request(tmp) {
	if (tmp != null) try { unlink(tmp); } catch (e) { }
}

function strategy_private_request(tmp, expectedSize) {
	let metadata = null, link = null;
	try { metadata = stat(tmp); } catch (e) { metadata = null; }
	try { link = readlink(tmp); } catch (e) { link = 'error'; }
	return metadata != null && metadata.type == 'file' && link == null
		&& type(metadata.size) == 'int' && metadata.size == expectedSize
		&& metadata.mode % 512 == 384 && '' + metadata.uid == STRATEGY_REQUEST_UID
		&& '' + metadata.gid == STRATEGY_REQUEST_GID
		&& match(tmp, /^\/tmp\/z2m-strategy-edit\.[A-Za-z0-9_-]+$/);
}

function strategy_locked_command(mode, command) {
	let state = 'Z2M_FLOCKED=1 Z2M_STRATEGY_LOCKED=1 Z2M_STRATEGY_RPC=1 ';
	if (mode == 'apply') {
		let config = 'Z2M_CONFIG_LOCKED=1 ' + command;
		config = 'flock -x ' + shell_escape(STRATEGY_CONFIG_FLOCK) + ' -c ' + shell_escape(config);
		return 'flock -x ' + shell_escape(STRATEGY_STATE_FLOCK) + ' -c ' + shell_escape(state + config);
	}
	return 'flock -x ' + shell_escape(STRATEGY_STATE_FLOCK) + ' -c ' + shell_escape(state + command);
}

function strategy_child_response(output, streamRc) {
	if (streamRc != 0 || type(output) != 'string' || length(output) > STRATEGY_MAX_CHILD_RESPONSE_BYTES + 128)
		return { ok: false, error: { code: 'EOUTPUT', message: 'Strategy child response exceeded the safe bound' } };
	let marker = '\n' + STRATEGY_CHILD_RESPONSE_MARKER, markerAt = rindex(output, marker);
	if (markerAt < 0) return { ok: false, error: { code: 'EOUTPUT', message: 'Strategy child response was truncated' } };
	let rcText = trim(substr(output, markerAt + length(marker)));
	if (!match(rcText, /^[0-9]+$/)) return { ok: false, error: { code: 'EOUTPUT', message: 'Strategy child status marker was malformed' } };
	let body = substr(output, 0, markerAt), childRc = +rcText;
	if (length(body) > STRATEGY_MAX_CHILD_RESPONSE_BYTES)
		return { ok: false, error: { code: 'EOUTPUT', message: 'Strategy child response exceeded the safe bound' } };
	if (childRc != 0) return { ok: false, error: { code: 'ECHILD', message: 'Strategy child exited unsuccessfully' } };
	try {
		let parsed = json(body);
		return parsed != null ? parsed : { ok: false, error: { code: 'EINTERNAL', message: 'Strategy response was empty' } };
	} catch (e) {
		return { ok: false, error: { code: 'EINTERNAL', message: 'Strategy response was malformed' } };
	}
}

function strategy_tmpfile() {
	let p = null, output = '', rc = -1;
	try { p = popen('umask 077; mktemp /tmp/z2m-strategy-edit.XXXXXX 2>/dev/null', 'r'); } catch (e) { p = null; }
	if (!p) return null;
	try { output = p.read('all') || ''; } catch (e) { output = ''; }
	try { rc = p.close(); } catch (e) { rc = -1; }
	let tmp = trim(output);
	if (rc != 0 || index(tmp, '/tmp/z2m-strategy-edit.') != 0) {
		if (length(tmp)) try { unlink(tmp); } catch (e) { }
		return null;
	}
	return tmp;
}

function strategy_edit_action(mode, req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	if (length(edit) > STRATEGY_MAX_REQUEST_BYTES)
		return { ok: false, error: { code: 'EINPUT', message: 'edit exceeds the safe request size limit' } };
	let tmp = strategy_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	try { writefile(tmp, edit); }
	catch (e) {
		strategy_cleanup_request(tmp);
		return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } };
	}
	if (!strategy_private_request(tmp, length(edit))) {
		strategy_cleanup_request(tmp);
		return { ok: false, error: { code: 'EINPUT', message: 'request temp file failed the private-file invariant' } };
	}
	let lock = strategy_lock_for(mode);
	if (lock != null && !strategy_have_flock()) {
		strategy_cleanup_request(tmp);
		return { ok: false, error: { code: 'ELOCK', message: 'real flock is required for Strategy mutations' } };
	}
	let source = null, cmd = null, wrapped = null;
	try {
		source = 'import { strategy_cli_request } from ' + sprintf('%J', STRATEGY_CLI)
			+ '; print(sprintf("%J", strategy_cli_request(' + sprintf('%J', mode) + ', '
			+ sprintf('%J', tmp) + ')));';
		cmd = shell_escape(STRATEGY_UCODE_BIN) + ' -e ' + shell_escape(source);
		if (lock != null) cmd = strategy_locked_command(mode, cmd);
		wrapped = '(' + cmd + '; rc=$?; printf ' + shell_escape('\n' + STRATEGY_CHILD_RESPONSE_MARKER + '%s\n') + ' "$rc") 2>&1 | head -c ' + (STRATEGY_MAX_CHILD_RESPONSE_BYTES + 128);
	} catch (e) {
		strategy_cleanup_request(tmp);
		return { ok: false, error: { code: 'EINPUT', message: 'Strategy child command could not be prepared' } };
	}
	let p = null, out = '', readOk = true, streamRc = -1;
	try { p = popen(wrapped, 'r'); } catch (e) { p = null; }
	if (!p) { strategy_cleanup_request(tmp); return { ok: false, error: { code: 'ETARGET', message: 'Strategy CLI unavailable' } }; }
	try { out = p.read('all') || ''; } catch (e) { readOk = false; }
	try { streamRc = p.close(); } catch (e) { streamRc = -1; }
	strategy_cleanup_request(tmp);
	if (!readOk) return { ok: false, error: { code: 'EIO', message: 'Strategy child response could not be read' } };
	return strategy_child_response(out, streamRc);
}

function strategy_noarg_action(mode) { return strategy_edit_action(mode, { edit: '{}' }); }
function strategies_list_method(req) { return strategy_noarg_action('list'); }
function strategies_get_method(req) { return strategy_edit_action('get', req); }
function strategies_create_method(req) { return strategy_edit_action('create', req); }
function strategies_update_method(req) { return strategy_edit_action('update', req); }
function strategies_delete_method(req) { return strategy_edit_action('delete', req); }
function strategies_duplicate_method(req) { return strategy_edit_action('duplicate', req); }
function strategies_favorite_method(req) { return strategy_edit_action('favorite', req); }
function strategies_preview_method(req) { return strategy_edit_action('preview', req); }
function strategies_validate_method(req) { return strategy_edit_action('validate', req); }
function strategies_apply_method(req) { return strategy_edit_action('apply', req); }
function strategies_catalog_status_method(req) { return strategy_noarg_action('catalog_status'); }
function strategies_catalog_reload_method(req) { return strategy_noarg_action('catalog_reload'); }
function strategies_import_profiles_method(req) { return strategy_edit_action('import_profiles', req); }

// ---- Avatar Strategy Scanner API -------------------------------------------
// Scanner requests use a private bounded JSON file because scanner-cli itself
// revalidates the file identity immediately before reading it.  The RPC layer
// only selects a fixed Scanner subcommand and frames the child response; it
// does not validate Scanner business fields or construct runtime arguments.
const SCANNER_CLI = '/usr/libexec/zapret2-manager/scanner-cli.uc';
const SCANNER_ROOT_BOOTSTRAP = '/usr/libexec/zapret2-manager/z2m-root-bootstrap';
const SCANNER_UCODE_BIN = getenv('Z2M_SCANNER_UCODE_BIN') || '/usr/bin/ucode';
const SCANNER_REQUEST_ROOT = '/tmp/zapret2-manager/runtime/requests';
const SCANNER_MAX_REQUEST_BYTES = 65536;
const SCANNER_MAX_CHILD_RESPONSE_BYTES = 131072;
const SCANNER_CHILD_RESPONSE_MARKER = '__Z2M_CHILD_RC__';

function scanner_cleanup_request(tmp) {
	if (tmp != null) try { unlink(tmp); } catch (e) { }
}

function scanner_tmpfile() {
	let command = 'umask 077; ' + shell_escape(SCANNER_ROOT_BOOTSTRAP) + ' runtime 2>/dev/null'
		+ ' && (mkdir ' + shell_escape(SCANNER_REQUEST_ROOT) + ' 2>/dev/null || test -d ' + shell_escape(SCANNER_REQUEST_ROOT) + ')'
		+ ' && tmp=$(mktemp ' + shell_escape(SCANNER_REQUEST_ROOT + '/scanner-rpc.XXXXXX')
		+ ' 2>/dev/null) && final="$tmp.json" && test ! -e "$final"'
		+ ' && mv "$tmp" "$final" 2>/dev/null && printf "%s\\n" "$final"';
	let p = null, output = '', rc = -1;
	try { p = popen(command, 'r'); } catch (e) { p = null; }
	if (!p) return null;
	try { output = p.read('all') || ''; } catch (e) { output = ''; }
	try { rc = p.close(); } catch (e) { rc = -1; }
	let tmp = trim(output);
	if (rc != 0 || !match(tmp, /^\/tmp\/zapret2-manager\/runtime\/requests\/scanner-rpc\.[A-Za-z0-9_-]+\.json$/)) {
		scanner_cleanup_request(tmp);
		return null;
	}
	return tmp;
}

function scanner_private_request(tmp, expectedSize) {
	let metadata = null, link = null;
	try { metadata = stat(tmp); } catch (e) { metadata = null; }
	try { link = readlink(tmp); } catch (e) { link = 'error'; }
	return metadata != null && metadata.type == 'file' && link == null
		&& type(metadata.size) == 'int' && metadata.size == expectedSize
		&& metadata.mode % 512 == 384
		&& match(tmp, /^\/tmp\/zapret2-manager\/runtime\/requests\/scanner-rpc\.[A-Za-z0-9_-]+\.json$/);
}

function scanner_child_response(output, streamRc) {
	if (streamRc != 0 || type(output) != 'string' || length(output) > SCANNER_MAX_CHILD_RESPONSE_BYTES + 128)
		return { ok: false, error: { code: 'EOUTPUT', message: 'Scanner child response exceeded the safe bound' } };
	let marker = '\n' + SCANNER_CHILD_RESPONSE_MARKER, markerAt = rindex(output, marker);
	if (markerAt < 0) return { ok: false, error: { code: 'EOUTPUT', message: 'Scanner child response was truncated' } };
	let rcText = trim(substr(output, markerAt + length(marker)));
	if (!match(rcText, /^[0-9]+$/)) return { ok: false, error: { code: 'EOUTPUT', message: 'Scanner child status marker was malformed' } };
	let body = substr(output, 0, markerAt), childRc = +rcText;
	if (length(body) > SCANNER_MAX_CHILD_RESPONSE_BYTES)
		return { ok: false, error: { code: 'EOUTPUT', message: 'Scanner child response exceeded the safe bound' } };
	if (childRc != 0) return { ok: false, error: { code: 'ECHILD', message: 'Scanner child exited unsuccessfully' } };
	try {
		let parsed = json(body);
		return parsed != null ? parsed : { ok: false, error: { code: 'EINTERNAL', message: 'Scanner response was empty' } };
	} catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'Scanner response was malformed' } }; }
}

function scanner_edit_action(sub, req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	if (length(edit) > SCANNER_MAX_REQUEST_BYTES)
		return { ok: false, error: { code: 'EINPUT', message: 'edit exceeds the safe request size limit' } };
	let tmp = scanner_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	try { writefile(tmp, edit); }
	catch (e) { scanner_cleanup_request(tmp); return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } }; }
	if (!scanner_private_request(tmp, length(edit))) {
		scanner_cleanup_request(tmp);
		return { ok: false, error: { code: 'EINPUT', message: 'request temp file failed the private-file invariant' } };
	}
	let expression = 'import { scanner_cli_request } from ' + sprintf('%J', SCANNER_CLI)
		+ '; print(sprintf("%J", scanner_cli_request(' + sprintf('%J', sub) + ', ' + sprintf('%J', tmp) + ')));';
	let command = shell_escape(SCANNER_UCODE_BIN) + ' -e ' + shell_escape(expression);
	let wrapped = '(' + command + '; rc=$?; printf ' + shell_escape('\n' + SCANNER_CHILD_RESPONSE_MARKER + '%s\n')
		+ ' "$rc") 2>&1 | head -c ' + (SCANNER_MAX_CHILD_RESPONSE_BYTES + 128);
	let p = null, output = '', readOk = true, streamRc = -1;
	try { p = popen(wrapped, 'r'); } catch (e) { p = null; }
	if (!p) { scanner_cleanup_request(tmp); return { ok: false, error: { code: 'ETARGET', message: 'Scanner CLI unavailable' } }; }
	try { output = p.read('all') || ''; } catch (e) { readOk = false; }
	try { streamRc = p.close(); } catch (e) { streamRc = -1; }
	scanner_cleanup_request(tmp);
	if (!readOk) return { ok: false, error: { code: 'EIO', message: 'Scanner child response could not be read' } };
	return scanner_child_response(output, streamRc);
}

function scanner_start_method(req) { return scanner_edit_action('start', req); }
function scanner_status_method(req) { return scanner_edit_action('status', req); }
function scanner_results_method(req) { return scanner_edit_action('results', req); }
function scanner_stop_method(req) { return scanner_edit_action('stop', req); }
function scanner_resume_method(req) { return scanner_edit_action('resume', req); }
function scanner_save_generated_method(req) { return scanner_edit_action('save-generated', req); }

// ---- service catalog (Phase B) -------------------------------------------------
const CATALOG_CLI = '/usr/libexec/zapret2-manager/catalog-cli.uc';
function catalog_list_method(req) { return cli_action(CATALOG_CLI, 'list'); }
function catalog_get_method(req) { return cli_edit_action(CATALOG_CLI, 'get', req, 'catalog'); }
function catalog_status_method(req) { return cli_action(CATALOG_CLI, 'status'); }
function catalog_preview_method(req) { return cli_edit_action(CATALOG_CLI, 'preview', req, 'catalog'); }
function catalog_apply_method(req) { return cli_edit_action(CATALOG_CLI, 'apply', req, 'catalog'); }

// ---- per-service DNS mapping (Slice 7) -----------------------------------------
const SERVICE_DNS_CLI = '/usr/libexec/zapret2-manager/service-dns-cli.uc';
function service_dns_providers_method(req) { return cli_action(SERVICE_DNS_CLI, 'providers'); }
function service_dns_status_method(req)    { return cli_action(SERVICE_DNS_CLI, 'status'); }
function service_dns_check_method(req)     { return cli_action(SERVICE_DNS_CLI, 'check'); }
function service_dns_preview_method(req)   { return cli_action(SERVICE_DNS_CLI, 'preview'); }
function service_dns_set_method(req)       { return cli_edit_action(SERVICE_DNS_CLI, 'set', req, 'service_dns'); }
function service_dns_apply_method(req)     { return cli_edit_action(SERVICE_DNS_CLI, 'apply', req, 'service_dns'); }
function service_dns_apply_async_method(req) { return cli_edit_action(SERVICE_DNS_CLI, 'apply-async', req, 'sdnsasync'); }
function service_dns_apply_status_method(req) { return cli_edit_action(SERVICE_DNS_CLI, 'apply-status', req, 'service_dns'); }
function service_dns_rollback_method(req)  { return cli_action(SERVICE_DNS_CLI, 'rollback'); }

// profiles_apply {edit: '{"mode":"preview"|"apply"}'} — preview is read-only
// (no write, no restart); apply runs the full pipeline (snapshot → write →
// restart → verify → rollback-on-failure). Mode parsing happens here; the
// CLI subcommand is chosen, never interpolated from the payload.
function profiles_apply_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	let mode = 'preview';
	if (edit != null && type(edit) == 'string') {
		let obj = null;
		try { obj = json(edit); } catch (e) { obj = null; }
		if (type(obj) == 'object' && obj != null && obj.mode == 'apply') mode = 'apply';
	}
	return profiles_action(mode);
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
		lists_set:         { args: { edit: 'string' }, call: function (req) { return lists_set_method(req); } },
		assets_list:       { call: function (req) { return assets_list_method(req); } },
		assets_get:        { args: { edit: 'string' }, call: function (req) { return assets_get_method(req); } },
		assets_validate:   { args: { edit: 'string' }, call: function (req) { return assets_validate_method(req); } },
		assets_resolve:    { args: { edit: 'string' }, call: function (req) { return assets_resolve_method(req); } },
		assets_import:     { args: { edit: 'string' }, call: function (req) { return assets_import_method(req); } },
		assets_update:     { args: { edit: 'string' }, call: function (req) { return assets_update_method(req); } },
		assets_register_builtin: { args: { edit: 'string' }, call: function (req) { return assets_register_builtin_method(req); } },
		assets_delete:     { args: { edit: 'string' }, call: function (req) { return assets_delete_method(req); } },
		assets_references: { args: { edit: 'string' }, call: function (req) { return assets_references_method(req); } },
		route_list:        { call: function (req) { return route_list_method(req); } },
		route_get:         { args: { edit: 'string' }, call: function (req) { return route_get_method(req); } },
		route_create:      { args: { edit: 'string' }, call: function (req) { return route_create_method(req); } },
		route_update:      { args: { edit: 'string' }, call: function (req) { return route_update_method(req); } },
		route_preview:     { args: { edit: 'string' }, call: function (req) { return route_preview_method(req); } },
		route_validate:    { args: { edit: 'string' }, call: function (req) { return route_validate_method(req); } },
		route_apply:       { args: { edit: 'string' }, call: function (req) { return route_apply_method(req); } },
		route_status:      { args: { edit: 'string' }, call: function (req) { return route_status_method(req); } },
		route_remove:      { args: { edit: 'string' }, call: function (req) { return route_remove_method(req); } },
		route_reconcile:   { call: function (req) { return route_reconcile_method(req); } },
		profiles_list:     { call: function (req) { return profiles_list_method(req); } },
		profiles_create:   { args: { edit: 'string' }, call: function (req) { return profiles_create_method(req); } },
		profiles_update:   { args: { edit: 'string' }, call: function (req) { return profiles_update_method(req); } },
		profiles_clone:    { args: { edit: 'string' }, call: function (req) { return profiles_clone_method(req); } },
		profiles_delete:   { args: { edit: 'string' }, call: function (req) { return profiles_delete_method(req); } },
		profiles_reorder:  { args: { edit: 'string' }, call: function (req) { return profiles_reorder_method(req); } },
		profiles_validate: { args: { edit: 'string' }, call: function (req) { return profiles_validate_method(req); } },
		profiles_import_applied: { call: function (req) { return profiles_import_applied_method(req); } },
		profiles_apply:    { args: { edit: 'string' }, call: function (req) { return profiles_apply_method(req); } },
		job_get:           { args: { edit: 'string' }, call: function (req) { return job_get_method(req); } },
		job_list:          { call: function (req) { return job_list_method(req); } },
		blockcheck_start:  { args: { edit: 'string' }, call: function (req) { return blockcheck_start_method(req); } },
		blockcheck_cancel: { args: { edit: 'string' }, call: function (req) { return blockcheck_cancel_method(req); } },
		blockcheck_status: { call: function (req) { return blockcheck_status_method(req); } },
		blockcheck_apply: { args: { edit: 'string' }, call: function (req) { return blockcheck_apply_method(req); } },
		blockcheck_preview: { args: { edit: 'string' }, call: function (req) { return blockcheck_preview_method(req); } },
		blockcheck_rollback: { args: { edit: 'string' }, call: function (req) { return blockcheck_rollback_method(req); } },
		blockcheck_diag_start: { args: { edit: 'string' }, call: function (req) { return blockcheck_diag_start_method(req); } },
		blockcheck_diag_status: { call: function (req) { return blockcheck_diag_status_method(req); } },
		blockcheck_diag_results: { args: { edit: 'string' }, call: function (req) { return blockcheck_diag_results_method(req); } },
		blockcheck_diag_stop: { args: { edit: 'string' }, call: function (req) { return blockcheck_diag_stop_method(req); } },
		blockcheck_diag_domains: { args: { edit: 'string' }, call: function (req) { return blockcheck_diag_domains_method(req); } },
		blockcheck_diag_traceroute: { args: { edit: 'string' }, call: function (req) { return blockcheck_diag_traceroute_method(req); } },
		blockcheck2_script: { call: function (req) { return blockcheck2_script_method(req); } },
		blockcheck2_start: { args: { edit: 'string' }, call: function (req) { return blockcheck2_start_method(req); } },
		blockcheck2_status: { call: function (req) { return blockcheck2_status_method(req); } },
		blockcheck2_output: { args: { edit: 'string' }, call: function (req) { return blockcheck2_output_method(req); } },
		blockcheck2_results: { args: { edit: 'string' }, call: function (req) { return blockcheck2_results_method(req); } },
		blockcheck2_stop: { args: { edit: 'string' }, call: function (req) { return blockcheck2_stop_method(req); } },
		blockcheckw_provider_status: { call: function (req) { return blockcheckw_provider_status_method(req); } },
		blockcheckw_update_check: { call: function (req) { return blockcheckw_update_check_method(req); } },
		blockcheckw_install: { args: { edit: 'string' }, call: function (req) { return blockcheckw_install_method(req); } },
		blockcheckw_script: { call: function (req) { return blockcheckw_script_method(req); } },
		blockcheckw_start: { args: { edit: 'string' }, call: function (req) { return blockcheckw_start_method(req); } },
		blockcheckw_status: { call: function (req) { return blockcheckw_status_method(req); } },
		blockcheckw_output: { args: { edit: 'string' }, call: function (req) { return blockcheckw_output_method(req); } },
		blockcheckw_results: { args: { edit: 'string' }, call: function (req) { return blockcheckw_results_method(req); } },
		blockcheckw_stop: { args: { edit: 'string' }, call: function (req) { return blockcheckw_stop_method(req); } },
		block_detector_start: { args: { edit: 'string' }, call: function (req) { return block_detector_start_method(req); } },
		block_detector_status: { call: function (req) { return block_detector_status_method(req); } },
		block_detector_results: { call: function (req) { return block_detector_results_method(req); } },
		block_detector_stop: { call: function (req) { return block_detector_stop_method(req); } },
		health_matrix_get: { call: function (req) { return health_matrix_get_method(req); } },
		health_matrix_start: { args: { edit: 'string' }, call: function (req) { return health_matrix_start_method(req); } },
		health_matrix_job_get: { args: { edit: 'string' }, call: function (req) { return health_matrix_job_get_method(req); } },
		health_matrix_job_cancel: { args: { edit: 'string' }, call: function (req) { return health_matrix_job_cancel_method(req); } },
		orchestra_capabilities: { call: function (req) { return orchestra_capabilities_method(req); } },
		discord_profile_preview: { call: function (req) { return discord_profile_preview_method(req); } },
		discord_profile_apply: { args: { edit: 'string' }, call: function (req) { return discord_profile_apply_method(req); } },
		discord_profile_rollback: { call: function (req) { return discord_profile_rollback_method(req); } },
		discord_profile_restore_previous: { call: function (req) { return discord_profile_restore_previous_method(req); } },
		orchestra_status:  { call: function (req) { return orchestra_status_method(req); } },
		orchestra_events:  { call: function (req) { return orchestra_events_method(req); } },
		orchestra_history: { call: function (req) { return orchestra_history_method(req); } },
		orchestra_ratings_get: { call: function (req) { return orchestra_ratings_get_method(req); } },
		orchestra_runid: { call: function (req) { return orchestra_runid_method(req); } },
		orchestra_parse_warnings: { call: function (req) { return orchestra_parse_warnings_method(req); } },
		orchestra_history_get: { call: function (req) { return orchestra_history_get_method(req); } },
		orchestra_history_paginated: { args: { cursor: 'string', limit: 'integer' }, call: function (req) { return orchestra_history_paginated_method(req); } },
		orchestra_history_export: { args: { limit: 'integer' }, call: function (req) { return orchestra_history_export_method(req); } },
		orchestra_history_clear: { args: { runId: 'string' }, call: function (req) { return orchestra_history_clear_method(req); } },
		orchestra_history_stats: { call: function (req) { return orchestra_history_stats_method(req); } },
		orchestra_run_start: { args: { edit: 'string' }, call: function (req) { return orchestra_run_start_method(req); } },
		orchestra_run_status: { args: { edit: 'string' }, call: function (req) { return orchestra_run_status_method(req); } },
		orchestra_run_events: { args: { edit: 'string' }, call: function (req) { return orchestra_run_events_method(req); } },
		orchestra_run_pause: { call: function (req) { return orchestra_run_pause_method(req); } },
		orchestra_run_resume: { call: function (req) { return orchestra_run_resume_method(req); } },
		orchestra_run_stop: { args: { edit: 'string' }, call: function (req) { return orchestra_run_stop_method(req); } },
		orchestra_run_continue: { args: { edit: 'string' }, call: function (req) { return orchestra_run_continue_method(req); } },
		orchestra_probe_preflight: { call: function (req) { return orchestra_probe_preflight_method(req); } },
		orchestra_run_invalidate: { args: { edit: 'string' }, call: function (req) { return orchestra_run_invalidate_method(req); } },
		orchestra_run_history: { call: function (req) { return orchestra_run_history_method(req); } },
		orchestra_run_load: { args: { edit: 'string' }, call: function (req) { return orchestra_run_load_method(req); } },
		orchestra_run_delete: { args: { edit: 'string' }, call: function (req) { return orchestra_run_delete_method(req); } },
		orchestra_apply_best: { args: { edit: 'string' }, call: function (req) { return orchestra_apply_best_method(req); } },
		orchestra_preview_best: { args: { edit: 'string' }, call: function (req) { return orchestra_preview_best_method(req); } },
		orchestra_apply_status: { args: { edit: 'string' }, call: function (req) { return orchestra_apply_status_method(req); } },
		orchestra_apply_events: { args: { edit: 'string' }, call: function (req) { return orchestra_apply_events_method(req); } },
		orchestra_restore_previous: { args: { edit: 'string' }, call: function (req) { return orchestra_restore_previous_method(req); } },
		orchestra_auto_status: { call: function (req) { return orchestra_auto_status_method(req); } },
		orchestra_auto_enable: { args: { edit: 'string' }, call: function (req) { return orchestra_auto_enable_method(req); } },
		orchestra_auto_disable: { args: { edit: 'string' }, call: function (req) { return orchestra_auto_disable_method(req); } },
		orchestra_auto_run: { args: { edit: 'string' }, call: function (req) { return orchestra_auto_run_method(req); } },
		orchestra_auto_stop: { args: { edit: 'string' }, call: function (req) { return orchestra_auto_stop_method(req); } },
		orchestra_auto_restore: { args: { edit: 'string' }, call: function (req) { return orchestra_auto_restore_method(req); } },
		dnsprov_components: { call: function (req) { return dnsprov_components_method(req); } },
		dnsprov_providers: { call: function (req) { return dnsprov_providers_method(req); } },
		dnsprov_diagnose: { args: { edit: 'string' }, call: function (req) { return dnsprov_diagnose_method(req); } },
		dns_select_provider: { args: { edit: 'string' }, call: function (req) { return dns_select_provider_method(req); } },
		proxy_capabilities: { call: function (req) { return proxy_capabilities_method(req); } },
		proxy_status:      { call: function (req) { return proxy_status_method(req); } },
		proxy_config_get:  { call: function (req) { return proxy_config_get_method(req); } },
		proxy_logs_tail:   { args: { edit: 'string' }, call: function (req) { return proxy_logs_tail_method(req); } },
		proxy_health:      { args: { edit: 'string' }, call: function (req) { return proxy_health_method(req); } },
		proxy_link_info:   { args: { edit: 'string' }, call: function (req) { return proxy_link_info_method(req); } },
		proxy_config_validate: { args: { edit: 'string' }, call: function (req) { return proxy_config_validate_method(req); } },
		proxy_config_preview: { args: { edit: 'string' }, call: function (req) { return proxy_config_preview_method(req); } },
		proxy_config_apply: { args: { edit: 'string' }, call: function (req) { return proxy_config_apply_method(req); } },
		proxy_start:       { call: function (req) { return proxy_start_method(req); } },
		proxy_stop:        { call: function (req) { return proxy_stop_method(req); } },
		proxy_restart:     { call: function (req) { return proxy_restart_method(req); } },
		proxy_autostart_set: { args: { edit: 'string' }, call: function (req) { return proxy_autostart_set_method(req); } },
		proxy_secret_rotate: { call: function (req) { return proxy_secret_rotate_method(req); } },
		proxy_quick_install: { call: function (req) { return proxy_quick_install_method(req); } },
		service_dns_providers: { call: function (req) { return service_dns_providers_method(req); } },
		service_dns_status:    { call: function (req) { return service_dns_status_method(req); } },
		service_dns_check:     { call: function (req) { return service_dns_check_method(req); } },
		service_dns_preview:   { call: function (req) { return service_dns_preview_method(req); } },
		service_dns_set:       { args: { edit: 'string' }, call: function (req) { return service_dns_set_method(req); } },
		service_dns_apply:     { args: { edit: 'string' }, call: function (req) { return service_dns_apply_method(req); } },
		service_dns_apply_async: { args: { edit: 'string' }, call: function (req) { return service_dns_apply_async_method(req); } },
		service_dns_apply_status: { args: { edit: 'string' }, call: function (req) { return service_dns_apply_status_method(req); } },
		service_dns_rollback:  { call: function (req) { return service_dns_rollback_method(req); } },
		versions:          { call: function (req) { return versions_method(req); } },
		maintenance_status: { call: function (req) { return maintenance_status_method(req); } },
		events_tail:       { args: { edit: 'string' }, call: function (req) { return events_tail_method(req); } },
		diagnostics_export: { call: function (req) { return diagnostics_export_method(req); } },
		backup_list:       { call: function (req) { return backup_list_method(req); } },
		backup_create:     { args: { edit: 'string' }, call: function (req) { return backup_create_method(req); } },
		backup_restore_preview: { args: { edit: 'string' }, call: function (req) { return backup_restore_preview_method(req); } },
		backup_restore:    { args: { edit: 'string' }, call: function (req) { return backup_restore_method(req); } },
		backup_delete:     { args: { edit: 'string' }, call: function (req) { return backup_delete_method(req); } },
		dns_get:           { call: function (req) { return dns_get_method(req); } },
		dns_set:           { args: { edit: 'string' }, call: function (req) { return dns_set_method(req); } },
		dns_validate:      { args: { edit: 'string' }, call: function (req) { return dns_validate_method(req); } },
		dns_apply:         { args: { edit: 'string' }, call: function (req) { return dns_apply_method(req); } },
		dns_check:         { args: { edit: 'string' }, call: function (req) { return dns_check_method(req); } },
		dns_rollback:      { call: function (req) { return dns_rollback_method(req); } },
		dns_restore_auto:  { call: function (req) { return dns_restore_auto_method(req); } },
		dns_global_get:    { call: function (req) { return dns_global_get_method(req); } },
		dns_global_set:    { args: { edit: 'string' }, call: function (req) { return dns_global_set_method(req); } },
		dns_global_preview:{ call: function (req) { return dns_global_preview_method(req); } },
		dns_global_apply:  { call: function (req) { return dns_global_apply_method(req); } },
		dns_global_rollback: { call: function (req) { return dns_global_rollback_method(req); } },
		dns_product_get: { call: function (req) { return dns_product_get_method(req); } },
		dns_product_providers: { call: function (req) { return dns_product_providers_method(req); } },
		dns_product_status: { call: function (req) { return dns_product_status_method(req); } },
		dns_product_preview: { args: { edit: 'string' }, call: function (req) { return dns_product_preview_method(req); } },
		dns_product_validate: { args: { edit: 'string' }, call: function (req) { return dns_product_validate_method(req); } },
		dns_product_apply: { args: { edit: 'string' }, call: function (req) { return dns_product_apply_method(req); } },
		dns_product_rollback: { args: { edit: 'string' }, call: function (req) { return dns_product_rollback_method(req); } },
		strategies_list:   { call: function (req) { return strategies_list_method(req); } },
		strategies_get:    { args: { edit: 'string' }, call: function (req) { return strategies_get_method(req); } },
		strategies_create: { args: { edit: 'string' }, call: function (req) { return strategies_create_method(req); } },
		strategies_update: { args: { edit: 'string' }, call: function (req) { return strategies_update_method(req); } },
		strategies_delete: { args: { edit: 'string' }, call: function (req) { return strategies_delete_method(req); } },
		strategies_duplicate: { args: { edit: 'string' }, call: function (req) { return strategies_duplicate_method(req); } },
		strategies_favorite: { args: { edit: 'string' }, call: function (req) { return strategies_favorite_method(req); } },
		strategies_preview: { args: { edit: 'string' }, call: function (req) { return strategies_preview_method(req); } },
		strategies_validate: { args: { edit: 'string' }, call: function (req) { return strategies_validate_method(req); } },
		strategies_apply: { args: { edit: 'string' }, call: function (req) { return strategies_apply_method(req); } },
		strategies_catalog_status: { call: function (req) { return strategies_catalog_status_method(req); } },
		strategies_catalog_reload: { call: function (req) { return strategies_catalog_reload_method(req); } },
		strategies_import_profiles: { args: { edit: 'string' }, call: function (req) { return strategies_import_profiles_method(req); } },
		scanner_start: { args: { edit: 'string' }, call: function (req) { return scanner_start_method(req); } },
		scanner_status: { args: { edit: 'string' }, call: function (req) { return scanner_status_method(req); } },
		scanner_results: { args: { edit: 'string' }, call: function (req) { return scanner_results_method(req); } },
		scanner_stop: { args: { edit: 'string' }, call: function (req) { return scanner_stop_method(req); } },
		scanner_resume: { args: { edit: 'string' }, call: function (req) { return scanner_resume_method(req); } },
		scanner_save_generated: { args: { edit: 'string' }, call: function (req) { return scanner_save_generated_method(req); } },
		catalog_list:      { call: function (req) { return catalog_list_method(req); } },
		catalog_get:       { args: { edit: 'string' }, call: function (req) { return catalog_get_method(req); } },
		catalog_status:    { call: function (req) { return catalog_status_method(req); } },
		catalog_preview:   { args: { edit: 'string' }, call: function (req) { return catalog_preview_method(req); } },
		catalog_apply:     { args: { edit: 'string' }, call: function (req) { return catalog_apply_method(req); } }
	}
};
