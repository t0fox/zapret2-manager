'use strict';

/* Avatar-equivalent BlockCheck product model.  This module is deliberately
 * independent from Scanner and BlockCheck2: it consumes observations and
 * publishes diagnostic findings, never a Strategy mutation. */

const MODES = { quick: true, full: true, dpi_only: true };
const MAX_DOMAINS = 32;
const MAX_DOMAIN_BYTES = 2048;
const MAX_EVIDENCE = 64;
const CLASSIFICATIONS = {
	none: true, dns_fake: true, http_inject: true, isp_page: true,
	tls_dpi: true, clienthello_dpi: true, tcp_reset: true, tcp_16_20: true,
	stun_block: true, quic_block: true, throttled: true, ip_block: true,
	full_block: true
};
const RECOMMENDATIONS = {
	none: 'none', dns_fake: 'dns', http_inject: 'scanner/zapret',
	isp_page: 'scanner/zapret', tls_dpi: 'scanner/zapret',
	clienthello_dpi: 'scanner/zapret', tcp_reset: 'scanner/zapret',
	tcp_16_20: 'scanner/zapret', stun_block: 'scanner/zapret',
	quic_block: 'scanner/zapret', throttled: 'scanner/zapret',
	ip_block: 'routing/tunnel', full_block: 'routing/tunnel'
};

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function lower(value) {
	let out = '';
	for (let i = 0; i < length(value); i++) {
		let c = ord(substr(value, i, 1));
		out += c >= 65 && c <= 90 ? chr(c + 32) : substr(value, i, 1);
	}
	return out;
}
function fail(message, path) {
	let out = { ok: false, error: { code: 'EINPUT', message: message } };
	if (path != null) out.error.path = path;
	return out;
}
function clone(value) {
	if (type(value) == 'array') { let out = []; for (let item in value) push(out, clone(item)); return out; }
	if (object(value)) { let out = {}; for (let key in value) out[key] = clone(value[key]); return out; }
	return value;
}
function hostname(raw) {
	if (!string(raw)) return null;
	let value = lower(trim(raw));
	if (substr(value, 0, 8) == 'https://') value = substr(value, 8);
	else if (substr(value, 0, 7) == 'http://') value = substr(value, 7);
	value = split(split(split(value, '/')[0], '?')[0], '#')[0];
	if (substr(value, -1) == '.') value = substr(value, 0, -1);
	if (length(value) < 1 || length(value) > 253 || index(value, ':') >= 0) return null;
	let labels = split(value, '.');
	if (length(labels) < 2) return null;
	for (let label in labels) {
		if (length(label) < 1 || length(label) > 63 || substr(label, 0, 1) == '-' || substr(label, -1) == '-') return null;
		for (let i = 0; i < length(label); i++) {
			let c = ord(substr(label, i, 1));
			if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 45)) return null;
		}
	}
	return value;
}
function domains(value, path) {
	if (value == null) return { ok: true, value: [] };
	if (type(value) != 'array') return fail('domains must be an array of hostnames', path);
	if (length(value) > MAX_DOMAINS) return fail('too many domains (max 32)', path);
	let out = [], seen = {}, bytes = 0;
	for (let raw in value) {
		let d = hostname(raw);
		if (d == null) return fail('invalid domain', path);
		bytes += length(d) + 1;
		if (bytes > MAX_DOMAIN_BYTES) return fail('domains exceed bounded request size', path);
		if (!seen[d]) { seen[d] = true; push(out, d); }
	}
	return { ok: true, value: out };
}

export const blockcheck_request_validate = function(input) {
	if (!object(input)) return fail('BlockCheck request must be an object', 'request');
	for (let key in input)
		if (key != 'mode' && key != 'domains' && key != 'extra_domains') return fail('unknown request field', key);
	let mode = input.mode == null ? 'quick' : lower(trim('' + input.mode));
	if (!MODES[mode]) return fail('mode must be quick, full, or dpi_only', 'mode');
	let configured = domains(input.domains, 'domains');
	if (!configured.ok) return configured;
	let extra = domains(input.extra_domains, 'extra_domains');
	if (!extra.ok) return extra;
	if (length(configured.value) == 0 && length(extra.value) == 0) return fail('at least one domain is required', 'domains');
	return { ok: true, value: { mode: mode, domains: configured.value, extra_domains: extra.value } };
};

function status(value, expected) { return object(value) && value.status == expected; }
function evidence(protocol, detail, raw) {
	let out = { protocol: protocol, detail: detail };
	if (object(raw)) out.observation = clone(raw);
	return out;
}
function finding(classification, confidence, list, protocol, domain) {
	let ev = [];
	for (let i = 0; i < length(list) && i < MAX_EVIDENCE; i++) push(ev, list[i]);
	return {
		classification: classification, confidence: confidence,
		protocol: protocol, domains: domain == null ? [] : [domain],
		evidence: ev, recommendation: RECOMMENDATIONS[classification] || 'none'
	};
}

export const blockcheck_classify_observation = function(observation) {
	if (!object(observation)) return { outcome: 'infrastructure', finding: null, infrastructure: { code: 'malformed_observation', message: 'observation is not an object' } };
	let domain = string(observation.domain) ? observation.domain : null;
	let all = [], dns = observation.dns, tcp = observation.tcp, tls = observation.tls;
	if (status(dns, 'unavailable') || status(tcp, 'unavailable') || status(tls, 'unavailable'))
		return { outcome: 'infrastructure', finding: null, infrastructure: { code: 'dependency_unavailable', message: 'required probe dependency is unavailable', evidence: [dns, tcp, tls] } };
	if (status(dns, 'failed'))
		return { outcome: 'infrastructure', finding: null, infrastructure: { code: 'dns_failed', message: 'resolver failed before diagnostic evidence was available', evidence: [dns, tcp, tls] } };
	if (object(dns) && dns.fake == true) return { outcome: 'finding', finding: finding('dns_fake', 'high', [evidence('dns', 'resolver returned a known-fake answer', dns)], 'dns', domain), infrastructure: [] };
	if (object(observation.http) && observation.http.injected == true) return { outcome: 'finding', finding: finding('http_inject', 'high', [evidence('http', 'unexpected injected response', observation.http)], 'http', domain), infrastructure: [] };
	if (object(observation.http) && observation.http.isp_page == true) return { outcome: 'finding', finding: finding('isp_page', 'high', [evidence('http', 'provider blocking page signature', observation.http)], 'http', domain), infrastructure: [] };
	if (object(observation.clienthello) && observation.clienthello.blocked == true) return { outcome: 'finding', finding: finding('clienthello_dpi', 'high', [evidence('tls', 'large ClientHello was rejected', observation.clienthello)], 'tls', domain), infrastructure: [] };
	if (object(tls) && tls.mitm == true) return { outcome: 'finding', finding: finding('tls_dpi', 'high', [evidence('tls', 'TLS interception or DPI signature', tls)], 'tls', domain), infrastructure: [] };
	if (object(tls) && (tls.status == 'reset' || tls.reset == true)) return { outcome: 'finding', finding: finding('tcp_reset', 'high', [evidence('tcp', 'TCP reset during TLS probe', tls)], 'tcp', domain), infrastructure: [] };
	if (object(observation.tcp_16_20) && observation.tcp_16_20.blocked == true) return { outcome: 'finding', finding: finding('tcp_16_20', 'high', [evidence('tcp', '16-20KB transfer was interrupted', observation.tcp_16_20)], 'tcp', domain), infrastructure: [] };
	if (object(observation.quic) && observation.quic.blocked == true) return { outcome: 'finding', finding: finding('quic_block', 'medium', [evidence('quic', 'QUIC/HTTP3 probe failed while TCP remained available', observation.quic)], 'quic', domain), infrastructure: [] };
	if (object(observation.stun) && observation.stun.blocked == true) return { outcome: 'finding', finding: finding('stun_block', 'medium', [evidence('stun', 'STUN probe failed', observation.stun)], 'stun', domain), infrastructure: [] };
	if (object(observation.throttling) && observation.throttling.detected == true) return { outcome: 'finding', finding: finding('throttled', 'medium', [evidence('https', 'bounded body transfer is materially degraded', observation.throttling)], 'https', domain), infrastructure: [] };
	if (status(tcp, 'failed') || status(tcp, 'timeout')) return { outcome: 'finding', finding: finding('ip_block', 'medium', [evidence('tcp', 'TCP connection did not become reachable', tcp)], 'tcp', domain), infrastructure: [] };
	return { outcome: 'finding', finding: finding('none', 'medium', [evidence('https', 'no positive blocking signature observed', observation)], 'https', domain), infrastructure: [] };
};

export const blockcheck_state_create = function(request) {
	return { schema: 1, id: request.id, request: clone(request), status: 'idle', phase: 'idle', progress: 0, total: 0, findings: [], infrastructure: [], recovery: { state: 'not_required' }, cancellationRequested: false, error: null };
};
export const blockcheck_state_transition = function(record, event) {
	if (!object(record) || !object(event)) return { ok: false, error: { code: 'ESTATE', message: 'invalid state event' } };
	if (record.status == 'idle' && event.type == 'start') { let out = clone(record); out.status = 'running'; out.phase = 'probes'; return { ok: true, state: out }; }
	if (record.status != 'running') return { ok: false, error: { code: 'ESTATE', message: 'state is terminal' } };
	let out = clone(record);
	if (event.type == 'progress') { out.progress = type(event.progress) == 'int' && event.progress >= 0 ? event.progress : out.progress; out.total = type(event.total) == 'int' && event.total >= 0 ? event.total : out.total; out.phase = string(event.phase) ? substr(event.phase, 0, 64) : out.phase; return { ok: true, state: out }; }
	if (event.type == 'cancel' || event.type == 'stop') {
		if (!object(event.recovery) || event.recovery.state != 'verified') { out.status = 'error'; out.phase = 'recovery'; out.recovery = { state: 'uncertain' }; out.error = 'owned probe cancellation was not verified'; return { ok: true, state: out }; }
		out.status = 'cancelled'; out.phase = 'cancelled'; out.recovery = { state: 'verified' }; return { ok: true, state: out };
	}
	if (event.type == 'complete') { out.status = 'completed'; out.phase = 'completed'; out.recovery = { state: 'verified' }; return { ok: true, state: out }; }
	if (event.type == 'error') { out.status = 'error'; out.phase = 'error'; out.recovery = { state: 'uncertain' }; out.error = string(event.message) ? substr(event.message, 0, 256) : 'diagnostic error'; return { ok: true, state: out }; }
	return { ok: false, error: { code: 'ESTATE', message: 'illegal state event' } };
};

export const blockcheck_result_validate = function(value) {
	if (!object(value) || value.schema !== 1 || !string(value.id) || !string(value.status) ||
		!object(value.request) || type(value.findings) != 'array' || type(value.infrastructure) != 'array' ||
		(value.cancellation != null && !object(value.cancellation)))
		return fail('BlockCheck result schema is invalid', 'result');
	if (value.status != 'completed' && value.status != 'cancelled' && value.status != 'error' && value.status != 'running')
		return fail('BlockCheck result status is invalid', 'result.status');
	return { ok: true, value: clone(value) };
};

export const blockcheck_classifications = function() { return ['none', 'dns_fake', 'http_inject', 'isp_page', 'tls_dpi', 'clienthello_dpi', 'tcp_reset', 'tcp_16_20', 'stun_block', 'quic_block', 'throttled', 'ip_block', 'full_block']; };
