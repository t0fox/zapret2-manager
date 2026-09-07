'use strict';

// Z2K Core owns the exact upstream Detect artifact. This module only resolves,
// stages and validates the binary; Detect itself remains the upstream algorithm.
import { popen, stat, readlink, readfile, writefile, unlink } from 'fs';
import * as native_helper from './core/native-helper.uc';
import * as detect_result from './core/detect-result.uc';
import { asset_registry_list } from './asset-registry.uc';
import { z2k_registry_receipt_state } from './z2k-installed-release.uc';
import { z2k_release_valid } from './z2k-release.uc';
import * as runtime_composition from './runtime-composition.uc';

const RUNTIME_TARGET = '/usr/libexec/zapret2-manager/z2k-detect';
const REPOSITORY = 'necronicle/z2k';
const TEST_PATH_PREFIX = '/tmp/z2m-z2k-detect-test-';
const PRODUCTION_STAGE_PREFIX = '/tmp/z2m-resource-update/';
const PRODUCTION_ROLLBACK = '/etc/zapret2-manager/z2k-detect.rollback';
const DISCOVERY_CONFIG = '/etc/zapret2-manager/z2k-detect-discovery.json';
const DISCOVERY_LIST = '/opt/zapret2/lists/discovered-domains.txt';
const DISCOVERY_INSTANCE = 'z2k-detect';
const DISCOVERY_SOURCES = ['auto', 'agh', 'dnsmasq', 'pkt'];

const DETECT_OPERATIONS = ['z2k_detect_probe', 'z2k_detect_classify', 'z2k_detect_quic', 'z2k_detect_voice', 'z2k_detect_tcp16'];
const DETECT_STATUS_SCHEMA = 1;
const DETECT_MAX_INPUT_BYTES = 4096;
const DETECT_MAX_STATUS_BYTES = 16384;
const CANONICAL_DETECT_ERRORS = ['EZ2K_NOT_INSTALLED', 'EZ2K_INCOHERENT', 'EDETECT_UNAVAILABLE', 'EDETECT_INCOMPATIBLE', 'EDETECT_TIMEOUT', 'EDETECT_FAILED', 'EDETECT_SCHEMA', 'EDETECT_NO_TARGET', 'EDETECT_NO_ACTIVE_VOICE'];
const DETECT_UNSAFE_INPUT_FIELDS = ['executable', 'argv', 'command', 'env', 'cwd', 'raw', 'shell', 'flags', 'path'];
let detect_status;

function object(value) { return type(value) == 'object' && value != null; }
function detect_cli_argv() {
	try { return ARGV; } catch (e) { return []; }
}
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function fail(code, message, details) {
	let out = { ok: false, error: { code: code, message: message } };
	for (let key in details || {}) out.error[key] = details[key];
	return out;
}
function detect_failure_details(data) {
	let details = {
		exitCode: data.exitCode, timedOut: data.timedOut, outputTruncated: data.outputTruncated,
	};
	if (string(data.stderr) && length(data.stderr)) details.stderr = substr(data.stderr, 0, 4096);
	return details;
}
function detect_error_normalize(response) {
	let source = response && object(response.error) ? response.error : {};
	let code = index(CANONICAL_DETECT_ERRORS, source.code) >= 0 ? source.code : 'EDETECT_FAILED';
	let message = string(source.message) && length(source.message) <= 320 ? source.message : 'Z2K Detect operation failed.';
	let out = fail(code, message);
	if (object(source.details)) {
		try { if (length(sprintf('%J', source.details)) <= 8192) out.error.details = source.details; } catch (e) { }
	}
	return out;
}

function detect_status_fail(code, message, details) {
	return fail(code, message, details);
}

function discovery_config_normalize(value) {
	if (value == null) return { ok: true, schema: 1, enabled: false, dnsSource: 'auto' };
	if (!object(value) || value.schema !== 1 || type(value.enabled) != 'bool' ||
		!string(value.dnsSource) || index(DISCOVERY_SOURCES, value.dnsSource) < 0)
		return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is invalid.');
	return { ok: true, schema: 1, enabled: value.enabled, dnsSource: value.dnsSource };
}

function discovery_config_read(seams) {
	let hooks = object(seams) ? seams : {}, raw = null;
	if (type(hooks.present) == 'bool') {
		if (hooks.present !== true) return discovery_config_normalize(null);
		if (hooks.dangling === true || hooks.link != null) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is a symlink.');
		if (hooks.readable === false || hooks.raw == null) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is unreadable.');
		raw = hooks.raw;
	} else {
		let presence = popen("if [ -L '/etc/zapret2-manager/z2k-detect-discovery.json' ]; then printf symlink; elif [ -e '/etc/zapret2-manager/z2k-detect-discovery.json' ]; then printf present; else printf absent; fi", 'r');
		if (!presence) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration could not be inspected.');
		let state = trim(presence.read('all') || ''), presenceRc = presence.close();
		if (presenceRc != 0) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration could not be inspected.');
		if (state == 'symlink') return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is a symlink.');
		if (state == 'absent') return discovery_config_normalize(null);
		if (state != 'present') return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration could not be inspected.');
		let st = null;
		try { st = stat(DISCOVERY_CONFIG); } catch (e) { return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration could not be inspected.'); }
		if (st == null) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is unreadable.');
		if (st.type != 'file' || readlink(DISCOVERY_CONFIG) != null) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is not a regular file.');
		raw = readfile(DISCOVERY_CONFIG);
		if (raw == null) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is unreadable.');
	}
	if (!string(raw) || !length(trim(raw))) return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is empty.');
	try { return discovery_config_normalize(json(raw)); }
	catch (e) { return fail('EDETECT_SCHEMA', 'Z2K Detect discovery configuration is not valid JSON.'); }
}

export const z2k_detect_discovery_config = function(value) { return discovery_config_normalize(value); };
export const z2k_detect_discovery_config_read = function(seams) { return discovery_config_read(seams); };

function discovery_process_invalid(count) {
	return { instance: DISCOVERY_INSTANCE, running: false, pid: null, count: type(count) == 'int' ? count : 0, validated: false, executable: null, outputOwned: false, command: [] };
}

function discovery_command_valid(argv) {
	if (type(argv) != 'array' || argv[0] != RUNTIME_TARGET || argv[1] != 'run') return false;
	if (length(argv) == 4) return argv[2] == '-publish' && argv[3] == DISCOVERY_LIST;
	return length(argv) == 6 && argv[2] == '-dns-source' && index(DISCOVERY_SOURCES, argv[3]) >= 0 &&
		argv[4] == '-publish' && argv[5] == DISCOVERY_LIST && argv[3] != 'auto';
}

function discovery_process_default() {
	let p = popen("ubus call service list '{\"name\":\"zapret2-manager\"}' 2>/dev/null", 'r');
	if (!p) return discovery_process_invalid(0);
	let raw = p.read('all') || '', rc = p.close(), document = null;
	if (rc != 0 || !length(trim(raw))) return discovery_process_invalid(0);
	try { document = json(raw); } catch (e) { return discovery_process_invalid(0); }
	let service = document && document['zapret2-manager'], instances = service && object(service.instances) ? service.instances : {}, instance = instances[DISCOVERY_INSTANCE];
	if (!object(instance)) return discovery_process_invalid(0);
	if (instance.running !== true || type(instance.pid) != 'int' || instance.pid <= 0) return discovery_process_invalid(1);
	let pid = instance.pid, executable = null, command = [];
	try {
		executable = readlink('/proc/' + pid + '/exe');
		let commandline = readfile('/proc/' + pid + '/cmdline') || '', fields = split(commandline, sprintf('%c', 0));
		for (let field in fields) if (length(field)) push(command, field);
	} catch (e) { return discovery_process_invalid(1); }
	let validated = executable == RUNTIME_TARGET && discovery_command_valid(command);
	return { instance: DISCOVERY_INSTANCE, running: validated, pid: validated ? pid : null, count: 1,
		validated: validated, executable: executable, outputOwned: validated && index(command, DISCOVERY_LIST) >= 0, command: command };
}

function discovery_file_default() {
	let value = { count: 0, mtime: null }, st = null;
	try { st = stat(DISCOVERY_LIST); } catch (e) { return value; }
	if (!st || st.type != 'file' || readlink(DISCOVERY_LIST) != null) return value;
	value.mtime = type(st.mtime) == 'int' ? st.mtime : null;
	let raw = readfile(DISCOVERY_LIST) || '', lines = split(raw, '\n');
	for (let line in lines) if (length(trim(line))) value.count++;
	return value;
}

function discovery_authority(seams) {
	let hooks = object(seams) ? seams : {};
	if (type(hooks.authority) == 'function') return hooks.authority();
	return detect_status();
}

export const z2k_detect_discovery_status = function(seams) {
	let hooks = object(seams) ? seams : {}, authority = discovery_authority(hooks);
	if (!object(authority) || authority.ok !== true || authority.coherent !== true)
		return authority && authority.ok === false ? detect_error_normalize(authority) : fail('EZ2K_INCOHERENT', 'Z2K Core installed authority is not coherent.');
	let config = type(hooks.config) == 'function' ? discovery_config_normalize(hooks.config()) : discovery_config_read();
	if (!object(config) || config.ok !== true) return config && config.ok === false ? config : fail('EDETECT_SCHEMA', 'Discovery configuration is invalid.');
	let process = type(hooks.process) == 'function' ? hooks.process() : discovery_process_default();
	let file = type(hooks.file) == 'function' ? hooks.file() : discovery_file_default();
	if (!object(process) || process.instance != DISCOVERY_INSTANCE || process.count != 1 || process.running !== true || process.validated !== true || process.executable != RUNTIME_TARGET || process.outputOwned !== true || !discovery_command_valid(process.command)) process = discovery_process_invalid(object(process) ? process.count : 0);
	if (!object(file) || type(file.count) != 'int' || file.count < 0 || (file.mtime != null && type(file.mtime) != 'int')) return fail('EDETECT_SCHEMA', 'Discovery list status is invalid.');
	return { ok: true, schema: 1, enabled: config.enabled, dnsSource: config.dnsSource,
		running: process.running, pid: process.pid == null ? null : process.pid,
		discoveredDomains: { count: file.count, mtime: file.mtime }, instance: DISCOVERY_INSTANCE };
};

export const z2k_detect_discovery_command = function(value) {
	let config = discovery_config_normalize(value);
	if (!config.ok) return config;
	if (!config.enabled) return { ok: true, enabled: false, command: null };
	let command = [RUNTIME_TARGET, 'run'];
	if (config.dnsSource != 'auto') command = push(command, '-dns-source', config.dnsSource);
	command = push(command, '-publish', DISCOVERY_LIST);
	return { ok: true, enabled: true, command: command, instance: DISCOVERY_INSTANCE };
};

function discovery_write(config, seams) {
	let hooks = object(seams) ? seams : {}, temp = null;
	if (type(hooks.temp) == 'function') temp = hooks.temp();
	else {
		let created = popen("umask 077; mktemp '/etc/zapret2-manager/.z2k-detect-discovery.XXXXXX' 2>/dev/null", 'r');
		if (created) { temp = trim(created.read('all') || ''); created.close(); }
	}
	if (!string(temp) || !length(temp)) return fail('EIO', 'Discovery configuration temporary file could not be created.');
	let content = sprintf('%J', config) + '\n';
	let write = type(hooks.write) == 'function' ? hooks.write(temp, content) : writefile(temp, content);
	if (!write) { try { if (type(hooks.remove) == 'function') hooks.remove(temp); else unlink(temp); } catch (e) { } return fail('EIO', 'Discovery configuration could not be written.'); }
	let mode = type(hooks.chmod) == 'function' ? hooks.chmod(temp, 384) : (() => { let p = popen("chmod 600 '" + temp + "'", 'r'); return p && p.close() == 0; })();
	if (!mode) { try { if (type(hooks.remove) == 'function') hooks.remove(temp); else unlink(temp); } catch (e) { } return fail('EIO', 'Discovery configuration permissions could not be secured.'); }
	let moved = type(hooks.move) == 'function' ? hooks.move(temp, DISCOVERY_CONFIG) : (() => { let p = popen("mv -f '" + temp + "' '" + DISCOVERY_CONFIG + "'", 'r'); return p && p.close() == 0; })();
	if (!moved) { try { if (type(hooks.remove) == 'function') hooks.remove(temp); else unlink(temp); } catch (e) { } return fail('EIO', 'Discovery configuration could not be committed.'); }
	return { ok: true, path: DISCOVERY_CONFIG, mode: 384 };
}

export const z2k_detect_discovery_write = function(config, seams) { return discovery_write(config, seams); };

export const z2k_detect_discovery_control = function(action, input, seams) {
	if (index(['enable', 'disable', 'restart'], action) < 0) return fail('EINPUT', 'Unsupported discovery control action.');
	let hooks = object(seams) ? seams : {}, authority = discovery_authority(hooks);
	if (!object(authority) || authority.ok !== true || authority.coherent !== true)
		return authority && authority.ok === false ? detect_error_normalize(authority) : fail('EZ2K_INCOHERENT', 'Z2K Core installed authority is not coherent.');
	let current = type(hooks.config) == 'function' ? discovery_config_normalize(hooks.config()) : discovery_config_read();
	if (!object(current) || current.ok !== true) return current && current.ok === false ? current : fail('EDETECT_SCHEMA', 'Discovery configuration is invalid.');
	let args = object(input) ? input : {}, source = args.dnsSource == null ? current.dnsSource : args.dnsSource;
	for (let key in args) if (key != 'dnsSource') return fail('EINPUT', 'Unsupported discovery control field.');
	if (index(DISCOVERY_SOURCES, source) < 0) return fail('EINPUT', 'dnsSource must be auto, agh, dnsmasq or pkt.');
	let next = { schema: 1, enabled: action == 'enable' ? true : action == 'disable' ? false : current.enabled, dnsSource: source };
	let saved = type(hooks.write) == 'function' ? hooks.write(next) : discovery_write(next, hooks);
	if (!saved || saved.ok !== true) return saved && saved.ok === false ? saved : fail('EIO', 'Discovery configuration could not be saved.');
	if (type(hooks.service) == 'function') return hooks.service(action, next);
	let p = popen("/etc/init.d/zapret2-manager restart >/dev/null 2>&1", 'r');
	if (!p || p.close() != 0) return fail('EIO', 'Z2K Detect discovery service restart failed.');
	return { ok: true, action: action, config: next };
};

function detect_status_digest(path) {
	if (!string(path)) return null;
	try {
		let st = stat(path);
		if (!st || st.type != 'file' || readlink(path) != null || type(st.size) != 'int' || st.size < 0 || st.size > 64 * 1024 * 1024) return null;
		let p = popen("sha256sum '" + path + "' 2>/dev/null", 'r');
		if (!p) return null;
		let raw = trim(p.read('all') || ''), rc = p.close(), value = split(raw, ' ')[0];
		return rc == 0 && valid_digest(value) ? lc(value) : null;
	} catch (e) { return null; }
}

function detect_status_authority(seams) {
	let hooks = object(seams) ? seams : {};
	if (type(hooks.authority) == 'function') return hooks.authority();
	let listed = type(hooks.registry) == 'function' ? hooks.registry() : asset_registry_list(null);
	if (!object(listed) || listed.ok !== true) return detect_status_fail('EZ2K_NOT_INSTALLED', 'Z2K Core installed Registry is unavailable.');
	let receiptState = z2k_registry_receipt_state(listed);
	if (!object(receiptState) || receiptState.state == 'unknown' || !object(receiptState.receipt)) {
		return detect_status_fail(type(listed.activationReceipts) == 'array' && length(listed.activationReceipts) ? 'EZ2K_INCOHERENT' : 'EZ2K_NOT_INSTALLED', 'Z2K Core installed authority is not coherent.');
	}
	if (receiptState.state != 'COHERENT_VERIFIED') return detect_status_fail('EZ2K_INCOHERENT', 'Z2K Core receipt is legacy or incomplete.');
	let receipt = receiptState.receipt, detect = receipt.detect;
	if (!object(detect) || !valid_digest(detect.digest) || !string(detect.arch) || !valid_commit(receipt.sourceCommit)) return detect_status_fail('EDETECT_INCOMPATIBLE', 'Installed Detect identity is incomplete.');
	let runtime = runtime_composition.resolveInstalled({ registry: listed, receipt: receipt });
	if (!object(runtime) || runtime.ok !== true || runtime.coherenceStatus != 'coherent') return detect_status_fail('EDETECT_INCOMPATIBLE', 'Installed runtime does not match the coherent Core receipt.');
	let actualDigest = detect_status_digest(RUNTIME_TARGET);
	if (actualDigest == null) return detect_status_fail('EDETECT_UNAVAILABLE', 'Installed Z2K Detect executable is unavailable.');
	if (actualDigest != lc(detect.digest) || (detect.sourceCommit != null && lc(detect.sourceCommit) != lc(receipt.sourceCommit))) return detect_status_fail('EDETECT_INCOMPATIBLE', 'Installed Detect does not match the coherent Core receipt.');
	return { ok: true, coherent: true, schema: DETECT_STATUS_SCHEMA, state: 'ready', installed: { release: receipt.release || receipt.version, sourceCommit: lc(receipt.sourceCommit), receiptId: receipt.receiptId || null }, detect: { path: RUNTIME_TARGET, arch: detect.arch, digest: actualDigest, sourceCommit: lc(receipt.sourceCommit) }, runtime: { compatibilityIdentity: receipt.compatibilityIdentity, bundleDigest: receipt.runtimeBundleDigest } };
}

function detect_status_arch(value) {
	return string(value) && index(['arm64', 'aarch64', 'amd64', 'x86_64', 'mipsle', 'mipsel', 'mips', 'riscv64'], value) >= 0;
}

function detect_status_normalize(value) {
	if (!object(value)) return fail('EDETECT_SCHEMA', 'Z2K Detect status must be an object.');
	if (value.ok !== true || value.coherent !== true || value.schema !== DETECT_STATUS_SCHEMA || value.state !== 'ready' ||
		!object(value.installed) || !z2k_release_valid(value.installed.release) || !valid_commit(value.installed.sourceCommit) ||
		(value.installed.receiptId != null && (!string(value.installed.receiptId) || length(value.installed.receiptId) > 128)) ||
		!object(value.detect) || value.detect.path !== RUNTIME_TARGET || !detect_status_arch(value.detect.arch) ||
		!valid_digest(value.detect.digest) || !valid_commit(value.detect.sourceCommit) || value.detect.sourceCommit != value.installed.sourceCommit ||
		!object(value.runtime) || !valid_digest(value.runtime.compatibilityIdentity) || !valid_digest(value.runtime.bundleDigest))
		return fail('EDETECT_SCHEMA', 'Z2K Detect status has missing or invalid identity fields.');
	try {
		if (length(sprintf('%J', value)) > DETECT_MAX_STATUS_BYTES) return fail('EDETECT_SCHEMA', 'Z2K Detect status exceeds the bounded response limit.');
	} catch (e) { return fail('EDETECT_SCHEMA', 'Z2K Detect status is not safely serializable.'); }
	return value;
}

export const z2k_detect_status_normalize = function(value) { return detect_status_normalize(value); };
detect_status = function(seams) {
	let result = detect_status_authority(seams), checked = result && result.ok === false ? detect_error_normalize(result) :
		(result && result.ok === true && result.coherent !== true ? fail('EDETECT_INCOMPATIBLE', result.error && result.error.message || 'Z2K Detect installed authority is incoherent.') : detect_status_normalize(result));
	return checked;
};
export const z2k_detect_status = function(seams) { return detect_status(seams); };

function detect_ipv4(value) {
	if (!string(value) || !match(value, /^[0-9]+(\.[0-9]+){3}$/)) return false;
	for (let part in split(value, '.')) {
		if (length(part) > 1 && substr(part, 0, 1) == '0') return false;
		if (int(part) > 255) return false;
	}
	return true;
}

function detect_hex_group(value) { return length(value) >= 1 && length(value) <= 4 && match(value, /^[0-9A-Fa-f]+$/); }

function detect_ipv6(value) {
	if (!string(value) || length(value) < 2 || !match(value, /^[0-9A-Fa-f:.]+$/)) return false;
	let compression = index(value, '::'), left = [], right = [], groups = 0;
	if (compression < 0 && (substr(value, 0, 1) == ':' || substr(value, -1) == ':')) return false;
	if (compression >= 0) {
		if (index(substr(value, compression + 2), '::') >= 0 || substr(value, compression + 2, 1) == ':') return false;
		left = split(substr(value, 0, compression), ':');
		right = split(substr(value, compression + 2), ':');
	} else left = split(value, ':');
	let parts = [...left, ...right];
	for (let i = 0; i < length(parts); i++) {
		let part = parts[i];
		if (!length(part)) continue;
		if (index(part, '.') >= 0) {
			if (i != length(parts) - 1 || !detect_ipv4(part)) return false;
			groups += 2;
		} else {
			if (!detect_hex_group(part)) return false;
			groups++;
		}
	}
	return compression >= 0 ? groups < 8 : groups == 8;
}

function detect_dns(value) {
	if (!string(value) || length(value) < 1 || length(value) > 253 || !match(value, /^[A-Za-z0-9.-]+$/)) return false;
	let labels = split(value, '.'), numeric = length(labels) > 1;
	for (let label in labels) {
		if (length(label) < 1 || length(label) > 63 || substr(label, 0, 1) == '-' || substr(label, -1) == '-' ||
			!match(label, /^[A-Za-z0-9-]+$/)) return false;
		if (!match(label, /^[0-9]+$/)) numeric = false;
	}
	return !numeric;
}

function detect_host(value) {
	if (!string(value) || index(value, sprintf('%c', 0)) >= 0 || index(value, '\n') >= 0 || index(value, '\r') >= 0 || index(value, '\t') >= 0) return false;
	return detect_ipv4(value) || (index(value, ':') >= 0 ? detect_ipv6(value) : detect_dns(value));
}

function detect_operation(value) { return string(value) && index(DETECT_OPERATIONS, value) >= 0; }
function detect_input_normalize(operation, value) {
	if (!detect_operation(operation) || !object(value)) return fail('EDETECT_SCHEMA', 'Z2K Detect input must be an object for a known operation.');
	try { if (length(sprintf('%J', value)) > DETECT_MAX_INPUT_BYTES) return fail('EDETECT_SCHEMA', 'Z2K Detect input exceeds the bounded request limit.'); }
	catch (e) { return fail('EDETECT_SCHEMA', 'Z2K Detect input is not safely serializable.'); }
	for (let name in DETECT_UNSAFE_INPUT_FIELDS) if (exists(value, name)) return fail('EINPUT', 'Z2K Detect input contains an unsafe execution field.', { field: name });
	let required = operation == 'z2k_detect_probe' ? ['domain', 'timeoutMs'] :
		operation == 'z2k_detect_classify' ? ['host', 'port', 'hello', 'repeats', 'timeoutMs'] :
		operation == 'z2k_detect_quic' ? ['domain', 'port', 'repeats', 'timeoutMs'] :
		operation == 'z2k_detect_voice' ? ['repeats', 'timeoutMs'] : ['timeoutMs'];
	for (let name in required) if (!exists(value, name)) return fail('EDETECT_SCHEMA', 'Z2K Detect input is missing a required field.', { field: name });
	if (exists(value, 'domain') && (!string(value.domain) || !detect_host(value.domain))) return fail('EINPUT', 'Z2K Detect domain is invalid.');
	if (exists(value, 'host') && (!string(value.host) || !detect_host(value.host))) return fail('EINPUT', 'Z2K Detect host is invalid.');
	if (exists(value, 'port') && (type(value.port) != 'int' || value.port < 1 || value.port > 65535)) return fail('EDETECT_SCHEMA', 'Z2K Detect port has the wrong type or range.');
	if (exists(value, 'repeats') && (type(value.repeats) != 'int' || value.repeats < 1 || value.repeats > 32)) return fail('EDETECT_SCHEMA', 'Z2K Detect repeats has the wrong type or range.');
	if (type(value.timeoutMs) != 'int' || value.timeoutMs < 1 || value.timeoutMs > 120000) return fail('EDETECT_SCHEMA', 'Z2K Detect timeoutMs has the wrong type or range.');
	if (operation == 'z2k_detect_classify' && type(value.hello) != 'string') return fail('EDETECT_SCHEMA', 'Z2K Detect classify hello has the wrong type.');
	if (operation == 'z2k_detect_classify' && index(['modern', 'legacy', 'both'], value.hello) < 0) return fail('EINPUT', 'Z2K Detect classify hello mode is invalid.');
	let normalized = {};
	for (let key in value) normalized[key] = value[key];
	let native = { timeoutMs: value.timeoutMs };
	if (operation == 'z2k_detect_probe') native.domain = value.domain;
	if (operation == 'z2k_detect_classify') native = { host: value.host, port: value.port, hello: value.hello, repeats: value.repeats, timeoutMs: value.timeoutMs };
	if (operation == 'z2k_detect_quic') native = { domain: value.domain, port: value.port, repeats: value.repeats, timeoutMs: value.timeoutMs };
	if (operation == 'z2k_detect_voice') native = { repeats: value.repeats, timeoutMs: value.timeoutMs };
	return { ok: true, value: normalized, native: native };
}

export const z2k_detect_normalize_input = function(operation, value) { return detect_input_normalize(operation, value); };

// The native helper is the only process-launch owner. This adapter validates
// and normalizes the typed boundary, then forwards exactly one fixed operation
// to that owner without accepting a command, executable, argv, env or cwd.
export const z2k_detect_fixed_argv = function(operation, input) {
	let checked = detect_input_normalize(operation, input);
	if (!checked.ok) return null;
	let args = checked.native;
	let kind = substr(operation, 11), seconds = int((args.timeoutMs + 999) / 1000), out = [RUNTIME_TARGET, kind];
	if (kind == 'probe') return push(out, '-json', args.domain);
	if (kind == 'classify') {
		let endpoint = index(args.host, ':') >= 0 ? '[' + args.host + ']:' + args.port : args.host + ':' + args.port;
		return push(out, '-hello', args.hello, '-repeats', '' + args.repeats, '-timeout', '' + seconds + 's', '-json', endpoint);
	}
	if (kind == 'quic') return push(out, '-port', '' + args.port, '-repeats', '' + args.repeats, '-timeout', '' + seconds + 's', '-json', args.domain);
	if (kind == 'voice') return push(out, '-repeats', '' + args.repeats, '-timeout', '' + seconds + 's', '-json');
	return out;
};

export const z2k_detect_execute = function(operation, input, seams) {
	let checkedInput = detect_input_normalize(operation, input);
	if (!checkedInput.ok) return checkedInput;
	let normalized = checkedInput.native;
	let hooks = object(seams) ? seams : {}, invoke = type(hooks.invoke) == 'function' ? hooks.invoke : native_helper.z2k_detect;
	let authority;
	if (type(hooks.authority) == 'function') {
		let rawAuthority = hooks.authority();
		if (rawAuthority && rawAuthority.ok === true && rawAuthority.coherent !== true)
			authority = fail('EDETECT_INCOMPATIBLE', rawAuthority.error && rawAuthority.error.message || 'Z2K Detect installed authority is incoherent.');
		else authority = rawAuthority && rawAuthority.ok === false ? detect_error_normalize(rawAuthority) : detect_status_normalize(rawAuthority);
	} else authority = type(hooks.invoke) == 'function' ? { ok: true, coherent: true, testOnly: true } : detect_status(hooks);
	if (!object(authority) || authority.ok !== true) return authority && authority.ok === false ? authority : fail('EDETECT_INCOMPATIBLE', 'Z2K Detect installed authority is unavailable.');
	if (authority.coherent !== true) return fail('EDETECT_INCOMPATIBLE', 'Z2K Detect installed authority is incoherent.');
	try {
		let response = invoke(operation, normalized, normalized.timeoutMs);
		if (!object(response) || type(response.ok) != 'bool') return fail('EDETECT_SCHEMA', 'Z2K Detect returned an invalid native response.');
		if (!response.ok) return detect_error_normalize(response);
		if (!detect_result.detect_result_data_valid(operation, response.data))
			return fail('EDETECT_SCHEMA', 'Z2K Detect returned an invalid upstream result.');
		if (response.data.timedOut)
			return fail('EDETECT_TIMEOUT', 'Z2K Detect timed out.', { details: detect_failure_details(response.data) });
		if (response.data.outputTruncated)
			return fail('EDETECT_FAILED', 'Z2K Detect output exceeded the bounded result limit.', { details: detect_failure_details(response.data) });
		if (response.data.exitCode != 0)
			return fail('EDETECT_FAILED', 'Z2K Detect exited with a failure status.', { details: detect_failure_details(response.data) });
		return response;
	}
	catch (e) { return fail('EDETECT_FAILED', 'Native Z2K Detect invocation failed.', { detail: substr(text(e), 0, 320) }); }
};

export const z2k_detect_probe = function(input) { return z2k_detect_execute('z2k_detect_probe', input); };
export const z2k_detect_classify = function(input) { return z2k_detect_execute('z2k_detect_classify', input); };
export const z2k_detect_quic = function(input) { return z2k_detect_execute('z2k_detect_quic', input); };
export const z2k_detect_voice = function(input) { return z2k_detect_execute('z2k_detect_voice', input); };
export const z2k_detect_tcp16 = function(input) { return z2k_detect_execute('z2k_detect_tcp16', input); };

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

function discovery_cli_emit(value, code) {
	print(sprintf('%J', value) + '\n');
	if (code != 0) exit(code);
}

// The init script uses these fixed, non-user-controlled probes before it
// opens the one named procd instance. The upstream executable remains the
// only owner of the long-running `run` process.
let cliArgv = detect_cli_argv();
if (length(cliArgv) > 0 && (cliArgv[0] == 'discovery-eligible' || cliArgv[0] == 'discovery-source')) {
	let config = discovery_config_read(), authority = detect_status();
	let eligible = config.ok === true && config.enabled === true && authority.ok === true && authority.coherent === true;
	if (cliArgv[0] == 'discovery-source') {
		if (!eligible) exit(1);
		print(config.dnsSource + '\n');
	} else discovery_cli_emit(eligible ? { ok: true, enabled: true, dnsSource: config.dnsSource, instance: DISCOVERY_INSTANCE } :
		(config.ok === false ? config : authority), eligible ? 0 : 1);
}
