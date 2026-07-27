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
import { read_var, write_list_file, restore_whole_file } from './apply.uc';
import { restore_state_raw, restore_drafts, load_state } from './profiles-draft.uc';

const BACKUP_DIR = '/etc/zapret2-manager/backups';
const PKG_VERSION = 1;   // [VERIFY:ROUTER] package version — apk info or compiled-in
const ARCHIVE_FORMAT = 2;
const MAX_FILE_BYTES = 1048576;
const MAX_ARCHIVE_BYTES = 4194304;

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
		},
		restoreWrite: 'engineConfig'
	},
	ourState: {
		paths: [ '/etc/zapret2-manager/state.json' ],
		syntaxCheck: (path, content) => {
			if (!content) return 'empty state';
			try { jparse(content); return null; }
			catch (e) { return 'not valid JSON: ' + e; }
		},
		restoreWrite: 'ourState'
	},
	lists: {
		// the proven user-maintained lists (lists-model.json: domainInclude +
		// domainExclude — the only editable, argv-referenced user sources).
		paths: [ '/opt/zapret2/ipset/zapret-hosts-user.txt',
		         '/opt/zapret2/ipset/zapret-hosts-user-exclude.txt' ],
		syntaxCheck: (path, content) => null,
		restoreWrite: 'lists'
	},
	profiles: {
		// draft profiles as a PORTABLE export (the profiles array from
		// state.json — survives state format changes; restores via the draft
		// machinery, preserving service keys and the id sequence).
		paths: [ '/etc/zapret2-manager/profiles.json' ],
		syntaxCheck: (path, content) => {
			let a = null;
			try { a = jparse(content); } catch (e) { return 'not valid JSON'; }
			return (type(a) == 'array') ? null : 'profiles export is not an array';
		},
		restoreWrite: 'profiles'
	}
};

// restoreWrite kinds:
//   engineConfig — apply.uc restore_whole_file (the SANCTIONED single writer;
//                  backup restore used to write /opt/zapret2/config directly —
//                  a forbidden second writer, fixed in Slice 5)
//   ourState     — profiles-draft restore_state_raw (validated + locked)
//   lists        — apply.uc write_list_file per path (the list writer)
//   profiles     — profiles-draft restore_drafts (draft machinery)

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

// sha256 via a temp file (ucode has no sha256 builtin; the command is a
// constant — content is data, never interpolated).
function sha256_text(text) {
	let tmp = '/tmp/z2m-backup-sha.' + time();
	writefile(tmp, '' + text);
	let r = run("sha256sum " + tmp + " 2>/dev/null | awk '{print $1}'");
	try { unlink(tmp); } catch (e) { }
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

// make_manifest(filesMeta) — SHA-256 per file + whole-manifest SHA-256.
// filesMeta: [{path, content, mode, owner}] (mode/owner from stat, for
// ownership/mode preservation on restore).
function make_manifest(filesMeta) {
	let entries = [];
	for (let i = 0; i < length(filesMeta); i++) {
		let f = filesMeta[i];
		push(entries, {
			path: f.path,
			sha256: sha256_text(f.content != null ? f.content : ''),
			size: length(f.content != null ? f.content : ''),
			mode: (f.mode != null) ? f.mode : null,
			owner: (f.owner != null) ? f.owner : null
		});
	}
	let payload = jstringify(entries);
	return { format: ARCHIVE_FORMAT, files: entries, sha256: sha256_text(payload) };
}

// verify_manifest(archive) → { ok, reason } — every manifest entry must have
// matching content, and the manifest itself must not be tampered.
function verify_manifest(archive) {
	let m = archive.manifest;
	if (type(m) != 'object' || m == null || type(m.files) != 'array')
		return { ok: false, reason: 'no manifest (or legacy archive without SHA-256)' };
	for (let i = 0; i < length(m.files); i++) {
		let entry = m.files[i];
		let found = null;
		for (let j = 0; j < length(archive.files); j++)
			if (archive.files[j].path == entry.path) { found = archive.files[j]; break; }
		if (found == null) return { ok: false, reason: 'manifest entry without content: ' + entry.path };
		if (sha256_text(found.content != null ? found.content : '') != entry.sha256)
			return { ok: false, reason: 'sha256 mismatch for ' + entry.path + ' (archive corrupted)' };
	}
	if (sha256_text(jstringify(m.files)) != m.sha256)
		return { ok: false, reason: 'manifest sha256 mismatch (tampered)' };
	return { ok: true };
}

function check_archive_limits(files) {
	let total = 0;
	for (let i = 0; i < length(files); i++) {
		let n = length(files[i].content != null ? files[i].content : '');
		if (n > MAX_FILE_BYTES) return { ok: false, reason: 'file ' + files[i].path + ' exceeds ' + MAX_FILE_BYTES + ' bytes' };
		total += n;
	}
	if (total > MAX_ARCHIVE_BYTES) return { ok: false, reason: 'archive exceeds ' + MAX_ARCHIVE_BYTES + ' bytes' };
	return { ok: true };
}

export const make_archive = function(scope, version, takenAt, files) {
	let payload = jstringify({ scope: scope, version: version, takenAt: takenAt, files: files });
	return {
		scope: scope, version: version, takenAt: takenAt, files: files,
		checksum: checksum(payload),
		manifest: make_manifest(files)
	};
};

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

// snapshot the live files for a scope — returns an ARRAY of {path, content,
// mode, owner} (mode/owner preserved for restore). The 'profiles' scope
// exports the draft profiles ARRAY from state.json (portable).
function snapshot(scope) {
	let files = [];
	let cfg = SCOPES[scope];
	if (!cfg) return null;
	if (scope == 'profiles') {
		let ls = load_state();
		let arr = (ls.ok) ? ls.state.profiles : [];
		push(files, { path: cfg.paths[0], content: jstringify(arr), mode: null, owner: null });
		return files;
	}
	for (let i = 0; i < length(cfg.paths); i++) {
		let p = cfg.paths[i];
		let c = readfile(p);
		let st = stat(p);
		push(files, {
			path: p,
			content: (c != null) ? c : '',
			mode: (st && st.mode != null) ? (st.mode % 512) : null,
			owner: (st && st.uid != null) ? (st.uid + ':' + st.gid) : null
		});
	}
	return files;
}

export const backup_scope = function(scope, now) {
	let cfg = SCOPES[scope];
	if (!cfg) return { ok: false, reason: 'unknown scope: ' + scope };
	let files = snapshot(scope);
	let lim = check_archive_limits(files);
	if (!lim.ok) return { ok: false, reason: lim.reason };
	if (!ensure_dir(scope_dir(scope))) return { ok: false, reason: 'cannot create backup dir' };
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
	return { ok: true, scope: scope, takenAt: now, manifestSha256: (arc.manifest != null) ? arc.manifest.sha256 : null };
}

// ---- restore ---------------------------------------------------------------

// sanctioned per-scope write. Returns null on success, reason on failure.
function restore_write(scope, f) {
	let kind = SCOPES[scope].restoreWrite;
	if (kind == 'engineConfig') {
		let w = restore_whole_file(f.path, f.content);
		return (w != null) ? null : ('sanctioned writer failed for ' + f.path);
	}
	if (kind == 'ourState') {
		let r = restore_state_raw(f.content);
		return r.ok ? null : r.reason;
	}
	if (kind == 'lists') {
		let entries = [];
		let lines = split(f.content != null ? f.content : '', '\n');
		for (let i = 0; i < length(lines); i++)
			if (length(trim(lines[i]))) push(entries, trim(lines[i]));
		let w = write_list_file(f.path, entries);
		return (w != null) ? null : ('list writer failed for ' + f.path);
	}
	if (kind == 'profiles') {
		let arr = null;
		try { arr = jparse(f.content); } catch (e) { return 'profiles export not valid JSON'; }
		let r = restore_drafts(arr);
		return r.ok ? null : r.reason;
	}
	return 'no sanctioned writer for scope ' + scope;
}

// mode/owner preservation (manifest meta; chmod/chown via run — constants
// from the manifest are numeric/uid:gid, never interpolated content).
function restore_meta(archive) {
	if (type(archive.manifest) != 'object' || archive.manifest == null) return;
	for (let i = 0; i < length(archive.manifest.files); i++) {
		let m = archive.manifest.files[i];
		if (m.mode != null) run(sprintf('chmod %o ', m.mode % 512) + m.path + ' 2>/dev/null');
		if (m.owner != null) run('chown ' + m.owner + ' ' + m.path + ' 2>/dev/null');
	}
}

export const restore_scope = function(scope, archive, opts) {
	let cfg = SCOPES[scope];
	if (!cfg) return { ok: false, reason: 'unknown scope: ' + scope };
	let currentVersion = (opts && opts.currentVersion != null) ? opts.currentVersion : PKG_VERSION;

	// 0) ALLOWLIST gate BEFORE anything (a crafted archive path must never
	//    become an arbitrary-file-write primitive — Slice 5 fix: restore used
	//    to write ANY archive path).
	for (let i = 0; i < length(archive.files); i++) {
		let allowed = false;
		for (let j = 0; j < length(cfg.paths); j++)
			if (archive.files[i].path == cfg.paths[j]) { allowed = true; break; }
		if (!allowed)
			return { ok: false, restored: false, preTaken: false,
				reason: 'archive path ' + archive.files[i].path + ' is not in the ' + scope + ' allowlist — restore REFUSED (no arbitrary paths)' };
	}

	// 1) pre-restore snapshot of current (ALWAYS, no exceptions), stored in history.
	let cur = scope_dir(scope) + '/current';
	if (stat(cur)) {
		let curArc = jparse(readfile(cur));
		if (curArc != null) {
			let now = (archive.takenAt != null ? archive.takenAt : time()) - 1;
			backup_scope(scope, now);
		}
	}

	// 2) verify archive integrity BEFORE overwrite: SHA-256 manifest when
	//    present (v2), else legacy FNV checksum. Plus syntax check per file.
	let downgrade = null;
	if (archive.manifest != null) {
		let vm = verify_manifest(archive);
		if (!vm.ok)
			return { ok: false, restored: false, preTaken: true, reason: vm.reason };
	} else {
		let payload = jstringify({ scope: archive.scope, version: archive.version,
			takenAt: archive.takenAt, files: archive.files });
		if (checksum(payload) != archive.checksum)
			return { ok: false, restored: false, preTaken: true,
				reason: 'checksum mismatch (archive corrupted)' };
	}
	if (cfg.syntaxCheck) {
		for (let i = 0; i < length(archive.files); i++) {
			let f = archive.files[i];
			let why = cfg.syntaxCheck(f.path, f.content);
			if (why) return { ok: false, restored: false, preTaken: true,
				reason: 'syntax: ' + f.path + ': ' + why };
		}
	}

	// 3) version gate: newer refuses, older restores WITH a downgrade warning
	if (archive.version > currentVersion) {
		return { ok: false, restored: false, preTaken: true,
			reason: 'archive version ' + archive.version + ' is NEWER than the running package version ' + currentVersion + ' — restore refused' };
	}
	if (archive.version < currentVersion) {
		downgrade = 'archive version ' + archive.version + ' is older than the running package version ' + currentVersion + ' — restored with downgrade warning';
	}

	// 4) restore through the SANCTIONED writers (never a second write path)
	for (let i = 0; i < length(archive.files); i++) {
		let why = restore_write(scope, archive.files[i]);
		if (why != null)
			return { ok: false, restored: false, preTaken: true, reason: why };
	}
	restore_meta(archive);
	if (ensure_dir(scope_dir(scope)))
		atomic_write(scope_dir(scope) + '/current', jstringify(archive));
	return { ok: true, restored: true, preTaken: true, scope: scope,
		downgradeWarning: downgrade,
		note: (scope == 'engineConfig') ? 'engine config restored; restart the service for it to take effect (no automatic restart)' : null };
};

// ---- list / preview / delete (Slice 5 RPC surface) ----------------------------

function archive_brief(arc, takenAt) {
	if (type(arc) != 'object' || arc == null) return null;
	let files = [];
	let mf = (type(arc.manifest) == 'object' && arc.manifest != null && type(arc.manifest.files) == 'array') ? arc.manifest.files : [];
	for (let i = 0; i < length(mf); i++)
		push(files, { path: mf[i].path, sha256: mf[i].sha256, size: mf[i].size });
	return {
		takenAt: (arc.takenAt != null) ? arc.takenAt : takenAt,
		version: arc.version,
		manifestSha256: (type(arc.manifest) == 'object' && arc.manifest != null) ? arc.manifest.sha256 : null,
		format: (type(arc.manifest) == 'object' && arc.manifest != null) ? 2 : 1,
		files: files
	};
}

function load_archive(scope, takenAt) {
	let path = (takenAt != null)
		? scope_dir(scope) + '/history/' + takenAt + '/archive'
		: scope_dir(scope) + '/current';
	let raw = readfile(path);
	if (!raw) return null;
	let arc = null;
	try { arc = jparse(raw); } catch (e) { return null; }
	return arc;
}

export const list_backups = function() {
	let out = {};
	let scopes = ['engineConfig', 'ourState', 'lists', 'profiles'];
	for (let si = 0; si < length(scopes); si++) {
		let scope = scopes[si];
		let cfg = SCOPES[scope];
		let entry = { paths: cfg.paths, current: null, history: [] };
		let cur = load_archive(scope, null);
		if (cur != null) entry.current = archive_brief(cur, null);
		let r = run('ls -1 ' + scope_dir(scope) + '/history' + ' 2>/dev/null');
		let lst = split(trim(r.out), '\n');
		let times = [];
		for (let i = 0; i < length(lst); i++) {
			let e = trim(lst[i]);
			if (length(e) && (+e) > 0) push(times, +e);
		}
		// newest first (insertion sort desc)
		for (let i = 1; i < length(times); i++) {
			let v = times[i]; let j = i - 1;
			while (j >= 0 && times[j] < v) { times[j + 1] = times[j]; j--; }
			times[j + 1] = v;
		}
		for (let i = 0; i < length(times); i++) {
			let arc = load_archive(scope, times[i]);
			if (arc != null) push(entry.history, archive_brief(arc, times[i]));
		}
		out[scope] = entry;
	}
	return { ok: true, scopes: out, historyCap: 3 };
};

export const preview_restore = function(scope, takenAt) {
	let cfg = SCOPES[scope];
	if (!cfg) return { ok: false, error: { code: 'EINPUT', message: 'unknown scope: ' + scope } };
	let arc = load_archive(scope, takenAt);
	if (arc == null) return { ok: false, error: { code: 'ESTATE', message: 'no archive for ' + scope + (takenAt != null ? ' at ' + takenAt : ' (current)') } };

	// allowlist (same gate as restore)
	for (let i = 0; i < length(arc.files); i++) {
		let allowed = false;
		for (let j = 0; j < length(cfg.paths); j++)
			if (arc.files[i].path == cfg.paths[j]) { allowed = true; break; }
		if (!allowed) return { ok: false, error: { code: 'EINPUT', message: 'archive path ' + arc.files[i].path + ' is not in the ' + scope + ' allowlist' } };
	}

	// manifest / checksum verification (preview reports, restore enforces)
	let integrity = { manifest: arc.manifest != null, ok: true, reason: null };
	if (arc.manifest != null) {
		let vm = verify_manifest(arc);
		integrity.ok = vm.ok;
		integrity.reason = vm.ok ? null : vm.reason;
	} else {
		let payload = jstringify({ scope: arc.scope, version: arc.version, takenAt: arc.takenAt, files: arc.files });
		integrity.ok = (checksum(payload) == arc.checksum);
		integrity.reason = integrity.ok ? null : 'legacy checksum mismatch';
	}

	// diff vs live
	let live = snapshot(scope);
	let diffs = [];
	for (let i = 0; i < length(arc.files); i++) {
		let af = arc.files[i];
		let cur = null;
		for (let j = 0; j < length(live); j++)
			if (live[j].path == af.path) { cur = live[j]; break; }
		let curContent = (cur != null) ? cur.content : null;
		push(diffs, {
			path: af.path,
			presentNow: cur != null,
			changed: cur == null || curContent != af.content,
			currentSha256: (cur != null) ? sha256_text(curContent) : null,
			archiveSha256: sha256_text(af.content != null ? af.content : ''),
			currentSize: (cur != null) ? length(curContent) : null,
			archiveSize: length(af.content != null ? af.content : '')
		});
	}

	// syntax findings
	let syntax = [];
	for (let i = 0; i < length(arc.files); i++) {
		let why = cfg.syntaxCheck(arc.files[i].path, arc.files[i].content);
		if (why != null) push(syntax, { path: arc.files[i].path, reason: why });
	}

	// version gate
	let gate = 'ok';
	if (arc.version > PKG_VERSION) gate = 'refuse';
	else if (arc.version < PKG_VERSION) gate = 'downgrade';

	return {
		ok: true,
		scope: scope,
		takenAt: arc.takenAt,
		archive: archive_brief(arc, takenAt),
		integrity: integrity,
		diffs: diffs,
		syntax: syntax,
		versionGate: gate,
		restorable: integrity.ok && length(syntax) == 0 && gate != 'refuse'
	};
};

export const delete_backup = function(scope, takenAt) {
	let cfg = SCOPES[scope];
	if (!cfg) return { ok: false, error: { code: 'EINPUT', message: 'unknown scope: ' + scope } };
	if (takenAt == null || (+takenAt) <= 0)
		return { ok: false, error: { code: 'EINPUT', message: 'a history takenAt is required (deleting the current baseline is refused)' } };
	let dir = scope_dir(scope) + '/history/' + (+takenAt);
	if (!stat(dir)) return { ok: false, error: { code: 'ESTATE', message: 'no history entry ' + (+takenAt) + ' for ' + scope } };
	run('rm -rf ' + dir);
	return { ok: true, scope: scope, deleted: (+takenAt) };
};

// Pure library (Slice 5): the CLI dispatch moved to backup-cli.uc — an ARGV
// dispatch at module top level would fire with the IMPORTING script's argv
// and exit(1). This file is imported, never executed directly.
