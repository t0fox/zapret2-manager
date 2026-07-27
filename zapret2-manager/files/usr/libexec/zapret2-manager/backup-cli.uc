#!/usr/bin/ucode
'use strict';
// jobs of backup-cli.uc — CLI wrapper for backup.uc (Slice 5 RPC surface).
// Same idiom as lists-cli.uc / profiles-cli.uc / jobs-cli.uc: backup.uc is a
// pure library; this script-mode wrapper dispatches ARGV and is NEVER
// imported. Parametrized modes take a FILE holding the JSON args verbatim
// (the rpcd plugin writes the frontend's `edit` string as-is).
//
//   ucode backup-cli.uc list                          → list_backups()
//   ucode backup-cli.uc create <file>                 → {"scope":"engineConfig"|"all"}
//   ucode backup-cli.uc preview <file>                → {"scope","takenAt"?}
//   ucode backup-cli.uc restore <file>                → {"scope","takenAt"?}
//   ucode backup-cli.uc delete <file>                 → {"scope","takenAt"}

import { readfile, popen } from 'fs';
import { backup_scope, restore_scope, list_backups, preview_restore, delete_backup } from './backup.uc';

const LOCKFILE = '/tmp/zapret2-manager/backup.lock';

function have_flock() {
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	return (out && length(trim(out)) > 0);
}

function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/backup-cli.uc';
	let cmd = 'Z2M_BFLOCKED=1 flock ' + LOCKFILE + " -c 'ucode " + self + ' ' + mode + ' ' + argfile + "'";
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

const SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];

let mode = ARGV[0];

if (mode == null) {
	print('usage: ucode backup-cli.uc list | create <f> | preview <f> | restore <f> | delete <f>\n');
	exit(1);
}

// create/restore/delete mutate — serialize under the backup flock
if ((mode == 'create' || mode == 'restore' || mode == 'delete') && getenv('Z2M_BFLOCKED') == null && have_flock()) {
	if (flock_wrap(mode, ARGV[1])) exit(0);
}

if (mode == 'list') {
	print(sprintf("%J", list_backups()) + '\n');
} else if (mode == 'create') {
	let a = read_args(ARGV[1]);
	let scope = (type(a) == 'object' && a != null) ? a.scope : null;
	if (scope == 'all') {
		let results = {};
		for (let i = 0; i < length(SCOPES); i++) results[SCOPES[i]] = backup_scope(SCOPES[i], time());
		print(sprintf("%J", { ok: true, scopes: results }) + '\n');
	} else if (type(scope) == 'string') {
		print(sprintf("%J", backup_scope(scope, time())) + '\n');
	} else {
		print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'missing scope (or "all")' } }) + '\n');
	}
} else if (mode == 'preview') {
	let a = read_args(ARGV[1]);
	if (type(a) != 'object' || a == null || type(a.scope) != 'string') {
		print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'missing scope' } }) + '\n');
	} else {
		print(sprintf("%J", preview_restore(a.scope, (type(a.takenAt) == 'int') ? a.takenAt : null)) + '\n');
	}
} else if (mode == 'restore') {
	let a = read_args(ARGV[1]);
	if (type(a) != 'object' || a == null || type(a.scope) != 'string') {
		print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'missing scope' } }) + '\n');
	} else {
		// load the archive (history entry or current) and restore through
		// restore_scope — pre-restore snapshot, allowlist, manifest,
		// version gate, sanctioned writers all inside
		let arc = null;
		let raw = readfile('/etc/zapret2-manager/backups/' + a.scope + '/current');
		if (type(a.takenAt) == 'int')
			raw = readfile('/etc/zapret2-manager/backups/' + a.scope + '/history/' + a.takenAt + '/archive');
		if (raw) { try { arc = json(raw); } catch (e) { arc = null; } }
		if (arc == null) {
			print(sprintf("%J", { ok: false, error: { code: 'ESTATE', message: 'no archive for ' + a.scope } }) + '\n');
		} else {
			print(sprintf("%J", restore_scope(a.scope, arc, {})) + '\n');
		}
	}
} else if (mode == 'delete') {
	let a = read_args(ARGV[1]);
	if (type(a) != 'object' || a == null || type(a.scope) != 'string') {
		print(sprintf("%J", { ok: false, error: { code: 'EINPUT', message: 'missing scope' } }) + '\n');
	} else {
		print(sprintf("%J", delete_backup(a.scope, (type(a.takenAt) == 'int') ? a.takenAt : null)) + '\n');
	}
} else {
	print('usage: ucode backup-cli.uc list | create <f> | preview <f> | restore <f> | delete <f>\n');
	exit(1);
}
