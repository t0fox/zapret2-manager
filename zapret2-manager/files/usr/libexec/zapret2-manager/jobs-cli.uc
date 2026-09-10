#!/usr/bin/ucode
'use strict';
// jobs-cli.uc — CLI wrapper for the bounded service-health job lifecycle.
// The library is NEVER run
// directly, this file is NEVER imported).
//
//   ucode jobs-cli.uc hm-start <file>            → { ok, job }
//   ucode jobs-cli.uc hm-get                     → { ok, matrix }
//   ucode jobs-cli.uc hm-cancel <file>           → { ok, cancelling }
//   -- runner callbacks:
//   ucode jobs-cli.uc mark-running <id> <pid>
//   ucode jobs-cli.uc mark-finished <id> <rc>
//   ucode jobs-cli.uc mark-cancelled <id>
//   ucode jobs-cli.uc mark-failed <id> <reason>
//
// 'start'/'cancel' are mutating: they self-wrap under the jobs flock (the
// whole check-then-act is serialized — two concurrent starts can never both
// pass the at-most-one check).

import { readfile, popen } from 'fs';
import { health_matrix_start, health_matrix_get, hm_cancel,
	mark_running, mark_finished, mark_cancelled, mark_failed } from './jobs.uc';

const LOCKFILE = '/tmp/zapret2-manager/jobs.lock';

function have_flock() {
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	return (out && length(trim(out)) > 0);
}

function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/jobs-cli.uc';
	let cmd = 'Z2M_JFLOCKED=1 flock ' + LOCKFILE + " -c 'ucode " + self + ' ' + mode;
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
	print('usage: ucode jobs-cli.uc hm-start <f> | hm-get | hm-cancel <f> | mark-running <id> <pid> | mark-finished <id> <rc> | mark-cancelled <id> | mark-failed <id> <reason>\n');
	exit(1);
}

let bootstrap = popen('/usr/libexec/zapret2-manager/z2m-root-bootstrap runtime 2>/dev/null', 'r');
if (!bootstrap || bootstrap.close() != 0) exit(1);

if ((mode == 'hm-start' || mode == 'hm-cancel') && getenv('Z2M_JFLOCKED') == null && have_flock()) {
	if (flock_wrap(mode, ARGV[1])) exit(0);
}

if (mode == 'hm-start') {
	print(sprintf("%J", health_matrix_start(read_args(ARGV[1]))) + '\n');
} else if (mode == 'hm-get') {
	print(sprintf("%J", health_matrix_get()) + '\n');
} else if (mode == 'hm-cancel') {
	print(sprintf("%J", hm_cancel(read_args(ARGV[1]))) + '\n');
} else if (mode == 'mark-running') {
	print(sprintf("%J", mark_running(ARGV[1], +ARGV[2])) + '\n');
} else if (mode == 'mark-finished') {
	print(sprintf("%J", mark_finished(ARGV[1], +ARGV[2])) + '\n');
} else if (mode == 'mark-cancelled') {
	print(sprintf("%J", mark_cancelled(ARGV[1])) + '\n');
} else if (mode == 'mark-failed') {
	print(sprintf("%J", mark_failed(ARGV[1], ARGV[2])) + '\n');
} else {
	print('usage: ucode jobs-cli.uc hm-start <f> | hm-get | hm-cancel <f> | mark-*\n');
	exit(1);
}
