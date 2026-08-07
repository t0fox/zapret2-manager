#!/usr/bin/ucode
'use strict';
// CLI boundary for the unified domain hub adapter.

import { readfile, popen } from 'fs';
import { domain_hub_get, domain_hub_preview, domain_hub_apply } from './domain-hub.uc';

const LOCKFILE = '/tmp/zapret2-manager/state.lock';

function have_flock() {
	let process = popen('command -v flock 2>/dev/null', 'r');
	let output = process ? process.read('all') : '';
	if (process) process.close();
	return output && length(trim(output)) > 0;
}

function flock_apply(file) {
	let command = "Z2M_DOMAIN_HUB_LOCKED=1 flock " + LOCKFILE +
		" -c '/usr/bin/ucode /usr/libexec/zapret2-manager/domain-hub-cli.uc apply " + file + "'";
	let process = popen(command, 'r');
	if (!process) return false;
	let output = process.read('all') || '';
	process.close();
	print(output);
	return true;
}

function edit_string(file) {
	if (!file) return null;
	let value = readfile(file);
	return value == null ? null : value;
}

let mode = ARGV[0];
if (mode == 'get') {
	print(sprintf('%J', domain_hub_get()) + '\n');
} else if (mode == 'preview') {
	let edit = edit_string(ARGV[1]);
	if (edit == null) {
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'missing edit file' } }) + '\n');
		exit(1);
	}
	print(sprintf('%J', domain_hub_preview(edit)) + '\n');
} else if (mode == 'apply') {
	if (getenv('Z2M_DOMAIN_HUB_LOCKED') == null && have_flock()) {
		if (flock_apply(ARGV[1])) exit(0);
	}
	let edit = edit_string(ARGV[1]);
	if (edit == null) {
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'missing edit file' } }) + '\n');
		exit(1);
	}
	print(sprintf('%J', domain_hub_apply(edit)) + '\n');
} else {
	print('usage: domain-hub-cli.uc get | preview <edit-file> | apply <edit-file>\n');
	exit(1);
}
