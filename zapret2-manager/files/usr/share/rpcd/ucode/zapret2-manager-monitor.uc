#!/usr/bin/ucode
'use strict';
// Read-only rpcd adapter for bounded Monitoring evidence.

import { writefile, unlink, popen } from 'fs';

const CLI = '/usr/libexec/zapret2-manager/monitor-cli.uc';
const MAX_OUTPUT = 524288;

function request_edit(req) {
	let edit = null;
	try { if (req && req.args && req.args.edit != null) edit = req.args.edit; } catch (e) { }
	if (edit == null) { try { if (req && req.edit != null) edit = req.edit; } catch (e) { } }
	return edit == null ? '{}' : edit;
}

function snapshot(req) {
	let edit = request_edit(req);
	if (type(edit) != 'string')
		return { ok: false, error: { code: 'EINPUT', message: 'edit must be a JSON string' } };
	let file = '/tmp/z2m-monitor-edit.' + time() + '.' + length(edit);
	if (!writefile(file, edit))
		return { ok: false, error: { code: 'EINTERNAL', message: 'failed to stage monitor edit' } };
	let process = popen('/usr/bin/ucode ' + CLI + ' snapshot ' + file + ' 2>/dev/null | head -c ' + MAX_OUTPUT, 'r');
	if (!process) {
		try { unlink(file); } catch (e) { }
		return { ok: false, error: { code: 'ETARGET', message: 'Monitoring adapter is unavailable' } };
	}
	let output = process.read('all') || '';
	process.close();
	try { unlink(file); } catch (e) { }
	try {
		let value = json(output);
		return value != null ? value : { ok: false, error: { code: 'EINTERNAL', message: 'Monitoring returned no response' } };
	} catch (e) {
		return { ok: false, error: { code: 'EINTERNAL', message: 'Monitoring response was invalid' } };
	}
}

return {
	'zapret2-manager-monitor': {
		monitor_snapshot: { call: snapshot }
	}
};
