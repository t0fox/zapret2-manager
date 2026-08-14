'use strict';

// Scanner result boundary. The worker persists bounded observations; this
// module is the only place that canonicalizes, scores, ranks, and hands them
// to Strategy. It deliberately has no filesystem, process, or runtime writer.

const MAX_TEXT = 256;
const MAX_RESULTS = 128;
const MAX_EVIDENCE_ITEMS = 32;

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function array(value) { return type(value) == 'array'; }
function number(value) { return type(value) == 'int' || type(value) == 'double'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function digest(value) { return string(value) && match(value, /^[a-f0-9]{64}$/); }
function safe_id(value) {
	return string(value) && length(value) > 0 && length(value) <= 128
		&& match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
}
function bounded_text(value, limit) {
	if (!string(value)) return null;
	return length(value) > limit ? substr(value, 0, limit) : value;
}
function error(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	for (let key in extra || {}) result[key] = extra[key];
	return result;
}
function copy(value, depth) {
	depth = integer(depth) ? depth : 0;
	if (depth > 8) return null;
	if (array(value)) {
		let result = [];
		for (let i = 0; i < length(value) && i < MAX_EVIDENCE_ITEMS; i++) push(result, copy(value[i], depth + 1));
		return result;
	}
	if (object(value)) {
		let result = {}, count = 0;
		for (let key in value) {
			if (count++ >= 64) break;
			result[key] = copy(value[key], depth + 1);
		}
		return result;
	}
	if (string(value)) return bounded_text(value, MAX_TEXT);
	return value;
}
function finite_nonnegative(value) { return number(value) && value == value && value >= 0 && value - value == 0; }
function clamp(value, low, high) { return value < low ? low : (value > high ? high : value); }
function round2(value) { return int(value * 100 + 0.5) / 100.0; }
function round3(value) { return int(value * 1000 + 0.5) / 1000.0; }
function score_tcp(metrics) {
	if (!object(metrics) || !finite_nonnegative(metrics.successRate)
		|| !finite_nonnegative(metrics.averageKbps) || !finite_nonnegative(metrics.averageLatencyMs)
		|| metrics.successRate > 1) return null;
	let rate = clamp(metrics.successRate, 0, 1);
	let kbps = clamp(metrics.averageKbps, 0, 2048);
	let latency = metrics.averageLatencyMs < 50 ? 50 : metrics.averageLatencyMs;
	return round2(rate * (kbps / (latency * 1.0)) * 1000);
}
function score_udp(metrics) {
	if (!object(metrics)) return null;
	let latency = number(metrics.stunLatencyMs) ? metrics.stunLatencyMs : metrics.latencyMs;
	if (!finite_nonnegative(latency) || latency <= 0) return null;
	return round2(1000.0 / (latency < 50 ? 50 : latency));
}
function candidate_values(authority) {
	if (array(authority)) return authority;
	return object(authority) && array(authority.candidates) ? authority.candidates : [];
}
function candidate_index(authority) {
	let result = {}, candidates = candidate_values(authority);
	for (let candidate in candidates) {
		if (!object(candidate) || !safe_id(candidate.scannerId)) return error('ESCHEMA', 'Scanner candidate authority is malformed.');
		if (result[candidate.scannerId] != null) return error('EDUPLICATE', 'Scanner candidate identity is duplicated.');
		result[candidate.scannerId] = candidate;
	}
	return { ok: true, values: result };
}
function metric_protocol(evidence, candidate) {
	if (object(candidate) && (candidate.protocol == 'tcp' || candidate.protocol == 'udp')) return candidate.protocol;
	return object(evidence) && object(evidence.metrics)
		&& (evidence.metrics.protocol == 'tcp' || evidence.metrics.protocol == 'udp') ? evidence.metrics.protocol : null;
}
function row_normalize(raw, candidates, require_authority) {
	if (!object(raw) || !safe_id(raw.candidateId) || !integer(raw.ordinal)
		|| (raw.verdict != 'working' && raw.verdict != 'failed' && raw.verdict != 'infrastructure')
		|| type(raw.success) != 'bool' || !object(raw.evidence))
		return error('ESCHEMA', 'Scanner result shape is invalid.');
	if ((raw.verdict == 'working') != (raw.success == true)) return error('ESCHEMA', 'Scanner result success disagrees with verdict.');
	if (raw.verdict == 'infrastructure' && raw.evidence.infrastructure !== true)
		return error('ESCHEMA', 'Infrastructure result is missing infrastructure evidence.');
	let candidate = candidates[raw.candidateId];
	if (require_authority && candidate == null) return error('EAUTHORITY', 'Scanner result is not in the persisted candidate plan.');
	if (candidate != null && integer(candidate.ordinal) && candidate.ordinal != raw.ordinal)
		return error('EAUTHORITY', 'Scanner result ordinal does not match the persisted candidate.');
	let protocol = metric_protocol(raw.evidence, candidate), metrics = raw.evidence.metrics;
	if (protocol == null || !object(metrics)) return error('ESCHEMA', 'Scanner result metrics are incomplete.');
	let score = raw.verdict == 'infrastructure' ? null : (protocol == 'tcp' ? score_tcp(metrics) : score_udp(metrics));
	if (raw.verdict == 'working' && score == null) return error('ESCHEMA', 'Working result score evidence is incomplete.');
	let result = {
		candidateId: raw.candidateId, ordinal: raw.ordinal, verdict: raw.verdict,
		success: raw.success == true, score: score, reason: bounded_text(raw.reason, MAX_TEXT),
		evidence: copy(raw.evidence, 0), planDigest: digest(raw.planDigest) ? raw.planDigest : null,
		evidenceIdentity: digest(raw.evidenceIdentity) ? raw.evidenceIdentity : null,
		protocol: protocol,
	};
	if (candidate != null) result.candidate = copy(candidate, 0);
	return { ok: true, value: result };
}
function insertion_sort(values) {
	let result = [];
	for (let item in values) {
		let at = length(result);
		for (let i = 0; i < length(result); i++) {
			let current = result[i];
			if (item.score > current.score || (item.score == current.score &&
				(item.ordinal < current.ordinal || (item.ordinal == current.ordinal && item.candidateId < current.candidateId)))) {
				at = i; break;
			}
		}
		if (at == length(result)) push(result, item);
		else {
			push(result, null);
			for (let j = length(result) - 1; j > at; j--) result[j] = result[j - 1];
			result[at] = item;
		}
	}
	return result;
}
function ordinal_sort(values) {
	let result = [];
	for (let item in values) {
		let at = length(result);
		for (let i = 0; i < length(result); i++) {
			if (item.ordinal < result[i].ordinal || (item.ordinal == result[i].ordinal && item.candidateId < result[i].candidateId)) { at = i; break; }
		}
		if (at == length(result)) push(result, item);
		else { push(result, null); for (let j = length(result) - 1; j > at; j--) result[j] = result[j - 1]; result[at] = item; }
	}
	return result;
}

export const scanner_rank_results = function(results, authority) {
	if (!array(results) || length(results) > MAX_RESULTS) return error('EINPUT', 'Scanner results must be a bounded array.');
	let indexed = candidate_index(authority);
	if (!indexed.ok) return indexed;
	let require_authority = authority != null;
	let seen = {}, working = [], failed = [], infrastructure = [], canonical = [];
	for (let raw in results) {
		let normalized = row_normalize(raw, indexed.values, require_authority);
		if (!normalized.ok) return normalized;
		let value = normalized.value;
		if (seen[value.candidateId]) return error('EDUPLICATE', 'Scanner result identity is duplicated.');
		seen[value.candidateId] = true; push(canonical, value);
		if (value.verdict == 'working') push(working, value);
		else if (value.verdict == 'failed') push(failed, value);
		else push(infrastructure, value);
	}
	return { ok: true, ranked: insertion_sort(working), failed: ordinal_sort(failed), infrastructure: ordinal_sort(infrastructure), results: canonical };
};

function find_candidate(authority, id) {
	let indexed = candidate_index(authority);
	return indexed.ok ? indexed.values[id] : null;
}
export const scanner_best_reference = function(ranked, authority) {
	if (!object(ranked) || !array(ranked.ranked) || !length(ranked.ranked)) return null;
	let best = ranked.ranked[0], candidate = object(best.candidate) ? best.candidate : find_candidate(authority, best.candidateId);
	if (!object(candidate) || !safe_id(candidate.scannerId)) return null;
	if (candidate.strategyId == null || candidate.saveRequired == true || candidate.identityKind == 'generated')
		return { kind: 'generated', candidateId: candidate.scannerId, identityKind: 'generated', saveRequired: true };
	if (!safe_id(candidate.strategyId) || !integer(candidate.strategyRevision)) return null;
	return { kind: candidate.identityKind == 'user' ? 'user' : 'catalog', candidateId: candidate.scannerId,
		strategyId: candidate.strategyId, revision: candidate.strategyRevision,
		strategyRevision: candidate.strategyRevision, identityKind: candidate.identityKind, saveRequired: false };
};

export const scanner_report_build = function(state) {
	if (!object(state) || !array(state.results)) return error('EINPUT', 'Scanner state is unavailable.');
	let authority = object(state.planAuthority) ? state.planAuthority : null;
	let ranked = scanner_rank_results(state.results, authority);
	if (!ranked.ok) return ranked;
	let tested = length(ranked.ranked) + length(ranked.failed), total = tested + length(ranked.infrastructure);
	let best = scanner_best_reference(ranked, authority), elapsed = null;
	if (integer(state.startedAt) && integer(state.finishedAt) && state.finishedAt >= state.startedAt) elapsed = state.finishedAt - state.startedAt;
	let targetProfile = object(authority) && object(authority.targetProfile) ? copy(authority.targetProfile, 0) : null;
	let report = {
		schema: 1, scanId: safe_id(state.id) ? state.id : null, status: bounded_text(state.status, MAX_TEXT),
		working: ranked.ranked, failed: ranked.failed, infrastructure: ranked.infrastructure,
		tested: tested, total: total, successRate: tested ? length(ranked.ranked) / (tested * 1.0) : 0,
		request: copy(state.request, 0), targetProfile: targetProfile,
		baseline: copy(state.baseline, 0), baselineByAddressFamily: object(state.baseline) ? copy(state.baseline.byAddressFamily, 0) : null,
		elapsedMs: elapsed, best: ranked.ranked[0] || null, bestReference: best, bestStrategy: best,
	};
	return { ok: true, report: report };
};

function token_text(tokens) {
	if (!array(tokens) || !length(tokens) || length(tokens) > 128) return null;
	let result = '';
	for (let token in tokens) {
		if (!string(token) || length(token) == 0 || length(token) > MAX_TEXT || index(token, '\n') >= 0 || index(token, '\r') >= 0) return null;
		if (result != '') result += ' ';
		result += token;
	}
	return result;
}
function generated_strategy(candidate) {
	let args = token_text(candidate.compiledTokens);
	if (args == null || !digest(candidate.compiledDigest) || !digest(candidate.dependencyDigest)
		|| !digest(candidate.catalogDigest) || !digest(candidate.compilerDigest)
		|| !object(candidate.dependencyClosure)) return null;
	let id = 'scanner-' + substr(candidate.compiledDigest, 0, 24);
	return {
		id: id, name: 'Scanner ' + bounded_text(candidate.scannerId, 96), origin: 'user', is_builtin: false,
		metadata: { source: 'scanner-generated', scannerCandidateId: candidate.scannerId,
			catalogDigest: candidate.catalogDigest, compilerDigest: candidate.compilerDigest,
			compiledDigest: candidate.compiledDigest, dependencyDigest: candidate.dependencyDigest,
			provenance: { source: candidate.source, sourcePath: candidate.sourcePath, protocol: candidate.protocol } },
		profiles: [{ id: 'scanner-profile-1', name: 'Scanner generated profile', enabled: true, args: args }],
	};
}
export const scanner_save_generated_validate = function(input, state) {
	if (!object(input) || !safe_id(input.scanId) || !safe_id(input.candidateId) || !object(state)
		|| !safe_id(state.id) || input.scanId != state.id || !object(state.planAuthority))
		return error('EINPUT', 'Scanner Save requires a stable scan and candidate identity.');
	let candidates = candidate_values(state.planAuthority), indexed = candidate_index(candidates);
	if (!indexed.ok) return indexed;
	let candidate = indexed.values[input.candidateId];
	if (!object(candidate)) return error('ENOENT', 'Scanner candidate was not found in persisted state.');
	if (candidate.identityKind != 'generated' || candidate.strategyId != null || candidate.saveRequired !== true)
		return error('EBOUNDARY', 'Only unmatched generated candidates may be saved.');
	if (state.catalogDigest != candidate.catalogDigest || state.compilerDigest != candidate.compilerDigest)
		return error('ESTALE', 'Scanner authority no longer matches the generated candidate.');
	let strategy = generated_strategy(candidate);
	if (strategy == null) return error('EVERIFY', 'Persisted generated candidate authority is incomplete.');
	return { ok: true, scanId: state.id, candidateId: candidate.scannerId, saveRequired: true,
		payload: { strategy: strategy, saveRequired: true, provenance: copy(candidate, 0),
			catalogDigest: candidate.catalogDigest, compilerDigest: candidate.compilerDigest,
			dependencyClosure: copy(candidate.dependencyClosure, 0) } };
};
