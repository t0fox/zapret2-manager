// Node reference: backup/restore logic for the four independent scopes (ЦЕЛЬ cleanup/15).
//
// Four scopes, each backed up and restored INDEPENDENTLY (user picks which):
//   engineConfig — /opt/zapret2/config (real format: quoted values, single-line NFQWS2_OPT)
//   ourState    — /etc/zapret2-manager/state.json (our own state)
//   lists       — ipset/ list files (user domain/IP lists)
//   profiles    — /etc/zapret2-manager/profiles (strategy profiles)
//
// Storage: ONE current copy + a history by capture time, at most 3 entries. On the
// 4th entry the OLDEST (min timestamp) is evicted. Eviction is proven by a self-test
// on the 4th entry, not assumed.
//
// Restore (hard rules):
//  - Before ANY restore, a snapshot of the CURRENT state is taken automatically — no
//    exceptions, even if the user is in a hurry. The snapshot is STORED in history
//    (so a bad restore can itself be rolled back), with the same eviction rule.
//  - Restore verifies archive INTEGRITY (checksum) and SYNtactic correctness of the
//    content BEFORE anything is overwritten. Fail either → touch nothing, return why.
//  - Restoring an archive taken by a NEWER package version is REFUSED with an
//    explicit message, not silently.
//  - Disk-shortage: backup never leaves a half-written archive. Write to a temp,
//    then rename (atomic).
//
// This module is the pure in-memory ALGORITHM (no real I/O). The shipped ucode
// backup.uc mirrors it and does the file I/O on the target. ucode does not run
// locally; node self-test proves the algorithm, runtime confirmed on target.
//
// NOTE: archive.files is an ARRAY of { path, content } pairs (NOT an object keyed
// by path). This keeps both the node reference and the shipped ucode in lockstep
// AND avoids for-in over an object (point 6: no reliance on object key-enumeration
// semantics; ucode has no keys() builtin, so for-in is the only object-iteration
// form — we avoid it entirely by carrying files as an array and iterating by index).

export function make_archive(scope, version, takenAt, files) {
	// files: array of { path, content }
	const payload = JSON.stringify({ scope, version, takenAt, files });
	return {
		scope,
		version,
		takenAt,
		files,
		checksum: checksum(payload)
	};
}

function checksum(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// A BackupsStore holds, per scope, ONE current copy + a history (max 3, LRU).
// History entries are { takenAt, archive }. Eviction is TESTED on the 4th entry.
export class BackupsStore {
	constructor() {
		this.scopes = {};   // scope -> { current: archive|null, history: [ {takenAt, archive} ] }
	}
	_ensure(scope) {
		if (!this.scopes[scope]) this.scopes[scope] = { current: null, history: [] };
		return this.scopes[scope];
	}
	// Take a snapshot of the current live state for a scope.
	// `liveFiles` is an array of { path, content } (deep copy by index).
	takeSnapshot(scope, liveFiles) {
		const files = [];
		for (let i = 0; i < liveFiles.length; i++) {
			files.push({ path: liveFiles[i].path, content: liveFiles[i].content });
		}
		return files;
	}
	// Store a backup: current = archive; push to history; evict oldest if >3.
	store(scope, archive, now) {
		const st = this._ensure(scope);
		st.current = archive;
		st.history.push({ takenAt: now, archive });
		if (st.history.length > 3) {
			let oldest = 0;
			for (let i = 1; i < st.history.length; i++)
				if (st.history[i].takenAt < st.history[oldest].takenAt) oldest = i;
			st.history.splice(oldest, 1);
		}
	}
	// Verify an archive: checksum + (optional) syntactic correctness of each file.
	// Returns { ok: bool, reason: string }.
	verifyArchive(archive, syntaxCheck) {
		const payload = JSON.stringify({
			scope: archive.scope, version: archive.version,
			takenAt: archive.takenAt, files: archive.files
		});
		if (checksum(payload) !== archive.checksum)
			return { ok: false, reason: 'checksum mismatch (archive corrupted)' };
		if (syntaxCheck) {
			for (let i = 0; i < archive.files.length; i++) {
				const f = archive.files[i];
				const why = syntaxCheck(f.path, f.content);
				if (why) return { ok: false, reason: 'syntax: ' + f.path + ': ' + why };
			}
		}
		return { ok: true, reason: '' };
	}
	// Restore an archive for ONE scope. Hard rules:
	//  - take a pre-restore snapshot of current (ALWAYS, no exceptions). The snapshot
	//    is STORED in history (so a bad restore can itself be rolled back), with
	//    the same eviction rule (max 3, oldest out).
	//  - verify archive (checksum + syntax); fail → touch nothing, return why.
	//  - when opts.allowedPaths is given, EVERY archive path must be in it —
	//    a crafted archive path outside the scope allowlist is REFUSED before
	//    anything is written (no arbitrary-file-write primitive).
	//  - refuse if archive.version > currentVersion (newer package version).
	//  - else restore: hand the files back to the live writer (atomic: temp+rename).
	// `writeFiles(path, content)` writes a file atomically (temp + rename) — no half.
	// `syntaxCheck(path, content)` returns a reason string or null.
	// `currentVersion` is the running package version.
	// `allowedPaths` (optional array) — the scope's restore allowlist.
	restore(scope, archive, opts) {
		const st = this._ensure(scope);
		const currentVersion = opts.currentVersion;
		const writeFiles = opts.writeFiles;
		const syntaxCheck = opts.syntaxCheck;
		const allowedPaths = opts.allowedPaths || null;
		// 0) allowlist gate BEFORE any write (Slice 5: a crafted archive must
		//    never become an arbitrary-file-write primitive)
		if (allowedPaths) {
			for (let i = 0; i < archive.files.length; i++) {
				if (!allowedPaths.includes(archive.files[i].path)) {
					return { ok: false, restored: false, preTaken: false,
						reason: 'archive path ' + archive.files[i].path + ' is not in the ' + scope + ' allowlist — restore REFUSED (no arbitrary paths)' };
				}
			}
		}
		// 1) pre-restore snapshot of current (ALWAYS, no exceptions). The snapshot is
		//    STORED in history (so a bad restore can itself be rolled back), with the
		//    same eviction rule (max 3, oldest out).
		const pre = (st.current != null)
			? this.takeSnapshot(scope, st.current.files)
			: null;
		if (pre != null) this.store(scope, st.current,
			opts.preNow != null ? opts.preNow : (archive.takenAt - 1));
		// 2) verify before overwrite
		const v = this.verifyArchive(archive, syntaxCheck);
		if (!v.ok) {
		return { ok: false, restored: false, preTaken: true, reason: v.reason };
		}
		// 3) refuse newer-version archive
		if (archive.version > currentVersion) {
		return {
			ok: false, restored: false, preTaken: true,
			reason: 'archive version ' + archive.version + ' is NEWER than the running package version ' + currentVersion + ' — restore refused'
		};
		}
		// 4) restore: write each file atomically (index loop, no for-in over object)
		for (let i = 0; i < archive.files.length; i++) {
		const f = archive.files[i];
		writeFiles(f.path, f.content);
	}
		st.current = archive;
		return { ok: true, restored: true, preTaken: true, scope };
	}
	// Inspect (for self-tests): current + history of a scope.
	state(scope) {
		const st = this._ensure(scope);
		return { current: st.current, history: st.history.slice() };
	}
}

// Atomic write helper (model): write to temp, then rename. No half-written archive.
export function atomicWrite(fsOps, name, content) {
	const tmp = name + '.tmp.' + (content.length + ':' + name.length);
	fsOps.writeTemp(tmp, content);
	fsOps.rename(tmp, name);
}
