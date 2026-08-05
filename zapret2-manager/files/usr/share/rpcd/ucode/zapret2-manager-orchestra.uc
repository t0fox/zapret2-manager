#!/usr/bin/ucode
'use strict';

import { popen } from 'fs';

const CLI = '/usr/libexec/zapret2-manager/orchestra-cli.uc';
const MAX_OUTPUT = 262144;

function action(subcommand) {
	let command = '/usr/bin/ucode ' + CLI + ' ' + subcommand + ' 2>/dev/null | head -c ' + MAX_OUTPUT;
	let process = popen(command, 'r');
	if (!process) return { ok: false, error: { code: 'ETARGET', message: 'Orchestra read adapter is unavailable' } };
	let output = process.read('all') || '';
	process.close();
	try {
		let parsed = json(output);
		return parsed != null ? parsed : { ok: false, error: { code: 'EINTERNAL', message: 'Orchestra returned no response' } };
	} catch (e) {
		return { ok: false, error: { code: 'EINTERNAL', message: 'Orchestra response was invalid' } };
	}
}

return {
	'zapret2-manager-orchestra': {
		orchestra_catalog: { call: function (req) { return action('catalog'); } },
		orchestra_corpus_get: { call: function (req) { return action('corpus_get'); } }
	}
};
