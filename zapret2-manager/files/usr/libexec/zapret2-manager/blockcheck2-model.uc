'use strict';

/* Server-owned BlockCheck2 mode/env/parser/conversion contract. */

const MODES = { quick: true, standard: true, force: true };
const OPTIONS = {
	IPVS: 'ipvs', REPEATS: 'int', ENABLE_HTTP: 'bool', ENABLE_HTTPS_TLS12: 'bool',
	ENABLE_HTTPS_TLS13: 'bool', ENABLE_HTTP3: 'bool', SKIP_TPWS: 'bool',
	SKIP_PKTWS: 'bool', PARALLEL: 'int', CURL_VERBOSE: 'bool'
};

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function lower(value) { let out = ''; for (let i = 0; i < length(value); i++) { let c = ord(substr(value, i, 1)); out += c >= 65 && c <= 90 ? chr(c + 32) : substr(value, i, 1); } return out; }
function fail(message, path) { let out = { ok: false, error: { code: 'EINPUT', message: message } }; if (path != null) out.error.path = path; return out; }
function host(value) {
	if (!string(value)) return null;
	let d = lower(trim(value)); if (substr(d, -1) == '.') d = substr(d, 0, -1);
	if (length(d) < 1 || length(d) > 253 || !match(d, /^[a-z0-9.-]+$/) || index(d, '..') >= 0) return null;
	let labels = split(d, '.'); if (length(labels) < 2) return null;
	for (let label in labels) if (length(label) < 1 || substr(label, 0, 1) == '-' || substr(label, -1) == '-') return null;
	return d;
}
function domains(value) {
	if (type(value) != 'array' || length(value) < 1 || length(value) > 32) return null;
	let out = [], seen = {};
	for (let raw in value) { let d = host(raw); if (d == null) return null; if (!seen[d]) { seen[d] = true; push(out, d); } }
	return out;
}
function bool(value) { return type(value) == 'bool'; }

export const blockcheck2_env_build = function(input) {
	if (!object(input) || !MODES[input.mode] || exists(input, 'shell_args') || exists(input, 'extra_args')) return fail('BlockCheck2 request contains unsupported fields', 'request');
	let ds = domains(input.domains); if (ds == null) return fail('domains must contain 1..32 strict hostnames', 'domains');
	let options = object(input.options) ? input.options : {};
	for (let key in options) if (!OPTIONS[key]) return fail('option is not allowlisted', 'options.' + key);
	let env = { BATCH: '1', SCANLEVEL: input.mode, DOMAINS: join(' ', ds), IPVS: '4', REPEATS: '1', ENABLE_HTTP: '1', ENABLE_HTTPS_TLS12: '1', ENABLE_HTTPS_TLS13: input.mode == 'force' ? '1' : '0', ENABLE_HTTP3: input.mode == 'force' ? '1' : '0', SKIP_TPWS: '0', SKIP_PKTWS: '0', PARALLEL: '0', CURL_VERBOSE: '0' };
	for (let key in options) {
		let value = options[key], kind = OPTIONS[key];
		if (kind == 'bool') { if (!bool(value)) return fail('option must be boolean', 'options.' + key); env[key] = value ? '1' : '0'; }
		else if (kind == 'ipvs') { if (value != '4' && value != '6' && value != '46') return fail('IPVS must be 4, 6, or 46', 'options.IPVS'); env[key] = '' + value; }
		else { if (type(value) != 'int' || value < 0 || value > (key == 'REPEATS' ? 3 : 4)) return fail('integer option is out of bounds', 'options.' + key); env[key] = '' + value; }
	}
	return { ok: true, mode: input.mode, domains: ds, env: env, serverOwned: true, argv: [] };
};

function classify(test) {
	let t = lower(test);
	if (index(t, 'http3') >= 0 || index(t, 'quic') >= 0) return { protocol: 'udp', port: 443, l7: 'quic' };
	if (index(t, 'https') >= 0 || index(t, 'tls') >= 0) return { protocol: 'tcp', port: 443, l7: 'tls' };
	return { protocol: 'tcp', port: 80, l7: 'http' };
}
function found_line(line) {
	let clean = trim(line), start = substr(clean, 0, 6) == '!!!!! ';
	if (!start || index(clean, '!!!!!', 6) < 0) return null;
	let body = trim(substr(clean, 6, length(clean) - 12)), marker = ': working strategy found for ';
	let at = index(body, marker); if (at <= 0) return null;
	let test = substr(body, 0, at), rest = substr(body, at + length(marker)), sp = index(rest, ' '); if (sp < 0) return null;
	let ipv = substr(rest, 0, sp); if (ipv != 'ipv4' && ipv != 'ipv6') return null;
	let rest2 = substr(rest, sp + 1), sep = index(rest2, ' : '); if (sep <= 0) return null;
	let domain = substr(rest2, 0, sep), payload = trim(substr(rest2, sep + 3)), arg = index(payload, '--'); if (arg < 0) return null;
	let engine = trim(substr(payload, 0, arg)), strategy = trim(substr(payload, arg)); if (!engine || !strategy) return null;
	let info = classify(test);
	return { ipv: ipv == 'ipv6' ? 6 : 4, test: test, domain: domain, engine: engine, strategy: strategy, raw: line, protocol: info.protocol, port: info.port, l7: info.l7 };
}

export const blockcheck2_parse_output = function(output) {
	if (!string(output) || length(output) > 262144) return { outcome: 'parser_error', error: { code: 'parser_input_invalid' }, found: [], evidence: [] };
	let lines = split(output, '\n'), found = [], evidence = [], malformedMarker = false;
	for (let line in lines) {
		let l = trim(line); if (!l) continue;
		if (index(l, 'working strategy found') >= 0) { let parsed = found_line(l); if (parsed == null) malformedMarker = true; else push(found, parsed); }
		if (substr(l, 0, 2) == '* ' || index(l, 'SUMMARY') >= 0 || index(l, 'COMMON') >= 0) push(evidence, substr(l, 0, 256));
	}
	if (malformedMarker) return { outcome: 'parser_error', error: { code: 'malformed_found_marker' }, found: found, evidence: evidence };
	if (length(found) == 0) return { outcome: 'no_results', found: [], evidence: evidence };
	return { outcome: 'found', found: found, evidence: evidence };
};

export const blockcheck2_strategy_from_found = function(value) {
	if (!object(value) || !string(value.strategy) || index(value.strategy, '--') != 0 || !string(value.domain) || !string(value.raw)) return fail('found strategy evidence is incomplete', 'found');
	let info = classify(string(value.test) ? value.test : 'http');
	let suffix = string(value.domain) ? lower(value.domain) : 'target', id = 'blockcheck2-' + suffix;
	return { ok: true, strategy: { authority: 'strategy-handoff-v1', id: id, name: 'BlockCheck2 ' + value.domain, origin: 'blockcheck2', is_builtin: false,
		metadata: { source: 'blockcheck2', authority: 'strategy-handoff-v1', engine: string(value.engine) ? value.engine : 'unknown' },
		source: { kind: 'blockcheck2', engine: string(value.engine) ? value.engine : 'unknown' },
		provenance: { raw: substr(value.raw, 0, 1024), test: value.test, domain: value.domain, ipv: value.ipv },
		profiles: [{ id: 'blockcheck2-' + info.l7, name: 'BlockCheck2 ' + info.l7, protocol: info.protocol, port: info.port, l7: info.l7, enabled: true, args: value.strategy }],
		previewRequired: true, validateRequired: true, permanentApply: false } };
};

export const blockcheck2_stream_slice = function(output, cursor) {
	if (!string(output) || type(cursor) != 'int' || cursor < 0) return fail('stream output/cursor is invalid', 'stream');
	let maxRetained = 262144, base = length(output) > maxRetained ? length(output) - maxRetained : 0;
	if (cursor < base) return { ok: true, reset: true, cursor: base, nextCursor: base, chunk: '' };
	if (cursor > length(output)) cursor = length(output);
	let take = length(output) - cursor > 65536 ? 65536 : length(output) - cursor;
	return { ok: true, reset: false, cursor: cursor, nextCursor: cursor + take, chunk: substr(output, cursor, take) };
};
