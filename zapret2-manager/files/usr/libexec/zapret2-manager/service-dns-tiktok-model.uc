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

export { valid_ipv4 };
