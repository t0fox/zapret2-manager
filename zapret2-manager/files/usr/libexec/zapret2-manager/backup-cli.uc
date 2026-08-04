#!/usr/bin/ucode
'use strict';
// CLI wrapper for backup.uc. Restore is bound to an exact preview identity
// and current-state revision, then verified by rereading every archive file.

import { readfile, popen } from 'fs';
import { backup_scope, restore_scope, list_backups, preview_restore, delete_backup } from './backup.uc';

const LOCKFILE = '/tmp/zapret2-manager/backup.lock';
const SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];

function have_flock() {
	let process = popen('command -v flock 2>/dev/null', 'r');
	let output = process ? process.read('all') : '';
	if (process) process.close();
	return output && length(trim(output)) > 0;
}
function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/backup-cli.uc';
	let command = 'Z2M_BFLOCKED=1 flock ' + LOCKFILE + " -c 'ucode " + self + ' ' + mode + ' ' + argfile + "'";
	let process = popen(command, 'r');
	if (!process) return false;
	let output = process.read('all') || '';
	process.close();
	print(output);
	return true;
}
function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	try { return json(raw); } catch (e) { return null; }
}
function archive_path(scope, takenAt) {
	return type(takenAt) == 'int'
		? '/etc/zapret2-manager/backups/' + scope + '/history/' + takenAt + '/archive'
		: '/etc/zapret2-manager/backups/' + scope + '/current';
}
function preview_revision(preview) {
	let revision = '';
	let diffs = type(preview.diffs) == 'array' ? preview.diffs : [];
	for (let i = 0; i < length(diffs); i++) {
		let row = diffs[i];
		revision += (row.path || '') + '=' + (row.currentSha256 || 'missing') + ';';
	}
	return revision;
}
function preview_identity(preview) {
	let archive = type(preview.archive) == 'object' && preview.archive != null ? preview.archive : {};
	return (preview.scope || '') + ':' + (preview.takenAt || 0) + ':' + (archive.manifestSha256 || archive.checksum || 'legacy');
}
function preview_with_identity(scope, takenAt) {
	let preview = preview_restore(scope, takenAt);
	if (!preview || preview.ok !== true) return preview;
	preview.previewId = preview_identity(preview);
	preview.revision = preview_revision(preview);
	return preview;
}
function restored_verified(preview) {
	if (!preview || preview.ok !== true || type(preview.diffs) != 'array') return false;
	for (let i = 0; i < length(preview.diffs); i++)
		if (preview.diffs[i].changed === true) return false;
	return true;
}

let mode = ARGV[0];
if (mode == null) {
	print('usage: ucode backup-cli.uc list | create <f> | preview <f> | restore <f> | delete <f>\n');
	exit(1);
}
if ((mode == 'create' || mode == 'restore' || mode == 'delete') && getenv('Z2M_BFLOCKED') == null && have_flock()) {
	if (flock_wrap(mode, ARGV[1])) exit(0);
}

if (mode == 'list') {
	print(sprintf('%J', list_backups()) + '\n');
} else if (mode == 'create') {
	let args = read_args(ARGV[1]);
	let scope = type(args) == 'object' && args != null ? args.scope : null;
	if (scope == 'all') {
		let results = {};
		for (let i = 0; i < length(SCOPES); i++) results[SCOPES[i]] = backup_scope(SCOPES[i], time());
		print(sprintf('%J', { ok: true, scopes: results }) + '\n');
	} else if (type(scope) == 'string') {
		print(sprintf('%J', backup_scope(scope, time())) + '\n');
	} else {
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'missing scope (or "all")' } }) + '\n');
	}
} else if (mode == 'preview') {
	let args = read_args(ARGV[1]);
	if (type(args) != 'object' || args == null || type(args.scope) != 'string')
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'missing scope' } }) + '\n');
	else
		print(sprintf('%J', preview_with_identity(args.scope, type(args.takenAt) == 'int' ? args.takenAt : null)) + '\n');
} else if (mode == 'restore') {
	let args = read_args(ARGV[1]);
	if (type(args) != 'object' || args == null || type(args.scope) != 'string') {
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'missing scope' } }) + '\n');
	} else if (type(args.previewId) != 'string' || type(args.expectedRevision) != 'string') {
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'restore requires previewId and expectedRevision' } }) + '\n');
	} else {
		let takenAt = type(args.takenAt) == 'int' ? args.takenAt : null;
		let fresh = preview_with_identity(args.scope, takenAt);
		if (!fresh || fresh.ok !== true) {
			print(sprintf('%J', fresh) + '\n');
		} else if (fresh.previewId != args.previewId || fresh.revision != args.expectedRevision) {
			print(sprintf('%J', {
				ok: false,
				error: { code: 'ESTALE', message: 'backup preview identity or current revision changed' },
				expected: { previewId: args.previewId, revision: args.expectedRevision },
				actual: { previewId: fresh.previewId, revision: fresh.revision }
			}) + '\n');
		} else if (fresh.restorable !== true) {
			print(sprintf('%J', { ok: false, error: { code: 'EBLOCKED', message: 'backup preview is not restorable' }, preview: fresh }) + '\n');
		} else {
			let raw = readfile(archive_path(args.scope, takenAt));
			let archive = null;
			if (raw) { try { archive = json(raw); } catch (e) { archive = null; } }
			if (archive == null) {
				print(sprintf('%J', { ok: false, error: { code: 'ESTATE', message: 'archive disappeared after preview' } }) + '\n');
			} else {
				let result = restore_scope(args.scope, archive, {});
				if (!result || result.ok !== true) {
					print(sprintf('%J', result) + '\n');
				} else {
					let reread = preview_with_identity(args.scope, takenAt);
					let verified = restored_verified(reread);
					result.verified = verified;
					result.reread = { revision: reread && reread.revision, previewId: reread && reread.previewId };
					if (!verified) {
						result.ok = false;
						result.error = { code: 'EVERIFY', message: 'restored files did not match the selected archive' };
					}
					print(sprintf('%J', result) + '\n');
				}
			}
		}
	}
} else if (mode == 'delete') {
	let args = read_args(ARGV[1]);
	if (type(args) != 'object' || args == null || type(args.scope) != 'string')
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'missing scope' } }) + '\n');
	else
		print(sprintf('%J', delete_backup(args.scope, type(args.takenAt) == 'int' ? args.takenAt : null)) + '\n');
} else {
	print('usage: ucode backup-cli.uc list | create <f> | preview <f> | restore <f> | delete <f>\n');
	exit(1);
}
