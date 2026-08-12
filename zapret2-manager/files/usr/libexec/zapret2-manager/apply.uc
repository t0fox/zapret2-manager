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
		let rest = substr(line, length(prefix));
		if (substr(rest, 0, 1) == '"') {
			if (rest == '"') {
				let buf = [];
				for (let j = i + 1; j < length(lines); j++) {
					let q = index(lines[j], '"');
					if (q >= 0) {
						if (q > 0) push(buf, substr(lines[j], 0, q));
						return join('\n', buf);
					}
					push(buf, lines[j]);
				}
				return join('\n', buf);
			}
			let cp = closing_quote_pos(rest);
			if (cp >= 0 && cp == length(rest) - 1)
				return substr(rest, 1, length(rest) - 2);
			let buf = [];
			push(buf, substr(rest, 1));
			for (let j = i + 1; j < length(lines); j++) {
				let q = index(lines[j], '"');
				if (q >= 0) {
					if (q > 0) push(buf, substr(lines[j], 0, q));
					return join('\n', buf);
				}
				push(buf, lines[j]);
			}
			return join('\n', buf);
		}
		return rest;
	}
	return null;
};

function render_var(config, name, value) {
	let lines = split(config, '\n');
	let prefix = name + '=';
	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (substr(line, 0, length(prefix)) != prefix) continue;
		if (is_comment(line)) continue;
		let rest = substr(line, length(prefix));
		let cp = closing_quote_pos(rest);
		let is_multi = (substr(rest, 0, 1) == '"') && (rest == '"' || !(cp >= 0 && cp == length(rest) - 1));
		if (is_multi) {
			let end = i;
			let found = false;
			for (let j = i + 1; j < length(lines); j++) {
				if (index(lines[j], '"') >= 0) { end = j; found = true; break; }
			}
			if (!found) {
				let result = [];
				for (let k = 0; k < i; k++) push(result, lines[k]);
				push(result, prefix + value);
				for (let k = i + 1; k < length(lines); k++) push(result, lines[k]);
				return join('\n', result);
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
			return join('\n', result);
		}
		if (substr(rest, 0, 1) == '"' && rest != '"' && cp >= 0 && cp == length(rest) - 1) {
			let result = [];
			for (let k = 0; k < i; k++) push(result, lines[k]);
			push(result, prefix + '"' + value + '"');
			for (let k = i + 1; k < length(lines); k++) push(result, lines[k]);
			return join('\n', result);
		}
		let result = [];
		for (let k = 0; k < i; k++) push(result, lines[k]);
		push(result, prefix + value);
		for (let k = i + 1; k < length(lines); k++) push(result, lines[k]);
		return join('\n', result);
	}
	let sep = (length(config) == 0 || substr(config, length(config) - 1, 1) == '\n') ? '' : '\n';
	return config + sep + prefix + value;
}

const LOCKFILE = CONFIG + '.lock';
const APPLY_CLI = '/usr/libexec/zapret2-manager/apply-cli.uc';

function shell_escape(value) {
	let s = '' + value, out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}

function command(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { rc: rc, out: out };
}

let _have_flock = null;
function have_flock() {
	if (_have_flock != null) return _have_flock;
	let r = command('command -v flock');
	_have_flock = r.rc == 0 && length(trim(r.out)) > 0;
	return _have_flock;
}

function locked() {
	return getenv('Z2M_CONFIG_LOCKED') == '1';
}

function secure_temp(template) {
	let r = command('umask 077; mktemp ' + shell_escape(template));
	let path = trim(r.out);
	if (r.rc != 0 || !length(path)) return null;
	let v = command('[ -f ' + shell_escape(path) + ' ] && [ ! -L ' + shell_escape(path) + ' ] && chmod 600 ' + shell_escape(path));
	if (v.rc != 0) {
		try { unlink(path); } catch (e) { }
		return null;
	}
	return path;
}

function cleanup(path) {
	if (path == null) return;
	try { unlink(path); } catch (e) { }
}

export const read_config_bytes = function() {
	let raw = readfile(CONFIG);
	return raw == null ? '' : raw;
};

export const config_sha256 = function() {
	if (!stat(CONFIG)) return null;
	let r = command("sha256sum " + shell_escape(CONFIG) + " | awk '{print $1}'");
	let digest = trim(r.out);
	return r.rc == 0 && length(digest) == 64 ? digest : null;
};

function preserve_trailing_newline(raw, rendered) {
	if (length(raw) > 0 && substr(raw, length(raw) - 1, 1) == '\n' &&
	    (length(rendered) == 0 || substr(rendered, length(rendered) - 1, 1) != '\n'))
		return rendered + '\n';
	return rendered;
}

function atomic_replace_locked(path, content) {
	if (!locked() || path != CONFIG) return null;
	let tmp = secure_temp(path + '.tmp.XXXXXX');
	if (tmp == null) return null;
	writefile(tmp, content);
	let prepared = command('[ -f ' + shell_escape(tmp) + ' ] && [ ! -L ' + shell_escape(tmp) +
		' ] && chmod 600 ' + shell_escape(tmp) + ' && (sync -f ' + shell_escape(tmp) + ' 2>/dev/null || sync)');
	if (prepared.rc != 0) { cleanup(tmp); return null; }
	let moved = command('mv -f ' + shell_escape(tmp) + ' ' + shell_escape(path));
	if (moved.rc != 0) { cleanup(tmp); return null; }
	let durable = command('(sync -f ' + shell_escape(path) + ' 2>/dev/null || sync); (sync -f /opt/zapret2 2>/dev/null || sync)');
	if (durable.rc != 0) return null;
	let rb = readfile(path);
	return rb == content ? content : null;
}

function set_locked(name, value) {
	if (!locked()) return null;
	let raw = read_config_bytes();
	let out = preserve_trailing_newline(raw, render_var(raw, name, '' + value));
	return atomic_replace_locked(CONFIG, out);
}

export const do_set = function(name_f, val_f) {
	if (!locked()) return false;
	let name = trim(readfile(name_f));
	let value = readfile(val_f);
	if (!length(name) || value == null) return false;
	return set_locked(name, value) != null;
};

export const do_restore = function(path, content_f) {
	if (!locked() || path != CONFIG) return false;
	let content = readfile(content_f);
	if (content == null) content = '';
	return atomic_replace_locked(path, content) != null;
};

function invoke_locked(mode, name, value) {
	if (!have_flock()) return null;
	let name_f = secure_temp('/tmp/z2m-apply-name.XXXXXX');
	let value_f = secure_temp('/tmp/z2m-apply-value.XXXXXX');
	if (name_f == null || value_f == null) {
		cleanup(name_f); cleanup(value_f);
		return null;
	}
	writefile(name_f, name + '\n');
	writefile(value_f, '' + value);
	let inner = '/usr/bin/ucode ' + APPLY_CLI + ' ' + mode + ' ' + shell_escape(name_f) + ' ' + shell_escape(value_f);
	let cmd = 'Z2M_CONFIG_LOCKED=1 flock -x ' + shell_escape(LOCKFILE) + ' -c ' + shell_escape(inner);
	let r = command(cmd);
	cleanup(name_f); cleanup(value_f);
	return r.rc == 0 ? true : null;
}

export const set_var = function(name, value) {
	if (locked()) return set_locked(name, value);
	if (!have_flock()) return null;
	if (invoke_locked('do_set', name, value) == null) return null;
	let rb = read_var(name);
	if (rb == ('' + value)) return '' + value;
	if (('' + value) == '' && rb != null) return '' + value;
	return null;
};

export const set_var_cas = function(name, value, expected_sha) {
	if (!locked()) return { ok: false, code: 'ELOCK', message: 'config transaction lock is not held' };
	let actual = config_sha256();
	if (expected_sha == null || actual == null || actual != expected_sha)
		return { ok: false, code: 'ECONFLICT', expectedSha256: expected_sha, actualSha256: actual };
	let written = set_locked(name, value);
	if (written == null) return { ok: false, code: 'EWRITE', message: 'durable atomic replace failed' };
	return { ok: true, previousSha256: actual, configSha256: config_sha256(), content: written };
};

export const restore_whole_file = function(path, content) {
	if (path != CONFIG || content == null) return null;
	if (locked()) return atomic_replace_locked(path, '' + content);
	if (!have_flock()) return null;
	let path_f = secure_temp('/tmp/z2m-restore-path.XXXXXX');
	let content_f = secure_temp('/tmp/z2m-restore-content.XXXXXX');
	if (path_f == null || content_f == null) {
		cleanup(path_f); cleanup(content_f);
		return null;
	}
	writefile(path_f, path + '\n');
	writefile(content_f, '' + content);
	let inner = '/usr/bin/ucode ' + APPLY_CLI + ' do_restore_file ' + shell_escape(path_f) + ' ' + shell_escape(content_f);
	let cmd = 'Z2M_CONFIG_LOCKED=1 flock -x ' + shell_escape(LOCKFILE) + ' -c ' + shell_escape(inner);
	let r = command(cmd);
	cleanup(path_f); cleanup(content_f);
	if (r.rc != 0) return null;
	let rb = readfile(path);
	return rb == content ? content : null;
};

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

export const write_list_file = function(path, entries) {
	let out = '';
	for (let i = 0; i < length(entries); i++) {
		let line = trim('' + entries[i]);
		if (!length(line)) continue;
		out += line + '\n';
	}
	let slash = rindex(path, '/');
	let parent = (slash > 0) ? substr(path, 0, slash) : null;
	if (parent) {
		try { mkdir(parent); } catch (e) { }
	}
	let tmp = path + '.tmp.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + path + ' 2>/dev/null', 'r');
	if (p) p.close();
	if (stat(tmp) || !stat(path)) {
		try { unlink(tmp); } catch (e) { }
		return null;
	}
	return out;
};

// Scanner uses the same Apply substrate for observation only. These entry
// points deliberately have no write capability: transient execution is owned
// by the bounded runtime adapter, never by a second config writer.
export const scanner_transient_lock = function(testEvidence) {
	let testHeld = getenv('Z2M_SCANNER_SERVER_TEST') == '1' && testEvidence != null
		&& testEvidence.held == true && testEvidence.owner == 'config/global';
	return getenv('Z2M_CONFIG_LOCKED') == '1' || testHeld
		? { ok: true, owner: 'config/global', held: getenv('Z2M_CONFIG_LOCKED') == '1' || testHeld }
		: { ok: false, code: 'ELOCK', message: 'transient Scanner session requires the existing config transaction lock' };
};

export const scanner_transient_config_snapshot = function() {
	let bytes = read_config_bytes(), sha = config_sha256();
	if (sha == null) return { ok: false, code: 'ESNAPSHOT', message: 'authoritative config snapshot is unavailable' };
	return { ok: true, config: { bytes: bytes, sha256: sha } };
};
