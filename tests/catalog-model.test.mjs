// catalog-model.test.mjs — Service Catalog schema/validation (Phase B1).
// Run: node --test tests/catalog-model.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CATALOG_SCHEMA, CATALOG_CATEGORIES, CATALOG_MECHANISMS,
	normalize_domain, validateCatalog, catalogDigest, serviceDomains,
	sha256hexNode, canonicalJson
} from './lib/catalog-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(HERE, '..', 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'catalog', 'services.json');

function loadCatalog() {
	return JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
}

// ---- shipped catalog is valid ------------------------------------------------

test('the SHIPPED catalog passes full validation (schema, ids, overlaps, digest)', () => {
	const doc = loadCatalog();
	const r = validateCatalog(doc, { now: '2026-07-28' });
	assert.deepEqual(r.errors, [], 'shipped catalog must be valid: ' + r.errors.join('; '));
	assert.equal(r.ok, true);
	assert.equal(r.digestOk, true, 'shipped digest must match content');
	assert.equal(doc.schema, CATALOG_SCHEMA);
	assert.ok(doc.services.length >= 11, 'at least 11 initial services');
});

test('shipped catalog: required services present with honest mechanisms', () => {
	const doc = loadCatalog();
	const ids = doc.services.map((s) => s.id);
	for (const id of ['youtube', 'discord', 'telegram-web', 'twitch', 'spotify', 'supercell', 'github', 'githubusercontent', 'chatgpt-openai', 'google-gemini', 'notion'])
		assert.ok(ids.includes(id), 'missing service ' + id);
	const ai = doc.services.find((s) => s.id === 'chatgpt-openai');
	assert.ok(ai.mechanisms.includes('unsupportedGeo'), 'AI service must declare unsupportedGeo honestly');
	assert.match(ai.limitations, /NOT bypass|GEO/i, 'AI limitation must state no GEO bypass');
	for (const s of doc.services) {
		for (const m of s.mechanisms) assert.ok(CATALOG_MECHANISMS.includes(m));
		assert.ok(CATALOG_CATEGORIES.includes(s.category));
		assert.ok(!s.mechanisms.includes('proxyRoute') || s.proxyRequirement, 'proxyRoute must carry an explicit requirement note');
	}
});

// ---- domain normalization ------------------------------------------------------

test('normalize_domain: rejects IPs, URLs, wildcards, shell chars, invalid hosts', () => {
	assert.equal(normalize_domain('YouTube.com').domain, 'youtube.com');
	assert.equal(normalize_domain('  a.b.co  ').domain, 'a.b.co');
	assert.equal(normalize_domain('192.0.2.1').ok, false, 'IPv4 rejected');
	assert.equal(normalize_domain('2001:db8::1').ok, false, 'IPv6 rejected');
	assert.equal(normalize_domain('https://x.com/y').ok, false, 'URL rejected');
	assert.equal(normalize_domain('x.com/path').ok, false, 'path rejected');
	assert.equal(normalize_domain('*.x.com').ok, false, 'wildcard rejected');
	assert.equal(normalize_domain('x.com; rm -rf /').ok, false, 'shell rejected');
	assert.equal(normalize_domain('x.com$(id)').ok, false, 'substitution rejected');
	assert.equal(normalize_domain("x.com'b").ok, false, 'quote rejected');
	assert.equal(normalize_domain('localhost').ok, false, 'single label rejected');
	assert.equal(normalize_domain('-bad.com').ok, false);
	assert.equal(normalize_domain('bad_domain.com').ok, false);
});

// ---- schema failures --------------------------------------------------------------

function baseCatalog() {
	const doc = loadCatalog();
	doc.services = doc.services.slice(0, 2);
	return doc;
}

test('validateCatalog: malformed documents fail closed', () => {
	assert.equal(validateCatalog(null).ok, false);
	assert.equal(validateCatalog([1, 2]).ok, false);
	const noSchema = baseCatalog(); delete noSchema.schema;
	assert.equal(validateCatalog(noSchema).ok, false);
	const noDigest = baseCatalog(); delete noDigest.digest;
	assert.equal(validateCatalog(noDigest).ok, false);
	const badDigest = baseCatalog(); badDigest.digest = '0'.repeat(64);
	const r = validateCatalog(badDigest);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.includes('digest mismatch')), 'tampered digest detected');
});

test('validateCatalog: duplicate service ids rejected', () => {
	const doc = baseCatalog();
	doc.services.push(JSON.parse(JSON.stringify(doc.services[0])));
	doc.digest = catalogDigest(doc);
	const r = validateCatalog(doc);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.includes('duplicate service id')));
});

test('validateCatalog: invalid domains rejected per service', () => {
	const doc = baseCatalog();
	doc.services[0].domains = ['ok.com', '192.0.2.1', '*.wild.com'];
	doc.digest = catalogDigest(doc);
	const r = validateCatalog(doc);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.includes('192.0.2.1')));
	assert.ok(r.errors.some((e) => e.includes('*.wild.com')));
});

test('validateCatalog: duplicate domains inside one service rejected', () => {
	const doc = baseCatalog();
	doc.services[0].domains = ['a.com', 'A.com'];
	doc.digest = catalogDigest(doc);
	const r = validateCatalog(doc);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.includes('duplicate domain a.com inside the service')));
});

test('validateCatalog: cross-service overlap is REPORTED (ledger resolves it), not fatal', () => {
	const doc = baseCatalog();
	doc.services[1].domains = [...doc.services[1].domains, doc.services[0].domains[0]];
	doc.digest = catalogDigest(doc);
	const r = validateCatalog(doc);
	assert.equal(r.ok, true, 'overlap alone is not fatal');
	assert.equal(r.overlaps.length, 1);
	assert.equal(r.overlaps[0].services.length, 2);
});

test('validateCatalog: stale/expired services flagged; unsupported mechanisms rejected', () => {
	const doc = baseCatalog();
	doc.services[0].stability = 'stale';
	doc.digest = catalogDigest(doc);
	let r = validateCatalog(doc, { now: '2026-07-28' });
	assert.ok(r.staleServices.includes(doc.services[0].id));

	const doc2 = baseCatalog();
	doc2.services[0].expires = '2026-01-01';
	doc2.digest = catalogDigest(doc2);
	r = validateCatalog(doc2, { now: '2026-07-28' });
	assert.ok(r.staleServices.includes(doc2.services[0].id), 'expired service flagged');

	const doc3 = baseCatalog();
	doc3.services[0].mechanisms = ['domainInclude', 'teleport'];
	doc3.digest = catalogDigest(doc3);
	r = validateCatalog(doc3);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.includes('unknown mechanism')));
});

test('digest is stable across re-serialization order (canonical form)', () => {
	const doc = loadCatalog();
	const d1 = catalogDigest(doc);
	const shuffled = JSON.parse(JSON.stringify(doc));
	shuffled.services = shuffled.services.slice().reverse();
	assert.equal(catalogDigest(shuffled), d1, 'canonical digest ignores service order');
});

test('canonicalJson: deterministic key order, minimal escaping, UTF-8 raw', () => {
	const a = canonicalJson({ b: 1, a: 'x—y…', c: ['z', 2, null] });
	assert.equal(a, '{"a":"x—y…","b":1,"c":["z",2,null]}');
	assert.equal(canonicalJson('a"b\\c'), '"a\\"b\\\\c"');
	assert.equal(canonicalJson('n'), '"n"');
});

test('serviceDomains normalizes once validated', () => {
	const svc = { domains: ['YouTube.com', 'googlevideo.com'] };
	assert.deepEqual(serviceDomains(svc), ['youtube.com', 'googlevideo.com']);
});
