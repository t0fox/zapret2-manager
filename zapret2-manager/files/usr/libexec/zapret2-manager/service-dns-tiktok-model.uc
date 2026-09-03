'use strict';

// Pure TikTok candidate/lifecycle helpers.  The existing service-dns RPC and
// apply worker remain the only runtime/state and dnsmasq authorities.

const TIKTOK_TARGET_HOST = 'v77.tiktokcdn.com';

function has(values, value) {
	return index(values || [], value) >= 0;
}

function append_unique(values, value) {
	if (value != null && !has(values, value)) push(values, value);
}

function valid_ipv4(value) {
	if (type(value) != 'string' || !match(value, /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)) return false;
	let parts = split(value, '.');
	if (length(parts) != 4) return false;
	for (let i = 0; i < 4; i++) {
		if (parts[i] == '' || int(parts[i]) > 255) return false;
	}
	return true;
}

function valid_domain(value) {
	return type(value) == 'string' && length(value) > 0 && length(value) <= 253 &&
		match(value, /^[a-z0-9][a-z0-9.-]*\.[a-z][a-z0-9-]*$/);
}

function valid_mode(value) {
	return value == 'cla' || value == 'ies' || value == 'generic' || value == 'legacy';
}

export const tiktok_domain_catalog = function() {
	return [
		{ domain: 'v16-cla.tiktokcdn.com', mode: 'cla', enabled: true, provenance: 'canonical-domain-source' },
		{ domain: 'v16-ies-music.tiktokcdn.com', mode: 'ies', enabled: true, provenance: 'canonical-domain-source' },
		{ domain: 'sf16-music.tiktokcdn-eu.com', mode: 'generic', enabled: true, provenance: 'canonical-domain-source' }
	];
};

export const tiktok_parse_nslookup = function(raw, resolver) {
	let addresses = [], collecting = false, lines = split(raw || '', '\n');
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i] || '');
		if (line == 'Non-authoritative answer:' || match(line, /^Name:\s*/)) collecting = true;
		if (!collecting) continue;
		let answer = match(line, /^Address:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)(:[0-9]+)?\s*$/);
		if (!answer || !valid_ipv4(answer[1]) || answer[1] == resolver) continue;
		append_unique(addresses, answer[1]);
	}
	return { status: length(addresses) ? 'resolved' : 'empty', addresses: addresses };
};

export const tiktok_resolved_candidates = function(resolutions) {
	let byIp = {}, result = [];
	for (let i = 0; i < length(resolutions || []); i++) {
		let resolution = resolutions[i] || {}, domain = lc(trim(resolution.domain || ''));
		if (!valid_domain(domain) || resolution.status != 'resolved' || type(resolution.addresses) != 'array') continue;
		for (let j = 0; j < length(resolution.addresses); j++) {
			let ip = trim(resolution.addresses[j] || '');
			if (!valid_ipv4(ip)) continue;
			let candidate = byIp[ip];
			if (!candidate) {
				candidate = { ip: ip, sourceDomains: [], modes: [], resolvers: [], provenance: 'domain-resolution' };
				byIp[ip] = candidate;
				push(result, candidate);
			}
			append_unique(candidate.sourceDomains, domain);
			if (valid_mode(resolution.mode)) append_unique(candidate.modes, resolution.mode);
			if (!candidate.sourceDomain) candidate.sourceDomain = domain;
			if (!candidate.mode && valid_mode(resolution.mode)) candidate.mode = resolution.mode;
			if (valid_ipv4(resolution.resolver)) append_unique(candidate.resolvers, resolution.resolver);
		}
	}
	return result;
};

function copy_array(values) {
	let result = [];
	for (let i = 0; i < length(values || []); i++) push(result, values[i]);
	return result;
}

function legacy_candidate(ip) {
	return { ip: ip, sourceDomains: [], modes: ['legacy'], resolvers: [], provenance: 'legacy-state' };
}

export const tiktok_state_migrate = function(auto) {
	let result = {};
	for (let key in (auto || {})) result[key] = auto[key];
	if (type(result) != 'object') result = {};
	if (!result.selectedCandidate && valid_ipv4(result.selectedIp))
		result.selectedCandidate = { ip: result.selectedIp, sourceDomain: null, mode: 'legacy', provenance: 'legacy-state' };
	if (type(result.selectedCandidate) == 'object' && valid_ipv4(result.selectedCandidate.ip)) {
		if (!result.selectedIp) result.selectedIp = result.selectedCandidate.ip;
		if (!result.selectedCandidate.mode) result.selectedCandidate.mode = 'legacy';
	}
	if (result.lastFailover == null) result.lastFailover = null;
	if (type(result.candidates) != 'array') result.candidates = valid_ipv4(result.selectedIp) ? [result.selectedIp] : [];
	if (type(result.resolvedCandidates) != 'array') {
		result.resolvedCandidates = [];
		for (let i = 0; i < length(result.candidates); i++)
			if (valid_ipv4(result.candidates[i])) push(result.resolvedCandidates, legacy_candidate(result.candidates[i]));
	}
	return result;
};

function candidate_for_ip(candidates, ip) {
	for (let i = 0; i < length(candidates || []); i++) if (candidates[i] && candidates[i].ip == ip) return candidates[i];
	return null;
}

function probe_ok(probes, ip) {
	return type(probes) == 'object' && type(probes[ip]) == 'object' && probes[ip].ok === true;
}

function choose_verified(candidates, probes, currentIp) {
	let best = null;
	for (let i = 0; i < length(candidates || []); i++) {
		let candidate = candidates[i];
		if (!candidate || candidate.ip == currentIp || !probe_ok(probes, candidate.ip)) continue;
		let latency = probes[candidate.ip].latencyMs || 999999;
		if (!best || latency < best.latency) best = { candidate: candidate, latency: latency };
	}
	return best ? best.candidate : null;
}

function selected_candidate(state) {
	if (type(state.selectedCandidate) == 'object' && valid_ipv4(state.selectedCandidate.ip)) return state.selectedCandidate;
	if (valid_ipv4(state.selectedIp)) return { ip: state.selectedIp, sourceDomain: null, mode: 'legacy', provenance: 'legacy-state' };
	return null;
}

function result_override(state, selected) {
	return selected && state.enabled !== false && state.managed !== false ?
		{ host: TIKTOK_TARGET_HOST, ip: selected.ip, managed: true } : null;
}

export const tiktok_reconcile = function(input) {
	input = input || {};
	let state = tiktok_state_migrate(input.state || {}), candidates = tiktok_resolved_candidates(input.resolutions || []),
		probes = input.probes || {}, current = selected_candidate(state), threshold = input.failoverThreshold || 2,
		result = { action: 'retain', state: state, candidates: candidates, selectedCandidate: current, lastFailover: state.lastFailover || null, override: result_override(state, current) };
	state.resolvedCandidates = candidates;
	state.candidates = [];
	for (let i = 0; i < length(candidates); i++) push(state.candidates, candidates[i].ip);
	if (!length(candidates)) {
		state.state = state.enabled === false ? 'off' : 'degraded';
		result.state = state;
		return result;
	}
	if (!current) {
		let initial = choose_verified(candidates, probes, null);
		if (initial) {
			state.selectedCandidate = initial;
			state.selectedIp = initial.ip;
			state.failureCount = 0;
			state.state = 'healthy';
			result.action = 'select';
			result.selectedCandidate = initial;
			result.override = result_override(state, initial);
		}
		result.state = state;
		return result;
	}
	if (probe_ok(probes, current.ip)) {
		state.state = 'healthy';
		state.failureCount = 0;
		state.selectedCandidate = current;
		state.selectedIp = current.ip;
		result.selectedCandidate = current;
		result.state = state;
		result.override = result_override(state, current);
		return result;
	}
	state.failureCount = (state.failureCount || 0) + 1;
	state.state = 'degraded';
	if (state.failureCount >= threshold) {
		let replacement = choose_verified(candidates, probes, current.ip);
		if (replacement) {
			state.selectedCandidate = replacement;
			state.selectedIp = replacement.ip;
			state.failureCount = 0;
			state.state = 'failover';
			result.action = 'failover';
			result.selectedCandidate = replacement;
			result.override = result_override(state, replacement);
		}
	}
	result.state = state;
	return result;
};

export { valid_ipv4 };
