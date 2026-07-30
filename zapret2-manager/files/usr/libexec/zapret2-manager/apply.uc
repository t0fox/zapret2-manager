'use strict';
// apply.uc — the SINGLE writer for /opt/zapret2/config (upstream's shell config).
//
// This is the sanctioned apply path: the only place in the shipped tree that
// writes /opt/zapret2/config. service.uc (pause, passthrough, rollback) calls
// read_var/set_var here; it never writes the file itself, and no other module
// may. Two places changing one file would break generation accounting.
//
// If something more is needed (the full options-string constructor that
// RENDERS NFQWS2_OPT from profiles), EXTEND this module — do not bypass it.
// That constructor is deferred to the strategy-editor branch; it will call
// set_var('NFQWS2_OPT', rendered) and not touch the file directly.
//
// The parse/replace algorithm is the ALGORITHM SPEC in
// tests/lib/apply-writer.mjs (a node reference), exercised locally by
// tests/apply-writer.test.mjs against the real /opt/zapret2/config fixture.
// ucode does not run in the build environment, so the ucode here mirrors the
// node reference and its RUNTIME is confirmed on the target via smoke.sh.
//
// Shell-style config rules handled (see tests/lib/apply-writer.mjs):
//   simple  VAR=value            (NFQWS2_ENABLE=1)
//   quoted  VAR="value"          (single-line)
//   multi   VAR="   …   "        (opening " alone, closing " on a later line;
//                                  NFQWS2_OPT)
//   commented  #VAR=value        (NOT matched; a write APPENDS a new active
//                                  assignment instead of rewriting the comment)
//   value may contain "=" (split on the FIRST "=" after the name only)

import { readfile, writefile, stat, popen, unlink, mkdir } from 'fs';
import { PATHS } from './constants.uc';

const CONFIG = PATHS.applied_conf;

// Leading whitespace then '#' → comment line (not an active assignment).
function is_comment(line) {
	let i = 0;
	while (i < length(line) && (substr(line, i, 1) == ' ' || substr(line, i, 1) == '\t'))
		i++;
	return (substr(line, i, 1) == '#');
}

// Position of the closing " in `rest` (a value string starting with "), or -1.
// Position of the closing " in `rest` (a value string starting with ").
// Uses rindex (LAST ") so a value with an INNER " like VAR="a "b" c" is still
// recognized as single-line (closing " is the last "). ucode rindex returns -1
// when absent. Returns the 0-based position in rest.
function closing_quote_pos(rest) {
	if (substr(rest, 0, 1) != '"') return -1;
	return rindex(rest, '"');
}

// Read the current value of `name`, or null if there is no active assignment.
// Multi-line quoted values return the text BETWEEN the quotes (newlines
// preserved), without the quotes.
export const read_var = function(name) {
	let raw = readfile(CONFIG);
	if (!raw) return null;
	let lines = split(raw, '\n');
	let prefix = name + '=';
	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (substr(line, 0, length(prefix)) != prefix) continue;
		if (is_comment(line)) continue;
		let rest = substr(line, length(prefix));   // after NAME=
		if (substr(rest, 0, 1) == '"') {
			// opening " alone → multi-line quoted (closing " on a later line)
			if (rest == '"') {
				let buf = [];
				for (let j = i + 1; j < length(lines); j++) {
					let q = index(lines[j], '"');
					if (q >= 0) {
						if (q > 0) push(buf, substr(lines[j], 0, q));
						return join(buf, '\n');
					}
					push(buf, lines[j]);
				}
				return join(buf, '\n');   // unterminated (should not happen)
			}
			// single-line quoted: closing " is the LAST " in the line (rindex, so
			// a value with an INNER " like VAR="a "b" c" is still single-line).
			let cp = closing_quote_pos(rest);
			if (cp >= 0 && cp == length(rest) - 1)
				return substr(rest, 1, length(rest) - 2);
			// multi-line quoted: closing " not on this line → collect later lines
			let buf = [];
			push(buf, substr(rest, 1));   // content after opening "
			for (let j = i + 1; j < length(lines); j++) {
				let q = index(lines[j], '"');
				if (q >= 0) {
					if (q > 0) push(buf, substr(lines[j], 0, q));
					return join(buf, '\n');
				}
				push(buf, lines[j]);
			}
			return join(buf, '\n');   // unterminated (should not happen)
		}
		return rest;   // unquoted single-line value
	}
	return null;
};

// Render a new config text with `name` set to `value`. Pure (no file I/O);
// mirrors tests/lib/apply-writer.mjs write_var. Surgical: only the named
// assignment changes. APPENDS if there is no active assignment.
function render_var(config, name, value) {
	let lines = split(config, '\n');
	let prefix = name + '=';
	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (substr(line, 0, length(prefix)) != prefix) continue;
		if (is_comment(line)) continue;
		let rest = substr(line, length(prefix));
		let cp = closing_quote_pos(rest);
		// multi-line iff: opening " alone (rest == '"'), OR the closing " is not the
		// last char of this line (a value with an inner " stays single-line).
		let is_multi = (substr(rest, 0, 1) == '"') && (rest == '"' || !(cp >= 0 && cp == length(rest) - 1));
		if (is_multi) {
			let end = i;
			let found = false;
			for (let j = i + 1; j < length(lines); j++) {
				if (index(lines[j], '"') >= 0) { end = j; found = true; break; }
			}
			// Unterminated quoted value (no closing " on any later line): do
			// NOT rewrite — that would silently drop the trailing content.
			// Treat as a single-line replace of the opening line only, leaving
			// the rest of the file untouched. (The real NFQWS2_OPT is always
			// terminated; this guards against a hand-corrupted config.)
			if (!found) {
				let result = [];
				for (let k = 0; k < i; k++) push(result, lines[k]);
				push(result, prefix + value);
				for (let k = i + 1; k < length(lines); k++) push(result, lines[k]);
				return join(result, '\n');
			}
			let result = [];
			for (let k = 0; k < i; k++) push(result, lines[k]);
			let open_alone = (rest == '"');
			if (open_alone) {
				push(result, prefix + '"');
				push(result, value);
				push(result, '"');
			} else {
				push(result, prefix + '"' + value + '"');
			}
			for (let k = end + 1; k < length(lines); k++) push(result, lines[k]);
			return join(result, '\n');
		}
		// single-line quoted: VAR="value" (closing " is the last " in the line, so
		// an inner " like in VAR="a "b" c" still counts as single-line). Preserve the
		// quotes — writing VAR=value (no quotes) would change the format the engine reads.
		if (substr(rest, 0, 1) == '"' && rest != '"' && cp >= 0 && cp == length(rest) - 1) {
			let result = [];
			for (let k = 0; k < i; k++) push(result, lines[k]);
			push(result, prefix + '"' + value + '"');
			for (let k = i + 1; k < length(lines); k++) push(result, lines[k]);
			return join(result, '\n');
		}
		// single-line unquoted: replace the one line
		let result = [];
		for (let k = 0; k < i; k++) push(result, lines[k]);
		push(result, prefix + value);
		for (let k = i + 1; k < length(lines); k++) push(result, lines[k]);
		return join(result, '\n');
	}
	// not found (or only commented): append a new active assignment
	let sep = (length(config) == 0 || substr(config, length(config) - 1, 1) == '\n') ? '' : '\n';
	return config + sep + prefix + value;
}

const LOCKFILE = CONFIG + '.lock';     // /opt/zapret2/config.lock  (flock)
const MARKER   = CONFIG + '.writing';  // /opt/zapret2/config.writing (fallback)

// flock is the right serializer and is USUALLY present in this firmware build
// (util-linux / util-linux-flock). [VERIFY:ROUTER] confirmed on device — until
// then we PROBE at runtime and fall back to a marker file if it is absent.
let _have_flock = null;
function have_flock() {
	if (_have_flock != null) return _have_flock;
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	_have_flock = (out && length(trim(out)) > 0) ? true : false;
	return _have_flock;
}

// mktemp helper for set_var's name/value temp files. Declared BEFORE set_var:
// ucode does not hoist `function` declarations in module mode, so a helper
// must precede its first caller (set_var below) or it is an undeclared var.
function _mktemp() {
	let p = popen('mktemp 2>/dev/null', 'r');
	if (!p) return '/tmp/z2m-set.' + time();
	let out = trim(p.read('all'));
	p.close();
	return length(out) ? out : ('/tmp/z2m-set.' + time());
}

// Set `name` to `value` in /opt/zapret2/config. Returns the new config text.
// Preserves a trailing newline if the original had one. The atomic phase
// (temp file + mv) is wrapped in flock when flock is present, so two writers
// never race the rename. The read-modify-write read phase is serialized the
// same way: when flock is present the WHOLE RMW is delegated to a ucode
// subprocess run under `flock <lockfile> -c 'ucode ... do_set'`, because ucode
// fs has no fd-lock to hold across an in-process RMW.
//
// REMAINING RACE (flock absent): the marker-file fallback has a check-then-
// create window — two writers can both see no marker, both create it, both
// RMW; the second mv wins and the first writer's change is LOST (lost update).
// The marker only narrows the window; it does NOT serialize. flock removes
// the race. [VERIFY:ROUTER] flock presence decides which path is live.
export const set_var = function(name, value) {
	if (have_flock()) {
		// Delegate the RMW to a subprocess under an exclusive flock. Use mktemp
		// for the name/value temp files so concurrent set_var calls do not
		// clobber each other's temp files before flock is taken.
		let name_f = _mktemp();
		let val_f  = _mktemp();
		writefile(name_f, name + '\n');
		writefile(val_f, '' + value);
		let cmd = "flock " + LOCKFILE + " -c 'ucode /usr/libexec/zapret2-manager/apply-cli.uc do_set " + name_f + " " + val_f + " 2>/dev/null'";
		let p = popen(cmd, 'r');
		if (p) p.close();
		try { unlink(name_f); } catch (e) { }
		try { unlink(val_f); } catch (e) { }
		// Verify the write: read back and compare. read_var returns null for
		// absent/empty; an empty value is a valid write (returns '' from
		// read_var only if the var exists with an empty quoted value, which is
		// rare). For a normal value, read_var must equal the written value.
		let rb = read_var(name);
		if (rb == ('' + value)) return '' + value;
		if (('' + value) == '' && rb != null) return '' + value;  // empty-ish edge
		return null;   // write did not take
	}
	// Fallback: marker file. A stale marker (crash between create and unlink)
	// is detected by timestamp: if older than 60s, ignore and proceed.
	if (stat(MARKER)) {
		try {
			let mtime = trim(readfile(MARKER));
			let age = time() - (+mtime);
			if (mtime && age < 60) return null;   // another writer is active
		} catch (e) { }
		// stale marker → remove and proceed
		try { unlink(MARKER); } catch (e) { }
	}
	try { writefile(MARKER, '' + time() + '\n'); } catch (e) { }
	let raw = readfile(CONFIG);
	if (!raw) raw = '';
	let out = render_var(raw, name, value);
	if (length(raw) > 0 && substr(raw, length(raw) - 1, 1) == '\n' &&
	    (length(out) == 0 || substr(out, length(out) - 1, 1) != '\n'))
		out += '\n';
	let tmp = CONFIG + '.tmp.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + CONFIG + ' 2>/dev/null', 'r');
	if (p) p.close();
	try { unlink(MARKER); } catch (e) { }
	return out;
};

// do_set <namefile> <valuefile> — runs UNDER flock (invoked by set_var above).
// Reads the config, renders name=value, atomically renames. Single entry point
// so the whole RMW is inside the locked subprocess.
export const do_set = function(name_f, val_f) {
	let name = trim(readfile(name_f));
	let value = readfile(val_f);
	// set_var writes value with NO trailing newline (writefile(val_f, value)),
	// so readfile(val_f) returns exactly the value. Do NOT strip a trailing
	// newline — that would remove a legitimate one from a multi-line value
	// (data loss). The name file gets name+'\n', so trim(name) is correct.
	let raw = readfile(CONFIG);
	if (!raw) raw = '';
	let out = render_var(raw, name, value);
	if (length(raw) > 0 && substr(raw, length(raw) - 1, 1) == '\n' &&
	    (length(out) == 0 || substr(out, length(out) - 1, 1) != '\n'))
		out += '\n';
	let tmp = CONFIG + '.tmp.do.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + CONFIG + ' 2>/dev/null', 'r');
	if (p) p.close();
};

// do_restore <path> <contentfile> — runs UNDER flock (invoked by
// restore_whole_file below). Whole-file atomic replace + readback verify.
export const do_restore = function(path, content_f) {
	let content = readfile(content_f);
	if (content == null) content = '';
	let tmp = path + '.tmp.rst.' + time();
	writefile(tmp, content);
	let p = popen('mv -f ' + tmp + ' ' + path + ' 2>/dev/null', 'r');
	if (p) p.close();
};

// restore_whole_file(path, content) — the SANCTIONED whole-file restore for
// the applied config (Slice 5). Before this existed, backup restore wrote
// /opt/zapret2/config through its own atomic_write — a SECOND writer, which
// the single-writer rule forbids. Restrictions:
//   - path allowlist: ONLY the applied config (PATHS.applied_conf);
//   - same serialization as set_var: flock subprocess when flock is present
//     (marker fallback otherwise, same remaining-race caveat);
//   - readback verify: the restored bytes must read back exactly.
// The caller (backup restore) is responsible for its own pre-restore
// snapshot, manifest/syntax verification and version gate — this function is
// the WRITE primitive only.
export const restore_whole_file = function(path, content) {
	if (path != CONFIG) return null;   // allowlist: the applied config only
	if (content == null) content = '';
	if (have_flock()) {
		let val_f = _mktemp();
		writefile(val_f, '' + content);
		let cmd = "flock " + LOCKFILE + " -c 'ucode /usr/libexec/zapret2-manager/apply-cli.uc do_restore " + path + " " + val_f + " 2>/dev/null'";
		let p = popen(cmd, 'r');
		if (p) p.close();
		try { unlink(val_f); } catch (e) { }
	} else {
		// marker fallback (same 60s stale window as set_var)
		if (stat(MARKER)) {
			let mtime = trim(readfile(MARKER));
			let age = time() - (+mtime);
			if (mtime && age < 60) return null;   // another writer is active
			try { unlink(MARKER); } catch (e) { }
		}
		try { writefile(MARKER, '' + time() + '\n'); } catch (e) { }
		let f = _mktemp();
		writefile(f, '' + content);
		do_restore(path, f);
		try { unlink(f); } catch (e) { }
		try { unlink(MARKER); } catch (e) { }
	}
	// readback verify
	let rb = readfile(path);
	if (rb == content) return content;
	return null;
};

// ---- list file I/O (single writer, same module as set_var) ------------------
// lists.uc imports these — there is no second write path. List files are the
// user-editable text lists under /opt/zapret2/ipset/ (one entry per line).

// Read a list file into an array of trimmed, NON-empty lines (one entry per
// line). Missing file → empty list. Order preserved; no invented entries.
// Mirrors tests/lib/list-io.mjs read_list_file.
export const read_list_file = function(path) {
	let raw = readfile(path);
	if (!raw) return [];
	let lines = split(raw, '\n');
	let out = [];
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (length(line)) push(out, line);
	}
	return out;
};

// Write a list file atomically: temp file in the SAME directory + mv -f rename
// (same-FS rename is atomic, so a concurrent writer never sees a partial file
// and a crash leaves only the temp — the target is untouched). One entry per
// line, LF-separated, with a trailing LF. Parent dir is created if missing.
// Returns the written content on success; returns null on write/rename failure
// so the caller (lists_set) surfaces the error rather than silently dropping it
// (ucode has no throw, so the error is returned, not raised). Engine-owned
// lists are NOT written here — the caller enforces that; this function is
// path-agnostic by design. Mirrors tests/lib/list-io.mjs write_list_file.
export const write_list_file = function(path, entries) {
	let out = '';
	for (let i = 0; i < length(entries); i++) {
		let line = trim('' + entries[i]);
		if (!length(line)) continue;        // drop empty lines
		out += line + '\n';                 // LF-separated, trailing LF
	}
	// Ensure the parent directory exists (mkdir -p). rindex finds the last '/'.
	let slash = rindex(path, '/');
	let parent = (slash > 0) ? substr(path, 0, slash) : null;
	if (parent) {
		try { mkdir(parent); } catch (e) { }   // exists is fine; other errors surface at writefile
	}
	let tmp = path + '.tmp.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + path + ' 2>/dev/null', 'r');
	if (p) p.close();
	// Verify the rename took: the temp must be gone and the target present.
	// On failure, best-effort clean up the orphan temp so no partial is left.
	if (stat(tmp) || !stat(path)) {
		try { unlink(tmp); } catch (e) { }
		return null;
	}
	return out;
};
