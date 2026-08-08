// dnsprov-logic.test.mjs — DNS providers + component diagnostics (Phase E).
// Run: node --test tests/dnsprov-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	validateProvider, validateProviders, componentReport,
	classifyProviderProbe, suspicionAssessment, parseBusyboxNslookup, summarizeAttempts
} from './lib/dnsprov-logic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_PATH = join(HERE, '..', 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'catalog', 'dns-providers.json');
const NSLOOKUP_FIXTURES = JSON.parse(readFileSync(join(HERE, 'fixtures', 'dnsprov-nslookup-fixtures.json'), 'utf8'));

test('the SHIPPED provider catalog passes validation (bundled providers, honest DoH-as-data notes)', () => {
	const doc = JSON.parse(readFileSync(PROVIDERS_PATH, 'utf8'));
	const r = validateProviders(doc);
	assert.deepEqual(r.errors, [], 'shipped providers must be valid: ' + r.errors.join('; '));
	assert.equal(r.ok, true);
	assert.equal(Object.keys(r.byId).length, doc.providers.length);
	for (const id of ['cloudflare', 'google-dns', 'quad9', 'adguard', 'opendns', 'dnssb'])
		assert.ok(r.byId[id], 'missing provider ' + id);
	for (const p of doc.providers) {
		if (p.doh) assert.match(p.doh, /^https:\/\//, 'doh is an https URL (data only)');
		assert.match(p.notes, /Data only|no DoH activation|never activated/i, 'notes must state DoH is data, not activation');
	}
});

test('validateProvider: rejects malformed entries', () => {
	assert.ok(validateProvider(null).length > 0);
	assert.ok(validateProvider({ id: 'X' }).length > 0);
	assert.ok(validateProvider({ id: 'ok', name: 'Ok', category: 'teleport', reviewed: '2026-01-01', provenance: [{ source: 'x', url: 'https://x' }], ipv4: ['1.1.1.1'], notes: 'n' }).length > 0);
	assert.ok(validateProvider({ id: 'ok', name: 'Ok', category: 'anycast', reviewed: 'bad-date', provenance: [{ source: 'x', url: 'https://x' }], ipv4: ['1.1.1.1'], notes: 'n' }).length > 0);
	assert.ok(validateProvider({ id: 'ok', name: 'Ok', category: 'anycast', reviewed: '2026-01-01', provenance: [], ipv4: ['1.1.1.1'], notes: 'n' }).length > 0);
	assert.ok(validateProvider({ id: 'ok', name: 'Ok', category: 'anycast', reviewed: '2026-01-01', provenance: [{ source: 'x', url: 'https://x' }], ipv4: ['999.1.1.1'], notes: 'n' }).length > 0);
	assert.ok(validateProvider({ id: 'ok', name: 'Ok', category: 'anycast', reviewed: '2026-01-01', provenance: [{ source: 'x', url: 'https://x' }], ipv4: ['1.1.1.1'], doh: 'http://insecure.example', notes: 'n' }).length > 0);
});

test('validateProviders: duplicate ids and bad schema rejected', () => {
	const doc = JSON.parse(readFileSync(PROVIDERS_PATH, 'utf8'));
	const dup = JSON.parse(JSON.stringify(doc));
	dup.providers.push(dup.providers[0]);
	assert.equal(validateProviders(dup).ok, false);
	assert.equal(validateProviders({ schema: 99, providers: [] }).ok, false);
	assert.equal(validateProviders(null).ok, false);
});

// ---- component report ------------------------------------------------------------

test('componentReport: dnsmasq-only path clean; a running alternative resolver is a conflict', () => {
	const clean = componentReport([
		{ name: 'dnsmasq', initPresent: true, running: true, enabled: true, listeners: ['127.0.0.1:53', '192.168.1.1:53'], configOwner: 'openwrt-uci' },
		{ name: 'odhcpd', initPresent: true, running: true, enabled: true, listeners: [], configOwner: 'openwrt-uci' }
	]);
	assert.deepEqual(clean.likelyResolverPath, ['dnsmasq']);
	assert.equal(clean.conflicts.length, 0);

	const dirty = componentReport([
		{ name: 'dnsmasq', initPresent: true, running: true, enabled: true, listeners: ['127.0.0.1:53'], configOwner: 'openwrt-uci' },
		{ name: 'smartdns', initPresent: true, running: true, enabled: true, listeners: ['127.0.0.1:53'], configOwner: 'package' }
	]);
	assert.equal(dirty.conflicts.length, 1);
	assert.match(dirty.conflicts[0].reason, /REPLACE or bypass dnsmasq/);
});

// ---- probe classification (no false certainty) ----------------------------------------

test('classifyProviderProbe: reachability/consistency/divergence with honest confidence', () => {
	assert.equal(classifyProviderProbe({ reachable: false }).outcome, 'unreachable');
	assert.equal(classifyProviderProbe({ reachable: true, answered: false }).outcome, 'no-answer');
	const c = classifyProviderProbe({ reachable: true, answered: true, answerMatchesLocal: true });
	assert.equal(c.outcome, 'consistent');
	assert.equal(c.confidence, 'high');
	const d = classifyProviderProbe({ reachable: true, answered: true, answerMatchesLocal: false });
	assert.equal(d.outcome, 'divergent');
	assert.equal(d.confidence, 'low', 'divergence is LOW confidence — CDN anycast produces the same picture');
	assert.match(d.reason, /NOT automatically poisoning/);
});

test('suspicionAssessment: divergent answers → LOW confidence verdict, never an accusation', () => {
	const probes = [
		{ outcome: 'consistent' },
		{ outcome: 'divergent' }
	];
	const r = suspicionAssessment(probes);
	assert.equal(r.verdict, 'divergent');
	assert.equal(r.confidence, 'low');
	assert.match(r.reason, /legitimate CDN|same picture|LOW/i);
	assert.equal(suspicionAssessment([{ outcome: 'consistent' }]).verdict, 'consistent');
	assert.equal(suspicionAssessment([]).verdict, 'unknown');
	assert.equal(suspicionAssessment([{ outcome: 'unreachable' }]).verdict, 'partial');
});

test('BusyBox parser ignores resolver header and supports numbered answers', () => {
	assert.deepEqual(parseBusyboxNslookup(NSLOOKUP_FIXTURES.normalBusybox, '1.1.1.1'), ['93.184.216.34', '93.184.216.35']);
});

test('BusyBox parser returns no answer for timeout header and NXDOMAIN', () => {
	assert.deepEqual(parseBusyboxNslookup(NSLOOKUP_FIXTURES.timeoutWithHeader, '1.1.1.1'), []);
	assert.deepEqual(parseBusyboxNslookup(NSLOOKUP_FIXTURES.nxdomain, '1.1.1.1'), []);
});

test('provider summary checks secondary after primary failure and ignores ping-only failure', () => {
	const r = summarizeAttempts([
		{ resolverIp: '1.1.1.1', dnsAnswered: false, pingAnswered: false, timedOut: true, answers: [] },
		{ resolverIp: '1.0.0.1', dnsAnswered: true, pingAnswered: false, timedOut: false, answers: ['93.184.216.34'] }
	]);
	assert.equal(r.outcome, 'partial');
	assert.equal(r.working, false);
	assert.equal(summarizeAttempts([{ dnsAnswered: true, pingAnswered: false }]).outcome, 'working');
});
