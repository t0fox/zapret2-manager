'use strict';

// Isolated boundary: verified Z2K compiler source snapshot -> official flat
// NFQWS2_OPT. This module owns neither catalog publication nor Apply.

import { popen, readfile, stat, unlink, writefile } from 'fs';
import { private_tempfile } from './core/private-temp.uc';

const REPOSITORY = 'necronicle/z2k';
const SCHEMA = 'z2m.z2k-official-compiler-snapshot.v1';
const DEFAULT_HARNESS = '/usr/libexec/zapret2-manager/z2k-official-compile.sh';
const DEFAULT_TIMEOUT_HELPER = '/usr/libexec/zapret2-manager/z2k-official-timeout.sh';
const REQUIRED_FILES = [
	'strats_new2.txt',
	'quic_strats.ini',
	'lib/utils.sh',
	'lib/strategies.sh',
	'lib/config_official.sh'
];
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const COMPILE_TIMEOUT_SECONDS = 45;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function fail(code, message, phase, path) {
	let result = { ok: false, error: { code: code, message: message, phase: phase } };
	if (path != null) result.error.path = path;
	return result;
}
function shell_quote(value) {
	let result = chr(39), text = '' + value;
	for (let i = 0; i < length(text); i++) {
		let ch = substr(text, i, 1);
		result += ch == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : ch;
	}
	return result + chr(39);
}
function valid_sha(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(value, /^[a-f0-9]{40}$/); }
function file_size(path) {
	let value = null;
	try { value = stat(path); } catch (e) { value = null; }
	return object(value) && type(value.size) == 'int' ? value.size : -1;
}
function run(command) {
	let process = null;
	try { process = popen(command, 'r'); } catch (e) { process = null; }
	if (!process) return { rc: -1, out: '' };
	let out = process.read('all') || '', rc = process.close();
	return { rc: rc, out: out };
}
function digest_text(value) {
	let path = private_tempfile();
	if (path == null || !writefile(path, value)) {
		if (path != null) try { unlink(path); } catch (e) { }
		return null;
	}
	let answer = run("sha256sum " + shell_quote(path) + " 2>/dev/null | awk '{print $1}'");
	try { unlink(path); } catch (e) { }
	let result = trim(answer.out || '');
	return answer.rc == 0 && valid_sha(result) ? result : null;
}
function snapshot_digest(snapshot, fileSha256) {
	let identity = SCHEMA + '\n' + REPOSITORY + '\n' + snapshot.sourceCommit + '\n';
	for (let relative in REQUIRED_FILES)
		identity += relative + '\n' + fileSha256[relative] + '\n';
	return digest_text(identity);
}
function validate_snapshot(snapshot) {
	if (!object(snapshot)) return fail('EINPUT', 'Z2K compiler snapshot is required', 'verify', 'snapshot');
	if (snapshot.repository != REPOSITORY)
		return fail('EPROVENANCE', 'Z2K compiler snapshot repository is not approved', 'verify', 'repository');
	if (!valid_commit(snapshot.sourceCommit))
		return fail('EPROVENANCE', 'Z2K compiler snapshot requires one exact 40-hex commit', 'verify', 'sourceCommit');
	if (!object(snapshot.files) || !object(snapshot.fileSha256))
		return fail('EVERIFY', 'Z2K compiler snapshot files and digests are required', 'verify', 'files');
	let files = {}, digests = {};
	for (let relative in REQUIRED_FILES) {
		let content = snapshot.files[relative], expected = snapshot.fileSha256[relative];
		if (!string(content) || content == '')
			return fail('EVERIFY', 'required Z2K compiler file is missing', 'verify', relative);
		if (length(content) > MAX_FILE_BYTES)
			return fail('EVERIFY', 'Z2K compiler file exceeds the content bound', 'verify', relative);
		if (!valid_sha(expected))
			return fail('EDIGEST', 'required Z2K compiler file digest is missing', 'verify', relative);
		let actual = digest_text(content);
		if (actual == null) return fail('EDIGEST', 'could not hash Z2K compiler file', 'verify', relative);
		if (actual != expected)
			return fail('EDIGEST', 'Z2K compiler file digest does not match the verified snapshot', 'verify', relative);
		files[relative] = content;
		digests[relative] = actual;
	}
	let snapshotDigest = snapshot_digest(snapshot, digests);
	if (snapshotDigest == null) return fail('EDIGEST', 'could not compute compiler snapshot identity', 'verify', 'snapshotDigest');
	return { ok: true, schema: SCHEMA, repository: REPOSITORY,
		sourceCommit: snapshot.sourceCommit, files: files, fileSha256: digests,
		snapshotDigest: snapshotDigest };
}
function safe_temp_root(path) {
	return string(path) && match(path, /^\/tmp\/z2m-z2k-compile\.[A-Za-z0-9]+$/);
}
function make_temp_root() {
	let result = run('umask 077; mktemp -d /tmp/z2m-z2k-compile.XXXXXX 2>/dev/null');
	let root = trim(result.out || '');
	return result.rc == 0 && safe_temp_root(root) ? root : null;
}
function cleanup(root) {
	if (safe_temp_root(root)) run('rm -rf ' + shell_quote(root));
}
function write_snapshot(root, files) {
	let dirs = run('mkdir -p ' + shell_quote(root + '/lib'));
	if (dirs.rc != 0) return false;
	for (let relative in REQUIRED_FILES) {
		let path = root + '/' + relative;
		if (!writefile(path, files[relative])) return false;
		let mode = run('chmod 0600 ' + shell_quote(path));
		if (mode.rc != 0) return false;
	}
	return true;
}
function harness_path() {
	let value = getenv('Z2M_Z2K_OFFICIAL_COMPILE_HARNESS');
	if (value == null || value == '') value = DEFAULT_HARNESS;
	return string(value) && match(value, /^\/[A-Za-z0-9._+@%=-]+(\/[A-Za-z0-9._+@%=-]+)*$/) ? value : null;
}
function timeout_helper_path() {
	let value = getenv('Z2M_Z2K_OFFICIAL_TIMEOUT_HELPER');
	if (value == null || value == '') value = DEFAULT_TIMEOUT_HELPER;
	return string(value) && match(value, /^\/[A-Za-z0-9._+@%=-]+(\/[A-Za-z0-9._+@%=-]+)*$/) ? value : null;
}
function parse_envelope(output) {
	if (!string(output) || length(output) > MAX_STDOUT_BYTES)
		return fail('EOUTPUT', 'official compiler stdout exceeds the bound', 'parse', 'stdout');
	let lines = split(output, '\n');
	if (length(lines) > 0 && lines[length(lines) - 1] == '') pop(lines);
	if (length(lines) < 3 || lines[0] != 'Z2M_NFQWS2_OPT_BEGIN'
		|| lines[length(lines) - 1] != 'Z2M_NFQWS2_OPT_END')
		return fail('EVERIFY', 'official compiler stdout is not a strict NFQWS2_OPT envelope', 'parse', 'stdout');
	let body = join('\n', slice(lines, 1, length(lines) - 1));
	if (body == '') return fail('EVERIFY', 'official compiler produced an empty NFQWS2_OPT', 'parse', 'nfqws2Opt');
	if (match(body, /(^|[ \t\n])--(template|import)(=|[ \t\n]|$)/))
		return fail('EVERIFY', 'official compiler output contains unresolved template/import semantics', 'parse', 'nfqws2Opt');
	let profiles = 1, cursor = 0;
	while (true) {
		let found = index(substr(body, cursor), '--new');
		if (found < 0) break;
		profiles++;
		cursor += found + 5;
	}
	return { ok: true, nfqws2Opt: body, profileCount: profiles };
}

function replace_all(value, needle, replacement) {
	let result = '', cursor = 0;
	while (true) {
		let foundInTail = index(substr(value, cursor), needle);
		if (foundInTail < 0) return result + substr(value, cursor);
		let found = cursor + foundInTail;
		result += substr(value, cursor, found - cursor) + replacement;
		cursor = found + length(needle);
	}
}

// The upstream generator writes hostlist paths below the private compile
// tree.  The directory name is intentionally random, so retaining it would
// make an otherwise identical source snapshot non-deterministic.  Convert
// only the two known generator layouts to logical Z2M resource paths; the
// resource binder resolves those paths to durable assets later.
function canonicalize_resource_paths(value, root) {
	let result = replace_all(value, root + '/lists/', '/runtime-assets/lists/');
	result = replace_all(result, root + '/extra_strats/', '/runtime-assets/lists/extra_strats/');
	// The pinned upstream config uses this legacy durable prefix for the
	// discovered hostlist. Bring it through the same declarative resource
	// binder as the private-tree paths so availability is checked uniformly.
	result = replace_all(result, '/opt/zapret2/lists/', '/runtime-assets/lists/');
	return result;
}

export const z2k_official_compiler_info = function() {
	return { schema: SCHEMA, repository: REPOSITORY, requiredFiles: REQUIRED_FILES,
		templates: 'disabled', timeoutSeconds: COMPILE_TIMEOUT_SECONDS,
		maxStdoutBytes: MAX_STDOUT_BYTES, maxStderrBytes: MAX_STDERR_BYTES };
};

export const z2k_official_compile = function(snapshot) {
	let checked = validate_snapshot(snapshot);
	if (!checked.ok) return checked;
	let harness = harness_path();
	if (harness == null) return fail('EINPUT', 'official compiler harness path is invalid', 'prepare', 'harness');
	let timeoutHelper = timeout_helper_path();
	if (timeoutHelper == null) return fail('EINPUT', 'official compiler timeout helper path is invalid', 'prepare', 'timeoutHelper');
	let root = make_temp_root();
	if (root == null) return fail('EIO', 'could not create a private compiler directory', 'prepare', 'compileRoot');
	let stdoutPath = root + '/stdout', stderrPath = root + '/stderr', result = null;
	try {
		if (!write_snapshot(root, checked.files)) {
			result = fail('EIO', 'could not materialize the verified compiler snapshot', 'prepare', 'files');
		} else {
			let command = 'ulimit -f 1024; exec env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=' + shell_quote(root)
				+ ' ZAPRET2_DIR=' + shell_quote(root) + ' CONFIG_DIR=' + shell_quote(root + '/config.d')
				+ ' Z2K_NFQWS2_TEMPLATES=0 sh ' + shell_quote(timeoutHelper)
				+ ' ' + COMPILE_TIMEOUT_SECONDS + ' ' + shell_quote(harness) + ' ' + shell_quote(root)
				+ ' ' + shell_quote(stdoutPath) + ' ' + shell_quote(stderrPath);
			let executed = run(command), stdoutBytes = file_size(stdoutPath), stderrBytes = file_size(stderrPath);
			if (stdoutBytes < 0 || stderrBytes < 0)
				result = fail('ECOMPILE', 'official compiler did not produce bounded output files', 'compile');
			else if (stdoutBytes > MAX_STDOUT_BYTES)
				result = fail('EOUTPUT', 'official compiler stdout exceeds the bound', 'compile', 'stdout');
			else if (stderrBytes > MAX_STDERR_BYTES)
				result = fail('EOUTPUT', 'official compiler stderr exceeds the bound', 'compile', 'stderr');
			else if (executed.rc == 124)
				result = fail('ETIMEOUT', 'official Z2K compiler exceeded its timeout', 'compile');
			else if (executed.rc != 0)
				result = fail('ECOMPILE', 'official Z2K compiler exited with code ' + executed.rc, 'compile');
				else {
					let parsed = parse_envelope(readfile(stdoutPath) || '');
					if (!parsed.ok) result = parsed;
					else {
						parsed.nfqws2Opt = canonicalize_resource_paths(parsed.nfqws2Opt, root);
						if (index(parsed.nfqws2Opt, root + '/') >= 0)
							result = fail('EVERIFY', 'official compiler output retained a private compile path', 'parse', 'nfqws2Opt');
						else {
							let outputDigest = digest_text(parsed.nfqws2Opt);
							result = outputDigest == null ? fail('EDIGEST', 'could not hash official NFQWS2_OPT', 'parse', 'nfqws2Opt') : {
								ok: true, schema: SCHEMA, repository: REPOSITORY,
								sourceCommit: snapshot.sourceCommit,
								compilerSnapshotDigest: checked.snapshotDigest,
								nfqws2Opt: parsed.nfqws2Opt, nfqws2OptSha256: outputDigest,
								diagnostics: { templates: 'disabled', profileCount: parsed.profileCount,
									stdoutBytes: stdoutBytes, stderrBytes: stderrBytes, isolation: 'private-temp-tree' }
							};
						}
					}
				}
		}
	} catch (e) {
		result = fail('ECOMPILE', 'official Z2K compiler invocation failed', 'compile');
	}
	cleanup(root);
	return result || fail('ECOMPILE', 'official Z2K compiler did not return a result', 'compile');
};
