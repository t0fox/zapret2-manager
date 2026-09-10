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
// answered by smoke.sh 01/02: `ubus call zapret2-manager status_fast` returns JSON
// and a permissioned LuCI call succeeds. If the shape is wrong the object
// does not register at all.

import { stat, writefile, unlink, readlink, popen } from 'fs';
import { strategy_cli_dispatch } from '/usr/libexec/zapret2-manager/strategy-cli.uc';
import { catalog_refresh_start, catalog_refresh_status, catalog_refresh_rebuild, catalog_refresh_source, catalog_source_set_enabled } from '/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc';
import * as strategy_sources from '/usr/libexec/zapret2-manager/strategy-sources.uc';
import { z2k_detect_status, z2k_detect_probe, z2k_detect_classify, z2k_detect_quic, z2k_detect_voice, z2k_detect_tcp16,
	z2k_detect_discovery_status, z2k_detect_discovery_control } from '/usr/libexec/zapret2-manager/z2k-detect.uc';
import { dns_product_get, dns_product_status,
	dns_product_validate, dns_product_provider_save, dns_product_provider_reset,
	dns_product_provider_delete } from '/usr/libexec/zapret2-manager/dns-product.uc';
import { tg_product_catalog, tg_product_status, tg_product_versions,
	tg_product_operation_status, tg_product_check_updates, tg_product_switch,
	tg_product_remove, tg_product_purge, tg_product_start,
	tg_product_stop, tg_product_restart } from '/usr/libexec/zapret2-manager/tg-product.uc';

const FAST_COLLECTOR = '/usr/libexec/zapret2-manager/status-fast.uc';
const SERVICE     = '/usr/libexec/zapret2-manager/service.uc';

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
function tg_product_check_updates_method(req) { return tg_edit_call(tg_product_check_updates, req); }
function tg_product_switch_method(req) { return tg_edit_call(tg_product_switch, req); }
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
// Hoist-safe alias used by the RPC command runners below.
function shell_escape(value) { return shell_escape_early(value); }

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

// Request staging always goes through `umask 077; mktemp` so a local
// unprivileged process cannot pre-create or symlink the path rpcd writes as
// root. `prefix` must end with a literal '.' and carry no shell metacharacters.
function staging_tempfile(prefix) {
	let p = popen('umask 077; mktemp ' + prefix + 'XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let path = trim(p.read('all') || ''), rc = p.close();
	return rc == 0 && index(path, prefix) == 0 && length(path) <= 64 ? path : null;
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
function assets_content_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('content', id); }
function assets_validate_content_method(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? asset_edit_action('validate-content', req, args.id) : { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } }; }
function assets_delete_method(req) { let id = asset_id(req); return id == null ? { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } } : asset_cli_action('delete', id); }
function assets_import_method(req) { return asset_edit_action('import', req); }
function assets_import_url_method(req) { return asset_edit_action('import-url', req); }
function assets_asn_method(req) { return asset_edit_action('asn', req); }
function assets_update_method(req) { let args = asset_args(req); return args && type(args.id) == 'string' ? asset_edit_action('update', req, args.id) : { ok: false, error: { code: 'EINPUT', message: 'asset id is required' } }; }
function resource_cli_action(mode, argument, secondary) {
	let command = '/usr/bin/ucode ' + RESOURCE_CLI + ' ' + mode + (argument == null ? '' : ' ' + shell_escape(argument)) + (secondary == null ? '' : ' ' + shell_escape(secondary)) + ' 2>/dev/null';
	let p = popen(command, 'r');
	if (!p) return { ok: false, error: { code: 'ETARGET', message: 'resource center runner unavailable' } };
	let out = p.read('all') || '', rc = p.close();
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: 'EINTERNAL', message: 'resource center returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'resource center response was malformed' } }; }
}
function resources_status_method(req) { return resource_cli_action('status-summary'); }
function resources_check_method(req) { return resource_cli_action('check'); }
function resource_version_arg(req) {
	let version = null;
	try { if (req && req.args && req.args.version != null) version = req.args.version; } catch (e) { }
	if (version == null) { try { if (req && req.version != null) version = req.version; } catch (e) { } }
	return type(version) == 'string' && match(version, /^([rp])-[0-9]+(\.[0-9]+)?$/) ? version : null;
}
function resource_repair_arg(req) {
	try { if (req && req.args && req.args.repair === true) return true; } catch (e) { }
	try { if (req && req.repair === true) return true; } catch (e) { }
	return false;
}
function resource_include_compare_arg(req) {
	try { if (req && req.args && (req.args.includeCompare === true || req.args.includeCompare == 'compare')) return true; } catch (e) { }
	try { if (req && (req.includeCompare === true || req.includeCompare == 'compare')) return true; } catch (e) { }
	return false;
}
function z2k_versions_method(req) { let refresh = false; try { refresh = req && req.args && req.args.refresh === true; } catch (e) { } try { if (req && req.refresh === true) refresh = true; } catch (e) { } return resource_cli_action(refresh ? 'versions-refresh' : 'versions'); }
function z2k_version_details_method(req) { let version = resource_version_arg(req); return version == null ? { ok: false, error: { code: 'EINPUT', message: 'Z2K release version is required' } } : resource_cli_action('details', version, resource_include_compare_arg(req) ? 'compare' : null); }
function z2k_prepare_version_start_method(req) { let version = resource_version_arg(req); return version == null ? { ok: false, error: { code: 'EINPUT', message: 'Z2K release version is required' } } : resource_cli_action('prepare-async', version, resource_repair_arg(req) ? 'repair' : null); }
function resource_operation_arg(req) {
	let operationId = null;
	try { if (req && req.args && req.args.operationId != null) operationId = req.args.operationId; } catch (e) { }
	if (operationId == null) { try { if (req && req.operationId != null) operationId = req.operationId; } catch (e) { } }
	return type(operationId) == 'string' ? operationId : null;
}
function resources_update_status_method(req) { let operationId = resource_operation_arg(req); return operationId == null ? { ok: false, error: { code: 'EINPUT', message: 'Z2K lifecycle operation id is required' } } : resource_cli_action('update-status', operationId); }
function z2k_prepare_version_status_method(req) { return resources_update_status_method(req); }
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
	let parsed = null;
	try { parsed = json(edit); } catch (e) { }
	let mode = parsed && parsed.bundleId == 'z2k-curated-lua' ? 'update-async' : 'update';
	let command = '/usr/bin/ucode ' + RESOURCE_CLI + ' ' + mode + ' ' + shell_escape(tmp) + ' 2>/dev/null';
	let child = popen(command, 'r');
	if (!child) { try { unlink(tmp); } catch (e) {} return { ok: false, error: { code: 'ETARGET', message: 'resource center runner unavailable' } }; }
	let out = child.read('all') || '', rc = child.close(); try { unlink(tmp); } catch (e) {}
	try { let result = json(out); return result != null ? result : { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'resource center returned no response' } }; }
	catch (e) { return { ok: false, error: { code: rc == 0 ? 'EINTERNAL' : 'ECHILD', message: 'resource center response was malformed' } }; }
}
function resources_update_method(req) { return resource_edit_action(req); }

// Legacy catalog execution is intentionally unavailable at the production RPC boundary.
// Legacy catalog execution is intentionally unavailable at the production RPC boundary.
function z2k_detect_input(req) {
	try { if (req && req.args != null) return req.args; } catch (e) { }
	return req;
}
function z2k_detect_rpc_input(req, names) {
	let input = req && req.args != null ? req.args : req;
	if (type(input) != 'object' || input == null)
		return { ok: false, error: { code: 'EINPUT', message: 'Detect request fields are invalid.' } };
	let normalized = {};
	for (let key in input) {
		if (key == 'ubus_rpc_session') continue;
		normalized[key] = input[key];
	}
	if (length(normalized) != length(names))
		return { ok: false, error: { code: 'EINPUT', message: 'Detect request fields are invalid.' } };
	for (let name in names) {
		if (!exists(normalized, name))
			return { ok: false, error: { code: 'EINPUT', message: 'Detect request fields are invalid.' } };
	}
	return { ok: true, input: normalized };
}
function z2k_detect_status_method(req) { return z2k_detect_status(); }
function z2k_detect_probe_method(req) {
	let checked = z2k_detect_rpc_input(req, ['domain', 'timeoutMs']);
	return checked.ok ? z2k_detect_probe(checked.input) : checked;
}
function z2k_detect_classify_method(req) {
	let checked = z2k_detect_rpc_input(req, ['host', 'port', 'hello', 'repeats', 'timeoutMs']);
	return checked.ok ? z2k_detect_classify(checked.input) : checked;
}
function z2k_detect_quic_method(req) {
	let checked = z2k_detect_rpc_input(req, ['domain', 'port', 'repeats', 'timeoutMs']);
	return checked.ok ? z2k_detect_quic(checked.input) : checked;
}
function z2k_detect_voice_method(req) {
	let checked = z2k_detect_rpc_input(req, ['repeats', 'timeoutMs']);
	return checked.ok ? z2k_detect_voice(checked.input) : checked;
}
function z2k_detect_tcp16_method(req) {
	let checked = z2k_detect_rpc_input(req, ['timeoutMs']);
	return checked.ok ? z2k_detect_tcp16(checked.input) : checked;
}
function z2k_detect_discovery_status_method(req) { return z2k_detect_discovery_status(); }
function z2k_detect_discovery_rpc_input(req) {
	let input = z2k_detect_input(req), nested = false;
	if (input != null && type(input) != 'object')
		return { ok: false, error: { code: 'EINPUT', message: 'discovery arguments must be an object' } };
	// A deployed rpcd bridge may expose the typed request as a second args
	// envelope. Unwrap only that exact envelope; unknown siblings stay rejected.
	try {
		if (req && req.args != null && input && input.args != null) nested = true;
	} catch (e) { }
	if (nested) {
		for (let key in input) if (key != 'args')
			return { ok: false, error: { code: 'EINPUT', message: 'Unsupported discovery control field.' } };
		input = input.args;
		if (input != null && type(input) != 'object')
			return { ok: false, error: { code: 'EINPUT', message: 'discovery arguments must be an object' } };
	}
	let normalized = {};
	for (let key in (input || {})) {
		// rpcd adds this transport-only session attribute to authenticated
		// req.args. It is not a discovery control field and must never reach
		// the business validator; every other key remains visible for EINPUT.
		if (key == 'ubus_rpc_session') continue;
		normalized[key] = input[key];
	}
	return { ok: true, input: normalized };
}
function z2k_detect_discovery_control_input(action, req) {
	let parsed = z2k_detect_discovery_rpc_input(req);
	if (!parsed || parsed.ok !== true) return parsed;
	return z2k_detect_discovery_control(action, parsed.input);
}
function z2k_detect_discovery_control_method(action, req) {
	let changed = z2k_detect_discovery_control_input(action, req);
	if (!changed || changed.ok !== true) return changed;
	let status = z2k_detect_discovery_status();
	if (!status || status.ok !== true) return status;
	status.action = action;
	return status;
}
function z2k_detect_discovery_enable_method(req) { return z2k_detect_discovery_control_method('enable', req); }
function z2k_detect_discovery_disable_method(req) { return z2k_detect_discovery_control_method('disable', req); }
function z2k_detect_discovery_restart_method(req) { return z2k_detect_discovery_control_method('restart', req); }

// ---- maintenance + backups (SLICE 5) -----------------------------------------
const BACKUP_CLI = '/usr/libexec/zapret2-manager/backup-cli.uc';
const MAINT_CLI = '/usr/libexec/zapret2-manager/maintenance-cli.uc';

function cli_action(cli, sub) {
	let cmd = '/usr/bin/ucode ' + cli + ' ' + sub + ' 2>/dev/null';
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

// ---- DNS providers + component diagnostics (Phase E) -----------------------------
const DNSPROV_CLI = '/usr/libexec/zapret2-manager/dnsprov-cli.uc';
function dnsprov_components_method(req) { return cli_action(DNSPROV_CLI, 'components'); }
function dnsprov_diagnose_method(req) { return cli_edit_action(DNSPROV_CLI, 'diagnose', req, 'dnsprov'); }
function dns_select_provider_method(req) { return cli_edit_action(DNSPROV_CLI, 'select', req, 'dnsprov'); }

// ---- TG WS Proxy adapter (Phase F: capabilities/status + functional slice) ------------
// capabilities/status stay read-only. The functional methods delegate to
// proxycfg.uc via the same CLI: validate/preview are write-free (registered in
// the READ ACL); apply/secret_rotate mutate and belong to the WRITE ACL. The
// optional package arrives only through the signed feed workflow.
const PROXY_CLI = '/usr/libexec/zapret2-manager/proxy-cli.uc';
function proxy_capabilities_method(req) { return cli_action(PROXY_CLI, 'capabilities'); }
function proxy_status_method(req) { return cli_action(PROXY_CLI, 'status'); }
function proxy_config_get_method(req) { return cli_action(PROXY_CLI, 'config_get'); }
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
function proxy_secret_rotate_method(req) { return cli_action(PROXY_CLI, 'secret_rotate'); }
function backup_restore_preview_method(req) { return cli_edit_action(BACKUP_CLI, 'preview', req, 'backup'); }
function backup_restore_method(req) { return cli_edit_action(BACKUP_CLI, 'restore', req, 'backup'); }
function backup_delete_method(req) { return cli_edit_action(BACKUP_CLI, 'delete', req, 'backup'); }

// ---- DNS (S6) ----------------------------------------------------------------
const DNS_CLI = '/usr/libexec/zapret2-manager/dns-cli.uc';
function dns_set_method(req) { return cli_edit_action(DNS_CLI, 'set', req, 'dns'); }
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

// ---- DNS global configuration (Slice 8) ----------------------------------------
const DNSGLOBAL_CLI = '/usr/libexec/zapret2-manager/dns-global-cli.uc';
function dns_global_get_method(req) { return cli_action(DNSGLOBAL_CLI, 'get'); }
function dns_global_set_method(req) { return cli_edit_action(DNSGLOBAL_CLI, 'set', req, 'dnsglobal'); }
function dns_global_apply_method(req) { return cli_action(DNSGLOBAL_CLI, 'apply'); }

// ---- Avatar Strategy API ----------------------------------------------------
// Strategy requests use a private JSON-string edit convention. The RPC layer
// chooses a fixed CLI mode; request content is carried
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
		|| mode == 'duplicate' || mode == 'favorite' || mode == 'apply';
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
				parsed.ok = false;
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
	if (mode != 'get' && mode != 'discord_donor') return {};
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) != 'string' || length(edit) > STRATEGY_MAX_REQUEST_BYTES)
		return mode == 'discord_donor' && edit == null ? {} : { ok: false, error: { code: 'EINPUT', message: 'missing or oversized Strategy read request' } };
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
function strategy_source_id(req) {
	let id = null;
	try { if (req && req.args && req.args.sourceId != null) id = req.args.sourceId; } catch (e) { }
	if (id == null) { try { if (req && req.sourceId != null) id = req.sourceId; } catch (e) { } }
	return id;
}
function strategy_source_edit_input(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (type(edit) == 'object' && edit != null) return edit;
	if (type(edit) != 'string') return null;
	try { let parsed = json(edit); return type(parsed) == 'object' && parsed != null ? parsed : null; }
	catch (e) { return null; }
}
function strategies_sources_get_method(req) { return strategy_sources.strategy_sources_get(); }
function strategies_source_refresh_method(req) {
	let id = strategy_source_id(req);
	if (id == null) return { ok: false, error: { code: 'EINPUT', message: 'sourceId is required' } };
	return catalog_refresh_source(id);
}
function strategies_source_set_enabled_method(req) {
	let input = strategy_source_edit_input(req);
	if (!input || input.sourceId == null || input.enabled == null || input.expectedRevision == null)
		return { ok: false, error: { code: 'EINPUT', message: 'sourceId, enabled, and expectedRevision are required' } };
	if (input.enabled == true) {
		let current = strategy_sources.strategy_source_current_snapshot(input.sourceId);
		if (!current || current.ok != true || current.snapshot == null)
			return { ok: false, error: { code: 'EUNAVAILABLE', message: 'Cannot enable a source without a verified LKG snapshot' } };
	}
	return catalog_source_set_enabled(input.sourceId, input.enabled, input.expectedRevision);
}
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
function strategies_pools_method(req) { return cli_action(STRATEGIES_OPS_CLI, 'pools'); }
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

// ---- per-service DNS mapping (Slice 7) -----------------------------------------
const SERVICE_DNS_CLI = '/usr/libexec/zapret2-manager/service-dns-cli.uc';
function service_dns_status_method(req)    { return cli_action(SERVICE_DNS_CLI, 'status'); }
function service_dns_set_method(req)       { return cli_edit_action(SERVICE_DNS_CLI, 'set', req, 'service_dns'); }
function service_dns_apply_method(req)     { return cli_edit_action(SERVICE_DNS_CLI, 'apply', req, 'service_dns'); }
function service_dns_apply_status_method(req) { return cli_edit_action(SERVICE_DNS_CLI, 'apply-status', req, 'service_dns'); }
function service_dns_tiktok_set_async_method(req) { return cli_edit_action(SERVICE_DNS_CLI, 'tiktok-set-async', req, 'service_dns_tiktok_async'); }
function service_dns_tiktok_status_method(req) { return cli_action(SERVICE_DNS_CLI, 'tiktok-status'); }
function service_dns_tiktok_check_method(req) { return cli_action(SERVICE_DNS_CLI, 'tiktok-check'); }
function service_dns_rollback_method(req)  { return cli_action(SERVICE_DNS_CLI, 'rollback'); }

// Signature: top-level key == ubus object name (matches ACL). Methods nested.
// Signature: top-level key == ubus object name (matches ACL). Per the rpcd
// ucode plugin contract (verified against the on-device `luci` plugin):
// each method is a DICT with a `call` field holding the function, NOT a bare
// function — a bare function does NOT register. `args` is an optional schema
// dict for request params. No `methods:` wrapper (not in the contract).
return {
	'zapret2-manager': {
		status_fast:       { call: function (req) { return status_fast_method(req); } },
		start:             { call: function (req) { return service_action('start'); } },
		stop:              { call: function (req) { return service_action('stop'); } },
		restart:           { call: function (req) { return service_action('restart'); } },
		assets_list:       { call: function (req) { return assets_list_method(req); } },
		assets_content:    { args: { edit: 'string' }, call: function (req) { return assets_content_method(req); } },
		assets_validate_content: { args: { edit: 'string' }, call: function (req) { return assets_validate_content_method(req); } },
		assets_import:     { args: { edit: 'string' }, call: function (req) { return assets_import_method(req); } },
		assets_import_url: { args: { edit: 'string' }, call: function (req) { return assets_import_url_method(req); } },
		assets_asn:        { args: { edit: 'string' }, call: function (req) { return assets_asn_method(req); } },
		assets_update:     { args: { edit: 'string' }, call: function (req) { return assets_update_method(req); } },
		assets_delete:     { args: { edit: 'string' }, call: function (req) { return assets_delete_method(req); } },
		resources_status: { call: function (req) { return resources_status_method(req); } },
		resources_check: { call: function (req) { return resources_check_method(req); } },
		resources_update_status: { args: { operationId: 'string' }, call: function (req) { return resources_update_status_method(req); } },
		resources_update: { args: { edit: 'string' }, call: function (req) { return resources_update_method(req); } },
		z2k_versions: { call: function (req) { return z2k_versions_method(req); } },
		z2k_version_details: { args: { version: 'string', includeCompare: 'string' }, call: function (req) { return z2k_version_details_method(req); } },
		z2k_prepare_version_start: { args: { version: 'string', repair: 'bool' }, call: function (req) { return z2k_prepare_version_start_method(req); } },
		z2k_prepare_version_status: { args: { operationId: 'string' }, call: function (req) { return z2k_prepare_version_status_method(req); } },




		dnsprov_components: { call: function (req) { return dnsprov_components_method(req); } },
		dnsprov_diagnose: { args: { edit: 'string' }, call: function (req) { return dnsprov_diagnose_method(req); } },
		dns_select_provider: { args: { edit: 'string' }, call: function (req) { return dns_select_provider_method(req); } },
	proxy_capabilities: { call: function (req) { return proxy_capabilities_method(req); } },
	proxy_status:      { call: function (req) { return proxy_status_method(req); } },
	proxy_config_get:  { call: function (req) { return proxy_config_get_method(req); } },
	proxy_health:      { args: { edit: 'string' }, call: function (req) { return proxy_health_method(req); } },
		proxy_link_info:   { args: { edit: 'string' }, call: function (req) { return proxy_link_info_method(req); } },
		proxy_config_validate: { args: { edit: 'string' }, call: function (req) { return proxy_config_validate_method(req); } },
		proxy_config_preview: { args: { edit: 'string' }, call: function (req) { return proxy_config_preview_method(req); } },
		proxy_config_apply: { args: { edit: 'string' }, call: function (req) { return proxy_config_apply_method(req); } },
	proxy_secret_rotate: { call: function (req) { return proxy_secret_rotate_method(req); } },
		service_dns_status:    { call: function (req) { return service_dns_status_method(req); } },
		service_dns_set:       { args: { edit: 'string' }, call: function (req) { return service_dns_set_method(req); } },
		service_dns_apply:     { args: { edit: 'string' }, call: function (req) { return service_dns_apply_method(req); } },
		service_dns_apply_status: { args: { edit: 'string' }, call: function (req) { return service_dns_apply_status_method(req); } },
		service_dns_tiktok_set_async: { args: { edit: 'string' }, call: function (req) { return service_dns_tiktok_set_async_method(req); } },
		service_dns_tiktok_status: { call: function (req) { return service_dns_tiktok_status_method(req); } },
		service_dns_tiktok_check: { call: function (req) { return service_dns_tiktok_check_method(req); } },
		service_dns_rollback:  { call: function (req) { return service_dns_rollback_method(req); } },
		dns_product_get: { call: function (req) { return dns_product_get(req); } },
		dns_product_status: { call: function (req) { return dns_product_status(req); } },
		dns_product_validate: { args: { edit: 'string' }, call: function (req) { return dns_product_validate(req); } },
		dns_product_provider_save: { args: { edit: 'string' }, call: function (req) { return dns_product_provider_save(req); } },
		dns_product_provider_reset: { args: { edit: 'string' }, call: function (req) { return dns_product_provider_reset(req); } },
		dns_product_provider_delete: { args: { edit: 'string' }, call: function (req) { return dns_product_provider_delete(req); } },
		tg_product_catalog: { call: function (req) { return tg_product_catalog(req); } },
		tg_product_status: { call: function (req) { return tg_product_status(req); } },
		tg_product_versions: { call: function (req) { return tg_product_versions(req); } },
		tg_product_operation_status: { args: { edit: 'string' }, call: function (req) { return tg_product_operation_status_method(req); } },
		tg_product_check_updates: { args: { edit: 'string' }, call: function (req) { return tg_product_check_updates_method(req); } },
		tg_product_switch: { args: { edit: 'string' }, call: function (req) { return tg_product_switch_method(req); } },
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
		dns_set:           { args: { edit: 'string' }, call: function (req) { return dns_set_method(req); } },
		dns_apply:         { args: { edit: 'string' }, call: function (req) { return dns_apply_method(req); } },
		dns_check:         { args: { edit: 'string' }, call: function (req) { return dns_check_method(req); } },
		dns_rollback:      { call: function (req) { return dns_rollback_method(req); } },
		dns_global_get:    { call: function (req) { return dns_global_get_method(req); } },
		dns_global_set:    { args: { edit: 'string' }, call: function (req) { return dns_global_set_method(req); } },
		dns_global_apply:  { call: function (req) { return dns_global_apply_method(req); } },
		strategies_list:   { call: function (req) { return strategies_list_method(req); } },
		strategies_recommendations: { call: function (req) { return strategies_recommendations_method(req); } },
		strategies_get:    { args: { edit: 'string' }, call: function (req) { return strategies_get_method(req); } },
		strategies_discord_donor: { args: { edit: 'string' }, call: function (req) { return strategies_discord_donor_method(req); } },
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
		strategies_sources_get: { call: function (req) { return strategies_sources_get_method(req); } },
		strategies_source_refresh: { args: { sourceId: 'string' }, call: function (req) { return strategies_source_refresh_method(req); } },
		strategies_source_set_enabled: { args: { edit: 'string' }, call: function (req) { return strategies_source_set_enabled_method(req); } },
		strategies_catalog_update: { args: { edit: 'string' }, call: function (req) { return strategies_catalog_update_method(req); } },
		strategies_state:  { call: function (req) { return strategies_state_method(req); } },
		strategies_state_clear: { args: { edit: 'string' }, call: function (req) { return strategies_state_clear_method(req); } },
		strategies_state_set: { args: { edit: 'string' }, call: function (req) { return strategies_state_set_method(req); } },
		strategies_pools:  { call: function (req) { return strategies_pools_method(req); } },
		healthcheck_status: { call: function (req) { return healthcheck_status_method(req); } },
		healthcheck_run:   { args: { edit: 'string' }, call: function (req) { return healthcheck_run_method(req); } },
		healthcheck_enable: { args: { edit: 'string' }, call: function (req) { return healthcheck_enable_method(req); } },
		healthcheck_disable: { args: { edit: 'string' }, call: function (req) { return healthcheck_disable_method(req); } },
		healthcheck_config: { args: { edit: 'string' }, call: function (req) { return healthcheck_config_method(req); } },
		catalog_list:      { call: function (req) { return catalog_list_method(req); } },
		z2k_detect_status: { call: function (req) { return z2k_detect_status_method(req); } },
		z2k_detect_discovery_status: { call: function(req) { return z2k_detect_discovery_status_method(req); } },
		z2k_detect_discovery_enable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_enable_method(req); } },
		z2k_detect_discovery_disable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_disable_method(req); } },
		z2k_detect_discovery_restart: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_restart_method(req); } },
		// rpcd infers integer argument types from integer exemplar values, not the
		// string "integer". Range and cross-field validation remains below in Detect.
		z2k_detect_probe: { args: { domain: 'string', timeoutMs: 1 }, call: function (req) { return z2k_detect_probe_method(req); } },
		z2k_detect_classify: { args: { host: 'string', port: 443, hello: 'string', repeats: 1, timeoutMs: 1 }, call: function (req) { return z2k_detect_classify_method(req); } },
		z2k_detect_quic: { args: { domain: 'string', port: 443, repeats: 1, timeoutMs: 1 }, call: function (req) { return z2k_detect_quic_method(req); } },
		z2k_detect_voice: { args: { repeats: 1, timeoutMs: 1 }, call: function (req) { return z2k_detect_voice_method(req); } },
		z2k_detect_tcp16: { args: { timeoutMs: 1 }, call: function (req) { return z2k_detect_tcp16_method(req); } }
	}
};
