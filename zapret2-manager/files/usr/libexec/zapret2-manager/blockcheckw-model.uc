'use strict';

/* Contract for the upstream rcd27/blockcheckw binary.  The manager adapts
 * reports; it does not reproduce its network probes or strategy generator. */

const ENGINES = { status: true, scan: true, universal: true, check: true };
const BLOCK_TYPES = { not_blocked: true, throttled: true, sni_blocked: true,
	ip_blocked: true, syn_blocked: true, host_dead: true, dns_failed: true };
const MAX_DOMAINS = 64;
const MAX_OUTPUT = 4 * 1024 * 1024;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function fail(code, message, path) { let out = { ok: false, error: { code: code, message: message } }; if (path != null) out.error.path = path; return out; }
function lower(value) { let out = ''; for (let i = 0; i < length(value); i++) { let c = ord(substr(value, i, 1)); out += c >= 65 && c <= 90 ? chr(c + 32) : substr(value, i, 1); } return out; }
function host(value) {
	if (!string(value)) return null;
	let d = trim(value); if (substr(d, -1) == '.') d = substr(d, 0, -1);
	if (length(d) < 1 || length(d) > 253 || !match(d, /^[A-Za-z0-9.-]+$/) || index(d, '..') >= 0) return null;
	let labels = split(d, '.'); if (length(labels) < 2) return null;
	for (let label in labels) if (length(label) < 1 || substr(label, 0, 1) == '-' || substr(label, -1) == '-') return null;
	return lower(d);
}
function domain_list(value, required) {
	if (value == null && !required) return { ok: true, value: [] };
	if (type(value) != 'array' || length(value) < (required ? 1 : 0) || length(value) > MAX_DOMAINS) return fail('EINPUT', 'domains must contain bounded hostnames', 'domains');
	let out = [], seen = {};
	for (let raw in value) { let d = host(raw); if (d == null) return fail('EINPUT', 'domain is invalid', 'domains'); if (!seen[d]) { seen[d] = true; push(out, d); } }
	return { ok: true, value: out };
}
function bool_or_default(value, fallback) { return value == null ? fallback : value == true; }

export const blockcheckw_request_validate = function(input) {
	if (!object(input) || !ENGINES[input.engine]) return fail('EINPUT', 'engine must be status, scan, universal, or check', 'engine');
	let ds = domain_list(input.domains, input.engine != 'status' && input.engine != 'universal'); if (!ds.ok) return ds;
	let list = domain_list(input.domain_list != null ? input.domain_list : input.domains, input.engine == 'status' || input.engine == 'universal'); if (!list.ok) return list;
	let workers = input.workers == null ? 8 : input.workers;
	if (type(workers) != 'int' || workers < 1 || workers > 2048) return fail('EINPUT', 'workers must be between 1 and 2048', 'workers');
	let protocols = input.protocols == null ? (input.engine == 'universal' ? 'tls12' : 'http,tls12,tls13') : input.protocols;
	if (!string(protocols) || !match(protocols, /^(http|tls12|tls13)(,(http|tls12|tls13))*$/)) return fail('EINPUT', 'protocols are not supported', 'protocols');
	let timeout = input.timeout == null ? 0 : input.timeout;
	if (type(timeout) != 'int' || timeout < 0 || timeout > 7200) return fail('EINPUT', 'timeout is out of bounds', 'timeout');
	let passes = input.passes == null ? 3 : input.passes;
	if (type(passes) != 'int' || passes < 1 || passes > 100) return fail('EINPUT', 'passes is out of bounds', 'passes');
	for (let key in input) if (key != 'engine' && key != 'domains' && key != 'domain_list' && key != 'workers' && key != 'protocols' && key != 'timeout' && key != 'passes' && key != 'sample' && key != 'source_job') return fail('EINPUT', 'unknown BlockCheckW field', key);
	if (input.source_job != null && (type(input.source_job) != 'string' || !match(input.source_job, /^bcw-[0-9]+-[0-9]+$/))) return fail('EINPUT', 'source_job must identify a BlockCheckW report job', 'source_job');
	let sample = input.sample == null ? 10 : input.sample;
	if (type(sample) != 'int' || sample < 1 || sample > 64) return fail('EINPUT', 'sample is out of bounds', 'sample');
	return { ok: true, value: { engine: input.engine, domains: ds.value, domain_list: list.value, workers: workers, protocols: protocols, timeout: timeout, passes: passes, sample: sample, source_job: input.source_job || null, auto: true, no_conflict_cleanup: true }, serverOwned: true, argv: [] };
};

function clone(value) { if (type(value) == 'array') { let out = []; for (let item in value) push(out, clone(item)); return out; } if (object(value)) { let out = {}; for (let key in value) out[key] = clone(value[key]); return out; } return value; }
function classification(block) {
	if (block == 'not_blocked') return 'none';
	if (block == 'dns_failed') return 'dns_failed';
	if (block == 'throttled') return 'throttled';
	if (block == 'sni_blocked') return 'sni_blocked';
	if (block == 'syn_blocked') return 'syn_blocked';
	if (block == 'host_dead') return 'host_dead';
	if (block == 'ip_blocked') return 'ip_blocked';
	return null;
}
function recommendation(kind) { return kind == 'none' || kind == 'dns_failed' ? 'none' : (kind == 'ip_blocked' || kind == 'syn_blocked' || kind == 'host_dead' ? 'routing/tunnel' : 'scanner/zapret'); }
function report_findings(engine, report) {
	let rows = [], domains = type(report.domains) == 'array' ? report.domains : [];
	for (let row in domains) {
		if (!object(row) || !string(row.domain) || !string(row.block_type) || !BLOCK_TYPES[row.block_type]) return fail('EPARSER', 'BlockCheckW domain result is unsupported', 'domains');
		let kind = classification(row.block_type), evidence = clone(row), finding = { classification: kind, confidence: 'upstream', protocol: 'https', domains: [row.domain], evidence: [evidence], recommendation: recommendation(kind), source: 'blockcheckw', engine: engine };
		if (row.dns_spoofed == true || report.dns_spoofed == true) finding.evidence.push({ dns_spoofed: true });
		push(rows, finding);
	}
	if (engine == 'scan' && string(report.block_type) && !BLOCK_TYPES[report.block_type]) return fail('EPARSER', 'BlockCheckW scan block_type is unsupported', 'block_type');
	if (engine == 'scan' && string(report.domain) && string(report.block_type)) { let kind = classification(report.block_type); push(rows, { classification: kind, confidence: 'upstream', protocol: 'mixed', domains: [report.domain], evidence: [clone(report)], recommendation: recommendation(kind), source: 'blockcheckw', engine: engine }); }
	return { ok: true, findings: rows };
}

export const blockcheckw_parse_report = function(output, engine) {
	if (!ENGINES[engine] || !string(output) || length(output) > MAX_OUTPUT) return fail('EPARSER', 'BlockCheckW output is malformed or oversized', 'output');
	let report = null; try { report = json(output); } catch (e) { return fail('EPARSER', 'BlockCheckW output is not JSON', 'output'); }
	if (!object(report)) return fail('EPARSER', 'BlockCheckW report is not an object', 'report');
	let findings = report_findings(engine, report); if (!findings.ok) return findings;
	let strategies = [], source = type(report.strategies) == 'array' ? report.strategies : [];
	for (let entry in source) if (object(entry) && string(entry.args) && string(entry.protocol)) push(strategies, { protocol: entry.protocol, args: entry.args, coverage: type(entry.coverage) == 'int' ? entry.coverage : 1, provenance: { source: 'blockcheckw', engine: engine, report: clone(entry) } });
	return { ok: true, outcome: 'report', engine: engine, report: clone(report), findings: findings.findings, strategies: strategies, evidence: { source: 'blockcheckw', engine: engine, report: clone(report) } };
};

export const blockcheckw_strategy_from_entry = function(entry, domain) {
	if (!object(entry) || !string(entry.args) || !string(entry.protocol) || index(entry.args, '--') != 0) return fail('EINPUT', 'BlockCheckW strategy entry is incomplete', 'strategy');
	let safeDomain = host(domain || 'target.example');
	if (safeDomain == null) safeDomain = 'target.example';
	let id = 'blockcheckw-' + safeDomain;
	return { ok: true, strategy: { id: id, name: 'BlockCheckW ' + safeDomain, origin: 'blockcheckw', is_builtin: false, metadata: { source: 'blockcheckw', authority: 'strategy-handoff-v1', coverage: entry.coverage || 1 }, profiles: [{ id: 'blockcheckw-' + entry.protocol, name: 'BlockCheckW ' + entry.protocol, enabled: true, protocol: entry.protocol, args: entry.args }], previewRequired: true, validateRequired: true, permanentApply: false } };
};

export const blockcheckw_classifications = function() { return ['none', 'dns_failed', 'throttled', 'sni_blocked', 'ip_blocked', 'syn_blocked', 'host_dead']; };
