#!/usr/bin/ucode
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

import { readfile, writefile, stat } from 'fs';
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
// Looks for a " after the opening one; ucode index returns -1 when absent.
function closing_quote_pos(rest) {
	if (substr(rest, 0, 1) != '"') return -1;
	let inner = substr(rest, 1);        // after the opening "
	let p = index(inner, '"');          // -1 if no inner "
	return p;                           // 0-based within inner == pos-1 in rest
}

// Read the current value of `name`, or null if there is no active assignment.
// Multi-line quoted values return the text BETWEEN the quotes (newlines
// preserved), without the quotes.
export function read_var(name) {
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
			let cp = closing_quote_pos(rest);
			// single-line quoted: "value" (closing " is the last char)
			if (cp >= 0 && cp + 1 == length(rest) - 1)
				return substr(rest, 1, length(rest) - 2);
			// multi-line quoted: collect until the line carrying the closing "
			let buf = [];
			if (length(rest) > 1) push(buf, substr(rest, 1));   // content after opening "
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
}

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
		let is_multi = (substr(rest, 0, 1) == '"') && !(cp >= 0 && cp + 1 == length(rest) - 1);
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
		// single-line quoted: VAR="value" (the only inner " is the closing one).
		// Preserve the quotes — writing VAR=value (no quotes) would change the
		// format the engine reads. Mirror the original quoting style.
		if (substr(rest, 0, 1) == '"' && cp >= 0 && cp + 1 == length(rest) - 1) {
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
export function set_var(name, value) {
	if (have_flock()) {
		// Delegate the RMW to a subprocess under an exclusive flock. Use mktemp
		// for the name/value temp files so concurrent set_var calls do not
		// clobber each other's temp files before flock is taken.
		let name_f = _mktemp();
		let val_f  = _mktemp();
		writefile(name_f, name + '\n');
		writefile(val_f, '' + value);
		let cmd = "flock " + LOCKFILE + " -c 'ucode /usr/libexec/zapret2-manager/apply.uc do_set " + name_f + " " + val_f + " 2>/dev/null'";
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
}

function _mktemp() {
	let p = popen('mktemp 2>/dev/null', 'r');
	if (!p) return '/tmp/z2m-set.' + time();
	let out = trim(p.read('all'));
	p.close();
	return length(out) ? out : ('/tmp/z2m-set.' + time());
}

// do_set <namefile> <valuefile> — runs UNDER flock (invoked by set_var above).
// Reads the config, renders name=value, atomically renames. Single entry point
// so the whole RMW is inside the locked subprocess.
function do_set(name_f, val_f) {
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
}

// ---- CLI (for smoke.sh / manual use) ----------------------------------------
//   ucode apply.uc read <name>          → prints value or "null"
//   ucode apply.uc set  <name> <value>  → sets a single-line var, prints "ok"
//   ucode apply.uc do_set <namefile> <valuefile>  → INTERNAL, runs under flock
// Multi-line values (NFQWS2_OPT) are set via service.uc importing set_var,
// not via the 'set' CLI (argv is line-oriented); do_set reads value from a
// file so multi-line values survive.
let mode = ARGV[0];
if (mode == 'read') {
	let v = read_var(ARGV[1]);
	print((v == null ? 'null' : v) + '\n');
} else if (mode == 'set') {
	set_var(ARGV[1], ARGV[2]);
	print('ok\n');
} else if (mode == 'do_set') {
	do_set(ARGV[1], ARGV[2]);
	print('ok\n');
} else if (mode == undefined) {
	// imported as a library — do nothing
} else {
	print('usage: ucode apply.uc read <name> | set <name> <value>\n');
	exit(1);
}
