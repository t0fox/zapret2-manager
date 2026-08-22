#!/usr/bin/ucode
'use strict';

import { writefile, unlink, popen } from 'fs';

const CLI = '/usr/libexec/zapret2-manager/proxy-provider-cli.uc';
const MAX_OUTPUT = 131072;
const TMP_PREFIX = '/tmp/z2m-proxy-provider-edit.';

// Staging goes through `umask 077; mktemp` so a local unprivileged process
// cannot pre-create or symlink the request path we write as root.
function tempfile() {
	let p = popen('umask 077; mktemp ' + TMP_PREFIX + 'XXXXXX 2>/dev/null', 'r');
	if (!p) return null;
	let file = trim(p.read('all') || ''), rc = p.close();
	return rc == 0 && index(file, TMP_PREFIX) == 0 && length(file) <= 64 ? file : null;
}

function request_edit(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	return edit;
}

function parse_output(output) {
	try {
		let value = json(output || '');
		return value != null ? value : { ok: false, error: { code: 'EINTERNAL', message: 'provider manager returned no response' } };
	} catch (e) {
		return { ok: false, error: { code: 'EINTERNAL', message: 'provider manager response was invalid' } };
	}
}

function action(mode, edit) {
	let file = null;
	let command = '/usr/bin/ucode ' + CLI + ' ' + mode;
	if (edit != null) {
		if (type(edit) != 'string')
			return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string' }, got: type(edit) };
		file = tempfile();
		if (file == null)
			return { ok: false, error: { code: 'EINTERNAL', message: 'failed to create a private edit file' } };
		if (!writefile(file, edit)) {
			try { unlink(file); } catch (e) { }
			return { ok: false, error: { code: 'EINTERNAL', message: 'failed to stage edit' } };
		}
		command += ' ' + file;
	}
	let process = popen(command + ' 2>/dev/null | head -c ' + MAX_OUTPUT, 'r');
	if (!process) {
		if (file != null) try { unlink(file); } catch (e) { }
		return { ok: false, error: { code: 'ETARGET', message: 'provider manager is unavailable' } };
	}
	let output = process.read('all') || '';
	process.close();
	if (file != null) try { unlink(file); } catch (e) { }
	return parse_output(output);
}

function edit_action(mode, req) {
	let edit = request_edit(req);
	if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
	return action(mode, edit);
}

return {
	'zapret2-manager-proxy-provider': {
		proxy_provider_catalog: { call: function (req) { return action('catalog', null); } },
		proxy_provider_status: { call: function (req) { return action('status', null); } },
		proxy_provider_preflight: { call: function (req) { return action('preflight', null); } },
		proxy_provider_check_updates: { args: { edit: 'string' }, call: function (req) { return edit_action('check', req); } },
		proxy_provider_install: { args: { edit: 'string' }, call: function (req) { return edit_action('install', req); } },
		proxy_provider_remove: { args: { edit: 'string' }, call: function (req) { return edit_action('remove', req); } },
		proxy_provider_purge: { args: { edit: 'string' }, call: function (req) { return edit_action('purge', req); } }
	}
};
