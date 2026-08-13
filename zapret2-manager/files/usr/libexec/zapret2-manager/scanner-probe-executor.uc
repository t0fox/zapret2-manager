'use strict';

// This is the only production network boundary for Scanner probes. Descriptors
// are emitted by scanner-probe-adapter and contain no caller-selected command.
import { popen } from 'fs';

const NCAT = '/usr/bin/ncat';
const TIMEOUT = '/usr/bin/timeout';
const AUTHORITY = 'scanner-probe-adapter.v1';
const TLS_TIMEOUT_MS = 6000;
const BODY_TIMEOUT_MS = 8000;
const STUN_TIMEOUT_MS = 4000;
const TLS_READ_LIMIT = 2048;
const BODY_READ_LIMIT = 69633;
const STUN_READ_LIMIT = 1024;
const MAX_RETRIES = 2;
const STUN_COOKIE = [0x21, 0x12, 0xa4, 0x42];
const STUN_TRANSACTION = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FORBIDDEN = {
	executable: true, executablePath: true, executable_path: true, program: true,
	command: true, commandLine: true, command_line: true, argv: true, args: true,
	raw: true, rawArgs: true, raw_args: true, path: true, cwd: true, shell: true,
};

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function failure(code, message, details) { return { ok: false, error: { code, message, details } }; }
function indeterminate(message, details) { return failure('EINDETERMINATE', message, details); }
function lower(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1);
	}
	return result;
}
function forbidden(value) {
	if (!object(value)) return false;
	for (let key in value) {
		let name = lower(key);
		if (FORBIDDEN[key] || index(name, 'executable') >= 0 || index(name, 'command') >= 0 ||
			index(name, 'raw') >= 0 || index(name, 'argv') >= 0 || index(name, 'path') >= 0) return true;
		if (object(value[key]) && forbidden(value[key])) return true;
	}
	return false;
}
function valid_host(value) {
	return string(value) && length(value) >= 1 && length(value) <= 253 &&
		match(value, /^[a-z0-9][a-z0-9.-]*$/) != null && index(value, '..') < 0;
}
function valid_family(value) { return value == 'ipv4' || value == 'ipv6'; }
function quote(value) {
	let result = "'";
	for (let i = 0; i < length(value); i++) result += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1);
	return result + "'";
}
function decimal(value) { return string(value) && match(value, /^[0-9]+$/) != null ? +value : null; }
function hex(value) { return string(value) && match(value, /^[0-9a-fA-F]+$/) != null ? +('0x' + value) : null; }
function round_one(value) { return int(value * 10 + 0.5) / 10.0; }
function remaining(request, minimum) {
	let now = int(time() * 1000), end = request?.deadlineMs;
	if (type(end) != 'int' || end <= now || end - now < minimum) return null;
	return end - now;
}
function seconds(milliseconds, maximum) {
	let value = milliseconds > maximum ? maximum : milliseconds, result = int(value / 1000);
	return result < 1 ? 1 : result;
}
function family_flag(family) { return family == 'ipv6' ? '-6' : '-4'; }

// timeout owns the child process and sends TERM followed by KILL. This keeps
// popen.read('all') bounded by a fixed per-operation deadline.
function run(command, operationMs, deadlineMs, outputLimit) {
	if (!string(command) || type(outputLimit) != 'int' || outputLimit < 1) return indeterminate('Probe command or output bound is invalid.', { stage: 'descriptor' });
	let available = remaining({ deadlineMs }, 1000);
	if (available == null) return indeterminate('Probe deadline has expired.', { stage: 'deadline' });
	let duration = seconds(operationMs < available ? operationMs : available, operationMs);
	let process = null, started = int(time() * 1000), output = '';
	let bounded = TIMEOUT + ' -k 1s ' + duration + 's sh -c ' + quote(command + ' 2>/dev/null | head -c ' + outputLimit);
	try { process = popen(bounded + ' 2>/dev/null'); }
	catch (exception) { return failure('EDEPENDENCY', 'Fixed probe executor could not start.', { stage: 'spawn' }); }
	if (!process) return failure('EDEPENDENCY', 'Fixed probe executor is unavailable.', { stage: 'spawn' });
	try { output = process.read('all') || ''; }
	catch (exception) { process.close(); return indeterminate('Probe response could not be read.', { stage: 'read' }); }
	let rc = process.close(), finished = int(time() * 1000);
	if (finished > deadlineMs) return indeterminate('Probe descriptor deadline was exceeded.', { stage: 'deadline' });
	if (rc == 124) return { ok: true, timeout: true, output, rc, startedAt: started, finishedAt: finished };
	if (rc != 0) return failure('EDEPENDENCY', 'Fixed probe transport is uncertain.', { stage: 'transport', exitCode: rc });
	return { ok: true, output, rc, startedAt: started, finishedAt: finished };
}
function header_end(raw, start) {
	let found = index(substr(raw, start), '\r\n\r\n');
	return found < 0 ? -1 : start + found;
}
function header_map(raw, start, end) {
	let result = {}, lines = split(substr(raw, start, end - start), '\r\n');
	for (let i = 1; i < length(lines); i++) {
		let colon = index(lines[i], ':');
		if (colon > 0) result[lower(trim(substr(lines[i], 0, colon)))] = trim(substr(lines[i], colon + 1));
	}
	return result;
}
function status_line(raw, start, end) {
	let line = substr(raw, start, end - start), status = decimal(substr(line, 9, 3));
	if (length(line) < 12 || substr(line, 0, 5) != 'HTTP/' || substr(line, 6, 1) != '.' || substr(line, 8, 1) != ' ') return null;
	return status != null && status >= 100 && status <= 599 ? status : null;
}
function body_limit(settings) {
	let value = settings?.readLimitBytes;
	return type(value) == 'int' && value > 0 ? value : BODY_READ_LIMIT;
}
function expected_range(settings) {
	let value = settings?.range;
	return string(value) && match(value, /^bytes=[0-9]+-[0-9]+$/) != null ? value : null;
}
function range_bounds(value) {
	if (!value) return null;
	let parts = split(substr(value, 6), '-');
	return length(parts) == 2 ? { start: +parts[0], end: +parts[1] } : null;
}
function chunked_body(raw, start, limit) {
	let offset = start, body = '', complete = false;
	while (offset < length(raw)) {
		let lineEnd = index(substr(raw, offset), '\r\n');
		if (lineEnd < 0) return null;
		let line = trim(substr(raw, offset, lineEnd)), semi = index(line, ';');
		if (semi >= 0) line = substr(line, 0, semi);
		if (!match(line, /^[0-9a-fA-F]+$/)) return null;
		let size = hex(line), data = offset + lineEnd + 2;
		if (size == 0) {
			if (data + 2 > length(raw) || substr(raw, data, 2) != '\r\n') return null;
			complete = true; break;
		}
		if (data + size + 2 > length(raw) || substr(raw, data + size, 2) != '\r\n') return null;
		if (length(body) < limit) body += substr(raw, data, limit - length(body) < size ? limit - length(body) : size);
		offset = data + size + 2;
	}
	return { body, complete };
}
function marker_evidence(body, settings) {
	let evidence = [], markers = settings?.markers;
	if (type(markers) != 'array') return evidence;
	body = substr(body, 0, settings?.markerScanBytes > 0 ? settings.markerScanBytes : length(body));
	for (let marker in markers) {
		if (!object(marker) || !string(marker.name) || type(marker.needles) != 'array') continue;
		for (let needle in marker.needles) {
			if (string(needle) && index(lower(body), lower(needle)) >= 0) {
				push(evidence, { name: marker.name, needle }); break;
			}
		}
	}
	return evidence;
}
function content_range_ok(value, expected) {
	if (!expected || !value) return expected == null;
	let bounds = range_bounds(expected), matchValue = match(value, /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/);
	return bounds != null && matchValue != null && +matchValue[1] == bounds.start && +matchValue[2] <= bounds.end;
}

export const scanner_probe_parse_http = function(raw, startedAt, finishedAt, settings) {
	if (!string(raw) || !length(raw) || type(startedAt) != 'int' || type(finishedAt) != 'int' || finishedAt < startedAt)
		return indeterminate('HTTP response is unavailable.', { stage: 'parse' });
	let offset = 0, status = null, headers = null, bodyStart = -1;
	for (let interim = 0; interim < 8; interim++) {
		let end = header_end(raw, offset);
		if (end < 0) return indeterminate('HTTP response headers are incomplete.', { stage: 'parse' });
		status = status_line(raw, offset, end);
		if (status == null || status < 100 || status > 599) return indeterminate('HTTP response status is invalid.', { stage: 'parse' });
		headers = header_map(raw, offset, end);
		bodyStart = end + 4;
		if (status < 200 && status != 101) { offset = bodyStart; continue; }
		break;
	}
	if (status == null || status < 200) return indeterminate('HTTP response has no final status.', { stage: 'parse' });
	let limit = body_limit(settings), body = '', complete = false, capped = false;
	if (status == 204 || status == 205 || status == 304) { complete = true; }
	else if (index(lower(headers['transfer-encoding'] || ''), 'chunked') >= 0) {
		let parsed = chunked_body(raw, bodyStart, limit);
		if (parsed == null || !parsed.complete) return indeterminate('Chunked HTTP response is truncated.', { stage: 'parse' });
		body = parsed.body; complete = true; capped = length(body) >= limit;
	}
	else {
		let declared = decimal(headers['content-length']), available = length(raw) - bodyStart;
		if (declared != null && declared < 0) return indeterminate('HTTP Content-Length is invalid.', { stage: 'parse' });
		if (declared != null && available < declared && declared <= limit) return indeterminate('HTTP response body is truncated.', { stage: 'parse' });
		let wanted = declared == null ? available : (declared < available ? declared : available);
		body = substr(raw, bodyStart, wanted < limit ? wanted : limit); capped = wanted > limit || length(body) >= limit;
		complete = declared == null || available >= declared || capped;
	}
	let elapsed = finishedAt - startedAt, range = expected_range(settings), rangeHeader = headers['content-range'];
	let markers = marker_evidence(body, settings), kbps = elapsed > 0 ? round_one((length(body) * 8.0) / elapsed) : 0;
	let rangeSatisfied = range == null || status == 200 || status == 204 || status == 205 || status == 304
		? true : content_range_ok(rangeHeader, range);
	return { ok: true, observation: {
		statusCode: status, bytesReceived: length(body), body, responseBytes: length(raw),
		latencyMs: elapsed, kbps, complete, truncated: !complete, capped,
		range: range, rangeSatisfied,
		contentLength: decimal(headers['content-length']), transferEncoding: headers['transfer-encoding'] || null,
		marker: length(markers) ? markers[0].name : '', markerEvidence: markers, tlsStatus: 'success',
	} };
};

function u16(raw, offset) { return ord(raw, offset) * 256 + ord(raw, offset + 1); }
function u32(raw, offset) { return ord(raw, offset) * 16777216 + ord(raw, offset + 1) * 65536 + ord(raw, offset + 2) * 256 + ord(raw, offset + 3); }
function same_transaction(raw, settings) {
	let expected = settings?.transactionId;
	if (!string(expected) || length(expected) != 24) return true;
	for (let i = 0; i < 12; i++) if (ord(raw, 8 + i) != hex(substr(expected, i * 2, 2))) return false;
	return true;
}
function address(bytes) { return bytes[0] + '.' + bytes[1] + '.' + bytes[2] + '.' + bytes[3]; }

export const scanner_probe_parse_stun = function(raw, startedAt, finishedAt, settings, expectedType) {
	if (!string(raw) || length(raw) < 20 || type(startedAt) != 'int' || type(finishedAt) != 'int' || finishedAt < startedAt)
		return indeterminate('STUN response is unavailable.', { stage: 'parse' });
	if (u16(raw, 0) != (expectedType == null ? 0x0101 : expectedType) || (ord(raw, 0) & 0xc0) != 0 || u32(raw, 4) != 0x2112a442 || !same_transaction(raw, settings))
		return indeterminate('STUN response header or transaction is invalid.', { stage: 'parse' });
	let messageLength = u16(raw, 2);
	if (messageLength > length(raw) - 20 || messageLength > STUN_READ_LIMIT - 20) return indeterminate('STUN response is truncated.', { stage: 'parse' });
	for (let offset = 20; offset + 4 <= 20 + messageLength;) {
		let kind = u16(raw, offset), size = u16(raw, offset + 2), value = offset + 4;
		if (value + size > length(raw)) return indeterminate('STUN attribute is truncated.', { stage: 'parse' });
		if (kind == 0x0020 && size >= 8 && ord(raw, value + 1) == 1) {
			let port = u16(raw, value + 2) ^ 0x2112, bytes = [];
			for (let i = 0; i < 4; i++) push(bytes, ord(raw, value + 4 + i) ^ STUN_COOKIE[i]);
			return { ok: true, observation: { transport: 'stun', status: 'success', latencyMs: finishedAt - startedAt,
				attempts: settings?.attempts || 1, mappedFamily: 'IPv4', mappedAddress: address(bytes), mappedPort: port } };
		}
		offset += 4 + ((size + 3) & ~3);
	}
	return indeterminate('STUN response has no XOR-mapped IPv4 address.', { stage: 'parse' });
};

function http_path(url, host) {
	if (!string(url) || substr(url, 0, 8) != 'https://') return null;
	let rest = substr(url, 8), slash = index(rest, '/');
	if (slash < 0 || substr(rest, 0, slash) != host || index(rest, '@') >= 0 || index(rest, '#') >= 0) return null;
	return substr(rest, slash);
}
function http_command(host, url, family, timeoutMs, settings) {
	let path = http_path(url, host);
	if (path == null || settings?.range != 'bytes=0-69632' || settings?.readLimitBytes != BODY_READ_LIMIT) return null;
	let request = 'GET ' + path + ' HTTP/1.1\\r\\nHost: ' + host + '\\r\\nConnection: close\\r\\nRange: ' + settings.range + '\\r\\n\\r\\n';
	return "printf '" + request + "' | " + TIMEOUT + ' -k 1s ' + seconds(timeoutMs, BODY_TIMEOUT_MS) + 's ' + NCAT + ' --ssl ' + family_flag(family) + ' -w ' + seconds(timeoutMs, BODY_TIMEOUT_MS) + ' ' + quote(host) + ' 443';
}
function tls_command(host, family, timeoutMs) {
	let request = 'GET / HTTP/1.1\\r\\nHost: ' + host + '\\r\\nConnection: close\\r\\n\\r\\n';
	return "printf '" + request + "' | " + TIMEOUT + ' -k 1s ' + seconds(timeoutMs, TLS_TIMEOUT_MS) + 's ' + NCAT + ' --ssl ' + family_flag(family) + ' -w ' + seconds(timeoutMs, TLS_TIMEOUT_MS) + ' ' + quote(host) + ' 443';
}
function stun_command(host, port, timeoutMs) {
	let request = '\\000\\001\\000\\000\\041\\022\\244\\102\\001\\002\\003\\004\\005\\006\\007\\010\\011\\012\\013\\014';
	return "printf '" + request + "' | " + TIMEOUT + ' -k 1s ' + seconds(timeoutMs, STUN_TIMEOUT_MS) + 's ' + NCAT + ' -u -4 -w ' + seconds(timeoutMs, STUN_TIMEOUT_MS) + ' ' + quote(host) + ' ' + port;
}
function descriptor_valid(descriptor) {
	return object(descriptor) && descriptor.authority == AUTHORITY && !forbidden(descriptor) && object(descriptor.request);
}
function body_request_valid(request) {
	return type(request.hosts) == 'array' && length(request.hosts) > 0 && request.retries == 1 &&
		object(request.tls) && request.tls.timeoutMs == TLS_TIMEOUT_MS && request.tls.readLimitBytes == TLS_READ_LIMIT &&
		object(request.body) && request.body.timeoutMs == BODY_TIMEOUT_MS && request.body.readLimitBytes == BODY_READ_LIMIT &&
		request.body.range == 'bytes=0-69632';
}

export const scanner_probe_execute = function(descriptor) {
	if (!descriptor_valid(descriptor)) return failure('EDEPENDENCY', 'Probe descriptor is not server-owned.', { stage: 'descriptor' });
	let request = descriptor.request, now = int(time() * 1000), end = request.deadlineMs;
	if (type(end) != 'int' || end <= now) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
	if (request.transport == 'tls') {
		if (!valid_host(request.host) || request.timeoutMs != TLS_TIMEOUT_MS || type(request.addressFamilies) != 'array') return failure('EDEPENDENCY', 'TLS descriptor settings are invalid.', { stage: 'descriptor' });
		let observations = {};
		for (let family in request.addressFamilies) {
			if (!valid_family(family)) return failure('EDEPENDENCY', 'TLS address family is invalid.', { stage: 'descriptor' });
			let available = remaining(request, 1000), result = run(tls_command(request.host, family, available), TLS_TIMEOUT_MS, end, TLS_READ_LIMIT);
			if (!result.ok) return result;
			observations[family] = result.timeout ? { status: 'timeout', available: true, latencyMs: result.finishedAt - result.startedAt, error: 'TIMEOUT' } : { status: 'open', available: true, latencyMs: result.finishedAt - result.startedAt, error: null };
		}
		return { ok: true, observations: [{ protocol: 'tcp', ipv4: observations.ipv4 || { status: 'skipped', available: false, latencyMs: 0, error: 'NOT_REQUESTED' }, ipv6: observations.ipv6 || { status: 'skipped', available: false, latencyMs: 0, error: 'NOT_REQUESTED' } }] };
	}
	if (request.transport == 'tls+body') {
		if (!body_request_valid(request)) return failure('EDEPENDENCY', 'HTTP body descriptor settings are invalid.', { stage: 'descriptor' });
		let observations = [];
		for (let item in request.hosts) {
			if (!object(item) || !valid_host(item.host) || item.hostIdentity != item.host || !valid_family(item.addressFamily) || http_path(item.url, item.host) == null) return failure('EDEPENDENCY', 'HTTP body target is not canonical.', { stage: 'descriptor' });
			let available = remaining(request, 1000), result = run(http_command(item.host, item.url, item.addressFamily, available, request.body), BODY_TIMEOUT_MS, end, BODY_READ_LIMIT);
			if (!result.ok) return result;
			if (result.timeout) { push(observations, { host: item.host, addressFamily: item.addressFamily, tls: { status: 'success', readBytes: 0, readLimitBytes: TLS_READ_LIMIT, latencyMs: result.finishedAt - result.startedAt }, body: { status: 'timeout', error: 'TIMEOUT', statusCode: 0, bytesReceived: 0, latencyMs: result.finishedAt - result.startedAt, range: request.body.range, minimumBytes: request.body.minimumBytes } }); continue; }
			let parsed = scanner_probe_parse_http(result.output, result.startedAt, result.finishedAt, request.body);
			if (!parsed.ok) return parsed;
			push(observations, { host: item.host, addressFamily: item.addressFamily, tls: { status: parsed.observation.tlsStatus, readBytes: parsed.observation.responseBytes > TLS_READ_LIMIT ? TLS_READ_LIMIT : parsed.observation.responseBytes, readLimitBytes: TLS_READ_LIMIT, latencyMs: parsed.observation.latencyMs }, body: parsed.observation });
		}
		return { ok: true, observations: [{ hosts: observations }] };
	}
	if (request.transport == 'stun') {
		if (!valid_host(request.host) || request.addressFamily != 'ipv4' || request.port < 1 || request.port > 65535 || request.timeoutMs != STUN_TIMEOUT_MS || request.retries != MAX_RETRIES || request.receiveLimitBytes != STUN_READ_LIMIT) return failure('EDEPENDENCY', 'STUN descriptor settings are invalid.', { stage: 'descriptor' });
		let attempts = 0, last = null;
		for (attempts = 1; attempts <= request.retries; attempts++) {
			let available = remaining(request, 1000), result = run(stun_command(request.host, request.port, available), STUN_TIMEOUT_MS, end, STUN_READ_LIMIT);
			if (!result.ok) return result;
			if (result.timeout) { last = result; continue; }
			let parsed = scanner_probe_parse_stun(result.output, result.startedAt, result.finishedAt, { transactionId: '0102030405060708090a0b0c', attempts }, 0x0101);
			if (parsed.ok) return { ok: true, observations: [parsed.observation] };
			return parsed;
		}
		return { ok: true, observations: [{ transport: 'stun', status: 'timeout', attempts, latencyMs: last ? last.finishedAt - last.startedAt : STUN_TIMEOUT_MS, error: 'TIMEOUT' }] };
	}
	return failure('EDEPENDENCY', 'Probe transport is not supported by the fixed executor.', { stage: 'descriptor' });
};
