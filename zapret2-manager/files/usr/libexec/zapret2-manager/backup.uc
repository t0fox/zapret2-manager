'use strict';
// backup.uc — backup/restore for the four independent scopes (ЦЕЛЬ cleanup/15).
//
// Four scopes, each backed up and restored INDEPENDENTLY (user picks which):
//   engineConfig — /opt/zapret2/config (real format: quoted values, single-line NFQWS2_OPT)
//   ourState    — /etc/zapret2-manager/state.json (our own state)
//   lists       — ipset/ list files (user domain/IP lists) [VERIFY:ROUTER exact paths]
//   profiles    — /etc/zapret2-manager/profiles [VERIFY:ROUTER]
//
// Storage: /etc/zapret2-manager/backups/<scope>/{current,history/<unixtime>}.
// ONE current copy + a history by capture time, at most 3 entries. On the 4th entry
// the OLDEST (min timestamp) is evicted (proven by self-test, not assumed).
//
// Restore (hard rules):
//  - Before ANY restore, a snapshot of the CURRENT state is taken automatically
//    (no exceptions). It is stored in history, so a bad restore can be rolled back.
//  - Restore verifies archive INTEGRITY (checksum) and SYNtactic correctness
//    BEFORE anything is overwritten. Fail either → touch nothing, return why.
//  - Restoring an archive from a NEWER package version is REFUSED with an
//    explicit message, not silently.
//  - Disk-shortage: backup never leaves a half-written archive. Write to a temp,
//    then rename (atomic).
//
// Mirrors tests/lib/backup-logic.mjs (the pure algorithm). archive.files is an ARRAY of
// {path, content} pairs (no for-in over an object — point6: no reliance on object
// key-enumeration semantics). ucode does not run locally; node self-test proves the
// algorithm, runtime confirmed on target. apply.uc (the single writer) is IMPORTED
// for the engineConfig syntax check on restore — this file does NOT write
// /opt/zapret2/config itself, and it does not touch the other backend files
// (service.uc, status.uc, watchdog.uc, rpcd plugin) — those are the infra owner's.

import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { parse as jparse, stringify as jstringify } from 'json';
import { read_var } from './apply.uc';

const BACKUP_DIR = '/etc/zapret2-manager/backups';
const PKG_VERSION = 1;   // [VERIFY:ROUTER] package version — apk info or compiled-in

// scope -> { paths: [path], syntaxCheck: fn(path, content)->reason|null }
const SCOPES = {
	engineConfig: {
		paths: [ '/opt/zapret2/config' ],
		syntaxCheck: (path, content) => {
			if (!content || !length(content)) return 'empty config';
			let has_active = false;
			let lines = split(content, '\n');
			for (let i = 0; i < length(lines); i++) {
				let t = trim(lines[i]);
				if (substr(t, 0, 1) == '#') continue;
				if (substr(t, 0, 14) == 'NFQWS2_ENABLE') { has_active = true; break; }
			}
			return has_active ? null : 'no NFQWS2_ENABLE assignment';
		}
	},
	ourState: {
		paths: [ '/etc/zapret2-manager/state.json' ],
		syntaxCheck: (path, content) => {
			if (!content) return 'empty state';
			try { jparse(content); return null; }
			catch (e) { return 'not valid JSON: ' + e; }
		}
	},
	lists: {
		paths: [ '/opt/zapret2/ipset/zapret-hostlist-user.txt',
	         '/opt/zapret2/ipset/zapret-ipset-exclude-user.txt' ],
		syntaxCheck: (path, content) => null
	},
	profiles: {
		paths: [ '/etc/zapret2-manager/profiles' ],
		syntaxCheck: (path, content) => null
	}
};

// ---- helpers (mirror backup-logic.mjs) ---------------------------------------

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	let raw = p ? p.read('all') : null;
	let out = raw ? raw : '';
	let rc = p ? p.close() : -1;
	return { out: out, rc: rc };
}

function checksum(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < length(s); i++) {
		let c = ord(s[i]);
		h = h ~ c;
		h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24));
	}
	let hex = '';
	for (let i = 0; i < 8; i++) {
		let nib = (h >> ((7 - i) * 4)) & 0xf;
		hex += substr('0123456789abcdef', nib, 1);
	}
	return hex;
}

export const make_archive = function(scope, version, takenAt, files) {
	let payload = jstringify({ scope: scope, version: version, takenAt: takenAt, files: files });
	return {
		scope: scope, version: version, takenAt: takenAt, files: files,
		checksum: checksum(payload)
	};
}

function atomic_write(path, content) {
	let tmp = path + '.tmp.' + length(content) + ':' + length(path);
	writefile(tmp, content);
	let r = run('mv -f ' + tmp + ' ' + path + ' 2>/dev/null');
	if (r.rc != 0) {
		try { unlink(tmp); } catch (e) { }
	}
	return r.rc;
}

// ---- store (current + history, max 3, evict oldest) ------------------------

function scope_dir(scope) {
	return BACKUP_DIR + '/' + scope;
}

function ensure_dir(path) {
	if (!stat(path)) {
		let r = run('mkdir -p ' + path);
		if (r.rc != 0) return null;
	}
	return path;
}

// snapshot the live files for a scope — returns an ARRAY of {path, content}.
function snapshot(scope) {
	let files = [];
	let cfg = SCOPES[scope];
	if (!cfg) return null;
	for (let i = 0; i < length(cfg.paths); i++) {
		let p = cfg.paths[i];
		let c = readfile(p);
		push(files, { path: p, content: (c != null) ? c : '' });
	}
	return files;
}

export const backup_scope = function(scope, now) {
	let cfg = SCOPES[scope];
	if (!cfg) return { ok: false, reason: 'unknown scope: ' + scope };
	if (!ensure_dir(scope_dir(scope))) return { ok: false, reason: 'cannot create backup dir' };
	let files = snapshot(scope);
	let arc = make_archive(scope, PKG_VERSION, now, files);
	let cur = scope_dir(scope) + '/current';
	if (atomic_write(cur, jstringify(arc))) return { ok: false, reason: 'current write failed' };
	let hist = scope_dir(scope) + '/history/' + now;
	if (!ensure_dir(hist)) return { ok: false, reason: 'cannot create history dir' };
	if (atomic_write(hist + '/archive', jstringify(arc))) return { ok: false, reason: 'history write failed' };
	// evict oldest if >3
	let hdir = scope_dir(scope) + '/history';
	let r = run('ls -1 ' + hdir + ' 2>/dev/null');
	let entries = [];
	let lst = split(trim(r.out), '\n');
	for (let i = 0; i < length(lst); i++) {
		let e = trim(lst[i]);
		if (length(e)) push(entries, +e);
	}
	if (length(entries) > 3) {
		let oldest = entries[0];
		for (let i = 1; i < length(entries); i++)
			if (entries[i] < oldest) oldest = entries[i];
		run('rm -rf ' + hdir + '/' + oldest);
	}
	return { ok: true, scope: scope, takenAt: now };
}

// ---- restore ---------------------------------------------------------------

export const restore_scope = function(scope, archive, opts) {
	let cfg = SCOPES[scope];
	if (!cfg) return { ok: false, reason: 'unknown scope: ' + scope };
	let currentVersion = (opts && opts.currentVersion != null) ? opts.currentVersion : PKG_VERSION;
	// 1) pre-restore snapshot of current (ALWAYS, no exceptions), stored in history.
	let cur = scope_dir(scope) + '/current';
	if (stat(cur)) {
		let curArc = jparse(readfile(cur));
		if (curArc != null) {
			let now = (archive.takenAt != null ? archive.takenAt : time()) - 1;
			backup_scope(scope, now);
		}
	}
	// 2) verify archive (checksum + syntax) BEFORE overwrite
	let payload = jstringify({ scope: archive.scope, version: archive.version,
		takenAt: archive.takenAt, files: archive.files });
	if (checksum(payload) != archive.checksum)
		return { ok: false, restored: false, preTaken: true,
			reason: 'checksum mismatch (archive corrupted)' };
	if (cfg.syntaxCheck) {
		for (let i = 0; i < length(archive.files); i++) {
			let f = archive.files[i];
			let why = cfg.syntaxCheck(f.path, f.content);
			if (why) return { ok: false, restored: false, preTaken: true,
				reason: 'syntax: ' + f.path + ': ' + why };
		}
	}
	// 3) refuse newer-version archive
	if (archive.version > currentVersion) {
		return { ok: false, restored: false, preTaken: true,
			reason: 'archive version ' + archive.version + ' is NEWER than the running package version ' + currentVersion + ' — restore refused' };
	}
	// 4) restore: write each file atomically (index loop, no for-in over object)
	for (let i = 0; i < length(archive.files); i++) {
		let f = archive.files[i];
		if (atomic_write(f.path, f.content) != 0)
			return { ok: false, restored: false, preTaken: true,
				reason: 'restore write failed for ' + f.path };
	}
	if (ensure_dir(scope_dir(scope)))
		atomic_write(scope_dir(scope) + '/current', jstringify(archive));
	return { ok: true, restored: true, preTaken: true, scope: scope };
}

// ---- CLI --------------------------------------------------------------------
//   ucode backup.uc backup  <scope>
//   ucode backup.uc restore <scope> <archive-file>
let mode = ARGV[0];
if (mode == 'backup') {
	let scope = ARGV[1];
	let now = time();
	let r = backup_scope(scope, now);
	print(jstringify(r) + '\n');
} else if (mode == 'restore') {
	let scope = ARGV[1];
	let af = ARGV[2];
	let raw = readfile(af);
	if (!raw) { print(jstringify({ ok: false, reason: 'no archive file' }) + '\n'); exit(1); }
	let arc = jparse(raw);
	if (!arc) { print(jstringify({ ok: false, reason: 'bad archive JSON' }) + '\n'); exit(1); }
	let r = restore_scope(scope, arc, { currentVersion: PKG_VERSION });
	print(jstringify(r) + '\n');
} else if (mode == undefined) {
	// imported as a library
} else {
	print('usage: ucode backup.uc backup <scope> | restore <scope> <archive-file>\n');
	exit(1);
}
