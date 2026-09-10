'use strict';
// apply.uc — the SINGLE writer for /opt/zapret2/config (upstream's shell config).
//
// This is the sanctioned apply path: the only place in the shipped tree that
// writes /opt/zapret2/config. service.uc (pause and rollback lifecycle) calls
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

// Resource Center uses the same Apply writer for transaction evidence.  These
// helpers only capture/restore the canonical config file; they do not create a
// second config authority or bypass the existing lock/CAS boundary.
export const transaction_config_snapshot = function() {
	let bytes = read_config_bytes(), digest = config_sha256();
	return digest == null ? { ok: false, error: { code: 'ESNAPSHOT', message: 'authoritative active config is unavailable' } }
		: { ok: true, bytes: bytes, sha256: digest };
};

export const restore_transaction_config = function(snapshot, lockedOverride) {
	if (!snapshot || snapshot.sha256 == null || snapshot.bytes == null) return { ok: false, error: { code: 'EINPUT', message: 'active config rollback evidence is incomplete' } };
	let rollbackError = { ok: false, error: { code: 'EROLLBACK', message: 'active config could not be restored to its recorded digest' } };
	// An existing transaction lock (or the explicit caller-owned override)
	// already provides the authority for the digest check and write.
	// Keep this path synchronous so lockedOverride retains its established
	// caller-owned-lock semantics.
	if (locked() || lockedOverride === true) {
		let current = config_sha256();
		if (current == snapshot.sha256) return { ok: true, alreadyRestored: true, sha256: snapshot.sha256 };
		let restored = restore_whole_file('/opt/zapret2/config', snapshot.bytes, lockedOverride === true);
		if (restored == null || config_sha256() != snapshot.sha256) return rollbackError;
		return { ok: true, restored: true, sha256: snapshot.sha256 };
	}

	// Without a caller-owned lock the digest check, restore, and verification
	// must be one flock/CAS operation.  Calling the existing apply CLI keeps the
	// canonical writer and its atomic_replace_locked() boundary in charge.
	if (!have_flock()) return rollbackError;
	let path_f = secure_temp('/tmp/z2m-transaction-restore-path.XXXXXX');
	let content_f = secure_temp('/tmp/z2m-transaction-restore-content.XXXXXX');
	if (path_f == null || content_f == null) {
		cleanup(path_f); cleanup(content_f);
		return rollbackError;
	}
	try {
		writefile(path_f, '/opt/zapret2/config\n');
		writefile(content_f, '' + snapshot.bytes);
	} catch (e) {
		cleanup(path_f); cleanup(content_f);
		return rollbackError;
	}
	let digest_cmd = "sha256sum " + shell_escape('/opt/zapret2/config') + " 2>/dev/null | cut -d ' ' -f 1";
	let expected = shell_escape(snapshot.sha256);
	let inner = 'current=$(' + digest_cmd + '); ' +
		'if [ "$current" = ' + expected + ' ]; then printf already; ' +
		'elif /usr/bin/ucode ' + shell_escape(APPLY_CLI) + ' do_restore_file ' + shell_escape(path_f) + ' ' + shell_escape(content_f) +
		' >/dev/null && [ "$(' + digest_cmd + ')" = ' + expected + ' ]; then printf restored; else exit 1; fi';
	let cmd = 'Z2M_CONFIG_LOCKED=1 flock -x ' + shell_escape(LOCKFILE) + ' -c ' + shell_escape(inner);
	let result = command(cmd);
	cleanup(path_f); cleanup(content_f);
	let outcome = trim(result.out);
	if (result.rc != 0) return rollbackError;
	if (outcome == 'already') return { ok: true, alreadyRestored: true, sha256: snapshot.sha256 };
	if (outcome == 'restored') return { ok: true, restored: true, sha256: snapshot.sha256 };
	return rollbackError;
};

const APPLIED_IDENTITY = getenv('Z2M_APPLIED_IDENTITY') || '/tmp/zapret2-manager/applied.sha256';

function file_sha256(path) {
	if (!stat(path)) return null;
	let r = command("sha256sum " + shell_escape(path) + " 2>/dev/null | awk '{print $1}'");
	let digest = trim(r.out);
	return r.rc == 0 && length(digest) == 64 ? digest : null;
}

// Commit point for the status identity. Callers must invoke this only after
// the owning transaction has verified the runtime; snapshots and pre-CAS
// states must never update this marker.
export const commit_applied_identity = function() {
	let identity = { config: config_sha256(), uci: file_sha256(PATHS.uci_conf), captured_at: time() };
	if (identity.config == null) return null;
	try { writefile(APPLIED_IDENTITY, sprintf('%J', identity) + '\n'); }
	catch (e) { return null; }
	return identity;
};

function preserve_trailing_newline(raw, rendered) {
	if (length(raw) > 0 && substr(raw, length(raw) - 1, 1) == '\n' &&
	    (length(rendered) == 0 || substr(rendered, length(rendered) - 1, 1) != '\n'))
		return rendered + '\n';
	return rendered;
}

function atomic_replace_locked(path, content, callerHoldsLock) {
	// The caller-owned transaction lock may use the same atomic writer without
	// recursively flocking; every other caller still requires Z2M_CONFIG_LOCKED=1.
	if ((!locked() && callerHoldsLock !== true) || path != CONFIG) return null;
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

const set_vars_locked = function(vars_map) {
	if (!locked()) return null;
	let raw = read_config_bytes();
	let current = raw;
	for (let name in vars_map) {
		let val = vars_map[name];
		current = render_var(current, name, val == null ? '' : '' + val);
	}
	let out = preserve_trailing_newline(raw, current);
	return atomic_replace_locked(CONFIG, out);
};

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

export const set_vars_cas = function(vars_map, expected_sha) {
	if (!locked()) return { ok: false, code: 'ELOCK', message: 'config transaction lock is not held' };
	let actual = config_sha256();
	if (expected_sha == null || actual == null || actual != expected_sha)
		return { ok: false, code: 'ECONFLICT', expectedSha256: expected_sha, actualSha256: actual };
	let written = set_vars_locked(vars_map);
	if (written == null) return { ok: false, code: 'EWRITE', message: 'durable atomic replace failed' };
	return { ok: true, previousSha256: actual, configSha256: config_sha256(), content: written };
};

export const set_var_cas = function(name, value, expected_sha) {
	let vars_map = {};
	vars_map[name] = value;
	return set_vars_cas(vars_map, expected_sha);
};

export const restore_whole_file = function(path, content, lockedOverride) {
	if (path != CONFIG || content == null) return null;
	if (locked() || lockedOverride === true) return atomic_replace_locked(path, '' + content, lockedOverride === true);
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
