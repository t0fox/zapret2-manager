#!/usr/bin/ucode
'use strict';
// catalog-cli.uc — CLI wrapper for catalog.uc (same idiom as the other
// *-cli.uc wrappers). Parametrized modes take a FILE with the JSON args.
//
//   ucode catalog-cli.uc list              → catalog_list()
//   ucode catalog-cli.uc get <file>        → {"id"}
//   ucode catalog-cli.uc status            → catalog_status()
//   ucode catalog-cli.uc preview <file>    → {"enabled":[ids…]}
//   ucode catalog-cli.uc apply <file>      → {"enabled":[…],"revision":N,"fileSha256":"…"}
//
// preview/apply are mutating-adjacent (apply writes); apply self-wraps under
// the jobs/state flock (the whole check-then-act is serialized).

import { readfile, popen } from 'fs';
import { catalog_list, catalog_get, catalog_status, catalog_preview, catalog_apply } from './catalog.uc';

const LOCKFILE = '/tmp/zapret2-manager/state.lock';

function have_flock() {
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	return (out && length(trim(out)) > 0);
}

function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/catalog-cli.uc';
	let cmd = 'Z2M_CFLOCKED=1 flock ' + LOCKFILE + " -c 'ucode " + self + ' ' + mode + ' ' + argfile + "'";
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
	print('usage: ucode catalog-cli.uc list | get <f> | status | preview <f> | apply <f>\n');
	exit(1);
}

if (mode == 'apply' && getenv('Z2M_CFLOCKED') == null && have_flock()) {
	if (flock_wrap(mode, ARGV[1])) exit(0);
}

if (mode == 'list') {
	print(sprintf("%J", catalog_list()) + '\n');
} else if (mode == 'get') {
	print(sprintf("%J", catalog_get(read_args(ARGV[1]))) + '\n');
} else if (mode == 'status') {
	print(sprintf("%J", catalog_status()) + '\n');
} else if (mode == 'preview') {
	print(sprintf("%J", catalog_preview(read_args(ARGV[1]))) + '\n');
} else if (mode == 'apply') {
	print(sprintf("%J", catalog_apply(read_args(ARGV[1]))) + '\n');
} else {
	print('usage: ucode catalog-cli.uc list | get <f> | status | preview <f> | apply <f>\n');
	exit(1);
}
