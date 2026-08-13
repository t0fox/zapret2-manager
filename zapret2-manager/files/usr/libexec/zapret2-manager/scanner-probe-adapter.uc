'use strict';

const TLS_TIMEOUT_MS = 6000;
const BODY_TIMEOUT_MS = 8000;
const STUN_TIMEOUT_MS = 4000;
const MAX_DEADLINE_MS = 120000;
const AUTHORITY = 'scanner-probe-adapter.v1';

function is_object(value) { return type(value) == 'object' && value != null; }
function fail(message) { return { ok: false, error: { code: 'EINPUT', message } }; }
function is_hex64(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{64}$/) != null; }

function lower_key(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1);
	}
	return result;
}

function forbidden_name(value) {
	let key = lower_key(value);
	for (let token in ['command', 'cmd', 'argv', 'arg', 'argument', 'executable', 'binary',
		'shell', 'process', 'path', 'raw', 'strategyargs', 'nfqwsargs', 'workingdirectory', 'cwd'])
		if (index(key, token) >= 0) return true;
	return false;
}

function safe_host(value) {
	if (type(value) != 'string' || length(value) < 1 || length(value) > 253 ||
		match(value, /^[a-z0-9][a-z0-9.-]*$/) == null || substr(value, -1) == '-') return false;
	for (let label in split(value, '.')) if (!length(label) || length(label) > 63 ||
		match(label, /^[a-z0-9][a-z0-9-]*$/) == null || substr(label, -1) == '-') return false;
	return true;
}

function forbidden(value) {
	if (!is_object(value)) return false;
	let names = {
		executable: true, executablePath: true, executable_path: true, program: true, binary: true,
		binaryPath: true, binary_path: true, exec: true, execPath: true, exec_path: true,
		command: true, commandLine: true, command_line: true, effectiveCommand: true, effective_command: true,
		commandArgs: true, command_args: true, commandPath: true, command_path: true,
		fullCommand: true, full_command: true,
		rawCommand: true, raw_command: true, rawCommandLine: true, raw_command_line: true,
		shell: true, process: true, argv: true, effectiveArgv: true, effective_argv: true,
		effectiveArgs: true, effective_args: true, rawArgv: true, raw_argv: true,
		args: true, arguments: true, raw: true, rawArgs: true, raw_args: true, rawArguments: true,
		raw_arguments: true, strategyArgs: true, strategy_args: true, nfqwsArgs: true,
		nfqws_args: true, path: true, userPath: true, outputPath: true,
		inputPath: true, workingDirectory: true, cwd: true,
	};
	for (let key in value) {
		if (names[key] || forbidden_name(key)) return true;
		if (is_object(value[key]) && forbidden(value[key])) return true;
	}
	return false;
}

function deadline(value, required) {
	if (!is_object(value) || type(value.nowMs) != 'int' || type(value.deadlineMs) != 'int' ||
		value.nowMs < 0 || value.deadlineMs <= value.nowMs ||
		value.deadlineMs - value.nowMs < required) return null;
	return value.deadlineMs - value.nowMs > MAX_DEADLINE_MS ? value.nowMs + MAX_DEADLINE_MS : value.deadlineMs;
}

function mode_limit(mode) {
	if (mode == 'quick') return 1;
	if (mode == 'standard') return 2;
	if (mode == 'full') return 4;
	return 0;
}

function profile_hosts(profile, mode) {
	let limit = mode_limit(mode), result = [];
	if (!limit || !is_object(profile) || !safe_host(profile.primaryHost) || type(profile.testHosts) != 'array') return null;
	push(result, profile.primaryHost);
	for (let host in profile.testHosts) {
		if (!safe_host(host)) return null;
		let seen = false;
		for (let existing in result) if (existing == host) seen = true;
		if (!seen && length(result) < limit) push(result, host);
	}
	return result;
}

function safe_url(value) {
	if (type(value) != 'string' || length(value) > 2048 || substr(value, 0, 8) != 'https://') return false;
	let rest = substr(value, 8), slash = index(rest, '/');
	let host = slash < 0 ? rest : substr(rest, 0, slash);
	return safe_host(host) && index(rest, '@') < 0 && index(host, ':') < 0;
}

function canonical_url(value, hosts) {
	if (!safe_url(value)) return false;
	let rest = substr(value, 8), slash = index(rest, '/');
	let path = slash >= 0 ? substr(rest, slash) : '';
	let host = slash >= 0 ? substr(rest, 0, slash) : '';
	let known = false;
	for (let candidate in hosts || []) if (candidate == host) known = true;
	return slash >= 0 && known &&
		match(path, /^\/[A-Za-z0-9._~\/?=&%+-]*$/) != null;
}

function candidate_valid(candidate, protocol) {
	return is_object(candidate) && !forbidden(candidate) && candidate.protocol == protocol &&
		type(candidate.scannerId) == 'string' && length(candidate.scannerId) > 0 && length(candidate.scannerId) <= 160 &&
		is_hex64(candidate.compiledDigest) && is_hex64(candidate.dependencyDigest);
}

export const scanner_probe_adapter_baseline = function(profile, limit) {
	if (!is_object(profile) || forbidden(profile) || !safe_host(profile.primaryHost)) return fail('Invalid server-owned target profile.');
	let protocol = profile.protocol, end = deadline(limit, protocol == 'udp' ? STUN_TIMEOUT_MS : TLS_TIMEOUT_MS);
	if (!end || (protocol != 'tcp' && protocol != 'udp')) return fail('Invalid probe deadline or protocol.');
	if (protocol == 'udp') return { ok: true, authority: AUTHORITY, request: { transport: 'stun', host: profile.primaryHost,
		port: 19302, addressFamily: 'ipv4', timeoutMs: STUN_TIMEOUT_MS, retries: 2,
		receiveLimitBytes: 1024, deadlineMs: end } };
	return { ok: true, authority: AUTHORITY, request: { transport: 'tls', host: profile.primaryHost,
		addressFamilies: ['ipv4', 'ipv6'], port: 443,
		timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048,
		tls: { timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048 }, deadlineMs: end } };
};

export const scanner_probe_adapter_tcp = function(candidate, target, addressFamily, limit) {
	if (!candidate_valid(candidate, 'tcp')) return fail('Invalid planner-owned TCP candidate.');
	if (forbidden(target) || !is_object(target) || !canonical_url(target.probeUrl, [target.primaryHost, ...(target.testHosts || [])])) return fail('Invalid server-owned target profile.');
	if (addressFamily != 'ipv4' && addressFamily != 'ipv6') return fail('Invalid address family.');
	let hosts = profile_hosts(target, limit?.mode), end = deadline(limit, BODY_TIMEOUT_MS);
	if (!hosts || !end) return fail('Invalid host set or probe deadline.');
	let requests = [];
	for (let host in hosts) push(requests, { host, hostIdentity: host, addressFamily, port: 443,
		url: host == target.primaryHost ? target.probeUrl : 'https://' + host + '/' });
	return { ok: true, authority: AUTHORITY, candidate: { scannerId: candidate.scannerId,
		compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest },
		request: { transport: 'tls+body', hosts: requests,
			retries: 1, tls: { timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048 },
			body: { timeoutMs: BODY_TIMEOUT_MS, minimumBytes: 65536, readChunkBytes: 4096,
				markerScanBytes: 8192, readLimitBytes: 69633, range: 'bytes=0-69632',
				markers: [{ name: 'isp_page', needles: ['blocked', 'access denied', 'captcha'] }] }, deadlineMs: end } };
};

export const scanner_probe_adapter_udp = function(candidate, target, limit) {
	if (!candidate_valid(candidate, 'udp')) return fail('Invalid planner-owned UDP candidate.');
	if (!is_object(target) || forbidden(target) || !safe_host(target.host) ||
		type(target.port) != 'int' || target.port < 1 || target.port > 65535)
		return fail('Invalid server-owned STUN target.');
	let end = deadline(limit, STUN_TIMEOUT_MS);
	if (!end) return fail('Invalid probe deadline.');
	return { ok: true, authority: AUTHORITY, candidate: { scannerId: candidate.scannerId,
		compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest },
		request: { transport: 'stun', host: target.host, port: target.port, addressFamily: 'ipv4',
			timeoutMs: STUN_TIMEOUT_MS, retries: 2, receiveLimitBytes: 1024, deadlineMs: end } };
};
