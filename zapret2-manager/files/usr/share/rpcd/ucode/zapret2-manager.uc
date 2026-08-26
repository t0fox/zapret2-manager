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

import { stat, readfile, writefile, unlink, readlink, mkdir, popen } from 'fs';
import { strategy_cli_dispatch } from '/usr/libexec/zapret2-manager/strategy-cli.uc';
import { catalog_refresh_start, catalog_refresh_status } from '/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc';
import * as scanner_state from '/usr/libexec/zapret2-manager/scanner-state.uc';
import { dns_product_get, dns_product_providers, dns_product_status,
	dns_product_preview, dns_product_validate, dns_product_apply,
	dns_product_rollback } from '/usr/libexec/zapret2-manager/dns-product.uc';
import { tg_product_get, tg_product_catalog, tg_product_status, tg_product_versions,
	tg_product_operation_status, tg_product_validate, tg_product_preview, tg_product_apply,
	tg_product_health, tg_product_check_updates, tg_product_switch, tg_product_install,
	tg_product_update, tg_product_remove, tg_product_purge, tg_product_start,
	tg_product_stop, tg_product_restart } from '/usr/libexec/zapret2-manager/tg-product.uc';

const STATUS_JSON = '/tmp/zapret2-manager/status.json';
const COLLECTOR   = '/usr/libexec/zapret2-manager/status.uc';
const FAST_COLLECTOR = '/usr/libexec/zapret2-manager/status-fast.uc';
const SERVICE     = '/usr/libexec/zapret2-manager/service.uc';
const CACHE_TTL   = 3;

// rpcd exposes parameterized methods as { args: { edit: JSON string } }.
// The canonical TG facade accepts the decoded object, not the wire string.
function tg_edit_input(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string' } };
	try {
		let parsed = json(edit);
		if (type(parsed) == 'object' && parsed != null) return { valid: true, value: parsed };
	} catch (e) { }
	return { ok: false, error: { code: 'EINPUT', message: 'edit must contain a JSON object' } };
}

function tg_edit_call(fn, req) {
	let parsed = tg_edit_input(req);
	return parsed.valid === true ? fn(parsed.value) : parsed;
}
function tg_product_operation_status_method(req) { return tg_edit_call(tg_product_operation_status, req); }
function tg_product_validate_method(req) { return tg_edit_call(tg_product_validate, req); }
function tg_product_preview_method(req) { return tg_edit_call(tg_product_preview, req); }
function tg_product_apply_method(req) { return tg_edit_call(tg_product_apply, req); }
function tg_product_health_method(req) { return tg_edit_call(tg_product_health, req); }
function tg_product_check_updates_method(req) { return tg_edit_call(tg_product_check_updates, req); }
function tg_product_switch_method(req) { return tg_edit_call(tg_product_switch, req); }
function tg_product_install_method(req) { return tg_edit_call(tg_product_install, req); }
function tg_product_update_method(req) { return tg_edit_call(tg_product_update, req); }
function tg_product_remove_method(req) { return tg_edit_call(tg_product_remove, req); }
function tg_product_purge_method(req) { return tg_edit_call(tg_product_purge, req); }

function shell_escape_early(value) {
	let s = '' + (value == null ? '' : value), out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}
function shell_quote_early(value) { return shell_escape_early(value); }
// Hoist-safe aliases for status_refresh_async (defined below before the
// later shell_escape/shell_quote declaration).
function shell_escape(value) { return shell_escape_early(value); }
function shell_quote(value) { return shell_quote_early(value); }

function now() { return time(); }

function cache_fresh() {
	let st = stat(STATUS_JSON);
	if (!st) return false;
	return (now() - st.mtime) <= CACHE_TTL;
}

// NON-BLOCKING by design: the full collector takes many seconds on real
// hardware and rpcd handles ubus calls synchronously — running it inline
// starved every other call on the system. Instead: serve the cached snapshot
// immediately and trigger at most ONE background refresh (mkdir lock with
// stale-lock steal; the lock also caps concurrency to a single collector).
function status_refresh_async() {
	let lock = '/tmp/zapret2-manager/status.refresh.lock';
	let lst = stat(lock);
	if (lst != null) {
		if ((now() - lst.mtime) < 180) return; // a collector is already running
		run_lock_cleanup(lock);
	}
	if (!writefile('/tmp/zapret2-manager/status.refresh.stamp', sprintf('%d', now()))) return;
	try { mkdir(lock); } catch (e) { return; } // someone won the race
	try {
		popen('( /usr/bin/ucode ' + shell_escape(COLLECTOR) + ' --no-print >/dev/null 2>&1; rm -rf ' + shell_escape(lock) + ' ) &', 'r').close();
	} catch (e) { try { unlink(lock); } catch (x) { } }
}

function run_lock_cleanup(lock) {
	try {
		popen('rm -rf ' + shell_escape(lock) + ' 2>/dev/null', 'r').close();
	} catch (e) { }
}

function status_method(req) {
	status_refresh_async();
	let raw = readfile(STATUS_JSON);
	if (!raw) return { ok: false, pending: true,
		error: { code: 'EPENDING', message: 'status collection in progress' },
		generatedAt: null };
	try {
		let value = json(raw);
		if (!cache_fresh() && value != null && type(value) == 'object')
			value.stale = true;
		return value;
	}
	catch (e) { return { error: 'status parse failed', raw: raw }; }
}

function status_fast_method(req) {
	let p = popen('/usr/bin/ucode ' + FAST_COLLECTOR + ' 2>/dev/null', 'r');
	if (!p) return { ok: false, error: { code: 'EFAST_STATUS', message: 'Fast status collector unavailable.' } };
	let out = p.read('all') || '', rc = p.close();
	if (rc != 0 || !length(trim(out))) return { ok: false, error: { code: 'EFAST_STATUS', message: 'Fast status collector failed.' } };
	try { return json(out); } catch (e) { return { ok: false, error: { code: 'EFAST_STATUS', message: 'Fast status response malformed.' } }; }
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
// Request staging always goes through `umask 077; mktemp` so a local
// unprivileged process cannot pre-create or symlink the path rpcd writes as
// root. `prefix` must end with a literal '.' and carry no shell metacharacters.
function staging_tempfile(prefix) {
	let p = popen('umask 077; mktemp ' + prefix + 'XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let path = trim(p.read('all') || ''), rc = p.close();
	return rc == 0 && index(path, prefix) == 0 && length(path) <= 64 ? path : null;
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
	let tmp = staging_tempfile('/tmp/z2m-lists-edit.');
	if (tmp == null) return { ok: false, error: 'private list edit file unavailable' };
	// verbatim — no sprintf("%J"), no double-encode
	if (!writefile(tmp, edit)) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'lists request temp file could not be written' } }; }
	let cmd = '/usr/bin/ucode ' + LISTS_CLI + ' set ' + shell_escape(tmp) + ' 2>/dev/null';
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

// ---- typed canonical assets -----------------------------------------------
const ASSET_CLI = '/usr/libexec/zapret2-manager/asset-registry-cli.uc';
const RESOURCE_CLI = '/usr/libexec/zapret2-manager/resource-update-cli.uc';
function asset_args(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > 32 * 1024 * 1024) return null;
	try { let value = json(edit); return type(value) == 'object' && value != null ? value : null; } catch (e) { return null; }
}
function asset_cli_action(mode, argument) {
	let cmd = '/usr/bin/ucode ' + ASSET_CLI + ' ' + mode + (argument == null ? '' : ' ' + shell_escape(argument)) + ' 2>/dev/null';
	let p = popen(cmd, 'r');
	if (!p) return { ok: false, error: { code: 'ETARGET', message: 'asset registry runner unavailable' } };
	let out = p.read('all') || '', rc = p.close();
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: 'EINTERNAL', message: 'asset registry returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'asset registry response was malformed' } }; }
}
function asset_tmpfile() {
	let p = popen('umask 077; mktemp /tmp/z2m-assets-edit.XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let path = trim(p.read('all') || ''), rc = p.close();
	return rc == 0 && index(path, '/tmp/z2m-assets-edit.') == 0 ? path : null;
}
function asset_edit_action(mode, req, trailing) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > 32 * 1024 * 1024)
		return { ok: false, error: { code: 'EINPUT', message: 'asset edit must be a bounded JSON string' } };
	let tmp = asset_tmpfile();
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'asset request temp file unavailable' } };
	let wrote = null; try { wrote = writefile(tmp, edit); } catch (e) { wrote = null; }
	if (wrote == null) { try { unlink(tmp); } catch (x) {} return { ok: false, error: { code: 'EIO', message: 'asset request temp file could not be written' } }; }
	let command = '/usr/bin/ucode ' + ASSET_CLI + ' ' + mode + (trailing == null ? '' : ' ' + shell_escape(trailing)) + ' ' + shell_escape(tmp) + ' 2>/dev/null';
	let p = popen(command, 'r');
	if (!p) { try { unlink(tmp); } catch (e) {} return { ok: false, error: { code: 'ETARGET', message: 'asset registry runner unavailable' } }; }
	let out = p.read('all') || '';
	p.close();
	try { unlink(tmp); } catch (e) {}
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: 'EINTERNAL', message: 'asset registry returned no response' } }; }
	catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'asset registry response was malformed' } }; }
}
function asset_id(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? args.id : null; }
function assets_list_method(req) { let args = asset_args(req); return asset_cli_action('list', args && type(args.type) == 'string' ? args.type : null); }
function assets_get_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('get', id); }
function assets_content_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('content', id); }
function assets_validate_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('validate', id); }
function assets_validate_content_method(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? asset_edit_action('validate-content', req, args.id) : { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } }; }
function assets_delete_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('delete', id); }
function assets_import_method(req) { return asset_edit_action('import', req); }
function assets_import_url_method(req) { return asset_edit_action('import-url', req); }
function assets_asn_method(req) { return asset_edit_action('asn', req); }
function assets_update_method(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? asset_edit_action('update', req, args.id) : { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } }; }
function assets_register_builtin_method(req) { return asset_edit_action('register-builtin', req); }
function assets_references_method(req) { return asset_edit_action('references', req); }
function assets_resolve_method(req) { return asset_edit_action('resolve', req); }
function resource_cli_action(mode) {
	let command = '/usr/bin/ucode ' + RESOURCE_CLI + ' ' + mode + ' 2>/dev/null';
	let p = popen(command, 'r');
	if (!p) return { ok: false, error: { code: 'ETARGET', message: 'resource center runner unavailable' } };
	let out = p.read('all') || '', rc = p.close();
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: 'EINTERNAL', message: 'resource center returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'resource center response was malformed' } }; }
}
function resources_status_method(req) { return resource_cli_action('status'); }
function resources_check_method(req) { return resource_cli_action('check'); }
function resource_edit_action(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > 32 * 1024 * 1024)
		return { ok: false, error: { code: 'EINPUT', message: 'resource edit must be a bounded JSON string' } };
	let p = popen('umask 077; mktemp /tmp/z2m-resources-edit.XXXXXX 2>/dev/null', 'r');
	if (!p) return { ok: false, error: { code: 'ETARGET', message: 'resource request temp file unavailable' } };
	let tmp = trim(p.read('all') || ''), mkrc = p.close();
	if (mkrc != 0 || index(tmp, '/tmp/z2m-resources-edit.') != 0) return { ok: false, error: { code: 'ETARGET', message: 'resource request temp file unavailable' } };
	let wrote = null; try { wrote = writefile(tmp, edit); } catch (e) { wrote = null; }
	if (wrote == null) { try { unlink(tmp); } catch (x) {} return { ok: false, error: { code: 'EIO', message: 'resource request could not be written' } }; }
	let command = '/usr/bin/ucode ' + RESOURCE_CLI + ' update ' + shell_escape(tmp) + ' 2>/dev/null';
	let child = popen(command, 'r');
	if (!child) { try { unlink(tmp); } catch (e) {} return { ok: false, error: { code: 'ETARGET', message: 'resource center runner unavailable' } }; }
	let out = child.read('all') || '', rc = child.close(); try { unlink(tmp); } catch (e) {}
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'resource center returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'resource center response was malformed' } }; }
}
function resources_update_method(req) { return resource_edit_action(req); }

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
	// verbatim — no re-encode
	if (!writefile(tmp, edit)) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'profiles request temp file could not be written' } }; }
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
	let tmp = staging_tempfile('/tmp/z2m-blockcheck-apply.');
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'private apply request file unavailable' } };
	if (!writefile(tmp, edit)) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'apply request temp file could not be written' } }; }
	let p = popen('/usr/bin/ucode ' + BLOCKCHECK_APPLY_CLI + ' ' + shell_escape(tmp) + ' 2>/dev/null', 'r'); if (!p) { try { unlink(tmp); } catch (e) {} return { ok: false, error: { code: 'ETARGET', message: 'apply runner unavailable' } }; }
	let out = p.read('all'); p.close(); try { unlink(tmp); } catch (e) {} try { return json(out); } catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'apply response parse failed' } }; }
}
function blockcheck_preview_method(req) { return blockcheck_apply_method(req); }
function blockcheck_rollback_method(req) { return blockcheck_apply_method(req); }

// ---- jobs + blockcheck (SLICE 4) --------------------------------------------
const JOBS_CLI = '/usr/libexec/zapret2-manager/jobs-cli.uc';
const BLOCK_DETECTOR_CLI = '/usr/libexec/zapret2-manager/block-detector-cli.uc';

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
	let tmp = staging_tempfile('/tmp/z2m-jobs-edit.');
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'private job edit file unavailable' } };
	if (!writefile(tmp, edit)) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'jobs request temp file could not be written' } }; }
	let cmd = '/usr/bin/ucode ' + JOBS_CLI + ' ' + sub + ' ' + shell_escape(tmp) + ' 2>/dev/null';
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

// ---- Scanner catalog adapter -------------------------------------------------
// Scanner request bodies use the same private JSON-string convention as the
// Strategy and Jobs adapters. The RPC layer only selects a fixed CLI mode and
// transports the opaque request; Scanner owns validation and lifecycle state.
const SCANNER_CLI = '/usr/libexec/zapret2-manager/scanner-cli-entry.uc';
const SCANNER_REQUEST_ROOT = '/tmp/zapret2-manager/runtime/requests/';
const SCANNER_MAX_REQUEST_BYTES = 65536;
const SCANNER_MAX_OUTPUT_BYTES = 131072;
function scanner_request_root_ready() {
	for (let path in ['/tmp/zapret2-manager', '/tmp/zapret2-manager/runtime', SCANNER_REQUEST_ROOT]) {
		let metadata = null;
		try { metadata = stat(path); } catch (e) { metadata = null; }
		if (metadata == null) { try { mkdir(path); metadata = stat(path); } catch (e) { return false; } }
		if (metadata == null || metadata.type != 'directory' || readlink(path) != null
			|| metadata.uid != 0 || metadata.gid != 0 || metadata.mode % 512 != 448) return false;
	}
	return true;
}

let scanner_start_sequence = 0;
function scanner_start_async_impl(req) {
	if (!scanner_request_root_ready()) return { ok: false, error: { code: 'EINPUT', message: 'Scanner request directory is unsafe' } };
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > SCANNER_MAX_REQUEST_BYTES)
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner start edit is invalid' } };
	let request = null;
	try { request = json(edit); } catch (e) { return { ok: false, error: { code: 'EINPUT', message: 'Scanner start request is malformed' } }; }
	if (type(request) != 'object' || request == null)
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner start request is invalid' } };
	if (request.request == null && request.target == null)
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner request is invalid' } };
	let inner = request.request != null ? request.request : request;
	if (inner.target == null && request.target != null) inner.target = request.target;
	if (inner.protocol == null && request.protocol != null) inner.protocol = request.protocol;
	if (inner.mode == null && request.mode != null) inner.mode = request.mode;
	if (inner.dpi_type == null && request.dpi_type != null) inner.dpi_type = request.dpi_type;
	if (type(inner.target) != 'string' || length(inner.target) < 1)
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner target is required' } };
	// strict hostname boundary - must pass before any durable side effects (NO scanId, NO record, NO history)
	if (!match(inner.target, /^[a-z0-9][a-z0-9.-]{1,252}$/) || index(inner.target, '.') < 0 || index(inner.target, ':') >= 0)
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner target must be a strict hostname.', path: 'target' } };
	if (substr(inner.target, length(inner.target) - 1, 1) == '.')
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner target must be a strict hostname.', path: 'target' } };
	if (index(inner.target, '..') >= 0)
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner target must be a strict hostname.', path: 'target' } };
	if (inner.protocol != null && inner.protocol != 'tcp' && inner.protocol != 'udp')
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner request fields are invalid.' } };
	if (inner.mode != null && inner.mode != 'quick' && inner.mode != 'standard' && inner.mode != 'full')
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner request fields are invalid.' } };
	if (request.id == null) request.id = 'scan-' + time() + '-' + (++scanner_start_sequence);
	if (type(request.id) != 'string' || !match(request.id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/))
		return { ok: false, error: { code: 'EINPUT', message: 'Scanner id is invalid' } };
	// Durable acceptance: create initial record before launching worker
	let initialRequest = inner;
	let initialRecord = null;
	try {
		let created = scanner_state.scanner_state_create(initialRequest, { schema: 1, request: initialRequest, catalogDigest: '0000000000000000000000000000000000000000000000000000000000000000', compilerDigest: '0000000000000000000000000000000000000000000000000000000000000000', candidates: [] });
		created.id = request.id;
		created.status = 'starting';
		created.phase = 'queued';
		created.progress = 0;
		created.total = 0;
		created.request = initialRequest;
		created.requestDigest = scanner_state.scanner_state_digest(initialRequest);
		created.catalogDigest = '0000000000000000000000000000000000000000000000000000000000000000';
		created.compilerDigest = '0000000000000000000000000000000000000000000000000000000000000000';
		created.planDigest = scanner_state.scanner_state_digest({ schema: 1, request: initialRequest });
		created.heartbeatAt = time();
		created.startedAt = time();
		let saved = scanner_state.scanner_state_save(created);
		if (!saved.ok) {
			let loadBack = scanner_state.scanner_state_load(request.id);
			if (!loadBack.ok) return { ok: false, error: { code: 'EIO', message: 'Scanner durable record could not be created', detail: saved.error } };
			initialRecord = loadBack.state;
		} else {
			let loadBack = scanner_state.scanner_state_load(request.id);
			if (!loadBack.ok) return { ok: false, error: { code: 'EIO', message: 'Scanner durable record not readable after creation' } };
			initialRecord = loadBack.state;
		}
	} catch (e) {
		return { ok: false, error: { code: 'EIO', message: 'Scanner durable record creation failed', detail: '' + e } };
	}
	if (initialRecord == null) return { ok: false, error: { code: 'EIO', message: 'Scanner durable record is null after creation' } };
	let serialized = sprintf('%J', request), tmp = null;
	let created = popen('umask 077; mktemp /tmp/zapret2-manager/runtime/requests/scanner.XXXXXX 2>/dev/null', 'r');
	if (created) { tmp = trim(created.read('all') || ''); created.close(); }
	if (!tmp || index(tmp, SCANNER_REQUEST_ROOT) != 0
		|| !match(substr(tmp, length(SCANNER_REQUEST_ROOT)), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)) {
		if (tmp) try { unlink(tmp); } catch (e) { }
		// Update already-created record to error: launch failure
		try {
			let rec = scanner_state.scanner_state_load(request.id);
			if (rec.ok) {
				let errRec = rec.state;
				errRec.status = 'error';
				errRec.phase = 'launch';
				errRec.error = 'Scanner worker could not be launched: temp file unavailable';
				errRec.recovery = { state: 'uncertain', message: 'launch failed' };
				errRec.finishedAt = time();
				scanner_state.scanner_state_save(errRec);
			}
		} catch (e) {}
		return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	}
	let wrote = null; try { wrote = writefile(tmp, serialized); } catch (e) { wrote = null; }
	if (wrote == null) {
		try { unlink(tmp); } catch (ignore) { }
		try {
			let rec = scanner_state.scanner_state_load(request.id);
			if (rec.ok) {
				let errRec = rec.state;
				errRec.status = 'error';
				errRec.phase = 'launch';
				errRec.error = 'request temp file could not be written';
				errRec.finishedAt = time();
				scanner_state.scanner_state_save(errRec);
			}
		} catch (e) {}
		return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } };
	}
	let workerCommand = '/usr/bin/ucode ' + SCANNER_CLI + ' start ' + tmp
		+ ' >/tmp/zapret2-manager/scanner/' + request.id + '.worker.log 2>&1; rm -f ' + tmp + ' >/dev/null 2>&1';
	let cmd = 'setsid sh -c ' + shell_escape(workerCommand) + ' >/dev/null 2>&1 &';
	let launched = popen(cmd, 'r');
	if (!launched) {
		try { unlink(tmp); } catch (e) { }
		try {
			let rec = scanner_state.scanner_state_load(request.id);
			if (rec.ok) {
				let errRec = rec.state;
				errRec.status = 'error';
				errRec.phase = 'launch';
				errRec.error = 'Scanner worker could not be launched';
				errRec.finishedAt = time();
				scanner_state.scanner_state_save(errRec);
			}
		} catch (e) {}
		return { ok: false, error: { code: 'ETARGET', message: 'Scanner worker could not be launched' } };
	}
	launched.close();
	// Verify durable record still readable after launch
	let verify = scanner_state.scanner_state_load(request.id);
	if (!verify.ok) return { ok: false, error: { code: 'EIO', message: 'Scanner durable record not readable after launch' } };
	return { ok: true, accepted: true, scanId: request.id, state: verify.state.status || 'starting', record: verify.state };
}

function scanner_start_async(req) {
	try { return scanner_start_async_impl(req); }
	catch (e) {
		try {
			let edit = null;
			try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (x) {}
			if (edit == null) try { if (req && req.edit != null) edit = req.edit; } catch (x) {}
			if (type(edit) == 'string') {
				let parsed = json(edit);
				let id = parsed?.id || parsed?.request?.id;
				if (type(id) == 'string' && match(id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)) {
					let rec = scanner_state.scanner_state_load(id);
					if (rec.ok) {
						let errRec = rec.state;
						errRec.status = 'error';
						errRec.phase = 'launch';
						errRec.error = 'Scanner start failed before worker launch: ' + (e?.message || e);
						errRec.recovery = { state: 'uncertain', message: errRec.error };
						errRec.finishedAt = time();
						scanner_state.scanner_state_save(errRec);
					}
				}
			}
		} catch (x) {}
		return { ok: false, error: { code: 'EINTERNAL', message: 'Scanner start failed before worker launch.' } };
	}
}

function scanner_edit_action(sub, req, tag) {
	if (tag == 'async-start') return scanner_start_async(req);
	if (!scanner_request_root_ready()) return { ok: false, error: { code: 'EINPUT', message: 'Scanner request directory is unsafe' } };
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	if (length(edit) > SCANNER_MAX_REQUEST_BYTES)
		return { ok: false, error: { code: 'EINPUT', message: 'edit exceeds the safe request size limit' } };
	let tmp = null;
	let created = popen('umask 077; mktemp /tmp/zapret2-manager/runtime/requests/scanner.XXXXXX 2>/dev/null', 'r');
	if (created) { tmp = trim(created.read('all') || ''); created.close(); }
	if (!tmp || index(tmp, SCANNER_REQUEST_ROOT) != 0
		|| !match(substr(tmp, length(SCANNER_REQUEST_ROOT)), /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)) {
		if (tmp) try { unlink(tmp); } catch (e) { }
		return { ok: false, error: { code: 'ETARGET', message: 'request temp file unavailable' } };
	}
	let wrote = null; try { wrote = writefile(tmp, edit); } catch (e) { wrote = null; }
	if (wrote == null) { try { unlink(tmp); } catch (ignore) { } return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } }; }
	let cmd = '/usr/bin/ucode ' + SCANNER_CLI + ' ' + sub + ' ' + tmp + ' 2>/dev/null | head -c ' + SCANNER_MAX_OUTPUT_BYTES;
	let p = popen(cmd, 'r');
	if (!p) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'ETARGET', message: 'Scanner CLI unavailable' } }; }
	let out = p.read('all') || '';
	p.close();
	try { unlink(tmp); } catch (e) { }
	if (length(out) >= SCANNER_MAX_OUTPUT_BYTES)
		return { ok: false, error: { code: 'EOUTPUT', message: 'Scanner response exceeds the safe output size limit' } };
	try {
		let parsed = json(out);
		return parsed != null ? parsed : { ok: false, error: { code: 'EINTERNAL', message: 'Scanner returned no response' } };
	} catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'Scanner response was malformed' } }; }
}

function scanner_start_method(req) { return scanner_edit_action('start', req, 'async-start'); }
function scanner_status_method(req) { return scanner_edit_action('status', req, 'status'); }
function scanner_results_method(req) { return scanner_edit_action('results', req, 'results'); }
function scanner_stop_method(req) { return scanner_edit_action('stop', req, 'stop'); }
function scanner_resume_method(req) { return scanner_edit_action('resume', req, 'resume'); }
function scanner_save_generated_method(req) { return scanner_edit_action('save-generated', req, 'save-generated'); }
function scanner_history_list_method(req) { return scanner_edit_action('history', req, 'history'); }
function scanner_history_get_method(req) { return scanner_edit_action('history-get', req, 'history-get'); }

function job_get_method(req) { return jobs_edit_action('get', req); }
function job_list_method(req) { return jobs_action('list'); }
function blockcheck_start_method(req) { return jobs_edit_action('start', req); }
function blockcheck_cancel_method(req) { return jobs_edit_action('cancel', req); }
function blockcheck_status_method(req) { return jobs_action('status'); }

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
	let p = popen('umask 077; mktemp /tmp/z2m-orch-req.XXXXXX 2>/dev/null', 'r');
	if (!p) return null; let out = trim(p.read('all')), rc = p.close();
	return rc == 0 && index(out, '/tmp/z2m-orch-req.') == 0 && length(out) <= 64 ? out : null;
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
	let tmp = staging_tempfile('/tmp/z2m-' + tag + '-edit.');
	if (tmp == null) return { ok: false, error: { code: 'ETARGET', message: 'private edit file unavailable' } };
	if (!writefile(tmp, edit)) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } }; }
	let cmd = '/usr/bin/ucode ' + cli + ' ' + sub + ' ' + shell_escape(tmp) + ' 2>/dev/null';
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

function block_detector_start_method(req) { return cli_edit_action(BLOCK_DETECTOR_CLI, 'start', req, 'block-detector'); }
function block_detector_status_method(req) { return cli_action(BLOCK_DETECTOR_CLI, 'status'); }
function block_detector_results_method(req) { return cli_action(BLOCK_DETECTOR_CLI, 'results'); }
function block_detector_stop_method(req) { return cli_action(BLOCK_DETECTOR_CLI, 'stop'); }

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
	if (!writefile(tmp, sprintf("%J", { args: orchestra_request_args(req) }) + '\n')) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } }; }
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
	if (!writefile(tmp, sprintf("%J", { args: orchestra_request_args(req) }) + '\n')) { try { unlink(tmp); } catch (e) { } return { ok: false, error: { code: 'EIO', message: 'request temp file could not be written' } }; }
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
	if (childRc != 0) {
		let bounded = length(body) > 2048 ? substr(body, 0, 2048) : body;
		try {
			let parsed = json(body);
			if (parsed != null && type(parsed) == 'object') {
				parsed.childExitCode = childRc;
				if (parsed.error == null) parsed.error = { code: 'ECHILD', message: 'Strategy child exited rc=' + childRc };
				else {
					parsed.error.childExitCode = childRc;
					parsed.error.childOutput = bounded;
				}
				return parsed;
			}
		} catch (e) {}
		return { ok: false, error: { code: 'ECHILD', message: 'Strategy child exited rc=' + childRc, childExitCode: childRc, childOutput: bounded } };
	}
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
	let wrote = null; try { wrote = writefile(tmp, edit); } catch (e) { wrote = null; }
	if (wrote == null) {
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
function strategy_read_input(mode, req) {
	if (mode != 'get') return {};
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > STRATEGY_MAX_REQUEST_BYTES)
		return { ok: false, error: { code: 'EINPUT', message: 'missing or oversized Strategy read request' } };
	let value = null;
	try { value = json(edit); } catch (e) { return { ok: false, error: { code: 'EINPUT', message: 'Strategy read request is malformed' } }; }
	return value != null && type(value) == 'object' && value.args != null ? value.args : value;
}
function strategy_read_action(mode, req) {
	let input = strategy_read_input(mode, req);
	if (input && input.ok == false && input.error) return input;
	try { return strategy_cli_dispatch(mode, input); }
	catch (e) { return { ok: false, error: { code: 'EINTERNAL', message: 'Strategy read dispatch failed' } }; }
}
function strategies_list_method(req) { return strategy_read_action('list', req); }
function strategies_recommendations_method(req) { return strategy_read_action('recommendations', req); }
function strategies_get_method(req) { return strategy_read_action('get', req); }
function strategies_discord_donor_method(req) { return strategy_read_action('discord_donor', req); }
function strategies_create_method(req) { return strategy_edit_action('create', req); }
function strategies_update_method(req) { return strategy_edit_action('update', req); }
function strategies_delete_method(req) { return strategy_edit_action('delete', req); }
function strategies_duplicate_method(req) { return strategy_edit_action('duplicate', req); }
function strategies_favorite_method(req) { return strategy_edit_action('favorite', req); }
function strategies_preview_method(req) { return strategy_edit_action('preview', req); }
function strategies_validate_method(req) { return strategy_edit_action('validate', req); }
function strategies_apply_method(req) { return strategy_edit_action('apply', req); }
function strategies_catalog_status_method(req) { return strategy_read_action('catalog_status', req); }
function strategies_catalog_reload_method(req) { return strategy_noarg_action('catalog_reload'); }
function strategies_catalog_refresh_start_method(req) {
  let p = popen('/usr/bin/ucode /usr/libexec/zapret2-manager/strategy-catalog-refresh-cli.uc start 2>/dev/null', 'r');
  if (!p) return { ok: false, error: { code: 'EIO', message: 'refresh worker unavailable' } };
  let out = p.read('all') || ''; p.close();
  try { let v = json(out); return v || { ok: false, error: { code: 'EIO', message: 'refresh start no output' } }; } catch(e) { return { ok: false, error: { code: 'EIO', message: 'refresh start malformed' } }; }
}
function strategies_catalog_refresh_status_method(req) {
  let p = popen('/usr/bin/ucode /usr/libexec/zapret2-manager/strategy-catalog-refresh-cli.uc status 2>/dev/null', 'r');
  if (!p) return { ok: false, error: { code: 'EIO', message: 'refresh status unavailable' } };
  let out = p.read('all') || ''; p.close();
  try { let v = json(out); return v || { ok: false, error: { code: 'EIO', message: 'refresh status no output' } }; } catch(e) { return { ok: false, error: { code: 'EIO', message: 'refresh status malformed' } }; }
}
function strategies_import_profiles_method(req) { return strategy_edit_action('import_profiles', req); }

// ---- Strategies Operations & Autocircular State (5-column state.tsv) ----------
const STRATEGIES_OPS_CLI = '/usr/libexec/zapret2-manager/strategies-ops-cli.uc';
function strategies_state_method(req) { return cli_action(STRATEGIES_OPS_CLI, 'state'); }
function strategies_catalog_update_method(req) { return cli_edit_action(STRATEGIES_OPS_CLI, 'catalog-update', req, 'strategies'); }
function strategies_state_clear_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(STRATEGIES_OPS_CLI, 'state-clear', { edit: '{}' }, 'strategies');
	return cli_edit_action(STRATEGIES_OPS_CLI, 'state-clear', req, 'strategies');
}
function strategies_state_set_method(req) { return cli_edit_action(STRATEGIES_OPS_CLI, 'state-set', req, 'strategies'); }
function strategies_state_delete_method(req) { return cli_edit_action(STRATEGIES_OPS_CLI, 'state-delete', req, 'strategies'); }
function strategies_pools_method(req) { return cli_action(STRATEGIES_OPS_CLI, 'pools'); }
function strategies_cleanup_deprecated_method(req) { return cli_action(STRATEGIES_OPS_CLI, 'cleanup-deprecated'); }
function strategies_debug_get_method(req) { return cli_action(STRATEGIES_OPS_CLI, 'debug-get'); }
function strategies_debug_set_method(req) { return cli_edit_action(STRATEGIES_OPS_CLI, 'debug-set', req, 'strategies'); }
function healthcheck_status_method(req) { return cli_action(STRATEGIES_OPS_CLI, 'health-status'); }
function healthcheck_run_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(STRATEGIES_OPS_CLI, 'health-run', { edit: '{}' }, 'strategies');
	return cli_edit_action(STRATEGIES_OPS_CLI, 'health-run', req, 'strategies');
}
function healthcheck_enable_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(STRATEGIES_OPS_CLI, 'health-enable', { edit: '{}' }, 'strategies');
	return cli_edit_action(STRATEGIES_OPS_CLI, 'health-enable', req, 'strategies');
}
function healthcheck_disable_method(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return cli_edit_action(STRATEGIES_OPS_CLI, 'health-disable', { edit: '{}' }, 'strategies');
	return cli_edit_action(STRATEGIES_OPS_CLI, 'health-disable', req, 'strategies');
}
function healthcheck_config_method(req) { return cli_edit_action(STRATEGIES_OPS_CLI, 'health-config', req, 'strategies'); }


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
function service_dns_tiktok_set_method(req) { return cli_edit_action(SERVICE_DNS_CLI, 'tiktok-set', req, 'service_dns'); }
function service_dns_tiktok_set_async_method(req) { return cli_edit_action(SERVICE_DNS_CLI, 'tiktok-set-async', req, 'service_dns_tiktok_async'); }
function service_dns_tiktok_status_method(req) { return cli_action(SERVICE_DNS_CLI, 'tiktok-status'); }
function service_dns_tiktok_check_method(req) { return cli_action(SERVICE_DNS_CLI, 'tiktok-check'); }
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
		status_fast:       { call: function (req) { return status_fast_method(req); } },
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
		assets_content:    { args: { edit: 'string' }, call: function (req) { return assets_content_method(req); } },
		assets_validate:   { args: { edit: 'string' }, call: function (req) { return assets_validate_method(req); } },
		assets_validate_content: { args: { edit: 'string' }, call: function (req) { return assets_validate_content_method(req); } },
		assets_resolve:    { args: { edit: 'string' }, call: function (req) { return assets_resolve_method(req); } },
		assets_import:     { args: { edit: 'string' }, call: function (req) { return assets_import_method(req); } },
		assets_import_url: { args: { edit: 'string' }, call: function (req) { return assets_import_url_method(req); } },
		assets_asn:        { args: { edit: 'string' }, call: function (req) { return assets_asn_method(req); } },
		assets_update:     { args: { edit: 'string' }, call: function (req) { return assets_update_method(req); } },
		assets_register_builtin: { args: { edit: 'string' }, call: function (req) { return assets_register_builtin_method(req); } },
		assets_delete:     { args: { edit: 'string' }, call: function (req) { return assets_delete_method(req); } },
		assets_references: { args: { edit: 'string' }, call: function (req) { return assets_references_method(req); } },
		resources_status: { call: function (req) { return resources_status_method(req); } },
		resources_check: { call: function (req) { return resources_check_method(req); } },
		resources_update: { args: { edit: 'string' }, call: function (req) { return resources_update_method(req); } },
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
		block_detector_start: { args: { edit: 'string' }, call: function (req) { return block_detector_start_method(req); } },
		block_detector_status: { call: function (req) { return block_detector_status_method(req); } },
		block_detector_results: { call: function (req) { return block_detector_results_method(req); } },
		block_detector_stop: { args: { edit: 'string' }, call: function (req) { return block_detector_stop_method(req); } },
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
		service_dns_tiktok_set: { args: { edit: 'string' }, call: function (req) { return service_dns_tiktok_set_method(req); } },
		service_dns_tiktok_set_async: { args: { edit: 'string' }, call: function (req) { return service_dns_tiktok_set_async_method(req); } },
		service_dns_tiktok_status: { call: function (req) { return service_dns_tiktok_status_method(req); } },
		service_dns_tiktok_check: { call: function (req) { return service_dns_tiktok_check_method(req); } },
		service_dns_rollback:  { call: function (req) { return service_dns_rollback_method(req); } },
		dns_product_get: { call: function (req) { return dns_product_get(req); } },
		dns_product_providers: { call: function (req) { return dns_product_providers(req); } },
		dns_product_status: { call: function (req) { return dns_product_status(req); } },
		dns_product_preview: { args: { edit: 'string' }, call: function (req) { return dns_product_preview(req); } },
		dns_product_validate: { args: { edit: 'string' }, call: function (req) { return dns_product_validate(req); } },
		dns_product_apply: { args: { edit: 'string' }, call: function (req) { return dns_product_apply(req); } },
		dns_product_rollback: { args: { edit: 'string' }, call: function (req) { return dns_product_rollback(req); } },
		tg_product_get: { call: function (req) { return tg_product_get(req); } },
		tg_product_catalog: { call: function (req) { return tg_product_catalog(req); } },
		tg_product_status: { call: function (req) { return tg_product_status(req); } },
		tg_product_versions: { call: function (req) { return tg_product_versions(req); } },
		tg_product_operation_status: { args: { edit: 'string' }, call: function (req) { return tg_product_operation_status_method(req); } },
		tg_product_validate: { args: { edit: 'string' }, call: function (req) { return tg_product_validate_method(req); } },
		tg_product_preview: { args: { edit: 'string' }, call: function (req) { return tg_product_preview_method(req); } },
		tg_product_apply: { args: { edit: 'string' }, call: function (req) { return tg_product_apply_method(req); } },
		tg_product_health: { args: { edit: 'string' }, call: function (req) { return tg_product_health_method(req); } },
		tg_product_check_updates: { args: { edit: 'string' }, call: function (req) { return tg_product_check_updates_method(req); } },
		tg_product_switch: { args: { edit: 'string' }, call: function (req) { return tg_product_switch_method(req); } },
		tg_product_install: { args: { edit: 'string' }, call: function (req) { return tg_product_install_method(req); } },
		tg_product_update: { args: { edit: 'string' }, call: function (req) { return tg_product_update_method(req); } },
		tg_product_remove: { args: { edit: 'string' }, call: function (req) { return tg_product_remove_method(req); } },
		tg_product_purge: { args: { edit: 'string' }, call: function (req) { return tg_product_purge_method(req); } },
		tg_product_start: { call: function (req) { return tg_product_start(req); } },
		tg_product_stop: { call: function (req) { return tg_product_stop(req); } },
		tg_product_restart: { call: function (req) { return tg_product_restart(req); } },
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
		strategies_list:   { call: function (req) { return strategies_list_method(req); } },
		strategies_recommendations: { call: function (req) { return strategies_recommendations_method(req); } },
		strategies_get:    { args: { edit: 'string' }, call: function (req) { return strategies_get_method(req); } },
		strategies_discord_donor: { call: function (req) { return strategies_discord_donor_method(req); } },
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
		strategies_catalog_refresh_start: { call: function (req) { return strategies_catalog_refresh_start_method(req); } },
		strategies_catalog_refresh_status: { call: function (req) { return strategies_catalog_refresh_status_method(req); } },
		strategies_catalog_update: { args: { edit: 'string' }, call: function (req) { return strategies_catalog_update_method(req); } },
		strategies_import_profiles: { args: { edit: 'string' }, call: function (req) { return strategies_import_profiles_method(req); } },
		strategies_state:  { call: function (req) { return strategies_state_method(req); } },
		strategies_state_clear: { args: { edit: 'string' }, call: function (req) { return strategies_state_clear_method(req); } },
		strategies_state_set: { args: { edit: 'string' }, call: function (req) { return strategies_state_set_method(req); } },
		strategies_state_delete: { args: { edit: 'string' }, call: function (req) { return strategies_state_delete_method(req); } },
		strategies_pools:  { call: function (req) { return strategies_pools_method(req); } },
		strategies_custom_create: { args: { edit: 'string' }, call: function (req) { return strategies_state_set_method(req); } },
		strategies_custom_bindings: { call: function (req) { return { ok: true, bindings: {} }; } },
		strategies_custom_remove: { args: { edit: 'string' }, call: function (req) { return strategies_state_delete_method(req); } },
		strategies_debug_get: { call: function (req) { return strategies_debug_get_method(req); } },
		strategies_debug_set: { args: { edit: 'string' }, call: function (req) { return strategies_debug_set_method(req); } },
		healthcheck_status: { call: function (req) { return healthcheck_status_method(req); } },
		healthcheck_run:   { args: { edit: 'string' }, call: function (req) { return healthcheck_run_method(req); } },
		healthcheck_enable: { args: { edit: 'string' }, call: function (req) { return healthcheck_enable_method(req); } },
		healthcheck_disable: { args: { edit: 'string' }, call: function (req) { return healthcheck_disable_method(req); } },
		healthcheck_config: { args: { edit: 'string' }, call: function (req) { return healthcheck_config_method(req); } },
		catalog_list:      { call: function (req) { return catalog_list_method(req); } },
		catalog_get:       { args: { edit: 'string' }, call: function (req) { return catalog_get_method(req); } },
		catalog_status:    { call: function (req) { return catalog_status_method(req); } },
		catalog_preview:   { args: { edit: 'string' }, call: function (req) { return catalog_preview_method(req); } },
		catalog_apply:     { args: { edit: 'string' }, call: function (req) { return catalog_apply_method(req); } },
		scanner_start:     { args: { edit: 'string' }, call: function (req) { return scanner_start_method(req); } },
		scanner_status:    { args: { edit: 'string' }, call: function (req) { return scanner_status_method(req); } },
		scanner_results:   { args: { edit: 'string' }, call: function (req) { return scanner_results_method(req); } },
		scanner_stop:      { args: { edit: 'string' }, call: function (req) { return scanner_stop_method(req); } },
		scanner_resume:    { args: { edit: 'string' }, call: function (req) { return scanner_resume_method(req); } },
		scanner_save_generated: { args: { edit: 'string' }, call: function (req) { return scanner_save_generated_method(req); } },
		scanner_history_list: { args: { edit: 'string' }, call: function (req) { return scanner_history_list_method(req); } },
		scanner_history_get: { args: { edit: 'string' }, call: function (req) { return scanner_history_get_method(req); } }
	}
};
