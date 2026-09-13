'use strict';

// Pure TikTok candidate/lifecycle helpers.  The existing service-dns RPC and
// apply worker remain the only runtime/state and dnsmasq authorities.

const TIKTOK_TARGET_HOST = 'v77.tiktokcdn.com';
const TIKTOK_HYSTERESIS_RELATIVE = 0.75;
const TIKTOK_HYSTERESIS_ABSOLUTE_MS = 40;

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
	return value == 'direct' || value == 'cla' || value == 'ies' || value == 'generic' || value == 'legacy' || value == 'curated';
}

export const tiktok_domain_catalog = function() {
	return [
		{ domain: TIKTOK_TARGET_HOST, mode: 'direct', enabled: true, provenance: 'primary-target' },
		{ domain: 'v16-cla.tiktokcdn.com', mode: 'cla', enabled: true, provenance: 'canonical-domain-source' },
		{ domain: 'v16-ies-music.tiktokcdn.com', mode: 'ies', enabled: true, provenance: 'canonical-domain-source' },
		{ domain: 'sf16-music.tiktokcdn-eu.com', mode: 'generic', enabled: true, provenance: 'canonical-domain-source' }
	];
};

function curated_candidate(ip, geoHint) {
	return {
		ip: ip, sourceDomains: [], modes: ['curated'], resolvers: [], sources: ['curated-community-fallback'],
		geoHint: geoHint, geoHints: [geoHint], provenance: 'curated-community-fallback',
		dnsObserved: false, curatedObserved: true, verified: false
	};
}

// Community observations are a bounded fallback only.  They are never the
// applied state and remain unverified until the same live TLS/SNI probe as DNS
// candidates succeeds.
export const tiktok_curated_candidates = function() {
	return [
		curated_candidate('212.188.77.134', 'Moscow'), curated_candidate('212.188.77.135', 'Moscow'),
		curated_candidate('212.188.77.140', 'Moscow'), curated_candidate('212.188.77.136', 'Moscow'),
		curated_candidate('185.11.78.47', 'Minsk'),
		curated_candidate('143.244.42.18', 'Amsterdam'), curated_candidate('143.244.42.29', 'Amsterdam'),
		curated_candidate('143.244.42.21', 'Amsterdam'), curated_candidate('143.244.42.36', 'Amsterdam'),
		curated_candidate('143.244.42.15', 'Amsterdam'), curated_candidate('143.244.42.26', 'Amsterdam'),
		curated_candidate('143.244.42.17', 'Amsterdam'), curated_candidate('143.244.42.23', 'Amsterdam'),
		curated_candidate('37.19.202.33', 'Amsterdam'), curated_candidate('37.19.202.53', 'Amsterdam'),
		curated_candidate('37.19.202.47', 'Amsterdam'), curated_candidate('37.19.202.54', 'Amsterdam'),
		curated_candidate('37.19.202.46', 'Amsterdam'), curated_candidate('37.19.202.50', 'Amsterdam'),
		curated_candidate('37.19.202.51', 'Amsterdam'), curated_candidate('37.19.202.49', 'Amsterdam'),
		curated_candidate('37.19.202.52', 'Amsterdam'), curated_candidate('37.19.202.48', 'Amsterdam'),
		curated_candidate('37.19.203.36', 'Sofia'), curated_candidate('169.150.237.34', 'Sofia'),
		curated_candidate('87.245.200.8', 'RETN'), curated_candidate('87.245.200.66', 'RETN'),
		curated_candidate('87.245.200.10', 'RETN'), curated_candidate('87.245.200.35', 'RETN'),
		curated_candidate('87.245.200.64', 'RETN'), curated_candidate('87.245.200.34', 'RETN'),
		curated_candidate('87.245.200.56', 'RETN'), curated_candidate('87.245.200.32', 'RETN'),
		curated_candidate('87.245.200.57', 'RETN'), curated_candidate('87.245.200.9', 'RETN'),
		curated_candidate('87.245.200.24', 'RETN')
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
	let cname = null;
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i] || ''), found = match(line, /canonical name\s*=\s*([a-z0-9][a-z0-9.-]*)/i);
		if (!found) found = match(line, /is an alias for\s+([a-z0-9][a-z0-9.-]*)/i);
		if (found && valid_domain(lc(found[1]))) { cname = lc(found[1]); break; }
	}
	return { status: length(addresses) ? 'resolved' : 'empty', addresses: addresses, cname: cname };
};

function add_resolution(candidate, resolution, domain) {
	let source = type(resolution.source) == 'string' && resolution.source != '' ? resolution.source : 'domain-resolution';
	append_unique(candidate.sourceDomains, domain);
	if (valid_mode(resolution.mode)) append_unique(candidate.modes, resolution.mode);
	if (!candidate.sourceDomain) candidate.sourceDomain = domain;
	if (!candidate.mode && valid_mode(resolution.mode)) candidate.mode = resolution.mode;
	if (valid_ipv4(resolution.resolver)) append_unique(candidate.resolvers, resolution.resolver);
	append_unique(candidate.sources, source);
	if (resolution.cname) {
		if (type(candidate.cnames) != 'array') candidate.cnames = [];
		append_unique(candidate.cnames, lc(trim(resolution.cname)));
		if (!candidate.cname) candidate.cname = lc(trim(resolution.cname));
	}
	candidate.dnsObserved = true;
}

function add_curated(candidate, fallback) {
	candidate.curatedObserved = true;
	if (candidate.provenance == 'domain-resolution') candidate.provenance = 'mixed';
	if (!candidate.geoHint && fallback.geoHint) candidate.geoHint = fallback.geoHint;
	if (fallback.geoHint) {
		if (type(candidate.geoHints) != 'array') candidate.geoHints = [];
		append_unique(candidate.geoHints, fallback.geoHint);
	}
	append_unique(candidate.sources, 'curated-community-fallback');
}

export const tiktok_candidate_pool = function(resolutions, curated) {
	let byIp = {}, result = [];
	for (let i = 0; i < length(resolutions || []); i++) {
		let resolution = resolutions[i] || {}, domain = lc(trim(resolution.domain || ''));
		if (!valid_domain(domain) || resolution.status != 'resolved' || type(resolution.addresses) != 'array') continue;
		for (let j = 0; j < length(resolution.addresses); j++) {
			let ip = trim(resolution.addresses[j] || '');
			if (!valid_ipv4(ip)) continue;
			let candidate = byIp[ip];
			if (!candidate) {
				candidate = { ip: ip, sourceDomains: [], modes: [], resolvers: [], sources: [], provenance: 'domain-resolution', dnsObserved: false, curatedObserved: false, verified: false };
				byIp[ip] = candidate;
				push(result, candidate);
			}
			add_resolution(candidate, resolution, domain);
		}
	}
	for (let i = 0; i < length(curated || []); i++) {
		let fallback = curated[i] || {}, ip = trim(fallback.ip || '');
		if (!valid_ipv4(ip)) continue;
		let candidate = byIp[ip];
		if (!candidate) {
			candidate = { ip: ip, sourceDomains: [], modes: [], resolvers: [], sources: [], provenance: 'curated-community-fallback', dnsObserved: false, curatedObserved: false, verified: false };
			byIp[ip] = candidate;
			push(result, candidate);
		}
		add_curated(candidate, fallback);
	}
	return result;
};

export const tiktok_resolved_candidates = function(resolutions) {
	return tiktok_candidate_pool(resolutions, []);
};

export const tiktok_hysteresis_decision = function(current, alternative) {
	current = current || {};
	alternative = alternative || {};
	let currentHealth = current.health || current.state || 'unknown';
	let alternativeHealth = alternative.health || alternative.state || 'unknown';
	if (alternativeHealth != 'healthy') return { action: 'keep', reason: 'alternative-unhealthy' };
	if (current.ip == null) return { action: 'switch', reason: 'no-current' };
	if (currentHealth != 'healthy') return { action: 'switch', reason: 'current-unhealthy' };
	let currentLatency = +current.latencyMs, alternativeLatency = +alternative.latencyMs;
	if (currentLatency > 0 && alternativeLatency > 0 &&
		alternativeLatency <= currentLatency * TIKTOK_HYSTERESIS_RELATIVE &&
		currentLatency - alternativeLatency >= TIKTOK_HYSTERESIS_ABSOLUTE_MS)
		return { action: 'switch', reason: 'material-latency-improvement' };
	return { action: 'keep', reason: 'hysteresis-not-met' };
};

export const tiktok_lease_valid = function(lease, nowValue, leaseSeconds) {
	lease = lease || {};
	let verifiedAt = int(lease.lastVerifiedAt || 0), nowAt = int(nowValue || 0), ttl = int(leaseSeconds || 0);
	return verifiedAt > 0 && nowAt >= verifiedAt && ttl > 0 && nowAt - verifiedAt <= ttl;
};

export const tiktok_should_fast_path = function(options) {
	options = options || {};
	return options.health == 'healthy' && options.leaseValid === true && options.explicitCheck !== true && options.scheduled !== true;
};

export const tiktok_health_state = function(observation, stable) {
	if (!observation || observation.ok !== true) return 'dead';
	return stable === true ? 'healthy' : 'degraded';
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
