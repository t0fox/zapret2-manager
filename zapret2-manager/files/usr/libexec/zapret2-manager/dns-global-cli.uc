#!/usr/bin/ucode
'use strict';
// dns-global-cli.uc — CLI wrapper for dns-global.uc

import { readfile, popen } from 'fs';
import { dns_global_get, dns_global_set, dns_global_preview, dns_global_apply, dns_global_rollback } from './dns-global.uc';

function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	let obj = null;
	try { obj = json(raw); } catch (e) { return null; }
	return obj;
}

let mode = ARGV[0];
if (mode == null) {
	printf('usage: ucode dns-global-cli.uc get | set <f> | preview | apply | rollback\n');
	exit(1);
}

let result = null;
if (mode == 'get') result = dns_global_get();
else if (mode == 'set') result = dns_global_set(read_args(ARGV[1]));
else if (mode == 'preview') result = dns_global_preview();
else if (mode == 'apply') result = dns_global_apply();
else if (mode == 'rollback') result = dns_global_rollback();
else result = { ok: false, error: { code: 'EINPUT', message: 'unknown command: ' + mode } };

printf('%J\n', result);
