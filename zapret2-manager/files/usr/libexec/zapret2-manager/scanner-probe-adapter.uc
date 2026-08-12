'use strict';

const TLS_TIMEOUT_MS = 6000;
const BODY_TIMEOUT_MS = 8000;
const STUN_TIMEOUT_MS = 4000;
const MAX_DEADLINE_MS = 120000;

function is_object(value) { return type(value) == 'object' && value != null; }
function fail(message) { return { ok: false, error: { code: 'EINPUT', message } }; }
function is_hex64(value) { return type(value) == 'string' && match(value, /^[a-f0-9]{64}$/) != null; }

function safe_host(value) {
	if (type(value) != 'string' || length(value) < 1 || length(value) > 253 ||
		match(value, /^[a-z0-9][a-z0-9.-]*$/) == null || substr(value, -1) == '-') return false;
	for (let label in split(value, '.')) if (!length(label) || length(label) > 63 ||
		match(label, /^[a-z0-9][a-z0-9-]*$/) == null || substr(label, -1) == '-') return false;
	return true;
}

function forbidden(value) {
	if (!is_object(value)) return false;
	let names = { executable: true, command: true, shell: true, args: true, rawArgs: true,
		rawArguments: true, nfqwsArgs: true, path: true, userPath: true, outputPath: true };
	for (let key in value) {
		if (names[key]) return true;
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

function candidate_valid(candidate, protocol) {
	return is_object(candidate) && !forbidden(candidate) && candidate.protocol == protocol &&
		type(candidate.scannerId) == 'string' && length(candidate.scannerId) > 0 && length(candidate.scannerId) <= 160 &&
		is_hex64(candidate.compiledDigest) && is_hex64(candidate.dependencyDigest);
}

export const scanner_probe_adapter_baseline = function(profile, limit) {
	if (!is_object(profile) || forbidden(profile) || !safe_host(profile.primaryHost)) return fail('Invalid server-owned target profile.');
	let protocol = profile.protocol, end = deadline(limit, protocol == 'udp' ? STUN_TIMEOUT_MS : TLS_TIMEOUT_MS);
	if (!end || (protocol != 'tcp' && protocol != 'udp')) return fail('Invalid probe deadline or protocol.');
	if (protocol == 'udp') return { ok: true, request: { transport: 'stun', host: profile.primaryHost,
		port: 19302, addressFamily: 'ipv4', timeoutMs: STUN_TIMEOUT_MS, retries: 2,
		receiveLimitBytes: 1024, deadlineMs: end } };
	return { ok: true, request: { transport: 'tls', host: profile.primaryHost,
		addressFamilies: ['ipv4', 'ipv6'], port: 443,
		tls: { timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048 }, deadlineMs: end } };
};

export const scanner_probe_adapter_tcp = function(candidate, target, addressFamily, limit) {
	if (!candidate_valid(candidate, 'tcp')) return fail('Invalid planner-owned TCP candidate.');
	if (forbidden(target) || !is_object(target) || !safe_url(target.probeUrl)) return fail('Invalid server-owned target profile.');
	if (addressFamily != 'ipv4' && addressFamily != 'ipv6') return fail('Invalid address family.');
	let hosts = profile_hosts(target, limit?.mode), end = deadline(limit, BODY_TIMEOUT_MS);
	if (!hosts || !end) return fail('Invalid host set or probe deadline.');
	let requests = [];
	for (let host in hosts) push(requests, { host, addressFamily, port: 443,
		url: host == target.primaryHost ? target.probeUrl : 'https://' + host + '/' });
	return { ok: true, candidate: { scannerId: candidate.scannerId,
		compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest },
		request: { transport: 'tls+body', hosts: requests,
			tls: { timeoutMs: TLS_TIMEOUT_MS, readLimitBytes: 2048 },
			body: { timeoutMs: BODY_TIMEOUT_MS, minimumBytes: 65536, readChunkBytes: 4096,
				markerScanBytes: 8192, readLimitBytes: 69633, range: 'bytes=0-69632' }, deadlineMs: end } };
};

export const scanner_probe_adapter_udp = function(candidate, target, limit) {
	if (!candidate_valid(candidate, 'udp')) return fail('Invalid planner-owned UDP candidate.');
	if (!is_object(target) || forbidden(target) || !safe_host(target.host) ||
		type(target.port) != 'int' || target.port < 1 || target.port > 65535)
		return fail('Invalid server-owned STUN target.');
	let end = deadline(limit, STUN_TIMEOUT_MS);
	if (!end) return fail('Invalid probe deadline.');
	return { ok: true, candidate: { scannerId: candidate.scannerId,
		compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest },
		request: { transport: 'stun', host: target.host, port: target.port, addressFamily: 'ipv4',
			timeoutMs: STUN_TIMEOUT_MS, retries: 2, receiveLimitBytes: 1024, deadlineMs: end } };
};
