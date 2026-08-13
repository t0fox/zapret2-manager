'use strict';

import { scanner_probe as native_scanner_probe } from './core/native-helper.uc';

const AUTHORITY = 'scanner-probe-adapter.v1';
const ADAPTER_DIGEST = '7cd367ef2aed1be2567505bf978b2d2b73f97ff149cc48d64826ed4f2b8c885e';
const TLS_READ_LIMIT = 2048;
const BODY_READ_LIMIT = 69633;
const STUN_READ_LIMIT = 1024;
const TLS_TIMEOUT_MS = 6000;
const BODY_TIMEOUT_MS = 8000;
const STUN_TIMEOUT_MS = 4000;
const STUN_TRANSACTION_ID = '0102030405060708090a0b0c';

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
function decimal(value) { return string(value) && match(value, /^[0-9]+$/) != null ? +value : null; }
function hex(value) { return string(value) && match(value, /^[0-9a-fA-F]+$/) != null ? +('0x' + value) : null; }
function round_one(value) { return int(value * 10 + 0.5) / 10.0; }
function body_limit(settings) { return settings?.readLimitBytes > 0 ? settings.readLimitBytes : BODY_READ_LIMIT; }
function expected_range(settings) { return string(settings?.range) && match(settings.range, /^bytes=[0-9]+-[0-9]+$/) ? settings.range : null; }
function range_bounds(value) { let parts = split(substr(value, 6), '-'); return length(parts) == 2 ? { start: +parts[0], end: +parts[1] } : null; }
function header_end(raw, start) { let found = index(substr(raw, start), '\r\n\r\n'); return found < 0 ? -1 : start + found; }
function header_map(raw, start, end) {
	let result = {}, lines = split(substr(raw, start, end - start), '\r\n');
	for (let i = 1; i < length(lines); i++) {
		let colon = index(lines[i], ':');
		if (colon <= 0 || match(trim(substr(lines[i], 0, colon)), /^[A-Za-z0-9-]+$/) == null) return null;
		let key = lower(trim(substr(lines[i], 0, colon))), value = trim(substr(lines[i], colon + 1));
		if (!length(value) || result[key] != null) return null;
		result[key] = value;
	}
	return result;
}
function trailers_valid(raw) {
	if (!length(raw)) return true;
	let seen = {};
	for (let line in split(raw, '\r\n')) {
		let colon = index(line, ':');
		if (colon <= 0 || match(trim(substr(line, 0, colon)), /^[A-Za-z0-9-]+$/) == null || seen[lower(trim(substr(line, 0, colon)))]) return false;
		seen[lower(trim(substr(line, 0, colon)))] = true;
		if (!length(trim(substr(line, colon + 1)))) return false;
	}
	return true;
}
function status_line(raw, start, end) {
	let line = substr(raw, start, end - start), status = decimal(substr(line, 9, 3));
	return length(line) >= 12 && substr(line, 0, 5) == 'HTTP/' && substr(line, 6, 1) == '.' && substr(line, 8, 1) == ' ' && status >= 100 && status <= 599 ? status : null;
}
function chunked_body(raw, start, limit) {
	let offset = start, body = '';
	while (offset < length(raw)) {
		let lineEnd = index(substr(raw, offset), '\r\n'); if (lineEnd < 0) return null;
		let line = trim(substr(raw, offset, lineEnd)), semi = index(line, ';');
		if (semi >= 0) {
			let extension = substr(line, semi + 1);
			if (match(extension, /^[ \t]*[A-Za-z0-9!#$%&'*+.^_`|~-]+(?:=[A-Za-z0-9!#$%&'*+.^_`|~-]+)?(?:;[ \t]*[A-Za-z0-9!#$%&'*+.^_`|~-]+(?:=[A-Za-z0-9!#$%&'*+.^_`|~-]+)?)*[ \t]*$/) == null) return null;
			line = substr(line, 0, semi);
		}
		if (!match(line, /^[0-9a-fA-F]+$/)) return null;
		let size = hex(line), data = offset + lineEnd + 2;
		if (size == 0) {
			if (substr(raw, data, 2) == '\r\n')
				return data + 2 == length(raw) ? { body, complete: true } : null;
			let trailerEnd = index(substr(raw, data), '\r\n\r\n');
			if (trailerEnd < 0) return null;
			let trailers = substr(raw, data, trailerEnd);
			if (!trailers_valid(trailers)) return null;
			return data + trailerEnd + 4 == length(raw) ? { body, complete: true } : null;
		}
		if (data + size + 2 > length(raw) || substr(raw, data + size, 2) != '\r\n') return null;
		if (length(body) < limit) body += substr(raw, data, limit - length(body) < size ? limit - length(body) : size);
		offset = data + size + 2;
	}
	return null;
}
function marker_evidence(body, settings) {
	let evidence = [], markers = settings?.markers;
	if (type(markers) != 'array') return evidence;
	body = substr(body, 0, settings?.markerScanBytes > 0 ? settings.markerScanBytes : length(body));
	for (let marker in markers) for (let needle in marker.needles || []) if (string(needle) && index(lower(body), lower(needle)) >= 0) { push(evidence, { name: marker.name, needle }); break; }
	return evidence;
}
function content_range_ok(value, expected) {
	if (!expected) return true;
	let bounds = range_bounds(expected), parsed = match(value || '', /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/);
	return bounds != null && parsed != null && +parsed[1] == bounds.start && +parsed[2] == bounds.end &&
		(parsed[3] == '*' || +parsed[3] >= bounds.end + 1);
}

export const scanner_probe_parse_http = function(raw, startedAt, finishedAt, settings) {
	if (!string(raw) || !length(raw) || type(startedAt) != 'int' || type(finishedAt) != 'int' || finishedAt < startedAt) return indeterminate('HTTP response is unavailable.', { stage: 'parse' });
	let offset = 0, status = null, headers = null, bodyStart = -1;
	for (let interim = 0; interim < 8; interim++) {
		let end = header_end(raw, offset); if (end < 0) return indeterminate('HTTP response headers are incomplete.', { stage: 'parse' });
		status = status_line(raw, offset, end); if (status == null) return indeterminate('HTTP response status is invalid.', { stage: 'parse' });
		headers = header_map(raw, offset, end); if (headers == null) return indeterminate('HTTP response headers are invalid.', { stage: 'parse' }); bodyStart = end + 4;
		if (status < 200 && status != 101) { offset = bodyStart; continue; } break;
	}
	if (status == null || status < 200) return indeterminate('HTTP response has no final status.', { stage: 'parse' });
	let limit = body_limit(settings), body = '', complete = false, capped = false;
	if (status == 204 || status == 205 || status == 304) {
		if (headers['transfer-encoding'] != null || (headers['content-length'] != null && decimal(headers['content-length']) == null) ||
			((status == 204 || status == 205) && headers['content-length'] != null && decimal(headers['content-length']) != 0) || length(raw) != bodyStart) return indeterminate('HTTP no-body framing is invalid.', { stage: 'parse' });
		complete = true;
	}
	else if (headers['transfer-encoding'] != null) {
		if (headers['transfer-encoding'] != 'chunked' || headers['content-length'] != null) return indeterminate('HTTP framing is invalid.', { stage: 'parse' });
		let parsed = chunked_body(raw, bodyStart, limit); if (parsed == null) return indeterminate('Chunked HTTP response is truncated.', { stage: 'parse' }); body = parsed.body; complete = true; capped = length(body) >= limit;
	}
	else {
		if (headers['content-length'] != null && match(headers['content-length'], /^[0-9]+$/) == null) return indeterminate('HTTP Content-Length is invalid.', { stage: 'parse' });
		let declared = decimal(headers['content-length']), available = length(raw) - bodyStart;
		if (declared != null && available < declared && available < limit) return indeterminate('HTTP response body is truncated.', { stage: 'parse' });
		let wanted = declared == null ? available : (declared < available ? declared : available);
		body = substr(raw, bodyStart, wanted < limit ? wanted : limit); capped = wanted > limit || length(body) >= limit; complete = declared == null || available >= declared || capped;
	}
	let elapsed = finishedAt - startedAt, range = expected_range(settings), markers = marker_evidence(body, settings);
	if (range && (!headers['content-range'] || !content_range_ok(headers['content-range'], range))) return indeterminate('HTTP Content-Range is not the requested canonical range.', { stage: 'parse' });
	return { ok: true, observation: { statusCode: status, bytesReceived: length(body), body, responseBytes: length(raw), latencyMs: elapsed, startedAt, finishedAt,
		kbps: elapsed > 0 ? round_one((length(body) * 8.0) / elapsed) : 0, complete, truncated: !complete, capped, range,
		rangeSatisfied: !range || (headers['content-range'] != null && content_range_ok(headers['content-range'], range)), contentLength: decimal(headers['content-length']),
		transferEncoding: headers['transfer-encoding'] || null, marker: length(markers) ? markers[0].name : '', markerEvidence: markers, tlsStatus: 'success' } };
};

function u16(raw, offset) { return ord(raw, offset) * 256 + ord(raw, offset + 1); }
function u32(raw, offset) { return ord(raw, offset) * 16777216 + ord(raw, offset + 1) * 65536 + ord(raw, offset + 2) * 256 + ord(raw, offset + 3); }
export const scanner_probe_parse_stun = function(raw, startedAt, finishedAt, settings, expectedType) {
	if (!string(raw) || length(raw) < 20 || type(startedAt) != 'int' || type(finishedAt) != 'int' || finishedAt < startedAt) return indeterminate('STUN response is unavailable.', { stage: 'parse' });
	if (u16(raw, 0) != (expectedType == null ? 0x0101 : expectedType) || (ord(raw, 0) & 0xc0) != 0 || u32(raw, 4) != 0x2112a442) return indeterminate('STUN response header is invalid.', { stage: 'parse' });
	if (string(settings?.transactionId) && length(settings.transactionId) == 24)
		for (let i = 0; i < 12; i++) if (ord(raw, 8 + i) != hex(substr(settings.transactionId, i * 2, 2))) return indeterminate('STUN transaction identity is invalid.', { stage: 'parse' });
	else if (settings?.transactionId != null) return indeterminate('STUN transaction identity is invalid.', { stage: 'parse' });
	let size = u16(raw, 2); if (size > length(raw) - 20 || size > STUN_READ_LIMIT - 20) return indeterminate('STUN response is truncated.', { stage: 'parse' });
	for (let offset = 20; offset + 4 <= 20 + size;) { let kind = u16(raw, offset), lengthValue = u16(raw, offset + 2), value = offset + 4; if (value + lengthValue > length(raw)) return indeterminate('STUN attribute is truncated.', { stage: 'parse' }); if (kind == 0x0020 && lengthValue >= 8 && ord(raw, value + 1) == 1) { let bytes = []; for (let i = 0; i < 4; i++) push(bytes, ord(raw, value + 4 + i) ^ [0x21, 0x12, 0xa4, 0x42][i]); return { ok: true, observation: { transport: 'stun', status: 'success', latencyMs: finishedAt - startedAt, attempts: settings?.attempts || 1, mappedFamily: 'IPv4', mappedAddress: bytes[0] + '.' + bytes[1] + '.' + bytes[2] + '.' + bytes[3], mappedPort: u16(raw, value + 2) ^ 0x2112 } }; } offset += 4 + ((lengthValue + 3) & ~3); }
	return indeterminate('STUN response has no XOR-mapped IPv4 address.', { stage: 'parse' });
};

function descriptor_valid(descriptor) {
	return object(descriptor) && descriptor.authority == AUTHORITY && descriptor.adapterDigest == ADAPTER_DIGEST
		&& object(descriptor.request) && object(descriptor.targetProfile) && string(descriptor.targetProfileDigest)
		&& string(descriptor.targetProfile.primaryHost) && object(descriptor.targetProfile.tcp)
		&& object(descriptor.targetProfile.udp) && type(descriptor.targetProfile.testHosts) == 'array';
}
function native_output(result) { try { return b64dec(result.data.content); } catch (e) { return null; } }
function native_observation_complete(result, raw) {
	return result?.ok === true && object(result.data) && result.data.complete === true
		&& type(result.data.byteLength) == 'int' && result.data.byteLength == length(raw)
		&& type(result.data.exitCode) == 'int' && type(result.data.signal) == 'int'
		&& type(result.data.startedAt) == 'int' && type(result.data.finishedAt) == 'int'
		&& result.data.finishedAt >= result.data.startedAt;
}
function family_requested(families, family) { for (let item in families || []) if (item == family) return true; return false; }
function bounded_timeout(request, configured) {
	if (type(request?.deadlineMs) != 'int') return null;
	let remaining = request.deadlineMs - int(time() * 1000);
	return remaining > 0 ? (remaining < configured ? remaining : configured) : null;
}
function native_call(descriptor, request) {
	return native_scanner_probe(descriptor.authority, descriptor.adapterDigest, descriptor.targetProfileDigest, descriptor.targetProfile, descriptor.candidate, request);
}
function native_call_safe(descriptor, request) {
	try {
		let result = native_call(descriptor, request);
		if (!result?.ok && result.error?.code != 'EDEPENDENCY') return failure('EDEPENDENCY', 'Native probe helper returned an infrastructure failure.', { stage: 'transport', helper: result.error });
		return result;
	}
	catch (exception) { return failure('EDEPENDENCY', 'Native probe helper is unavailable.', { stage: 'transport', exception }); }
}

function native_failure(result, message) {
	if (!result?.ok) return result;
	return failure('EDEPENDENCY', message, { stage: 'transport', child: result.data });
}

export const scanner_probe_execute = function(descriptor) {
	if (!descriptor_valid(descriptor)) return failure('EDEPENDENCY', 'Probe descriptor is not server-owned.', { stage: 'descriptor' });
	let request = descriptor.request, now = int(time() * 1000), result, raw;
	if (request.transport == 'tls') {
		let families = request.addressFamilies, observations = {};
		if (type(families) != 'array') return failure('EDEPENDENCY', 'TLS descriptor settings are invalid.', { stage: 'descriptor' });
		for (let family in families) {
			let timeoutMs = bounded_timeout(request, TLS_TIMEOUT_MS);
			if (timeoutMs == null) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
			let probe = { transport: 'tls', mode: request.mode, retries: request.retries, host: request.host, addressFamily: family, port: request.port, portRange: request.portRange, tls: request.tls, timeoutMs, deadlineMs: request.deadlineMs };
			result = native_call_safe(descriptor, probe); if (!result.ok) return result;
			raw = native_output(result); if (raw == null || !native_observation_complete(result, raw)) return native_failure(result, 'TLS child output is incomplete.');
			if (result.data.signal != 0 || result.data.exitCode != 0) return native_failure(result, 'TLS child outcome is not a successful transport observation.');
			let parsed = scanner_probe_parse_http(raw, result.data.startedAt, result.data.finishedAt, { readLimitBytes: TLS_READ_LIMIT });
			if (!parsed.ok) return failure('EDEPENDENCY', 'TLS response parsing is indeterminate.', { stage: 'parse', parser: parsed.error });
			observations[family] = { status: 'open', available: true, latencyMs: parsed.observation.latencyMs, startedAt: result.data.startedAt, finishedAt: result.data.finishedAt, error: null };
		}
		return { ok: true, observations: [{ protocol: 'tcp', ipv4: observations.ipv4 || { status: 'skipped', available: false, latencyMs: 0, error: 'NOT_REQUESTED' }, ipv6: observations.ipv6 || { status: 'skipped', available: false, latencyMs: 0, error: 'NOT_REQUESTED' } }] };
	}
	if (request.transport == 'tls+body') {
		let hosts = [], transportFailures = 0;
		for (let item in request.hosts) {
			let timeoutMs = bounded_timeout(request, BODY_TIMEOUT_MS);
			if (timeoutMs == null) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
			let probe = { transport: 'tls+body', mode: request.mode, retries: request.retries, host: item.host, addressFamily: item.addressFamily, port: item.port, portRange: item.portRange, url: item.url, tls: request.tls, body: request.body, timeoutMs, deadlineMs: request.deadlineMs };
			result = native_call_safe(descriptor, probe);
			if (!result.ok) { return result; }
			raw = native_output(result); if (raw == null || !native_observation_complete(result, raw) || result.data.signal != 0 || result.data.exitCode != 0) return native_failure(result, 'HTTP child outcome is not usable.');
			let parsed = scanner_probe_parse_http(raw, result.data.startedAt, result.data.finishedAt, request.body);
			if (!parsed.ok) return failure('EDEPENDENCY', 'HTTP response parsing is indeterminate.', { stage: 'parse', parser: parsed.error });
			push(hosts, { host: item.host, addressFamily: item.addressFamily, startedAt: result.data.startedAt, finishedAt: result.data.finishedAt, tls: { status: 'success', readBytes: TLS_READ_LIMIT, readLimitBytes: TLS_READ_LIMIT, latencyMs: parsed.observation.latencyMs }, body: parsed.observation });
		}
		return { ok: true, observations: [{ hosts }] };
	}
	if (request.transport == 'stun') {
		let attempts = 0;
		for (attempts = 1; attempts <= request.retries; attempts++) {
			let timeoutMs = bounded_timeout(request, STUN_TIMEOUT_MS);
			if (timeoutMs == null) return failure('EDEPENDENCY', 'Probe deadline has expired.', { stage: 'deadline' });
			result = native_call_safe(descriptor, { transport: 'stun', mode: request.mode, retries: request.retries, host: request.host, addressFamily: request.addressFamily, port: request.port, portRange: request.portRange, transactionId: request.transactionId || STUN_TRANSACTION_ID, receiveLimitBytes: request.receiveLimitBytes, timeoutMs, deadlineMs: request.deadlineMs }); if (!result.ok) return result;
			raw = native_output(result); if (raw == null || !native_observation_complete(result, raw) || result.data.signal != 0 || result.data.exitCode != 0) return native_failure(result, 'STUN child outcome is not usable.');
			let parsed = scanner_probe_parse_stun(raw, result.data.startedAt, result.data.finishedAt, { attempts, transactionId: request.transactionId || STUN_TRANSACTION_ID }, 0x0101); if (parsed.ok) { parsed.observation.startedAt = result.data.startedAt; parsed.observation.finishedAt = result.data.finishedAt; return { ok: true, observations: [parsed.observation] }; }
			if (attempts == request.retries) return failure('EDEPENDENCY', 'STUN response parsing is indeterminate.', { stage: 'parse', parser: parsed.error });
		}
		return failure('EDEPENDENCY', 'STUN response is indeterminate.', { stage: 'transport' });
	}
	return failure('EDEPENDENCY', 'Probe transport is not supported by the fixed executor.', { stage: 'descriptor' });
};
