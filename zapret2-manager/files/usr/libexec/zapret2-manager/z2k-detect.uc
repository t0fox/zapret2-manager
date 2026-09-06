'use strict';

// Z2K Core owns the exact upstream Detect artifact. This module only resolves,
// stages and validates the binary; Detect itself remains the upstream algorithm.
import { popen, stat, writefile } from 'fs';

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
	try { let value = stat(path); return object(value) && value.type == 'file' && type(value.size) == 'int'; }
	catch (e) { return false; }
}
function digest(path) {
	if (!regular(path)) return null;
	let result = command("sha256sum " + shell_quote(path) + " | awk '{print $1}'"), value = trim(result.out);
	return result.rc == 0 && valid_digest(value) ? lc(value) : null;
}
function allowed_stage(path, testOnly) {
	return string(path) && (testOnly === true ? substr(path, 0, length(TEST_PATH_PREFIX)) == TEST_PATH_PREFIX
		: substr(path, 0, length(PRODUCTION_STAGE_PREFIX)) == PRODUCTION_STAGE_PREFIX);
}
function allowed_test_target(path) { return string(path) && substr(path, 0, length(TEST_PATH_PREFIX)) == TEST_PATH_PREFIX; }
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
		sha256: type(seams.sha256) == 'function' ? seams.sha256 : digest,
		chmod: type(seams.chmod) == 'function' ? seams.chmod : default_chmod,
		size: type(seams.size) == 'function' ? seams.size : default_size,
		mode: type(seams.mode) == 'function' ? seams.mode : default_mode,
		check: type(seams.check) == 'function' ? seams.check : null
	};
}
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
	let hash = type(input.sha256) == 'function' ? input.sha256 : digest;
	let chmod = type(input.chmod) == 'function' ? input.chmod : default_chmod;
	let check = type(input.check) == 'function' ? input.check : null;
	try {
		if (!fetch(url, stagePath)) return fail('EUNAVAILABLE', 'Selected Detect artifact could not be fetched.', { sourcePath: candidate.sourcePath, url: url });
		let actual = hash(stagePath);
		if (actual == null || lc(actual) != lc(candidate.sha256)) return fail('EVERIFY', 'Fetched Detect bytes do not match the selected manifest SHA-256.', { expectedSha256: candidate.sha256, actualSha256: actual, sourcePath: candidate.sourcePath });
		if (!chmod(stagePath)) return fail('EDETECT_INCOMPATIBLE', 'Fetched Detect artifact could not be marked executable.', { path: stagePath });
		let executable = check != null ? executable_result(stagePath, check) : executable_result(stagePath);
		if (!executable.ok) return executable;
		let size = null;
		try { size = stat(stagePath); } catch (e) { }
		return { ok: true, candidate: { ...candidate, byteSize: size && type(size.size) == 'int' ? size.size : null, executable: true }, stagePath: stagePath, url: url };
	} catch (e) { return fail('EDETECT_INCOMPATIBLE', 'Detect staging failed closed.', { detail: text(e) }); }
};

function detect_restore(publication, seams) {
	let input = object(seams) ? seams : {}, target = object(publication) ? publication.target : null, hooks = hooks_for(input), prior = object(publication) ? publication.prior : null;
	if (!object(publication) || publication.published !== true || !string(target) || (publication.testOnly === true ? !allowed_test_target(target) : target != RUNTIME_TARGET)
		|| !prior || !string(publication.backupPath)) return fail('EINPUT', 'Detect rollback state is invalid.');
	if (prior.exists === true) {
		if (!hooks.exists(publication.backupPath)) return hooks.exists(target) && hooks.sha256(target) == prior.sha256 ? { ok: true, restored: true, alreadyRestored: true } : fail('EROLLBACK', 'Prior stable Detect bytes are unavailable for restoration.');
		if (!hooks.remove(target) || !hooks.copy(publication.backupPath, target) || !hooks.chmod(target, prior.mode)) return fail('EROLLBACK', 'Prior stable Detect state could not be restored.', { target: target });
		if (hooks.sha256(target) != prior.sha256) return fail('EROLLBACK', 'Restored stable Detect bytes do not match the captured state.', { target: target });
		if (!hooks.remove(publication.backupPath) || hooks.exists(publication.backupPath)) return fail('EROLLBACK', 'Restored Detect rollback state could not be closed.', { target: target });
		return { ok: true, restored: true, target: target, sha256: prior.sha256 };
	}
	if (!hooks.remove(target) || hooks.exists(target)) return fail('EROLLBACK', 'Absent prior Detect state could not be restored.', { target: target });
	return { ok: true, restored: true, target: target, absent: true };
}

export const z2k_detect_publish = function(candidate, stagePath, seams) {
	let input = object(seams) ? seams : {}, target = resolve_target(input), hooks = hooks_for(input);
	if (!object(candidate) || candidate.ok !== true || candidate.runtimeTarget != RUNTIME_TARGET || target == null
		|| !allowed_stage(stagePath, input.testOnly === true)) return fail('EINPUT', 'Detect publication target is not the fixed Core target.');
	if (!hooks.exists(stagePath)) return fail('EUNAVAILABLE', 'Verified Detect staging bytes are absent.', { stagePath: stagePath });
	let backup = resolve_backup(input, target), priorExists = hooks.exists(target), prior = { exists: priorExists, sha256: null, byteSize: null, mode: null };
	if (priorExists) {
		prior.sha256 = hooks.sha256(target); prior.byteSize = hooks.size(target); prior.mode = hooks.mode(target);
		if (!valid_digest(prior.sha256) || !hooks.copy(target, backup)) return fail('EVERIFY', 'Prior stable Detect state could not be captured.', { target: target });
	} else if (!hooks.remove(backup)) return fail('EWRITE', 'Stale Detect rollback state could not be cleared.', { backup: backup });
	let temp = target + '.candidate.' + time();
	if (!hooks.copy(stagePath, temp)) { if (priorExists) hooks.remove(backup); return fail('EWRITE', 'Detect candidate could not be copied into the stable target filesystem.'); }
	let actual = hooks.sha256(temp);
	if (actual == null || lc(actual) != lc(candidate.sha256)) { hooks.remove(temp); if (priorExists) hooks.remove(backup); return fail('EVERIFY', 'Detect candidate bytes changed before publication.', { expectedSha256: candidate.sha256, actualSha256: actual }); }
	if (!hooks.chmod(temp)) { hooks.remove(temp); if (priorExists) hooks.remove(backup); return fail('EDETECT_INCOMPATIBLE', 'Detect candidate could not be marked executable.'); }
	let checked = hooks.check != null ? executable_result(temp, hooks.check) : executable_result(temp);
	if (!checked.ok) { hooks.remove(temp); if (priorExists) hooks.remove(backup); return checked; }
	if (!hooks.move(temp, target)) { hooks.remove(temp); if (priorExists) hooks.remove(backup); return fail('EWRITE', 'Detect candidate could not be atomically published.'); }
	actual = hooks.sha256(target);
	if (actual == null || lc(actual) != lc(candidate.sha256)) {
		let publication = { published: true, target: target, testOnly: input.testOnly === true, backupPath: backup, prior: prior, candidate: candidate };
		let restored = detect_restore(publication, input);
		return restored.ok ? fail('EVERIFY', 'Stable Detect target did not retain the verified candidate bytes.', { expectedSha256: candidate.sha256, actualSha256: actual })
			: fail('EROLLBACK', 'Stable Detect target verification failed and the prior state could not be restored.', { expectedSha256: candidate.sha256, actualSha256: actual, restore: restored });
	}
	return { ok: true, published: true, target: target, backupPath: backup, prior: prior, candidate: candidate, testOnly: input.testOnly === true };
};

export const z2k_detect_restore = function(publication, seams) { return detect_restore(publication, seams); };

export const z2k_detect_finalize = function(publication, seams) {
	let input = object(seams) ? seams : {}, hooks = hooks_for(input), target = object(publication) ? publication.target : null;
	if (!object(publication) || publication.published !== true || !string(publication.backupPath)
		|| (publication.testOnly === true ? !allowed_test_target(target) : target != RUNTIME_TARGET)) return fail('EINPUT', 'Detect publication state is invalid.');
	if (object(publication.candidate) && hooks.sha256(target) != publication.candidate.sha256) return fail('EVERIFY', 'Stable Detect target changed before transaction finalization.', { target: target });
	if (!hooks.remove(publication.backupPath) || hooks.exists(publication.backupPath)) return fail('EWRITE', 'Detect rollback state could not be closed.');
	return { ok: true, finalized: true, target: target };
};
