#!/usr/bin/ucode
'use strict';
// dns-cli.uc — CLI wrapper for dns.uc (same idiom as the other *-cli.uc).
// Parametrized modes take a FILE holding the JSON args verbatim.
//
//   ucode dns-cli.uc get                → dns_get()
//   ucode dns-cli.uc set <file>         → {"entries":[...],"revision"?}
//   ucode dns-cli.uc validate <file>    → {"entries"?} (or the draft)
//   ucode dns-cli.uc preview            → dns_apply_preview()
//   ucode dns-cli.uc apply              → dns_apply_run()
//   ucode dns-cli.uc rollback           → dns_rollback()
//   ucode dns-cli.uc check <file>       → {"domain","ip"}? (or all applied)

import { readfile, popen } from 'fs';
import { dns_get, dns_set, dns_validate, dns_apply_preview, dns_apply_run, dns_rollback, dns_check } from './dns.uc';

const LOCKFILE = '/tmp/zapret2-manager/state.lock';

function have_flock() {
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	return (out && length(trim(out)) > 0);
}

function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/dns-cli.uc';
	let cmd = 'Z2M_DFLOCKED=1 flock ' + LOCKFILE + " -c 'ucode " + self + ' ' + mode;
	if (argfile != null) cmd += ' ' + argfile;
	cmd += "'";
	let p = popen(cmd, 'r');
	if (!p) return false;
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	print(out);
	return true;
}

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
	print('usage: ucode dns-cli.uc get | set <f> | validate <f> | preview | apply | rollback | check <f>\n');
	exit(1);
}

if ((mode == 'set' || mode == 'apply' || mode == 'rollback') && getenv('Z2M_DFLOCKED') == null && have_flock()) {
	if (flock_wrap(mode, ARGV[1])) exit(0);
}

if (mode == 'get') {
	print(sprintf("%J", dns_get()) + '\n');
} else if (mode == 'set') {
	print(sprintf("%J", dns_set(read_args(ARGV[1]))) + '\n');
} else if (mode == 'validate') {
	print(sprintf("%J", dns_validate(read_args(ARGV[1]))) + '\n');
} else if (mode == 'preview') {
	print(sprintf("%J", dns_apply_preview()) + '\n');
} else if (mode == 'apply') {
	print(sprintf("%J", dns_apply_run()) + '\n');
} else if (mode == 'rollback') {
	print(sprintf("%J", dns_rollback()) + '\n');
} else if (mode == 'check') {
	print(sprintf("%J", dns_check(read_args(ARGV[1]))) + '\n');
} else {
	print('usage: ucode dns-cli.uc get | set <f> | validate <f> | preview | apply | rollback | check <f>\n');
	exit(1);
}
