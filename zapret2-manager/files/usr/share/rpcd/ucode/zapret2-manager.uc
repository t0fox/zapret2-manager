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
function profiles_edit_action(sub, req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	if (type(edit) != 'string') return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string', got: type(edit) } };
	let tmp = '/tmp/z2m-profiles-edit.' + time();
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
		profiles_list:     { call: function (req) { return profiles_list_method(req); } },
		profiles_create:   { args: { edit: 'string' }, call: function (req) { return profiles_create_method(req); } },
		profiles_update:   { args: { edit: 'string' }, call: function (req) { return profiles_update_method(req); } },
		profiles_clone:    { args: { edit: 'string' }, call: function (req) { return profiles_clone_method(req); } },
		profiles_delete:   { args: { edit: 'string' }, call: function (req) { return profiles_delete_method(req); } },
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
		catalog_list:      { call: function (req) { return catalog_list_method(req); } },
		catalog_get:       { args: { edit: 'string' }, call: function (req) { return catalog_get_method(req); } },
		catalog_status:    { call: function (req) { return catalog_status_method(req); } },
		catalog_preview:   { args: { edit: 'string' }, call: function (req) { return catalog_preview_method(req); } },
		catalog_apply:     { args: { edit: 'string' }, call: function (req) { return catalog_apply_method(req); } }
	}
};
