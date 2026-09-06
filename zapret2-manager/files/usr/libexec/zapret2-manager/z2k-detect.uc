'use strict';

// Z2K Core owns the exact upstream Detect artifact. This module only resolves,
// stages and validates the binary; Detect itself remains the upstream algorithm.
import { popen, stat, readlink, writefile } from 'fs';

const RUNTIME_TARGET = '/usr/libexec/zapret2-manager/z2k-detect';
const REPOSITORY = 'necronicle/z2k';
const TEST_PATH_PREFIX = '/tmp/z2m-z2k-detect-test-';
const PRODUCTION_STAGE_PREFIX = '/tmp/z2m-resource-update/';
const PRODUCTION_ROLLBACK = '/etc/zapret2-manager/z2k-detect.rollback';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function fail(code, message, details) {
	let out = { ok: false, error: { code: code, message: message } };
	for (let key in details || {}) out.error[key] = details[key];
	return out;
}
function shell_quote(value) {
	let out = "'", raw = text(value);
	for (let i = 0; i < length(raw); i++) out += substr(raw, i, 1) == "'" ? "'\\''" : substr(raw, i, 1);
	return out + "'";
}
function command(value) {
	let process = popen(value + ' 2>&1', 'r');
	if (!process) return { rc: -1, out: '' };
	let out = process.read('all') || '', rc = process.close();
	return { rc: rc, out: out };
}
function regular(path) {
	try { let value = stat(path); return object(value) && value.type == 'file' && readlink(path) == null && type(value.size) == 'int'; }
	catch (e) { return false; }
}
function digest(path) {
	if (!regular(path)) return null;
	let result = command("sha256sum " + shell_quote(path) + " | awk '{print $1}'"), value = trim(result.out);
	return result.rc == 0 && valid_digest(value) ? lc(value) : null;
}
function allowed_stage(path, testOnly) {
	let prefix = testOnly === true ? TEST_PATH_PREFIX : PRODUCTION_STAGE_PREFIX;
	if (!string(path) || index(path, '\\') >= 0 || substr(path, 0, length(prefix)) != prefix) return false;
	let parts = split(path, '/');
	for (let i = 0; i < length(parts); i++) if (parts[i] == '..') return false;
	return true;
}
function allowed_test_target(path) { return allowed_stage(path, true); }
function resolve_target(input) {
	if (object(input) && input.testOnly === true) return allowed_test_target(input.target) ? input.target : null;
	return RUNTIME_TARGET;
}
function resolve_backup(input, target) {
	if (object(input) && input.testOnly === true) return allowed_test_target(input.backup) ? input.backup : target + '.rollback';
	return PRODUCTION_ROLLBACK;
}
function default_exists(path) { return regular(path); }
function default_copy(from, to) { return command('cp -f ' + shell_quote(from) + ' ' + shell_quote(to)).rc == 0 && regular(to); }
function default_move(from, to) { return command('mv -f ' + shell_quote(from) + ' ' + shell_quote(to)).rc == 0; }
function default_remove(path) { return command('rm -f ' + shell_quote(path)).rc == 0; }
function default_size(path) { try { let value = stat(path); return value && type(value.size) == 'int' ? value.size : null; } catch (e) { return null; } }
function default_mode(path) { try { let value = stat(path); return value && type(value.mode) == 'int' ? value.mode : 493; } catch (e) { return 493; } }
function default_chmod(path, mode) {
	let value = type(mode) == 'int' ? mode & 511 : 493;
	return command('chmod ' + sprintf('%03o', value) + ' ' + shell_quote(path)).rc == 0;
}
function default_check(path) {
	// No argv crosses this boundary. The fixed internal invocation asks the OS
	// to load the file and is only an executable-format/permission preflight.
	let result = command(shell_quote(path));
	if (result.rc == 0) return { rc: 0 };
	let output = lc(result.out || '');
	if (index(output, 'exec format error') >= 0) return { rc: 126, error: 'ENOEXEC' };
	if (index(output, 'permission denied') >= 0 || index(output, 'not executable') >= 0)
		return { rc: 126, error: 'EACCES' };
	// A valid executable is allowed to return its own usage/error code when
	// invoked without arguments; only loader and permission failures reject it.
	return { rc: 0 };
}
function hooks_for(input) {
	let seams = object(input) ? input : {};
	return {
		exists: type(seams.exists) == 'function' ? seams.exists : default_exists,
		copy: type(seams.copy) == 'function' ? seams.copy : default_copy,
		move: type(seams.move) == 'function' ? seams.move : default_move,
		remove: type(seams.remove) == 'function' ? seams.remove : default_remove,
		regular: type(seams.regular) == 'function' ? seams.regular : regular,
		sha256: type(seams.sha256) == 'function' ? seams.sha256 : digest,
		chmod: type(seams.chmod) == 'function' ? seams.chmod : default_chmod,
		size: type(seams.size) == 'function' ? seams.size : default_size,
		mode: type(seams.mode) == 'function' ? seams.mode : default_mode,
		check: type(seams.check) == 'function' ? seams.check : null
	};
}
function stage_failure(remove, path, result) { try { remove(path); } catch (e) {} return result; }
function executable_result(path, runner) {
	let result;
	try { result = type(runner) == 'function' ? runner(path) : default_check(path); }
	catch (e) { return fail('EDETECT_INCOMPATIBLE', 'Detect executable could not be executed.', { detail: text(e) }); }
	if (!object(result) || result.ok === false || (result.ok !== true && result.rc != 0) || result.error == 'ENOEXEC' || result.error == 'EACCES' || result.error == 'EPERM')
		return fail('EDETECT_INCOMPATIBLE', 'Detect executable format or permissions are invalid.', { path: path, reason: result && result.error || 'execution-failed' });
	return { ok: true, path: path };
}

export const z2k_detect_arch = function(machine) {
	if (!string(machine)) return null;
	let map = { aarch64: 'arm64', x86_64: 'amd64', mipsel: 'mipsle', mips: 'mips', riscv64: 'riscv64' };
	return map[machine] || null;
};

export const z2k_detect_candidate = function(manifest, sourceCommit, machine) {
	if (!valid_commit(sourceCommit)) return fail('ECOMPATIBILITY', 'Detect sourceCommit must be the selected exact Z2K commit.');
	let arch = z2k_detect_arch(machine);
	if (arch == null) return fail('EDETECT_UNAVAILABLE', 'Router architecture is not supported by the upstream Detect artifacts.', { machine: machine || null });
	let sourcePath = 'z2k-detect/builds/z2k-detect-linux-' + arch;
	let files = object(manifest) && object(manifest.files_sha256) ? manifest.files_sha256 : null;
	let sha256 = files && files[sourcePath];
	if (!valid_digest(sha256)) return fail('EDETECT_UNAVAILABLE', 'Selected manifest has no exact Detect artifact for the router architecture.', { sourcePath: sourcePath, sourceCommit: lc(sourceCommit) });
	return { ok: true, arch: arch, sourceCommit: lc(sourceCommit), sourcePath: sourcePath,
		sha256: lc(sha256), runtimeTarget: RUNTIME_TARGET, byteSize: null, executable: true };
};

function default_fetch(url, path) { return command('uclient-fetch -q -O ' + shell_quote(path) + ' ' + shell_quote(url)).rc == 0 && regular(path); }

export const z2k_detect_executable_check = function(path, runner, options) {
	let input = object(options) ? options : {};
	if (input.testOnly === true ? !allowed_test_target(path) : path != RUNTIME_TARGET)
		return fail('EDETECT_INCOMPATIBLE', 'Detect executable check is restricted to the fixed Core target.');
	return executable_result(path, runner);
};

export const z2k_detect_stage = function(candidate, stagePath, seams) {
	let input = object(seams) ? seams : {};
	if (!object(candidate) || candidate.ok !== true || !valid_commit(candidate.sourceCommit) || !valid_digest(candidate.sha256)
		|| candidate.runtimeTarget != RUNTIME_TARGET || !allowed_stage(stagePath, input.testOnly === true))
		return fail('EINPUT', 'Detect staging candidate is invalid.');
	let url = 'https://raw.githubusercontent.com/' + REPOSITORY + '/' + candidate.sourceCommit + '/' + candidate.sourcePath;
	let fetch = type(input.fetch) == 'function' ? input.fetch : default_fetch;
	let isRegular = type(input.regular) == 'function' ? input.regular : regular;
	let remove = type(input.remove) == 'function' ? input.remove : default_remove;
	let hash = type(input.sha256) == 'function' ? input.sha256 : digest;
	let chmod = type(input.chmod) == 'function' ? input.chmod : default_chmod;
	let check = type(input.check) == 'function' ? input.check : null;
	try {
		if (!fetch(url, stagePath)) return stage_failure(remove, stagePath, fail('EUNAVAILABLE', 'Selected Detect artifact could not be fetched.', { sourcePath: candidate.sourcePath, url: url }));
		if (!isRegular(stagePath)) return stage_failure(remove, stagePath, fail('EDETECT_INCOMPATIBLE', 'Selected Detect stage is not a regular non-symlink file.', { path: stagePath }));
		let actual = hash(stagePath);
		if (actual == null || lc(actual) != lc(candidate.sha256)) return stage_failure(remove, stagePath, fail('EVERIFY', 'Fetched Detect bytes do not match the selected manifest SHA-256.', { expectedSha256: candidate.sha256, actualSha256: actual, sourcePath: candidate.sourcePath }));
		if (!chmod(stagePath)) return stage_failure(remove, stagePath, fail('EDETECT_INCOMPATIBLE', 'Fetched Detect artifact could not be marked executable.', { path: stagePath }));
		let executable = check != null ? executable_result(stagePath, check) : executable_result(stagePath);
		if (!executable.ok) return stage_failure(remove, stagePath, executable);
		let size = null;
		try { size = stat(stagePath); } catch (e) { }
		return { ok: true, candidate: { ...candidate, byteSize: size && type(size.size) == 'int' ? size.size : null, executable: true }, stagePath: stagePath, url: url };
	} catch (e) { return stage_failure(remove, stagePath, fail('EDETECT_INCOMPATIBLE', 'Detect staging failed closed.', { detail: text(e) })); }
};

function publication_valid(publication) {
	return object(publication) && (publication.prepared === true || publication.published === true) && string(publication.target)
		&& (publication.testOnly === true ? allowed_test_target(publication.target) : publication.target == RUNTIME_TARGET)
		&& object(publication.prior) && string(publication.backupPath) && object(publication.candidate)
		&& valid_digest(publication.candidate.sha256);
}
function publication_state(publication, hooks) {
	let target = publication.target, prior = publication.prior, present = hooks.exists(target);
	if (!present) return prior.exists === true ? 'absent-after-prior' : 'prior-absent';
	if (!hooks.regular(target)) return 'invalid';
	let actual = hooks.sha256(target);
	if (actual != null && lc(actual) == lc(publication.candidate.sha256)) return 'candidate';
	if (prior.exists === true && actual != null && lc(actual) == lc(prior.sha256)) return 'prior';
	return 'unknown';
}
function close_backup(publication, hooks) {
	if (hooks.exists(publication.backupPath) && !hooks.remove(publication.backupPath)) return false;
	return !hooks.exists(publication.backupPath);
}
function detect_restore(publication, seams) {
	let input = object(seams) ? seams : {}, hooks = hooks_for(input);
	if (!publication_valid(publication)) return fail('EINPUT', 'Detect rollback state is invalid.');
	let prior = publication.prior, state = publication_state(publication, hooks), target = publication.target;
	// A completed publication can fail its post-move verification with bytes
	// that are neither the candidate nor the captured prior bytes. The backup
	// still belongs to this Core transaction, so restore it; a PREPARED intent
	// with an unknown target remains fail-closed for recovery instead.
	if ((state == 'invalid' || state == 'unknown') && publication.published === true) state = 'candidate';
	if (state == 'invalid' || state == 'unknown') return fail('EROLLBACK', 'Stable Detect state is neither the captured prior bytes nor the selected candidate.', { target: target, state: state });
	if (state == 'candidate' || state == 'absent-after-prior') {
		if (prior.exists === true) {
			if (!hooks.exists(publication.backupPath) || !hooks.remove(target) || !hooks.copy(publication.backupPath, target) || !hooks.chmod(target, prior.mode)) return fail('EROLLBACK', 'Prior stable Detect state could not be restored.', { target: target });
			if (!hooks.regular(target) || hooks.sha256(target) != prior.sha256) return fail('EROLLBACK', 'Restored stable Detect bytes do not match the captured state.', { target: target });
		} else if (!hooks.remove(target) || hooks.exists(target)) return fail('EROLLBACK', 'Absent prior Detect state could not be restored.', { target: target });
	}
	if (state == 'prior' && (prior.exists !== true || hooks.sha256(target) != prior.sha256)) return fail('EROLLBACK', 'Stable Detect prior state verification failed.', { target: target });
	if (!close_backup(publication, hooks)) return fail('EROLLBACK', 'Detect rollback state could not be closed.', { target: target });
	return { ok: true, restored: true, target: target, sha256: prior.exists === true ? prior.sha256 : null, absent: prior.exists !== true, state: state };
}

export const z2k_detect_prepare = function(candidate, stagePath, seams) {
	let input = object(seams) ? seams : {}, target = resolve_target(input), hooks = hooks_for(input);
	if (!object(candidate) || candidate.ok !== true || candidate.runtimeTarget != RUNTIME_TARGET || !valid_digest(candidate.sha256) || target == null
		|| !allowed_stage(stagePath, input.testOnly === true)) return fail('EINPUT', 'Detect publication target is not the fixed Core target.');
	if (!hooks.regular(stagePath)) return fail('EUNAVAILABLE', 'Verified Detect staging bytes are absent or not a regular file.', { stagePath: stagePath });
	let stagedSha = hooks.sha256(stagePath);
	if (stagedSha == null || lc(stagedSha) != lc(candidate.sha256)) return fail('EVERIFY', 'Detect staging bytes do not match the selected candidate.', { stagePath: stagePath });
	if (hooks.exists(target) && !hooks.regular(target)) return fail('EDETECT_INCOMPATIBLE', 'Stable Detect target is not a regular non-symlink file.', { target: target });
	let backup = resolve_backup(input, target), priorExists = hooks.regular(target), prior = { exists: priorExists, sha256: null, byteSize: null, mode: null };
	if (priorExists) {
		prior.sha256 = hooks.sha256(target); prior.byteSize = hooks.size(target); prior.mode = hooks.mode(target);
		if (!valid_digest(prior.sha256) || !hooks.copy(target, backup)) return fail('EVERIFY', 'Prior stable Detect state could not be captured.', { target: target });
	} else if (!hooks.remove(backup)) return fail('EWRITE', 'Stale Detect rollback state could not be cleared.', { backup: backup });
	return { ok: true, prepared: true, published: false, target: target, backupPath: backup, prior: prior, candidate: candidate, testOnly: input.testOnly === true };
};

function publication_failure(publication, hooks, code, message, details) {
	let restored = detect_restore(publication, hooks), result = fail(restored.ok ? code : 'EROLLBACK', restored.ok ? message : 'Detect publication failed and stable state could not be restored.', details || {});
	result.error.restore = restored;
	return result;
}

export const z2k_detect_publish_prepared = function(publication, stagePath, seams) {
	let input = object(seams) ? seams : {}, hooks = hooks_for(input);
	if (!publication_valid(publication) || publication.prepared !== true || !allowed_stage(stagePath, input.testOnly === true)) return fail('EINPUT', 'Detect prepared publication state is invalid.');
	if (!hooks.regular(stagePath)) return publication_failure(publication, hooks, 'EUNAVAILABLE', 'Verified Detect staging bytes are absent or not a regular file.', { stagePath: stagePath });
	let temp = publication.target + '.candidate.' + time();
	if (!hooks.copy(stagePath, temp)) return publication_failure(publication, hooks, 'EWRITE', 'Detect candidate could not be copied into the stable target filesystem.');
	let actual = hooks.sha256(temp);
	if (actual == null || lc(actual) != lc(publication.candidate.sha256)) { hooks.remove(temp); return publication_failure(publication, hooks, 'EVERIFY', 'Detect candidate bytes changed before publication.', { expectedSha256: publication.candidate.sha256, actualSha256: actual }); }
	if (!hooks.chmod(temp)) { hooks.remove(temp); return publication_failure(publication, hooks, 'EDETECT_INCOMPATIBLE', 'Detect candidate could not be marked executable.'); }
	let checked = hooks.check != null ? executable_result(temp, hooks.check) : executable_result(temp);
	if (!checked.ok) { hooks.remove(temp); return publication_failure(publication, hooks, checked.error.code, checked.error.message); }
	if (type(input.beforeMove) == 'function') {
		try { if (input.beforeMove(publication) === false) { hooks.remove(temp); return publication_failure(publication, hooks, 'EWRITE', 'Detect publication was interrupted before the stable target move.'); } }
		catch (e) { hooks.remove(temp); return publication_failure(publication, hooks, 'EWRITE', 'Detect publication callback failed before the stable target move.', { detail: text(e) }); }
	}
	let moving = { ...publication, published: true };
	if (!hooks.move(temp, publication.target)) { hooks.remove(temp); return publication_failure(moving, hooks, 'EWRITE', 'Detect candidate could not be atomically published.'); }
	actual = hooks.sha256(publication.target);
	if (actual == null || lc(actual) != lc(publication.candidate.sha256)) return publication_failure(moving, hooks, 'EVERIFY', 'Stable Detect target did not retain the verified candidate bytes.', { expectedSha256: publication.candidate.sha256, actualSha256: actual });
	return moving;
};

export const z2k_detect_publish = function(candidate, stagePath, seams) {
	let prepared = z2k_detect_prepare(candidate, stagePath, seams);
	return prepared.ok ? z2k_detect_publish_prepared(prepared, stagePath, seams) : prepared;
};

export const z2k_detect_restore = function(publication, seams) { return detect_restore(publication, seams); };

export const z2k_detect_finalize = function(publication, seams) {
	let input = object(seams) ? seams : {}, hooks = hooks_for(input), target = object(publication) ? publication.target : null;
	if (!publication_valid(publication)) return fail('EINPUT', 'Detect publication state is invalid.');
	if (object(publication.candidate) && hooks.sha256(target) != publication.candidate.sha256) return fail('EVERIFY', 'Stable Detect target changed before transaction finalization.', { target: target });
	if (!close_backup(publication, hooks)) return fail('EWRITE', 'Detect rollback state could not be closed.');
	return { ok: true, finalized: true, target: target };
};
