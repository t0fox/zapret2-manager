// dnsprov-logic.mjs — node reference for DNS provider catalog + component
// diagnostics (Phase E). Mirrored by the shipped ucode dnsprov.uc.
//
// This phase adds provider and component INTELLIGENCE only — it does NOT
// change the router's resolver. Storing a DoH endpoint is data, never an
// activation. Diagnostics report evidence + confidence, never false
// certainty ("different answer" is not automatically poisoning — CDNs
// legitimately differ).

export const PROVIDER_SCHEMA = 1;
export const PROVIDER_CATEGORIES = ['anycast', 'privacy', 'filtered', 'regional', 'isp', 'Популярные', 'Безопасные', 'Для ИИ', 'Другое'];

// validateProvider(p) → errors[]
export function validateProvider(p) {
	const errs = [];
	if (!p || typeof p !== 'object') return ['provider is not an object'];
	if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(p.id)) errs.push('id must be 2..32 chars of a-z0-9-');
	if (typeof p.name !== 'string' || !p.name) errs.push('name required');
	if (!PROVIDER_CATEGORIES.includes(p.category)) errs.push('category must be one of ' + PROVIDER_CATEGORIES.join('/'));
	if (typeof p.reviewed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.reviewed)) errs.push('reviewed must be an ISO date');
	if (!Array.isArray(p.provenance) || !p.provenance.length) errs.push('provenance[] required');
	for (const ip of p.ipv4 || []) {
		const parts = String(ip).split('.');
		const bad = parts.length !== 4 || parts.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255 || (o.length > 1 && o.startsWith('0')));
		if (bad) errs.push('invalid ipv4 ' + ip + ' (octets must be 0..255, no leading zeros)');
	}
	for (const ip of p.ipv6 || []) if (!/^[0-9a-fA-F:]+$/.test(ip) || ip.length < 2) errs.push('invalid ipv6 ' + ip);
	if (p.doh != null && (typeof p.doh !== 'string' || !/^https:\/\//.test(p.doh))) errs.push('doh endpoint must be an https:// URL (data only — never activated)');
	if (typeof p.notes !== 'string' || !p.notes) errs.push('privacy/security notes required');
	return errs;
}

// validateProviders(doc) → { ok, errors, byId }
export function validateProviders(doc) {
	const errors = [];
	if (!doc || typeof doc !== 'object' || Array.isArray(doc))
		return { ok: false, errors: ['providers document is not an object'], byId: {} };
	if (doc.schema !== PROVIDER_SCHEMA) errors.push('schema must be ' + PROVIDER_SCHEMA);
	if (typeof doc.version !== 'string' || !doc.version) errors.push('version required');
	const byId = {};
	for (const p of doc.providers || []) {
		errors.push(...validateProvider(p).map((e) => (p && p.id ? p.id + ': ' : '?: ') + e));
		if (p && typeof p.id === 'string') {
			if (byId[p.id]) errors.push('duplicate provider id: ' + p.id);
			byId[p.id] = p;
		}
	}
	return { ok: errors.length === 0, errors, byId };
}

// componentReport(detected) — the resolver-component matrix.
// detected: [{ name, initPresent, running, enabled, listeners, configOwner }]
// A CONFLICT is a running ALTERNATIVE resolver holding :53 listeners (it can
// replace or bypass dnsmasq) — a component without :53 listeners (odhcpd
// doing RA/DHCPv6 only) is not a resolver conflict.
export function componentReport(detected) {
	const resolverCandidates = [];
	const conflicts = [];
	for (const c of detected) {
		const hasListeners = c.listeners && c.listeners.length > 0;
		if (c.running && hasListeners) resolverCandidates.push(c.name);
		if (c.running && hasListeners && c.name !== 'dnsmasq') conflicts.push({
			component: c.name,
			reason: c.name + ' is running with :53 listeners — it may REPLACE or bypass dnsmasq (manager DNS flows assume dnsmasq)'
		});
	}
	return {
		components: detected,
		likelyResolverPath: resolverCandidates.length ? resolverCandidates : ['unknown'],
		conflicts,
		note: 'detected read-only; unknown states are reported, never guessed'
	};
}

// classifyProviderProbe({reachable, answered, answerMatchesLocal}) →
// evidence + confidence (never false certainty).
export function classifyProviderProbe(pr) {
	if (pr.reachable !== true) return { outcome: 'unreachable', confidence: 'high', reason: 'no answer within the probe budget' };
	if (pr.answered !== true) return { outcome: 'no-answer', confidence: 'medium', reason: 'reachable but no DNS answer' };
	if (pr.answerMatchesLocal === true) return { outcome: 'consistent', confidence: 'high', reason: 'provider and local answers agree' };
	if (pr.answerMatchesLocal === false) return {
		outcome: 'divergent', confidence: 'low',
		reason: 'provider and local answers DIFFER — this is NOT automatically poisoning: CDN-backed domains legitimately return different IPs by resolver/region'
	};
	return { outcome: 'unknown', confidence: 'none', reason: 'insufficient evidence' };
}

// suspicionAssessment(divergentDomains, totalDomains) → the consistency
// verdict with honest confidence.
export function suspicionAssessment(probes) {
	const divergent = (probes || []).filter((p) => p.outcome === 'divergent');
	const consistent = (probes || []).filter((p) => p.outcome === 'consistent');
	const unreachable = (probes || []).filter((p) => p.outcome === 'unreachable' || p.outcome === 'no-answer');
	if (!(probes || []).length) return { verdict: 'unknown', confidence: 'none', reason: 'no probes completed' };
	if (divergent.length === 0 && unreachable.length === 0)
		return { verdict: 'consistent', confidence: 'high', reason: 'all provider and local answers agree' };
	if (divergent.length === 0)
		return { verdict: 'partial', confidence: 'low', reason: unreachable.length + ' provider(s) unreachable; remaining answers agree' };
	return {
		verdict: 'divergent',
		confidence: 'low',
		reason: divergent.length + ' domain(s) resolve differently via provider vs local resolver. Confidence is LOW: legitimate CDN anycast/regional answers produce the same picture. Suspicion requires more evidence than this probe provides.'
	};
}

// BusyBox nslookup prints resolver metadata before `Name:` and answer records
// afterwards. Only post-Name Address/Address N records are domain answers.
export function parseBusyboxNslookup(text, resolverIp) {
	const answers = [];
	let answerSection = false;
	for (const raw of String(text || '').split(/\r?\n/)) {
		const line = raw.trim();
		if (/^Name:\s*/i.test(line)) { answerSection = true; continue; }
		if (!answerSection || !/^Address(?:\s+\d+)?\s*:/i.test(line)) continue;
		const value = line.slice(line.indexOf(':') + 1).trim().split(/\s+/)[0];
		if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value !== resolverIp && !answers.includes(value)) answers.push(value);
	}
	return answers;
}

export function summarizeAttempts(attempts) {
	const rows = attempts || [];
	const answered = rows.filter((a) => a.dnsAnswered === true).length;
	const outcome = answered > 0 ? (answered === rows.length ? 'working' : 'partial') : 'failed';
	return { outcome, working: outcome === 'working', partial: outcome === 'partial', failed: outcome === 'failed' };
}
