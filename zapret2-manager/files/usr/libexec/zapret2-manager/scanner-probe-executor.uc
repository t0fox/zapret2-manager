'use strict';

// The executor accepts planner-owned descriptors only. Network I/O is fixed to
// the packaged ncat primitive; response fields are parsed before classification.
import { popen } from 'fs';

const NCAT = '/usr/bin/ncat';
const MAX_OUTPUT = 69633;
const MAX_TCP_TIMEOUT_MS = 8000;
const MAX_STUN_TIMEOUT_MS = 4000;
const FORBIDDEN = {
	executable: true, executablePath: true, executable_path: true, command: true,
	commandLine: true, command_line: true, argv: true, args: true, raw: true,
	rawArgs: true, raw_args: true, path: true, cwd: true, shell: true,
};

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function failure(code, message, details) { return { ok: false, error: { code, message, details } }; }
function indeterminate(message, details) { return failure('EINDETERMINATE', message, details); }
function lower(value) {
	let out = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		out += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1);
	}
	return out;
}
function forbidden(value) {
	if (!object(value)) return false;
	for (let key in value) {
		if (FORBIDDEN[key] || index(lower(key), 'executable') >= 0 || index(lower(key), 'command') >= 0 || index(lower(key), 'raw') >= 0 || index(lower(key), 'argv') >= 0 || index(lower(key), 'path') >= 0) return true;
		if (object(value[key]) && forbidden(value[key])) return true;
	}
	return false;
}
function valid_host(value) { return string(value) && match(value, /^[a-z0-9][a-z0-9.-]{0,252}$/); }
function valid_url(value) { return string(value) && length(value) <= 2048 && substr(value, 0, 8) == 'https://'; }
function remaining(request, minimum) {
	let now = int(time() * 1000), end = request?.deadlineMs;
	if (type(end) != 'int' || end <= now || end - now < minimum) return null;
	return end - now;
}
function timeout_seconds(milliseconds, maximum) {
	let bounded = milliseconds > maximum ? maximum : milliseconds;
	return int(bounded / 1000);
}
function run(command, milliseconds, deadlineMs) {
	if (milliseconds == null) return indeterminate('Probe deadline has expired.', { stage: 'deadline' });
	let process = null, output = '', started = int(time() * 1000);
	try { process = popen(command + ' 2>/dev/null', 'r'); } catch (e) { return failure('EDEPENDENCY', 'Fixed probe executor could not start.', { stage: 'spawn' }); }
	if (!process) return failure('EDEPENDENCY', 'Fixed probe executor is unavailable.', { stage: 'spawn' });
	try { output = process.read('all') || ''; } catch (e) { process.close(); return indeterminate('Probe response could not be read.', { stage: 'read' }); }
	let rc = process.close(), finished = int(time() * 1000);
	if (finished > deadlineMs) return indeterminate('Probe descriptor deadline was exceeded.', { stage: 'deadline' });
	if (length(output) > MAX_OUTPUT) return indeterminate('Probe response exceeded its bound.', { stage: 'output' });
	return { ok: true, output, rc, startedAt: started, finishedAt: finished };
}
function line_end(value, start) { let tail = substr(value, start), found = index(tail, '\r\n'); return found < 0 ? -1 : start + found; }
function decimal(value) { return string(value) && match(value, /^[0-9]+$/) ? +value : null; }

export const scanner_probe_parse_http = function(raw, startedAt, finishedAt) {
	if (!string(raw) || !length(raw) || type(startedAt) != 'int' || type(finishedAt) != 'int' || finishedAt < startedAt) return indeterminate('HTTP response is unavailable.', { stage: 'parse' });
	let firstEnd = line_end(raw, 0), first = firstEnd >= 0 ? substr(raw, 0, firstEnd) : '';
	let fields = split(first, ' '), status = length(fields) >= 2 ? decimal(fields[1]) : null;
	if (!match(first, /^HTTP\/[0-9]\.[0-9] [0-9]{3}([[:space:]]|$)/) || status == null || status < 100 || status > 599) return indeterminate('HTTP response status is invalid.', { stage: 'parse' });
	let bodyStart = index(raw, '\r\n\r\n');
	if (bodyStart < 0) return indeterminate('HTTP response headers are incomplete.', { stage: 'parse' });
	bodyStart += 4;
	let bytes = length(raw) - bodyStart;
	return { ok: true, observation: { statusCode: status, bytesReceived: bytes, latencyMs: finishedAt - startedAt, responseBytes: length(raw), body: substr(raw, bodyStart), tlsStatus: 'success' } };
};

function u16(raw, offset) { return ord(raw, offset) * 256 + ord(raw, offset + 1); }
function u32(raw, offset) { return ord(raw, offset) * 16777216 + ord(raw, offset + 1) * 65536 + ord(raw, offset + 2) * 256 + ord(raw, offset + 3); }
function address(value) { return value[0] + '.' + value[1] + '.' + value[2] + '.' + value[3]; }

export const scanner_probe_parse_stun = function(raw, startedAt, finishedAt) {
	if (!string(raw) || length(raw) < 20 || type(startedAt) != 'int' || type(finishedAt) != 'int' || finishedAt < startedAt) return indeterminate('STUN response is unavailable.', { stage: 'parse' });
	if ((ord(raw, 0) & 0xc0) != 0 || u32(raw, 4) != 0x2112a442) return indeterminate('STUN response header is invalid.', { stage: 'parse' });
	let messageLength = u16(raw, 2);
	if (messageLength > length(raw) - 20) return indeterminate('STUN response is truncated.', { stage: 'parse' });
	for (let offset = 20; offset + 4 <= 20 + messageLength;) {
		let kind = u16(raw, offset), size = u16(raw, offset + 2), value = offset + 4;
		if (value + size > length(raw)) return indeterminate('STUN attribute is truncated.', { stage: 'parse' });
		if (kind == 0x0020 && size >= 8 && ord(raw, value + 1) == 1) {
			let port = u16(raw, value + 2) ^ 0x2112, bytes = [];
			for (let i = 0; i < 4; i++) push(bytes, ord(raw, value + 4 + i) ^ ord(sprintf('%c%c%c%c', 0x21, 0x12, 0xa4, 0x42), i));
			return { ok: true, observation: { transport: 'stun', status: 'success', latencyMs: finishedAt - startedAt, attempts: 1, mappedFamily: 'IPv4', mappedAddress: address(bytes), mappedPort: port } };
		}
		offset += 4 + ((size + 3) & ~3);
	}
	return indeterminate('STUN response has no XOR-mapped address.', { stage: 'parse' });
};

function http_request(host, timeoutMs) {
	return "printf 'GET / HTTP/1.1\\r\\nHost: " + host + "\\r\\nConnection: close\\r\\nRange: bytes=0-69632\\r\\n\\r\\n' | " + NCAT + ' --ssl -4 -w ' + timeout_seconds(timeoutMs, MAX_TCP_TIMEOUT_MS) + ' ' + host + ' 443';
}
function stun_request(timeoutMs, host, port) {
	return "printf '\\001\\000\\000\\000\\041\\022\\244\\102\\001\\002\\003\\004\\005\\006\\007\\010\\011\\012\\013\\014' | " + NCAT + ' -u -w ' + timeout_seconds(timeoutMs, MAX_STUN_TIMEOUT_MS) + ' ' + host + ' ' + port;
}

export const scanner_probe_execute = function(descriptor) {
	if (!object(descriptor) || forbidden(descriptor) || !object(descriptor.request)) return failure('EDEPENDENCY', 'Probe descriptor is unavailable.', { stage: 'descriptor' });
	let request = descriptor.request;
	if (request.transport == 'tls') {
		if (!valid_host(request.host)) return failure('EDEPENDENCY', 'TLS probe host is not server-owned.', { stage: 'descriptor' });
		let available = remaining(request, 1000);
		if (available == null) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
		let result = run(http_request(request.host, available), available, request.deadlineMs);
		if (!result.ok) return result;
		if (result.rc != 0) return failure('EDEPENDENCY', 'Fixed TLS probe did not complete.', { stage: 'transport', exitCode: result.rc });
		let parsed = scanner_probe_parse_http(result.output, result.startedAt, result.finishedAt);
		if (!parsed.ok) return parsed;
		return { ok: true, observations: [{ protocol: 'tcp', ipv4: { status: 'open', available: true, latencyMs: parsed.observation.latencyMs, error: null }, ipv6: { status: 'skipped', available: false, latencyMs: 0, error: 'NOT_REQUESTED' } }] };
	}
	if (request.transport == 'tls+body') {
		if (type(request.hosts) != 'array' || !length(request.hosts)) return failure('EDEPENDENCY', 'TLS body probe hosts are unavailable.', { stage: 'descriptor' });
		let observations = [];
		for (let host in request.hosts) {
			if (!object(host) || !valid_host(host.host) || !valid_url(host.url)) return failure('EDEPENDENCY', 'TLS body probe host is not server-owned.', { stage: 'descriptor' });
			let available = remaining(request, 1000);
			if (available == null) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
			let result = run(http_request(host.host, available), available, request.deadlineMs);
			if (!result.ok) return result;
			if (result.rc != 0) return failure('EDEPENDENCY', 'Fixed body probe did not complete.', { stage: 'transport', exitCode: result.rc });
			let parsed = scanner_probe_parse_http(result.output, result.startedAt, result.finishedAt);
			if (!parsed.ok) return parsed;
			push(observations, { host: host.host, addressFamily: host.addressFamily, tls: { status: parsed.observation.tlsStatus, readBytes: parsed.observation.responseBytes > 2048 ? 2048 : parsed.observation.responseBytes, latencyMs: parsed.observation.latencyMs }, body: parsed.observation });
		}
		return { ok: true, observations: [{ hosts: observations }] };
	}
	if (request.transport == 'stun') {
		if (!valid_host(request.host) || type(request.port) != 'int' || request.port < 1 || request.port > 65535) return failure('EDEPENDENCY', 'STUN target is not server-owned.', { stage: 'descriptor' });
		let available = remaining(request, 1000);
		if (available == null) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
		let result = run(stun_request(available, request.host, request.port), available, request.deadlineMs);
		if (!result.ok) return result;
		if (result.rc != 0) return failure('EDEPENDENCY', 'Fixed STUN probe did not complete.', { stage: 'transport', exitCode: result.rc });
		let parsed = scanner_probe_parse_stun(result.output, result.startedAt, result.finishedAt);
		return parsed.ok ? { ok: true, observations: [parsed.observation] } : parsed;
	}
	return failure('EDEPENDENCY', 'Probe transport is not supported by the fixed executor.', { stage: 'descriptor' });
};
