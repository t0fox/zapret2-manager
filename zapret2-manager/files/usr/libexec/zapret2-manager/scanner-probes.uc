'use strict';

const TLS_READ_LIMIT = 2048;
const BODY_MINIMUM = 65536;
const BLOCK_MIN = 15000;
const BLOCK_MAX = 21000;
const BLOCK_WIDE_MIN = 10240;
const BLOCK_WIDE_MAX = 25600;

const UNAVAILABLE_ERRORS = {
	NO_ADDR: true, DNS_ERR: true, RESOLVE_ERR: true, NET_UNREACH: true, HOST_UNREACH: true,
};

const ERROR_PRIORITY = [
	'FAKE_LEAK', 'ISP_PAGE', 'HTTP_INJECT', 'TLS_MITM_SELF', 'TLS_MITM_UNKNOWN_CA',
	'TCP_16_20', 'TLS_RESET', 'TCP_RESET', 'TLS_EOF_EARLY', 'TLS_EOF_DATA',
	'READ_RESET', 'READ_BROKEN', 'TLS_SNI_REJECT', 'TLS_HANDSHAKE',
	'TLS_ALERT_INTERNAL', 'TLS_ALERT', 'TLS_CERT_ERR', 'TLS_VERSION', 'TCP_REFUSED',
	'HOST_UNREACH', 'NET_UNREACH', 'TLS_TIMEOUT', 'TCP_TIMEOUT', 'READ_TIMEOUT',
	'TIMEOUT', 'SHORT_BODY', 'RST', 'TCP_ABORT', 'CONNECT_ERR', 'TLS_ERR',
	'READ_ERR', 'BAD_URL', 'DNS_ERR', 'RESOLVE_ERR',
];

function is_object(value) { return type(value) == 'object' && value != null; }
function is_number(value) { return type(value) == 'int' || type(value) == 'double'; }
function valid_nonnegative_number(value) {
	return is_number(value) && value == value && value >= 0 && value - value == 0;
}
function number(value, fallback) { return is_number(value) && value >= 0 ? value : fallback; }
function clamp(value, low, high) { return value < low ? low : (value > high ? high : value); }
function round_to(value, places) {
	let scale = places == 3 ? 1000 : (places == 2 ? 100 : 10);
	return int(value * scale + 0.5) / (scale * 1.0);
}

function infrastructure(error, testType) {
	return {
		success: false, error: error, failureClass: 'probe_dependency_failure',
		infrastructureFailure: true, testType: testType,
	};
}

function normalize_family(raw) {
	raw = is_object(raw) ? raw : {};
	let status = type(raw.status) == 'string' ? raw.status : 'unavailable';
	let error = type(raw.error) == 'string' && raw.error != '' ? raw.error : null;
	let available = raw.available === true;
	if (raw.available !== false)
		available = status == 'open' || status == 'blocked' || status == 'failed' || status == 'timeout';
	if (status == 'skipped' || status == 'unavailable' || UNAVAILABLE_ERRORS[error]) available = false;
	let result = { status, available, latencyMs: number(raw.latencyMs, 0), error };
	if (is_number(raw.startedAt)) result.startedAt = raw.startedAt;
	if (is_number(raw.finishedAt)) result.finishedAt = raw.finishedAt;
	return result;
}

function baseline_family_complete(raw) {
	let statuses = ['open', 'blocked', 'failed', 'timeout', 'skipped', 'unavailable', 'error'];
	let allowed = false;
	if (is_object(raw) && type(raw.status) == 'string') for (let value in statuses) if (value == raw.status) allowed = true;
	return is_object(raw) && type(raw.status) == 'string'
		&& allowed
		&& (raw.available == null || type(raw.available) == 'bool')
		&& valid_nonnegative_number(raw.latencyMs)
		&& type(raw.bytesReceived) == 'int' && raw.bytesReceived >= 0
		&& type(raw.exitCode) == 'int' && raw.exitCode >= -1
		&& type(raw.signal) == 'int' && raw.signal >= 0
		&& type(raw.startedAt) == 'int' && raw.startedAt >= 0
		&& type(raw.finishedAt) == 'int' && raw.finishedAt >= raw.startedAt;
}

export const scanner_baseline_classify = function(raw) {
	if (!is_object(raw) || (raw.protocol != 'tcp' && raw.protocol != 'udp'))
		return { protocol: null, baselineOpen: false, allAvailableOpen: false,
			byAddressFamily: {}, probeAddressFamilies: [], infrastructureFailure: true,
			error: 'INVALID_BASELINE' };

	let by = {};
	if (raw.infrastructureFailure === true) return { protocol: raw.protocol, baselineOpen: false, allAvailableOpen: false,
		byAddressFamily: {}, probeAddressFamilies: [], infrastructureFailure: true, error: raw.error || 'PROBE_DEPENDENCY' };
	if (raw.protocol == 'udp') {
		if (raw.transport != 'stun')
			return { protocol: 'udp', baselineOpen: false, allAvailableOpen: false,
				byAddressFamily: {}, probeAddressFamilies: ['ipv4'], infrastructureFailure: true,
				error: 'PROBE_DEPENDENCY' };
		if (!valid_nonnegative_number(raw.latencyMs) || type(raw.bytesReceived) != 'int' || raw.bytesReceived < 0 ||
			type(raw.exitCode) != 'int' || raw.exitCode < -1 || type(raw.signal) != 'int' || raw.signal < 0 ||
			type(raw.startedAt) != 'int' || raw.startedAt < 0 || type(raw.finishedAt) != 'int' || raw.finishedAt < raw.startedAt)
			return { protocol: 'udp', baselineOpen: false, allAvailableOpen: false,
				byAddressFamily: {}, probeAddressFamilies: ['ipv4'], infrastructureFailure: true,
				error: 'INVALID_BASELINE' };
		if (raw.status == 'success' && raw.mappedFamily != 'IPv4')
			return { protocol: 'udp', baselineOpen: false, allAvailableOpen: false,
				byAddressFamily: {}, probeAddressFamilies: ['ipv4'], infrastructureFailure: true,
				error: 'INVALID_BASELINE' };
		if (raw.status == 'error' || (raw.status != 'success' && raw.status != 'timeout' &&
			raw.status != 'skipped' && raw.status != 'blocked'))
			return { protocol: 'udp', baselineOpen: false, allAvailableOpen: false,
				byAddressFamily: {}, probeAddressFamilies: ['ipv4'], infrastructureFailure: true,
				error: raw.error || 'INDETERMINATE' };
		let status = raw.status == 'success' ? 'open' :
			(raw.status == 'timeout' ? 'timeout' : (raw.status == 'skipped' ? 'skipped' : 'blocked'));
		by.ipv4 = normalize_family({ status, available: status != 'skipped', latencyMs: raw.latencyMs,
			error: raw.error || (status == 'timeout' ? 'TIMEOUT' : null) });
	}
	else {
		if (!baseline_family_complete(raw.ipv4) || !baseline_family_complete(raw.ipv6))
			return { protocol: 'tcp', baselineOpen: false, allAvailableOpen: false,
				byAddressFamily: {}, probeAddressFamilies: [], infrastructureFailure: true,
				error: 'INCOMPLETE_BASELINE' };
		by.ipv4 = normalize_family(raw.ipv4);
		by.ipv6 = normalize_family(raw.ipv6);
	}

	let available = 0, open = 0, blocked = [];
	for (let af in ['ipv4', 'ipv6']) {
		if (!by[af] || !by[af].available) continue;
		available++;
		if (by[af].status == 'open') open++;
		else push(blocked, af);
	}
	let all_open = available > 0 && open == available;
	let probe = blocked;
	if (!length(probe)) {
		if (by.ipv4) probe = ['ipv4'];
		else if (by.ipv6) probe = ['ipv6'];
	}
	return { protocol: raw.protocol, baselineOpen: open > 0, allAvailableOpen: all_open,
		byAddressFamily: by, probeAddressFamilies: probe, infrastructureFailure: false, error: null };
};

function normalize_tls(raw) {
	raw = is_object(raw) ? raw : {};
	let success = raw.status == 'success' || raw.success === true;
	let result = {
		success, status: success ? 'success' : (raw.status || 'failed'),
		error: success ? null : (raw.error || (raw.status == 'timeout' ? 'TIMEOUT' : 'TLS_FAIL')),
		latencyMs: number(raw.latencyMs, 0),
		readBytes: clamp(number(raw.readBytes, 0), 0, TLS_READ_LIMIT), readLimitBytes: TLS_READ_LIMIT,
	};
	if (is_number(raw.startedAt)) result.startedAt = raw.startedAt;
	if (is_number(raw.finishedAt)) result.finishedAt = raw.finishedAt;
	return result;
}

function in_cutoff(bytes) {
	return (bytes >= BLOCK_MIN && bytes <= BLOCK_MAX) ||
		(bytes >= BLOCK_WIDE_MIN && bytes <= BLOCK_WIDE_MAX);
}

function normalize_body(raw) {
	raw = is_object(raw) ? raw : {};
	let bytes = number(raw.bytesReceived, 0), code = number(raw.statusCode, 0), latency = number(raw.latencyMs, 0);
	let error = type(raw.error) == 'string' && raw.error != '' ? raw.error : null;
	let marker = type(raw.marker) == 'string' ? raw.marker : '';
	let marker_evidence = type(raw.markerEvidence) == 'array' ? raw.markerEvidence : [];
	let transport = type(raw.transport) == 'string' ? raw.transport : '';
	if (marker == 'isp_page' || raw.ispMarker || length(marker_evidence)) error = 'ISP_PAGE';
	else if (code == 400) error = 'FAKE_LEAK';
	else if (in_cutoff(bytes) && bytes < BODY_MINIMUM) error = 'TCP_16_20';
	else if (transport == 'timeout') error = 'TIMEOUT';
	else if (transport == 'reset') error = 'RST';
	let success = error == null && raw.rangeSatisfied !== false && raw.complete !== false && (bytes >= BODY_MINIMUM || bytes > BLOCK_MAX ||
		code == 204 || code == 205 || code == 304);
	if (!success && error == null) error = 'SHORT_BODY';
	let result = {
		success, status: success ? 'success' : (transport == 'timeout' ? 'timeout' : 'failed'),
		error: success ? null : error, statusCode: code, bytesReceived: bytes,
		kbps: is_number(raw.kbps) ? raw.kbps : (latency > 0 ? round_to((bytes * 8.0) / latency, 1) : 0), latencyMs: latency,
		marker: marker, markerEvidence: marker_evidence, range: 'bytes=0-69632', rangeSatisfied: raw.rangeSatisfied !== false,
		complete: raw.complete !== false, minimumBytes: BODY_MINIMUM,
	};
	if (is_number(raw.startedAt)) result.startedAt = raw.startedAt;
	if (is_number(raw.finishedAt)) result.finishedAt = raw.finishedAt;
	return result;
}

function pick_error(errors, tls_ok, body_ok) {
	if (!length(errors)) return tls_ok == 0 ? 'TLS_FAIL' : 'BODY_FAIL';
	let present = {};
	for (let error in errors) if (type(error) == 'string' && error != '') present[error] = true;
	for (let candidate in ERROR_PRIORITY) if (present[candidate]) return candidate;
	return errors[0];
}
function verdict_metrics(tests) {
	let first = tests?.[0];
	if (!is_object(first)) return null;
	if (first.protocol == 'tcp') return { averageKbps: number(first.averageKbps, 0), averageLatencyMs: number(first.averageLatencyMs, 0), successRate: number(first.successRate, 0), perProbe: first.perHost };
	return { averageKbps: 0, averageLatencyMs: number(first.latencyMs, 0), successRate: first.success === true ? 1 : 0,
		perProbe: { startedAt: first.startedAt, finishedAt: first.finishedAt } };
}

function verdict_score(tests) {
	let first = tests?.[0];
	return is_object(first) && is_number(first.score) ? first.score : null;
}

export const scanner_score = function(result) {
	if (!is_object(result) || result.infrastructureFailure === true) return null;
	if (result.protocol == 'udp') {
		if (result.success !== true) return 0;
		let latency = number(result.stunLatencyMs, number(result.latencyMs, 0));
		return latency > 0 ? round_to(1000.0 / (latency < 50 ? 50 : latency), 2) : 0;
	}
	if (result.protocol != 'tcp') return null;
	let rate = clamp(number(result.successRate, 0), 0, 1);
	if (result.success !== true) return round_to(rate, 3);
	let kbps = clamp(number(result.averageKbps, number(result.kbps, 0)), 0, 2048);
	let latency = number(result.averageLatencyMs, number(result.latencyMs, 0));
	latency = latency < 50 ? 50 : latency;
	return round_to(rate * (kbps / (latency * 1.0)) * 1000, 2);
};

export const scanner_tcp_classify = function(raw) {
	if (!is_object(raw) || type(raw.hosts) != 'array' || !length(raw.hosts) || length(raw.hosts) > 8)
		return infrastructure('INVALID_OBSERVATION', 'tls+body');
	let per_host = [], errors = [], tls_count = 0, body_count = 0;
	let sum_kbps = 0, kbps_count = 0, sum_latency = 0;
	for (let item in raw.hosts) {
		if (!is_object(item) || type(item.host) != 'string' || !length(item.host) ||
			(item.addressFamily != 'ipv4' && item.addressFamily != 'ipv6') || !is_object(item.tls) ||
			type(item.tls.status) != 'string' && item.tls.success !== true)
			return infrastructure('INVALID_OBSERVATION', 'tls+body');
		let tls = normalize_tls(item.tls), body = null;
		if (tls.success) {
			if (!is_object(item.body) ||
				(!((item.body.status == 'failed' || item.body.status == 'timeout') && type(item.body.error) == 'string' && length(item.body.error)) &&
					(!is_number(item.body.statusCode) || item.body.statusCode < 0 ||
						!is_number(item.body.bytesReceived) || item.body.bytesReceived < 0)))
				return infrastructure('INVALID_OBSERVATION', 'tls+body');
			tls_count++;
			body = normalize_body(item.body);
			if (body.success) {
				body_count++; sum_kbps += body.kbps; kbps_count++; sum_latency += body.latencyMs;
			}
			else push(errors, body.error);
		}
		else push(errors, tls.error);
		let hostResult = { host: type(item.host) == 'string' ? item.host : '',
			addressFamily: item.addressFamily == 'ipv6' ? 'ipv6' : 'ipv4', tls, body };
		if (is_number(item.startedAt)) hostResult.startedAt = item.startedAt;
		if (is_number(item.finishedAt)) hostResult.finishedAt = item.finishedAt;
		push(per_host, hostResult);
	}
	if (!tls_count && !body_count && length(errors)) {
		let result = { protocol: 'tcp', success: false, error: pick_error(errors, tls_count, body_count),
			failureClass: 'candidate_blocked', infrastructureFailure: false, testType: 'tls+body', bodyPassed: false,
			successRate: 0, averageKbps: 0, averageLatencyMs: 0, perHost: per_host };
		result.score = scanner_score(result); return result;
	}
	let total = length(raw.hosts), rate = round_to((tls_count * 0.4 + body_count * 0.6) / total, 3);
	let success = body_count > 0;
	let result = {
		protocol: 'tcp', success, error: success ? null : pick_error(errors, tls_count, body_count),
		failureClass: success ? null : 'candidate_blocked', infrastructureFailure: false,
		testType: 'tls+body', bodyPassed: body_count > 0, successRate: rate,
		averageKbps: kbps_count ? round_to(sum_kbps / kbps_count, 1) : 0,
		averageLatencyMs: total ? round_to(sum_latency / total, 2) : 0,
		perHost: per_host,
	};
	result.score = scanner_score(result);
	return result;
};

export const scanner_udp_classify = function(raw) {
	if (!is_object(raw) || raw.transport != 'stun') return infrastructure('PROBE_DEPENDENCY', 'stun');
	if (!valid_nonnegative_number(raw.latencyMs))
		return infrastructure('INVALID_OBSERVATION', 'stun');
	if (raw.status == 'success' && raw.mappedFamily != 'IPv4')
		return infrastructure('INVALID_OBSERVATION', 'stun');
	if (raw.status == 'error' || (raw.status != 'success' && raw.status != 'timeout' &&
		raw.status != 'reset' && raw.status != 'parse_error'))
		return infrastructure(raw.error || 'INDETERMINATE', 'stun');
	let success = raw.status == 'success';
	let latency = number(raw.latencyMs, 0);
	let result = {
		protocol: 'udp', success,
		error: success ? null : (raw.error || (raw.status == 'timeout' ? 'TIMEOUT' :
			(raw.status == 'reset' ? 'RESET' : (raw.status == 'parse_error' ? 'PARSE_ERR' : 'STUN_FAIL')))),
		failureClass: success ? null : 'candidate_blocked', infrastructureFailure: false,
		testType: 'stun', quicProbe: false, attempts: clamp(number(raw.attempts, 1), 1, 2),
		latencyMs: latency, stunLatencyMs: latency,
		mappedFamily: raw.mappedFamily == 'IPv6' ? 'IPv6' : (raw.mappedFamily == 'IPv4' ? 'IPv4' : null),
	};
	if (is_number(raw.startedAt)) result.startedAt = raw.startedAt;
	if (is_number(raw.finishedAt)) result.finishedAt = raw.finishedAt;
	result.score = scanner_score(result);
	return result;
};

function valid_text(value) { return type(value) == 'string' && length(value) > 0; }
function valid_nullable_text(value) { return value == null || valid_text(value); }

function valid_tcp_test(evidence) {
	if (evidence.protocol != 'tcp' || evidence.testType != 'tls+body' ||
		type(evidence.bodyPassed) != 'bool' || !valid_nonnegative_number(evidence.successRate) ||
		evidence.successRate > 1 || !valid_nonnegative_number(evidence.averageKbps) ||
		!valid_nonnegative_number(evidence.averageLatencyMs) || type(evidence.perHost) != 'array' ||
		!length(evidence.perHost) || length(evidence.perHost) > 8) return false;
	for (let host in evidence.perHost) {
		if (!is_object(host) || !valid_text(host.host) ||
			(host.addressFamily != 'ipv4' && host.addressFamily != 'ipv6') || !is_object(host.tls) ||
		type(host.tls.success) != 'bool' || !valid_text(host.tls.status) ||
			!valid_nullable_text(host.tls.error) || !valid_nonnegative_number(host.tls.latencyMs) ||
			!valid_nonnegative_number(host.tls.readBytes) || host.tls.readBytes > TLS_READ_LIMIT ||
			host.tls.readLimitBytes != TLS_READ_LIMIT) return false;
		if (host.tls.success) {
			if (!is_object(host.body) || type(host.body.success) != 'bool' ||
				!valid_text(host.body.status) || !valid_nullable_text(host.body.error) ||
				!valid_nonnegative_number(host.body.statusCode) ||
				!valid_nonnegative_number(host.body.bytesReceived) ||
				!valid_nonnegative_number(host.body.kbps) ||
				!valid_nonnegative_number(host.body.latencyMs) ||
				host.body.range != 'bytes=0-69632' || host.body.minimumBytes != BODY_MINIMUM ||
				host.body.rangeSatisfied !== true || host.body.complete !== true || type(host.body.markerEvidence) != 'array') return false;
		}
		else if (host.body != null) return false;
	}
	return true;
}

function valid_udp_test(evidence) {
	return evidence.protocol == 'udp' && evidence.testType == 'stun' && evidence.quicProbe === false &&
		type(evidence.attempts) == 'int' && evidence.attempts >= 1 && evidence.attempts <= 2 &&
		valid_nonnegative_number(evidence.latencyMs) &&
		valid_nonnegative_number(evidence.stunLatencyMs) && evidence.latencyMs == evidence.stunLatencyMs &&
		(evidence.mappedFamily == null || evidence.mappedFamily == 'IPv4' || evidence.mappedFamily == 'IPv6') &&
		(!evidence.success || evidence.mappedFamily == 'IPv4');
}

function valid_candidate_test(evidence, protocol) {
	if (!is_object(evidence) || type(evidence.success) != 'bool' ||
		type(evidence.infrastructureFailure) != 'bool' ||
		(!evidence.success && (!valid_text(evidence.error) || !valid_text(evidence.failureClass)))) return false;
	if (evidence.infrastructureFailure === true) return true;
	if (evidence.protocol != protocol) return false;
	return protocol == 'tcp' ? valid_tcp_test(evidence) : valid_udp_test(evidence);
}

export const scanner_candidate_verdict = function(baseline, tests) {
	if (!is_object(baseline) || baseline.infrastructureFailure === true ||
		(baseline.protocol != 'tcp' && baseline.protocol != 'udp'))
		return { verdict: 'infrastructure', reason: baseline?.error || 'BASELINE_UNAVAILABLE', success: false,
			evidence: { infrastructure: true, baselineSuppressed: false, failureClass: 'probe_dependency_failure' } };
	if (type(tests) != 'array' || !length(tests))
		return { verdict: 'infrastructure', reason: 'INDETERMINATE', success: false,
			evidence: { infrastructure: true, baselineSuppressed: false, failureClass: 'indeterminate' } };
	for (let evidence in tests) if (!valid_candidate_test(evidence, baseline.protocol))
		return { verdict: 'infrastructure', reason: 'INDETERMINATE', success: false,
			evidence: { infrastructure: true, baselineSuppressed: false, failureClass: 'indeterminate' } };
	for (let evidence in tests) if (evidence.infrastructureFailure === true)
		return { verdict: 'infrastructure', reason: evidence.error || 'INFRASTRUCTURE_FAILURE', success: false,
			evidence: { infrastructure: true, baselineSuppressed: false,
				failureClass: evidence.failureClass || 'probe_dependency_failure' } };
	if (baseline.allAvailableOpen === true)
		return { verdict: 'failed', reason: 'BASELINE_OPEN', success: false,
			evidence: { infrastructure: false, baselineSuppressed: true, failureClass: 'baseline_open' } };
	for (let evidence in tests) if (evidence?.success === true)
		return { verdict: 'working', reason: null, success: true, score: verdict_score(tests),
			evidence: { infrastructure: false, baselineSuppressed: false, failureClass: null, metrics: verdict_metrics(tests) } };
	let errors = [];
	for (let evidence in tests) if (evidence?.error) push(errors, evidence.error);
	return { verdict: 'failed', reason: pick_error(errors, 0, 0), success: false, score: verdict_score(tests),
		evidence: { infrastructure: false, baselineSuppressed: false,
			failureClass: tests[0]?.failureClass || 'candidate_blocked', metrics: verdict_metrics(tests) } };
};
