'use strict';

// Z2K Core owns the exact upstream Detect artifact. This module only resolves,
// stages and validates the binary; Detect itself remains the upstream algorithm.
import { popen, stat, writefile } from 'fs';

const RUNTIME_TARGET = '/usr/libexec/zapret2-manager/z2k-detect';
const REPOSITORY = 'necronicle/z2k';

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
function default_chmod(path) { return command('chmod 0755 ' + shell_quote(path)).rc == 0; }
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

export const z2k_detect_executable_check = function(path, runner) {
	if (!string(path) || substr(path, 0, 1) != '/') return fail('EDETECT_INCOMPATIBLE', 'Detect executable path is not absolute.');
	let result;
	try { result = type(runner) == 'function' ? runner(path) : default_check(path); }
	catch (e) { return fail('EDETECT_INCOMPATIBLE', 'Detect executable could not be executed.', { detail: text(e) }); }
	if (!object(result) || result.rc != 0 || result.error == 'ENOEXEC' || result.error == 'EACCES' || result.error == 'EPERM')
		return fail('EDETECT_INCOMPATIBLE', 'Detect executable format or permissions are invalid.', { path: path, reason: result && result.error || 'execution-failed' });
	return { ok: true, path: path };
};

export const z2k_detect_stage = function(candidate, stagePath, seams) {
	if (!object(candidate) || candidate.ok !== true || !valid_commit(candidate.sourceCommit) || !valid_digest(candidate.sha256)
		|| candidate.runtimeTarget != RUNTIME_TARGET || !string(stagePath) || substr(stagePath, 0, 1) != '/')
		return fail('EINPUT', 'Detect staging candidate is invalid.');
	let input = object(seams) ? seams : {}, url = 'https://raw.githubusercontent.com/' + REPOSITORY + '/' + candidate.sourceCommit + '/' + candidate.sourcePath;
	let fetch = type(input.fetch) == 'function' ? input.fetch : default_fetch;
	let hash = type(input.sha256) == 'function' ? input.sha256 : digest;
	let chmod = type(input.chmod) == 'function' ? input.chmod : default_chmod;
	let check = type(input.check) == 'function' ? input.check : function(path) { return z2k_detect_executable_check(path); };
	try {
		if (!fetch(url, stagePath)) return fail('EUNAVAILABLE', 'Selected Detect artifact could not be fetched.', { sourcePath: candidate.sourcePath, url: url });
		let actual = hash(stagePath);
		if (actual == null || lc(actual) != lc(candidate.sha256)) return fail('EVERIFY', 'Fetched Detect bytes do not match the selected manifest SHA-256.', { expectedSha256: candidate.sha256, actualSha256: actual, sourcePath: candidate.sourcePath });
		if (!chmod(stagePath)) return fail('EDETECT_INCOMPATIBLE', 'Fetched Detect artifact could not be marked executable.', { path: stagePath });
		let executable = check(stagePath);
		if (!executable || executable.ok !== true) return executable && executable.error ? executable : fail('EDETECT_INCOMPATIBLE', 'Fetched Detect artifact failed executable preflight.', { path: stagePath });
		let size = stat(stagePath);
		return { ok: true, candidate: { ...candidate, byteSize: size && type(size.size) == 'int' ? size.size : null, executable: true }, stagePath: stagePath, url: url };
	} catch (e) { return fail('EDETECT_INCOMPATIBLE', 'Detect staging failed closed.', { detail: text(e) }); }
};
