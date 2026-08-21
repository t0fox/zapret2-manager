'use strict';

const TLS_TIMEOUT_MS = 6000;
const BODY_TIMEOUT_MS = 8000;
const STUN_TIMEOUT_MS = 4000;
const MAX_DEADLINE_MS = 120000;
const AUTHORITY = 'scanner-probe-adapter.v1';
const ADAPTER_DIGEST = '7cd367ef2aed1be2567505bf978b2d2b73f97ff149cc48d64826ed4f2b8c885e';
const STUN_TRANSACTION_ID = '0102030405060708090a0b0c';

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
	let tokens = ['command', 'cmd', 'argv', 'arg', 'argument', 'executable', 'binary',
		'shell', 'process', 'raw', 'strategyargs', 'nfqwsargs', 'workingdirectory', 'cwd'];
	for (let i = 0; i < length(tokens); i++) if (index(key, tokens[i]) >= 0) return true;
	return false;
}

function safe_host(value) {
	if (type(value) != 'string' || length(value) < 1 || length(value) > 253 ||
		match(value, /^[a-z0-9][a-z0-9.-]*$/) == null || substr(value, -1) == '-') return false;
	let labels = split(value, '.');
	for (let i = 0; i < length(labels); i++) {
		let label = labels[i];
		if (!length(label) || length(label) > 63 || match(label, /^[a-z0-9][a-z0-9-]*$/) == null || substr(label, -1) == '-') return false;
	}
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

function first_port(value) {
	if (type(value) != 'string' || match(value, /^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$/) == null) return null;
	let bounds = split(split(value, ',')[0], '-'), port = +bounds[0];
	return port >= 1 && port <= 65535 && (length(bounds) == 1 || (+bounds[1] >= port && +bounds[1] <= 65535)) ? port : null;
}

function attach_cancel(request, limit) {
	if (type(limit?.cancelToken) == 'string' && match(limit.cancelToken, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) != null)
		request.cancelToken = limit.cancelToken;
	return request;
}

function profile_hosts(profile, mode) {
	let limit = mode_limit(mode), result = [];
	if (!limit || !is_object(profile) || !safe_host(profile.primaryHost) || type(profile.testHosts) != 'array') return null;
	push(result, profile.primaryHost);
	for (let i = 0; i < length(profile.testHosts); i++) {
		let host = profile.testHosts[i];
		if (!safe_host(host)) return null;
		let seen = false;
		for (let j = 0; j < length(result); j++) if (result[j] == host) seen = true;
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
	for (let i = 0; i < length(hosts || []); i++) if ((hosts || [])[i] == host) known = true;
	return slash >= 0 && known &&
		match(path, /^\/[A-Za-z0-9._~\/?=&%+-]*$/) != null;
}

function descriptor_common(profile, request, candidate, suppliedDigest) {
	let result = { authority: AUTHORITY, adapterDigest: ADAPTER_DIGEST,
		targetProfileDigest: is_hex64(suppliedDigest) ? suppliedDigest : null, targetProfile: profile, request };
	if (candidate != null) result.candidate = candidate;
	return result;
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
	if (protocol == 'udp') {
		let port = first_port(profile.udp?.ports);
		if (port == null) return fail('Invalid server-owned UDP port profile.');
		if (profile.udp?.l7 != 'stun' || profile.udp?.payload != 'binding') return fail('Server-owned UDP profile is not a STUN profile.');
		return { ok: true, ...descriptor_common(profile, attach_cancel({ transport: 'stun', mode: limit?.mode, host: profile.primaryHost,
			port, portRange: profile.udp.ports, addressFamily: 'ipv4', timeoutMs: STUN_TIMEOUT_MS, retries: 2,
			receiveLimitBytes: 1024, transactionId: STUN_TRANSACTION_ID, deadlineMs: end }, limit), null, limit?.profileDigest) };
	}
	let port = first_port(profile.tcp?.ports);
	if (port == null) return fail('Invalid server-owned TCP port profile.');
	return { ok: true, ...descriptor_common(profile, attach_cancel({ transport: 'tls', mode: limit?.mode, host: profile.primaryHost,
		addressFamilies: ['ipv4', 'ipv6'], port, portRange: profile.tcp.ports,
		timeoutMs: TLS_TIMEOUT_MS, retries: 1, readLimitBytes: 2048,
		tls: { timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048 }, deadlineMs: end }, limit), null, limit?.profileDigest) };
};

export const scanner_probe_adapter_tcp = function(candidate, target, addressFamily, limit) {
	if (!candidate_valid(candidate, 'tcp')) return fail('Invalid planner-owned TCP candidate.');
	if (forbidden(target) || !is_object(target) || !canonical_url(target.probeUrl, [target.primaryHost, ...(target.testHosts || [])])) return fail('Invalid server-owned target profile.');
	if (!is_object(target.tcp) || target.tcp.l7 != 'tls' || target.tcp.payload != 'tls_client_hello') return fail('Invalid server-owned TCP profile.');
	if (addressFamily != 'ipv4' && addressFamily != 'ipv6') return fail('Invalid address family.');
	let hosts = profile_hosts(target, limit?.mode), end = deadline(limit, BODY_TIMEOUT_MS);
	if (!hosts || !end) return fail('Invalid host set or probe deadline.');
	let port = first_port(target.tcp?.ports);
	if (port == null) return fail('Invalid server-owned TCP port profile.');
	let requests = [];
	for (let i = 0; i < length(hosts); i++) {
		let host = hosts[i];
		push(requests, { host, hostIdentity: host, addressFamily, port, portRange: target.tcp.ports,
			url: host == target.primaryHost ? target.probeUrl : 'https://' + host + '/' });
	}
	let descriptor = descriptor_common(target, attach_cancel({ transport: 'tls+body', mode: limit?.mode, hosts: requests,
		retries: 1, tls: { timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048 },
		body: { timeoutMs: BODY_TIMEOUT_MS, minimumBytes: 65536, readChunkBytes: 4096,
			markerScanBytes: 8192, readLimitBytes: 69633, range: 'bytes=0-69632',
		markers: [{ name: 'isp_page', needles: ['blocked', 'access denied', 'captcha'] }] }, deadlineMs: end }, limit), { scannerId: candidate.scannerId, protocol: candidate.protocol,
		compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest }, limit?.profileDigest);
	return { ok: true, ...descriptor };
};

export const scanner_probe_adapter_staged = function(candidate, target, limit) {
	if (!candidate_valid(candidate, 'tcp')) return fail('Invalid planner-owned TCP candidate.');
	if (forbidden(target) || !is_object(target) || !canonical_url(target.probeUrl, [target.primaryHost, ...(target.testHosts || [])]))
		return fail('Invalid server-owned target profile.');
	if (!is_object(target.tcp) || target.tcp.l7 != 'tls' || target.tcp.payload != 'tls_client_hello')
		return fail('Invalid server-owned TCP profile.');
	let end = deadline(limit, BODY_TIMEOUT_MS), hosts = profile_hosts(target, limit?.mode);
	if (!end || !hosts) return fail('Invalid staged probe deadline or host set.');
	let port = first_port(target.tcp.ports);
	if (port == null) return fail('Invalid server-owned TCP port profile.');
	return { ok: true, ...descriptor_common(target, attach_cancel({ transport: 'staged', mode: limit?.mode,
		host: target.primaryHost, hosts, port, portRange: target.tcp.ports, neutralSni: 'example.com',
		h2Required: target.h2Required === true, timeoutMs: BODY_TIMEOUT_MS, deadlineMs: end }, limit),
		{ scannerId: candidate.scannerId, protocol: candidate.protocol, compiledDigest: candidate.compiledDigest,
			dependencyDigest: candidate.dependencyDigest }, limit?.profileDigest) };
};

export const scanner_probe_adapter_udp = function(candidate, target, limit) {
	if (!candidate_valid(candidate, 'udp')) return fail('Invalid planner-owned UDP candidate.');
	if (!is_object(target) || forbidden(target) || !safe_host(target.primaryHost) ||
		type(target.udp) != 'object' || first_port(target.udp.ports) == null)
		return fail('Invalid server-owned STUN target.');
	let end = deadline(limit, STUN_TIMEOUT_MS);
	if (!end) return fail('Invalid probe deadline.');
	let port = first_port(target.udp.ports);
	if (port == null) return fail('Invalid server-owned STUN port profile.');
	let descriptor = descriptor_common(target, attach_cancel({ transport: 'stun', mode: limit?.mode, host: target.primaryHost, port, portRange: target.udp.ports, addressFamily: 'ipv4',
		timeoutMs: STUN_TIMEOUT_MS, retries: 2, receiveLimitBytes: 1024, transactionId: STUN_TRANSACTION_ID, deadlineMs: end }, { scannerId: candidate.scannerId, protocol: candidate.protocol,
		compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest }, limit), limit?.profileDigest);
	return { ok: true, ...descriptor };
};
