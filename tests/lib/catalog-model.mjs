// catalog-model.mjs — node reference for the Service Catalog data model
// (Phase B). Mirrored by the shipped ucode catalog.uc.
//
// The catalog is a versioned, LOCAL, auditable package-owned dataset — not a
// remote updater and not a giant hosts replacement. Every service carries
// provenance and honest limitations. Mechanisms are DECLARED, never implied:
// proxyRoute/unsupportedGeo exist in the enum to say "not supported", never
// to pretend support.
//
// Schema v1. Validation is fail-closed: a malformed/duplicate/stale catalog
// must block mutation entirely (anti-wipe).

import { createHash } from 'node:crypto';

export const CATALOG_SCHEMA = 1;
export const CATALOG_CATEGORIES = ['video', 'messaging', 'social', 'games', 'AI', 'developer', 'music', 'media', 'other'];
export const CATALOG_MECHANISMS = ['domainInclude', 'domainExclude', 'dnsOverride', 'dnsProvider', 'proxyRoute', 'unsupportedGeo'];
export const CATALOG_STABILITY = ['reviewed', 'experimental', 'stale'];

export function sha256hexNode(text) {
	return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// Domain rules (catalog fields): full hostname, ≥2 labels, LDH charset, NO
// IPs (all-numeric labels), NO URLs/paths, NO wildcards, NO shell characters.
export function normalize_domain(d) {
	if (typeof d !== 'string') return { ok: false, reason: 'domain must be a string' };
	let s = d.trim().toLowerCase();
	if (s.startsWith('.')) s = s.slice(1);
	if (s === '') return { ok: false, reason: 'empty domain' };
	if (s.length > 253) return { ok: false, reason: 'domain too long (>253)' };
	if (s.includes('*')) return { ok: false, reason: 'wildcards are not catalog domains' };
	if (/[^a-z0-9.-]/.test(s)) return { ok: false, reason: 'invalid characters (URLs, paths, shell characters and spaces are rejected)' };
	const labels = s.split('.');
	if (labels.length < 2) return { ok: false, reason: 'need a full domain (at least two labels)' };
	let allNumeric = true;
	for (const l of labels) {
		if (l.length === 0 || l.length > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (l.startsWith('-') || l.endsWith('-')) return { ok: false, reason: 'labels must not start/end with a hyphen' };
		if (!/^\d+$/.test(l)) allNumeric = false;
	}
	if (allNumeric) return { ok: false, reason: 'IPs are not catalog domains (DNS-overrides own IPs, not services)' };
	return { ok: true, domain: s };
}

function isISODate(s) {
	return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// validateService(svc, index) → errors[]
function validateService(svc, index) {
	const errs = [];
	const at = `service[${index}]${svc && svc.id ? ' (' + svc.id + ')' : ''}`;
	const req = (cond, msg) => { if (!cond) errs.push(at + ': ' + msg); };
	if (!svc || typeof svc !== 'object' || Array.isArray(svc)) { errs.push(at + ': not an object'); return errs; }
	req(typeof svc.id === 'string' && /^[a-z0-9][a-z0-9-]{1,31}$/.test(svc.id), 'id must be 2..32 chars of a-z0-9-');
	req(typeof svc.name === 'string' && svc.name.length > 0 && svc.name.length <= 64, 'name must be 1..64 chars');
	req(CATALOG_CATEGORIES.includes(svc.category), 'category must be one of ' + CATALOG_CATEGORIES.join('/'));
	req(typeof svc.description === 'string' && svc.description.length > 0, 'description required');
	req(typeof svc.reviewed === 'string' && isISODate(svc.reviewed), 'reviewed must be an ISO date (YYYY-MM-DD)');
	req(Array.isArray(svc.provenance) && svc.provenance.length > 0, 'provenance[] required (source URLs)');
	if (Array.isArray(svc.provenance)) {
		for (const p of svc.provenance) {
			if (!p || typeof p.source !== 'string' || typeof p.url !== 'string' || !/^https:\/\//.test(p.url))
				errs.push(at + ': provenance entries need {source, url:https://…}');
		}
	}
	req(Array.isArray(svc.mechanisms) && svc.mechanisms.length > 0, 'mechanisms[] required');
	if (Array.isArray(svc.mechanisms)) {
		for (const m of svc.mechanisms) {
			if (!CATALOG_MECHANISMS.includes(m)) errs.push(at + ': unknown mechanism ' + JSON.stringify(m));
		}
	}
	req(typeof svc.limitations === 'string' && svc.limitations.length > 0, 'limitations text required (honest bounds)');
	req(CATALOG_STABILITY.includes(svc.stability), 'stability must be reviewed/experimental/stale');
	req(Array.isArray(svc.domains) && svc.domains.length > 0, 'domains[] required');
	if (Array.isArray(svc.domains)) {
		const seen = new Set();
		for (const d of svc.domains) {
			const nd = normalize_domain(d);
			if (!nd.ok) { errs.push(at + ': ' + JSON.stringify(d) + ' — ' + nd.reason); continue; }
			if (seen.has(nd.domain)) errs.push(at + ': duplicate domain ' + nd.domain + ' inside the service');
			seen.add(nd.domain);
		}
	}
	// optional blocks (shape-checked only when present)
	if (svc.dnsMappings != null && !Array.isArray(svc.dnsMappings)) errs.push(at + ': dnsMappings must be an array when present');
	if (svc.strategyRefs != null && !Array.isArray(svc.strategyRefs)) errs.push(at + ': strategyRefs must be an array when present');
	if (svc.proxyRequirement != null && typeof svc.proxyRequirement !== 'string') errs.push(at + ': proxyRequirement must be a string when present');
	if (svc.minUpstream != null && typeof svc.minUpstream !== 'string') errs.push(at + ': minUpstream must be a string');
	if (svc.minManager != null && typeof svc.minManager !== 'string') errs.push(at + ': minManager must be a string');
	if (svc.expires != null && !isISODate(svc.expires)) errs.push(at + ': expires must be an ISO date');
	return errs;
}

// validateCatalog(doc, { now }) → { ok, errors, overlaps, staleServices }
// Whole-document gate: schema, per-service rules, duplicate ids, cross-service
// domain overlaps (reported, not fatal — the ownership ledger resolves them),
// digest fields, staleness flagging.
export function validateCatalog(doc, opts = {}) {
	const errors = [];
	if (!doc || typeof doc !== 'object' || Array.isArray(doc))
		return { ok: false, errors: ['catalog document is not an object'], overlaps: [], staleServices: [] };
	if (doc.schema !== CATALOG_SCHEMA) errors.push('schema must be ' + CATALOG_SCHEMA);
	if (typeof doc.catalogVersion !== 'string' || doc.catalogVersion === '') errors.push('catalogVersion required');
	if (typeof doc.digest !== 'string' || !/^[0-9a-f]{64}$/.test(doc.digest)) errors.push('digest must be a sha256 hex');
	if (!Array.isArray(doc.services)) errors.push('services must be an array');
	const services = Array.isArray(doc.services) ? doc.services : [];
	const ids = new Set();
	for (let i = 0; i < services.length; i++) {
		const svc = services[i];
		errors.push(...validateService(svc, i));
		if (svc && typeof svc.id === 'string') {
			if (ids.has(svc.id)) errors.push('duplicate service id: ' + svc.id);
			ids.add(svc.id);
		}
	}
	// cross-service domain overlaps (informational — ledger resolves ownership)
	const owner = new Map();
	const overlaps = [];
	for (const svc of services) {
		if (!svc || !Array.isArray(svc.domains)) continue;
		for (const d of svc.domains) {
			const nd = normalize_domain(d);
			if (!nd.ok) continue;
			if (owner.has(nd.domain) && owner.get(nd.domain) !== svc.id)
				overlaps.push({ domain: nd.domain, services: [owner.get(nd.domain), svc.id] });
			else owner.set(nd.domain, svc.id);
		}
	}
	// digest verification: digest covers {schema, catalogVersion, services}
	let digestOk = false;
	if (typeof doc.digest === 'string' && /^[0-9a-f]{64}$/.test(doc.digest)) {
		digestOk = catalogDigest(doc) === doc.digest;
		if (!digestOk) errors.push('digest mismatch (catalog content tampered or stale digest)');
	}
	// staleness: expires in the past or stability 'stale'
	const now = opts.now || null;
	const staleServices = [];
	for (const svc of services) {
		if (!svc || typeof svc.id !== 'string') continue;
		if (svc.stability === 'stale') staleServices.push(svc.id);
		else if (now && svc.expires && svc.expires < now) staleServices.push(svc.id);
	}
	return { ok: errors.length === 0, errors, overlaps, staleServices, digestOk };
}

// catalogDigest(doc) — canonical digest over {schema, catalogVersion,
// services}. Canonicalization is CUSTOM (canonicalJson below), NOT
// JSON.stringify: key order and array order are normalized, and the string
// escaping is the minimal JSON set (\", \\, control) with UTF-8 left RAW —
// the ucode port produces byte-identical output by construction (ucode
// sprintf("%J") escapes non-ASCII as \uXXXX, which would silently fork the
// digest between implementations — learned from the backup manifest drill).
export function catalogDigest(doc) {
	const canonical = canonicalServices(doc.services || []);
	return sha256hexNode(canonicalJson({ schema: doc.schema, catalogVersion: doc.catalogVersion, services: canonical }));
}

// canonicalJson(v) — deterministic JSON: object keys sorted, minimal string
// escaping (only ", \, and C0 controls as \uXXXX), UTF-8 raw. Node and
// ucode mirrors MUST produce identical bytes for identical values.
export function canonicalJson(v) {
	if (v === null || v === undefined) return 'null';
	if (typeof v === 'number') return String(v);
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'string') return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\x00-\x1f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
	if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
	if (typeof v === 'object') {
		const keys = Object.keys(v).sort();
		return '{' + keys.map((k) => canonicalJson(k) + ':' + canonicalJson(v[k])).join(',') + '}';
	}
	return 'null';
}

function canonicalServices(services) {
	const out = [];
	for (const svc of services) {
		const c = {};
		for (const k of Object.keys(svc).sort()) {
			const v = svc[k];
			if (k === 'domains' && Array.isArray(v)) c[k] = v.map((d) => normalize_domain(d).ok ? normalize_domain(d).domain : d).sort();
			else if (k === 'mechanisms' && Array.isArray(v)) c[k] = v.slice().sort();
			else if (k === 'provenance' && Array.isArray(v)) c[k] = v.map((p) => ({ source: p.source, url: p.url })).sort((a, b) => a.url < b.url ? -1 : 1);
			else c[k] = v;
		}
		out.push(c);
	}
	out.sort((a, b) => (a.id < b.id ? -1 : 1));
	return out;
}

// serviceDomains(svc) → normalized domain list (validated catalogs only).
export function serviceDomains(svc) {
	const out = [];
	for (const d of svc.domains || []) {
		const nd = normalize_domain(d);
		if (nd.ok) out.push(nd.domain);
	}
	return out;
}
