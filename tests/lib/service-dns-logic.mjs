// service-dns-logic.mjs — node reference for the Per-Service DNS slice.
// Mirrored by the shipped ucode service-dns.uc. This module is the pure logic:
// dataset/profiling validation, ownership ledger, preview, render, parse,
// status. Deterministic, side-effect free, JSON serializable, independent of
// the router. Live DNS apply is SUPERVISED (see docs/contracts/service-dns.md);
// this module never touches the filesystem.
//
// PRODUCT GOAL: the operator chooses a provider profile per service
// (e.g. ChatGPT → Comss, Discord → Provider X). The manager then generates
// ONLY the hostname/IP mappings those selected services need. Other domains
// keep using the router's normal DNS. This is NOT global DNS replacement,
// WAN DNS switching, DoH, or a service-unblocking guarantee.
//
// OWNERSHIP MODEL (the core invariant — same shape as catalog-logic but at
// hostname+family+address granularity):
//   - a record tuple (hostname, family, address) is removed only when its
//     owner set becomes empty after a selection change;
//   - a preexisting USER tuple is NEVER claimed by a service (anti-wipe);
//   - a shared tuple (≥2 service owners) survives while any owner needs it;
//   - disabling one service removes only tuples exclusively owned by its
//     old profile.
//
// IPv4-only target: A records may be applied; AAAA records are preserved in
// the provider dataset but reported as unsupported (not applied). The schema
// carries both so a future IPv6 capability needs no migration.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
export const DATASET_SCHEMA_VERSION = 1;
export const MAX_PROVIDERS = 64;
export const MAX_PROFILES = 128;
export const MAX_OUTPUT_LINES = 256;
export const MAX_OUTPUT_BYTES = 16384;
export const MAX_RECORDS_PER_PROFILE = 64;

// Trust classification. 'applicable' = safe to apply by default.
// experimental needs an explicit advanced opt-in; expired/untrusted never
// apply.
const TRUST_APPLICABLE = new Set(['bundled-reviewed', 'pinned-hash']);

// the canonical service IDs come from the shipped Service Catalog
// (catalog/services.json). This list is the validation whitelist for
// profile.serviceId. Keeping it here (mirroring the catalog) avoids a
// filesystem read in pure logic; the backend re-checks against the live
// catalog at apply time.
export const KNOWN_SERVICE_IDS = [
	'youtube', 'discord', 'telegram-web', 'twitch', 'spotify', 'supercell',
	'github', 'githubusercontent', 'chatgpt-openai', 'google-gemini', 'notion'
];

// ---------------------------------------------------------------------------
// hostname / address validation (mirrors dns-logic validate_domain/_ipv4,
// extended with IPv6 + the rejection of non-routable ranges)
// ---------------------------------------------------------------------------

// normalizeHostname(name) → { ok, hostname } | { ok:false, reason }
// Rejects: non-strings, empty, URLs (scheme/://), wildcards, whitespace,
// shell metacharacters, invalid LDH, >253, single-label, leading/trailing
// hyphen. Returns the lowercased canonical hostname.
export function normalizeHostname(name) {
	if (typeof name !== 'string') return { ok: false, reason: 'hostname must be a string' };
	// reject raw whitespace/control chars BEFORE trimming — a trailing \n or
	// internal \t is an injection vector; trim() would silently erase it.
	if (/[\s\x00-\x1f\x7f]/.test(name)) return { ok: false, reason: 'whitespace/control characters in hostname' };
	const h = name.trim().toLowerCase();
	if (h === '') return { ok: false, reason: 'empty hostname' };
	if (h.length > 253) return { ok: false, reason: 'hostname too long (>253)' };
	// URL instead of hostname — a hostname has no scheme, no path, no port
	if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) return { ok: false, reason: 'URL where a hostname is expected' };
	if (h.includes('://')) return { ok: false, reason: 'URL where a hostname is expected' };
	if (h.includes('/')) return { ok: false, reason: 'hostname must not contain a path separator' };
	if (h.includes(':')) return { ok: false, reason: 'hostname must not contain a port separator' };
	if (h.includes('*')) return { ok: false, reason: 'wildcards are not supported' };
	// shell metacharacters — never reach a file
	if (/[;|&$`<>(){}\\"'!#]/.test(h)) return { ok: false, reason: 'shell metacharacters in hostname' };
	if (/[^a-z0-9.-]/.test(h)) return { ok: false, reason: 'invalid characters in hostname (a-z 0-9 . - only)' };
	const labels = h.split('.');
	if (labels.length < 2) return { ok: false, reason: 'need a full hostname (at least two labels)' };
	for (const l of labels) {
		if (l.length === 0 || l.length > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (l.startsWith('-') || l.endsWith('-')) return { ok: false, reason: 'labels must not start/end with a hyphen' };
	}
	return { ok: true, hostname: h };
}

// isPrivateIPv4(octets) — 10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT),
// 0/8, 127/8, 169.254/16, 224/4, 240/4, 192.0.2/24 (TEST-NET-1),
// 198.51.100/24 (TEST-NET-2), 203.0.113/24 (TEST-NET-3), 198.18/15 (bench).
export function isPrivateIPv4(o) {
	const a = o[0], b = o[1];
	if (a === 0) return true;                 // 0.0.0.0/8 "this host"
	if (a === 10) return true;               // private
	if (a === 127) return true;              // loopback
	if (a === 169 && b === 254) return true;  // link-local
	if (a >= 224) return true;               // multicast (224/4) + reserved (240/4)
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 168) return true; // private
	if (a === 192 && b === 0 && o[2] === 2) return true; // TEST-NET-1
	if (a === 198 && b === 18) return true;  // benchmarking
	if (a === 198 && b === 19) return true;  // benchmarking
	if (a === 198 && b === 51 && o[2] === 100) return true; // TEST-NET-2
	if (a === 203 && b === 0 && o[2] === 113) return true;  // TEST-NET-3
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	return false;
}

// normalizeAddress(addr, family) → { ok, address } | { ok:false, reason }
// family ∈ {'A','AAAA'}. Validates syntax AND rejects non-routable ranges.
export function normalizeAddress(addr, family) {
	if (typeof addr !== 'string') return { ok: false, reason: 'address must be a string' };
	const s = addr.trim();
	if (s === '') return { ok: false, reason: 'empty address' };
	if (family === 'A') return normalizeIPv4(s);
	if (family === 'AAAA') return normalizeIPv6(s);
	return { ok: false, reason: 'family must be A or AAAA' };
}

export function normalizeIPv4(s) {
	const parts = s.split('.');
	if (parts.length !== 4) return { ok: false, reason: 'IPv4 must have exactly 4 octets' };
	const oct = [];
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return { ok: false, reason: 'invalid octet ' + JSON.stringify(p) };
		if (p.length > 1 && p.startsWith('0')) return { ok: false, reason: 'leading zeros are not allowed' };
		const n = Number(p);
		if (n > 255) return { ok: false, reason: 'octet > 255' };
		oct.push(n);
	}
	if (isPrivateIPv4(oct)) {
		return { ok: false, reason: 'non-routable/private/loopback/multicast/documentation IPv4 rejected: ' + oct.join('.') };
	}
	return { ok: true, address: oct.join('.') };
}

// normalizeIPv6(s) — canonical compressed form. Rejects ::, ::1 (loopback),
// fe80::/10 (link-local), ff00::/8 (multicast), 2001:db8::/32 (documentation),
// fc00::/7 (ULA — unique local, non-routable). Uses Node's URL to parse, then
// checks ranges. NEVER invents an address to make a profile complete.
export function normalizeIPv6(s) {
	if (typeof s !== 'string' || s.trim() === '') return { ok: false, reason: 'empty IPv6' };
	const t = s.trim();
	// basic char gate before parsing
	if (!/^[0-9a-fA-F:]+$/.test(t)) return { ok: false, reason: 'invalid IPv6 characters' };
	if ((t.match(/::/g) || []).length > 1) return { ok: false, reason: 'IPv6 has multiple ::' };
	// expand via a synthetic URL host parse (Node's canonical parser)
	let canonical;
	try {
		const u = new URL('http://[' + t + ']:1/');
		// u.hostname keeps brackets in some runtimes; strip them
		let host = u.hostname.replace(/^\[|\]$/g, '');
		if (!host || host === '') host = u.host.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
		// re-validate the parsed host is a real IPv6
		if (!host || !host.includes(':')) return { ok: false, reason: 'malformed IPv6' };
		canonical = host.toLowerCase();
	} catch (e) {
		return { ok: false, reason: 'malformed IPv6' };
	}
	// expand to 8 groups for range checks
	const groups = expandIPv6(canonical);
	if (!groups) return { ok: false, reason: 'malformed IPv6' };
	const g0 = parseInt(groups[0], 16);
	// :: (unspecified) / ::1 (loopback)
	if (groups.every(x => x === '0000')) return { ok: false, reason: 'unspecified IPv6 rejected' };
	if (groups[0] === '0000' && groups[1] === '0000' && groups[2] === '0000' && groups[3] === '0000' &&
		groups[4] === '0000' && groups[5] === '0000' && groups[6] === '0000' && groups[7] === '0001')
		return { ok: false, reason: 'loopback IPv6 rejected' };
	// link-local fe80::/10
	if ((g0 & 0xffc0) === 0xfe80) return { ok: false, reason: 'link-local IPv6 rejected' };
	// multicast ff00::/8
	if ((g0 & 0xff00) === 0xff00) return { ok: false, reason: 'multicast IPv6 rejected' };
	// documentation 2001:db8::/32
	if (g0 === 0x2001 && parseInt(groups[1], 16) === 0x0db8) return { ok: false, reason: 'documentation IPv6 rejected' };
	// ULA fc00::/7
	if ((g0 & 0xfe00) === 0xfc00) return { ok: false, reason: 'unique-local IPv6 rejected' };
	return { ok: true, address: canonical };
}

function expandIPv6(canonical) {
	// split into groups honoring ::
	let left, right;
	if (canonical.includes('::')) {
		const [lh, rh] = canonical.split('::');
		left = lh ? lh.split(':') : [];
		right = rh ? rh.split(':') : [];
		const fill = 8 - left.length - right.length;
		if (fill < 1) return null;
		const groups = [...left, ...Array(fill).fill('0000'), ...right];
		if (groups.length !== 8) return null;
		return groups.map(g => g.padStart(4, '0'));
	}
	const groups = canonical.split(':');
	if (groups.length !== 8) return null;
	return groups.map(g => g.padStart(4, '0'));
}

// ---------------------------------------------------------------------------
// record normalization
// ---------------------------------------------------------------------------

// normalizeRecord(rec) → { ok, record } | { ok:false, reason }
// record = { hostname, A:[], AAAA:[] }. Validates hostname + every address,
// dedupes within-family duplicates, drops empty families (but keeps the key).
export function normalizeRecord(rec) {
	if (!rec || typeof rec !== 'object') return { ok: false, reason: 'record must be an object' };
	const hn = normalizeHostname(rec.hostname);
	if (!hn.ok) return { ok: false, reason: hn.reason };
	const rawA = Array.isArray(rec.A) ? rec.A : [];
	const rawAAAA = Array.isArray(rec.AAAA) ? rec.AAAA : [];
	const A = [];
	const AAAA = [];
	const seenA = new Set();
	const seenAAAA = new Set();
	for (const a of rawA) {
		const v = normalizeAddress(a, 'A');
		if (!v.ok) return { ok: false, reason: 'A: ' + v.reason };
		if (seenA.has(v.address)) continue; // within-record dedup
		seenA.add(v.address);
		A.push(v.address);
	}
	for (const a of rawAAAA) {
		const v = normalizeAddress(a, 'AAAA');
		if (!v.ok) return { ok: false, reason: 'AAAA: ' + v.reason };
		if (seenAAAA.has(v.address)) continue;
		seenAAAA.add(v.address);
		AAAA.push(v.address);
	}
	return { ok: true, record: { hostname: hn.hostname, A, AAAA } };
}

// ---------------------------------------------------------------------------
// provider / profile / dataset validation
// ---------------------------------------------------------------------------

// validateProvider(p) → { ok, provider } | { ok:false, reason }
export function validateProvider(p) {
	if (!p || typeof p !== 'object') return { ok: false, reason: 'provider must be an object' };
	if (typeof p.id !== 'string' || p.id.trim() === '') return { ok: false, reason: 'provider.id must be a non-empty string' };
	if (typeof p.name !== 'string' || p.name.trim() === '') return { ok: false, reason: 'provider.name must be a non-empty string' };
	if (typeof p.sourceUrl !== 'string' || p.sourceUrl.trim() === '') return { ok: false, reason: 'provider.sourceUrl must be a non-empty string' };
	if (typeof p.sourceRevision !== 'string' || p.sourceRevision.trim() === '') return { ok: false, reason: 'provider.sourceRevision required (provenance)' };
	if (typeof p.sourceHash !== 'string' || p.sourceHash.trim() === '') return { ok: false, reason: 'provider.sourceHash required (pinned provenance)' };
	if (typeof p.reviewedAt !== 'string') return { ok: false, reason: 'provider.reviewedAt must be a string' };
	if (typeof p.expiresAt !== 'string') return { ok: false, reason: 'provider.expiresAt must be a string' };
	if (!TRUST_APPLICABLE.has(p.trust) && p.trust !== 'experimental' && p.trust !== 'expired' && p.trust !== 'untrusted')
		return { ok: false, reason: 'provider.trust has an unknown value' };
	return { ok: true, provider: p };
}

// validateProfile(p, knownServiceIds, knownProviderIds) → { ok, profile } | { ok:false, reason }
export function validateProfile(p, knownServiceIds, knownProviderIds) {
	if (!p || typeof p !== 'object') return { ok: false, reason: 'profile must be an object' };
	if (typeof p.id !== 'string' || p.id.trim() === '') return { ok: false, reason: 'profile.id must be a non-empty string' };
	if (typeof p.providerId !== 'string') return { ok: false, reason: 'profile.providerId must be a string' };
	if (knownProviderIds && !knownProviderIds.has(p.providerId)) return { ok: false, reason: 'profile references unknown providerId' };
	if (typeof p.serviceId !== 'string' || p.serviceId.trim() === '') return { ok: false, reason: 'profile.serviceId must be a non-empty string' };
	if (knownServiceIds && !knownServiceIds.has(p.serviceId)) return { ok: false, reason: 'unknown serviceId: ' + p.serviceId };
	if (!Array.isArray(p.requiredDomains)) return { ok: false, reason: 'requiredDomains must be an array' };
	if (!Array.isArray(p.optionalDomains)) return { ok: false, reason: 'optionalDomains must be an array' };
	if (!Array.isArray(p.diagnosticTargets)) return { ok: false, reason: 'diagnosticTargets must be an array' };
	if (!Array.isArray(p.records)) return { ok: false, reason: 'records must be an array' };
	if (p.records.length > MAX_RECORDS_PER_PROFILE) return { ok: false, reason: 'too many records in one profile (max ' + MAX_RECORDS_PER_PROFILE + ')' };
	const normalized = [];
	const seenHost = new Set();
	for (const r of p.records) {
		const v = normalizeRecord(r);
		if (!v.ok) return { ok: false, reason: 'record for ' + (r && r.hostname) + ': ' + v.reason };
		if (seenHost.has(v.record.hostname)) return { ok: false, reason: 'duplicate hostname in profile: ' + v.record.hostname };
		seenHost.add(v.record.hostname);
		normalized.push(v.record);
	}
	return {
		ok: true,
		profile: {
			...p,
			records: normalized
		}
	};
}

// validateDataset(ds) → { ok, providers, profiles, providersValid, profilesValid } | { ok:false, errors }
export function validateDataset(ds) {
	const errors = [];
	if (!ds || typeof ds !== 'object') return { ok: false, errors: [{ reason: 'dataset must be an object' }] };
	if (ds.schemaVersion !== DATASET_SCHEMA_VERSION) return { ok: false, errors: [{ reason: 'unsupported schemaVersion (expected ' + DATASET_SCHEMA_VERSION + ')' }] };
	if (!Array.isArray(ds.providers)) return { ok: false, errors: [{ reason: 'providers must be an array' }] };
	if (!Array.isArray(ds.profiles)) return { ok: false, errors: [{ reason: 'profiles must be an array' }] };
	if (ds.providers.length > MAX_PROVIDERS) return { ok: false, errors: [{ reason: 'too many providers (max ' + MAX_PROVIDERS + ')' }] };
	if (ds.profiles.length > MAX_PROFILES) return { ok: false, errors: [{ reason: 'too many profiles (max ' + MAX_PROFILES + ')' }] };
	const providerIds = new Set();
	const profileIds = new Set();
	const providers = [];
	const profiles = [];
	for (const p of ds.providers) {
		const v = validateProvider(p);
		if (!v.ok) { errors.push({ reason: 'provider ' + (p && p.id) + ': ' + v.reason }); continue; }
		if (providerIds.has(p.id)) { errors.push({ reason: 'duplicate provider id: ' + p.id }); continue; }
		providerIds.add(p.id);
		providers.push(v.provider);
	}
	for (const pr of ds.profiles) {
		const v = validateProfile(pr, new Set(KNOWN_SERVICE_IDS), providerIds);
		if (!v.ok) { errors.push({ reason: 'profile ' + (pr && pr.id) + ': ' + v.reason }); continue; }
		if (profileIds.has(pr.id)) { errors.push({ reason: 'duplicate profile id: ' + pr.id }); continue; }
		profileIds.add(pr.id);
		profiles.push(v.profile);
	}
	if (errors.length) return { ok: false, errors };
	return { ok: true, providers, profiles, providersValid: providers.length, profilesValid: profiles.length };
}

// ---------------------------------------------------------------------------
// trust / staleness / completeness classification
// ---------------------------------------------------------------------------

// classifyTrust(provider, { now }) → { applicable, trust, warning, reason }
// 'now' is an ISO date string (or null → use a fixed far-future date is WRONG;
// tests pass explicit dates). Expired beats untrusted/experimental in ordering.
export function classifyTrust(provider, opts) {
	opts = opts || {};
	const now = opts.now || '2026-07-30';
	const trust = provider.trust;
	// staleness first: an expired pinned/bundled profile is NOT applicable
	const stale = classifyStaleness(provider, opts);
	if (!stale.fresh) {
		return { applicable: false, trust, warning: true, reason: 'profile expired: ' + (provider.expiresAt || '?') + ' (' + stale.reason + ')' };
	}
	if (trust === 'untrusted') return { applicable: false, trust, warning: true, reason: 'provider is untrusted' };
	if (trust === 'expired') return { applicable: false, trust, warning: true, reason: 'provider marked expired' };
	if (trust === 'experimental') return { applicable: false, trust, warning: true, reason: 'experimental — requires explicit advanced opt-in' };
	if (TRUST_APPLICABLE.has(trust)) return { applicable: true, trust, warning: false, reason: null };
	return { applicable: false, trust, warning: true, reason: 'unknown trust level' };
}

// classifyStaleness(provider, { now }) → { fresh, reason }
export function classifyStaleness(provider, opts) {
	opts = opts || {};
	const now = opts.now || '2026-07-30';
	if (!provider.expiresAt) return { fresh: false, reason: 'no expiry set' };
	// lexicographic ISO date comparison works for YYYY-MM-DD and
	// YYYY-MM-DDTHH:MM:SSZ (same length / format)
	if (provider.expiresAt <= now) return { fresh: false, reason: 'expired at ' + provider.expiresAt };
	return { fresh: true, reason: null };
}

// computeCompleteness(profile) → { status, missingRequired, missingOptional,
//   aCount, aaaaCount, unsupportedFamilies }
// status ∈ complete | partial | empty | unsupported address family.
// A profile is 'complete' only when EVERY required domain has ≥1 applicable
// A record (the IPv4 target). AAAA counts toward AAAA coverage but is reported
// as an unsupported address family on the current target.
export function computeCompleteness(profile) {
	const recsByHost = new Map();
	for (const r of profile.records) recsByHost.set(r.hostname, r);
	const missingRequired = [];
	const missingOptional = [];
	let aCount = 0, aaaaCount = 0;
	const unsupported = [];
	for (const d of profile.requiredDomains) {
		const r = recsByHost.get(d);
		if (!r || r.A.length === 0) {
			// does it have AAAA only? then it is an unsupported-address-family gap
			if (r && r.AAAA.length > 0) unsupported.push({ hostname: d, reason: 'AAAA-only — unsupported address family on IPv4 target' });
			missingRequired.push(d);
		}
	}
	for (const d of profile.optionalDomains) {
		const r = recsByHost.get(d);
		if (!r) missingOptional.push(d);
	}
	for (const r of profile.records) { aCount += r.A.length; aaaaCount += r.AAAA.length; }
	let status;
	if (profile.records.length === 0 && profile.requiredDomains.length === 0) status = 'empty';
	else if (missingRequired.length === 0) status = 'complete';
	else if (unsupported.length > 0 && missingRequired.length === unsupported.length) status = 'unsupported address family';
	else status = 'partial';
	return { status, missingRequired, missingOptional, aCount, aaaaCount, unsupported };
}

// ---------------------------------------------------------------------------
// desired records + ownership
// ---------------------------------------------------------------------------

// computeDesiredRecords(records, applyFamily) → { records, unsupported }
// records: a profile's normalized records. applyFamily: 'A' (current target).
// Returns the applicable records (family applied) plus the unsupported
// addresses (e.g. AAAA on the IPv4 target) — preserved but not applied.
export function computeDesiredRecords(records, applyFamily) {
	const out = [];
	const unsupported = [];
	for (const r of records) {
		if (applyFamily === 'A') {
			if (r.A.length > 0) out.push({ hostname: r.hostname, A: r.A, AAAA: [] });
			for (const a of r.AAAA) unsupported.push(a);
		} else if (applyFamily === 'AAAA') {
			if (r.AAAA.length > 0) out.push({ hostname: r.hostname, A: [], AAAA: r.AAAA });
			for (const a of r.A) unsupported.push(a);
		}
	}
	return { records: out, unsupported };
}

// tuple key: hostname + family + address. Ownership is tracked at this
// granularity so the same hostname with two different addresses (different
// owners) is not conflated.
function tupleKey(hostname, family, address) {
	return hostname + '|' + family + '|' + address;
}

// computeRecordOwnership(state, desiredServiceRecords, opts)
// desiredServiceRecords: [{ hostname, A|AAAA, owner }] from the currently
//   selected+applicable profiles.
// opts: { revision?, expectedFileHash?, resolveFailed?, stateWriteFailed?,
//   reloadFailed?, rollbackFailed? } — optimistic-concurrency + file-hash
//   conflict checks, plus failure simulation gates mirroring the backend's
//   fail-closed apply stages.
// Returns { ok, ownership } where ownership maps tupleKey → owner set, OR
// { ok:false, error:{ code, message } }.
export function computeRecordOwnership(state, desiredServiceRecords, opts) {
	opts = opts || {};
	const input = opts;
	// failure simulation gates (mirror the backend's fail-closed stages)
	if (opts.rollbackFailed) return { ok: false, error: { code: 'ECRITICAL', message: 'rollback failed — manual recovery required' } };
	if (opts.resolveFailed) return { ok: false, error: { code: 'ETARGET', message: 'local resolver verification failed — rolled back' } };
	if (opts.stateWriteFailed) return { ok: false, error: { code: 'ESTATE', message: 'state write failed — rolled back' } };
	if (opts.reloadFailed) return { ok: false, error: { code: 'ETARGET', message: 'dnsmasq reload failed — rolled back' } };

	const serviceDns = (state && state.serviceDns) || {};
	const applied = serviceDns.applied || {};
	const curRevision = (typeof applied.revision === 'number') ? applied.revision : 0;
	// optimistic revision conflict
	if (typeof input.revision === 'number' && input.revision !== curRevision)
		return { ok: false, error: { code: 'ECONFLICT', message: 'service DNS draft changed elsewhere (revision ' + curRevision + '); reload and retry' } };
	// file-hash conflict (manual file change between preview and apply)
	if (opts.expectedFileHash && applied.fileHash && opts.expectedFileHash !== applied.fileHash)
		return { ok: false, error: { code: 'ECONFLICT', message: 'generated DNS file changed on disk between preview and apply' } };

	// build ownership map from desired service records
	const ownership = {};
	for (const rec of desiredServiceRecords) {
		const fam = rec.A && rec.A.length ? 'A' : 'AAAA';
		const addrs = fam === 'A' ? rec.A : rec.AAAA;
		for (const a of addrs) {
			const k = tupleKey(rec.hostname, fam, a);
			if (!ownership[k]) ownership[k] = { hostname: rec.hostname, family: fam, address: a, owners: [] };
			if (!ownership[k].owners.includes(rec.owner)) ownership[k].owners.push(rec.owner);
			ownership[k].owners.sort();
		}
	}
	return { ok: true, ownership };
}

// buildPreview(existingRecords, serviceRecords, opts)
// existingRecords: the live generated-file records (user + service-owned).
//   null = read failed (anti-wipe: refuse).
// serviceRecords: the desired service-owned records (owner: 'service:<id>').
// opts: { stateReadFailed?, fileReadFailed? }
// Returns a preview with added/removed/preserved/shared + ownership, OR
// { ok:false, error }.
export function buildPreview(existingRecords, serviceRecords, opts) {
	opts = opts || {};
	if (opts.stateReadFailed) return { ok: false, error: { code: 'ESTATE', message: 'failed to read service DNS state — refusing to overwrite' } };
	if (opts.fileReadFailed) return { ok: false, error: { code: 'ETARGET', message: 'failed to read generated DNS file — refusing to overwrite' } };

	const added = [];
	const removed = [];
	const preserved = [];
	const sharedKept = [];

	// index existing by tuple
	const existingByTuple = new Map();
	for (const r of (existingRecords || [])) {
		const fams = [['A', r.A || []], ['AAAA', r.AAAA || []]];
		for (const [fam, addrs] of fams) {
			for (const a of addrs) existingByTuple.set(tupleKey(r.hostname, fam, a), { ...r, family: fam, address: a, owner: r.owner || 'user' });
		}
	}

	// index desired service tuples, MERGING owners for a tuple wanted by
	// multiple profiles (shared ownership)
	const desiredByTuple = new Map();
	for (const r of (serviceRecords || [])) {
		const fams = [['A', r.A || []], ['AAAA', r.AAAA || []]];
		for (const [fam, addrs] of fams) {
			for (const a of addrs) {
				const k = tupleKey(r.hostname, fam, a);
				const prev = desiredByTuple.get(k);
				if (prev) {
					// merge owner (string or array) into the existing set
					const owners = new Set(prev.ownerArr || []);
					(Array.isArray(r.owner) ? r.owner : [r.owner]).forEach(o => owners.add(o));
					prev.ownerArr = [...owners].sort();
				} else {
					desiredByTuple.set(k, { ...r, family: fam, address: a, owner: r.owner, ownerArr: (Array.isArray(r.owner) ? r.owner : [r.owner]) });
				}
			}
		}
	}

	// added: desired not present in existing
	for (const [k, d] of desiredByTuple) {
		if (!existingByTuple.has(k)) added.push(d);
	}
	// preserved/removed: existing tuples
	const ownership = {};
	const userOwnedKeys = new Set(); // tuples the user already owns — services
	// never claim or share ownership of these (anti-wipe + ownership claim ban)
	for (const [k, e] of existingByTuple) {
		const d = desiredByTuple.get(k);
		// existing user-owned record: never claim, never remove (anti-wipe)
		if (e.owner === 'user') {
			preserved.push(e);
			ownership[k] = ['user'];
			userOwnedKeys.add(k);
			continue;
		}
		// service-owned existing tuple
		if (d) {
			// still desired by ≥1 service → keep; if multiple services want
			// it, it is shared.
			sharedKept.push(e);
			ownership[k] = d.ownerArr || [d.owner];
		} else {
			// service-owned but no longer desired → remove
			removed.push(e);
		}
	}
	// add desired tuples to ownership map (for newly added). A tuple already
	// owned by the user is NEVER merged with service owners — the service
	// cannot claim or share a preexisting user record (anti-wipe ownership ban).
	for (const [k, d] of desiredByTuple) {
		if (userOwnedKeys.has(k)) continue;
		const owners = d.ownerArr || [d.owner];
		if (!ownership[k]) ownership[k] = owners;
		else {
			const cur = new Set(ownership[k]);
			owners.forEach(o => cur.add(o));
			ownership[k] = [...cur].sort();
		}
	}

	// restructure ownership to the nested {hostname:{address:{family:owners}}} shape
	const nestedOwnership = {};
	for (const [k, owners] of Object.entries(ownership)) {
		const [hostname, family, address] = k.split('|');
		if (!nestedOwnership[hostname]) nestedOwnership[hostname] = {};
		if (!nestedOwnership[hostname][address]) nestedOwnership[hostname][address] = {};
		nestedOwnership[hostname][address][family] = owners;
	}

	return {
		ok: true,
		added: dedupeRecords(added).sort(compareRecords),
		removed: dedupeRecords(removed).sort(compareRecords),
		preserved: dedupeRecords(preserved).sort(compareRecords),
		sharedKept: dedupeRecords(sharedKept).sort(compareRecords),
		ownership: nestedOwnership
	};
}

function dedupeRecords(list) {
	const seen = new Set();
	const out = [];
	for (const r of list) {
		const fam = r.family || (r.A && r.A.length ? 'A' : 'AAAA');
		const addrs = fam === 'A' ? (r.A || []) : (r.AAAA || []);
		const a = r.address || addrs[0];
		const k = tupleKey(r.hostname, fam, a);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(r);
	}
	return out;
}

function compareRecords(a, b) {
	const fa = a.family || (a.A && a.A.length ? 'A' : 'AAAA');
	const fb = b.family || (b.A && b.A.length ? 'A' : 'AAAA');
	const aa = a.address || (a[fa] || [])[0] || '';
	const ab = b.address || (b[fb] || [])[0] || '';
	if (a.hostname !== b.hostname) return a.hostname < b.hostname ? -1 : 1;
	if (fa !== fb) return fa < fb ? -1 : 1;
	return aa < ab ? -1 : (aa > ab ? 1 : 0);
}

// ---------------------------------------------------------------------------
// addnhosts render / parse — one record per line: "IP hostname"
// Deterministic ordering: by hostname, then family (A < AAAA), then address.
// ---------------------------------------------------------------------------

export function renderAddnhosts(records) {
	// flatten to lines, dedupe, sort
	const lines = new Set();
	for (const r of records) {
		for (const a of (r.A || [])) lines.add(a + ' ' + r.hostname);
		for (const a of (r.AAAA || [])) lines.add(a + ' ' + r.hostname);
	}
	const arr = [...lines];
	// bound output
	const bounded = arr.slice(0, MAX_OUTPUT_LINES);
	// sort: by hostname, then address (lexicographic on the full line gives
	// stable, address-grouped ordering under the same hostname)
	bounded.sort((x, y) => {
		const hx = x.split(' ').slice(1).join(' ');
		const hy = y.split(' ').slice(1).join(' ');
		if (hx !== hy) return hx < hy ? -1 : 1;
		const ax = x.split(' ')[0];
		const ay = y.split(' ')[0];
		return ax < ay ? -1 : (ax > ay ? 1 : 0);
	});
	let out = '';
	for (const l of bounded) out += l + '\n';
	// bound total bytes
	if (out.length > MAX_OUTPUT_BYTES) out = out.slice(0, MAX_OUTPUT_BYTES);
	return out;
}

// parseAddnhosts(text) → [{ hostname, A:[], AAAA:[] }] (re-grouped by host)
export function parseAddnhosts(text) {
	const byHost = new Map();
	for (const line of String(text || '').split('\n')) {
		const l = line.trim();
		if (!l || l.startsWith('#')) continue;
		const parts = l.split(/\s+/);
		if (parts.length < 2) continue;
		const ip = parts[0];
		const host = parts[1];
		const fam = ip.includes(':') ? 'AAAA' : 'A';
		// validate lightly (reject garbage rather than crash)
		const v = normalizeAddress(ip, fam);
		if (!v.ok) continue;
		const vh = normalizeHostname(host);
		if (!vh.ok) continue;
		if (!byHost.has(vh.hostname)) byHost.set(vh.hostname, { hostname: vh.hostname, A: [], AAAA: [] });
		const rec = byHost.get(vh.hostname);
		if (!rec[fam].includes(v.address)) rec[fam].push(v.address);
	}
	return [...byHost.values()];
}

// ---------------------------------------------------------------------------
// status assembly (pure projection of dataset + state → UI-facing status)
// ---------------------------------------------------------------------------

// assembleStatus(dataset, state, opts) → status envelope for the UI/CLI.
// opts: { now?, mode?, advancedOptIn?, applyFamily? }
// mode: 'preview' adds a zero-writes preview block.
export function assembleStatus(dataset, state, opts) {
	opts = opts || {};
	const now = opts.now || '2026-07-30';
	const applyFamily = opts.applyFamily || 'A';
	const vd = validateDataset(dataset);
	const datasetValid = vd.ok;
	const profiles = vd.ok ? vd.profiles : [];
	const providers = vd.ok ? vd.providers : [];

	// group profiles by service + classify
	const byService = {};
	const warnings = [];
	for (const p of profiles) {
		const trust = classifyTrust(
			providers.find(pr => pr.id === p.providerId) || { trust: 'untrusted', expiresAt: null },
			{ now }
		);
		const comp = computeCompleteness(p);
		const desired = computeDesiredRecords(p.records, applyFamily);
		const applicable = trust.applicable && (applyFamily === 'A' ? comp.aCount > 0 : comp.aaaaCount > 0);
		if (!byService[p.serviceId]) byService[p.serviceId] = [];
		byService[p.serviceId].push({
			id: p.id,
			providerId: p.providerId,
			trust: trust,
			completeness: comp,
			applicable: applicable,
			unsupportedAaaa: desired.unsupported,
			records: p.records
		});
		if (comp.status === 'partial') warnings.push({ type: 'partial-profile', serviceId: p.serviceId, profileId: p.id, reason: 'profile does not cover all required domains' });
		if (!trust.applicable && trust.trust === 'experimental') warnings.push({ type: 'experimental-profile', serviceId: p.serviceId, profileId: p.id, reason: 'experimental — opt-in required' });
	}

	const serviceDns = (state && state.serviceDns) || {};
	const selections = serviceDns.selections || {};
	const applied = serviceDns.applied || {};
	// drift: desired selection != applied selection
	let drift = null;
	for (const [svc, prof] of Object.entries(selections)) {
		if (applied.selections && applied.selections[svc] !== prof) {
			drift = { serviceId: svc, desired: prof, applied: applied.selections[svc] || 'off' };
			break;
		}
	}

	const uiUnavailable = !datasetValid || profiles.length === 0;
	const events = (state && state.serviceDns && state.serviceDns.events) || [];
	const boundedEvents = events.slice(-10);

	const status = {
		ok: true,
		datasetValid,
		datasetVersion: dataset ? dataset.datasetVersion : null,
		uiUnavailable,
		services: byService,
		selections,
		applied: applied.selections || {},
		appliedAt: applied.generatedAt || null,
		drift,
		warnings,
		events: boundedEvents,
		state: state || {},
		mode: opts.mode || 'status'
	};
	if (opts.mode === 'preview') {
		status.preview = { ok: true, zeroWrites: true, note: 'preview performs no writes; call service_dns_apply to commit' };
	}
	return status;
}
