#!/usr/bin/ucode
'use strict';
// Focused rpcd adapter for the domain hub transaction owner.
// It delegates to domain-hub-cli.uc; it is not a second catalog/list writer.

import { writefile, unlink, popen } from 'fs';

const CLI = '/usr/libexec/zapret2-manager/domain-hub-cli.uc';
const MAX_OUTPUT = 524288;

function request_edit(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	return edit;
}

function parse_output(output) {
	try {
		let value = json(output || '');
		return value != null ? value : { ok: false, error: { code: 'EINTERNAL', message: 'domain hub returned no response' } };
	} catch (e) {
		return { ok: false, error: { code: 'EINTERNAL', message: 'domain hub response was invalid' } };
	}
}

function action(mode, edit) {
	let file = null;
	let command = '/usr/bin/ucode ' + CLI + ' ' + mode;
	if (edit != null) {
		if (type(edit) != 'string')
			return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string' }, got: type(edit) };
		file = '/tmp/z2m-domain-hub-edit.' + time() + '.' + length(edit);
		if (!writefile(file, edit))
			return { ok: false, error: { code: 'EINTERNAL', message: 'failed to stage edit' } };
		command += ' ' + file;
	}
	let process = popen(command + ' 2>/dev/null | head -c ' + MAX_OUTPUT, 'r');
	if (!process) {
		if (file != null) try { unlink(file); } catch (e) { }
		return { ok: false, error: { code: 'ETARGET', message: 'domain hub adapter is unavailable' } };
	}
	let output = process.read('all') || '';
	process.close();
	if (file != null) try { unlink(file); } catch (e) { }
	return parse_output(output);
}

return {
	'zapret2-manager-domain-hub': {
		domain_hub_get: { call: function (req) { return action('get', null); } },
		domain_hub_preview: { args: { edit: 'string' }, call: function (req) {
			let edit = request_edit(req);
			if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
			return action('preview', edit);
		} },
		domain_hub_apply: { args: { edit: 'string' }, call: function (req) {
			let edit = request_edit(req);
			if (edit == null) return { ok: false, error: { code: 'EINPUT', message: 'missing edit param' } };
			return action('apply', edit);
		} }
	}
};
