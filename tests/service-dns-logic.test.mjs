// service-dns-logic.test.mjs — 55-case verification suite for the Per-Service
// DNS slice's pure reference logic. Grounding: the dataset/profile model and
// ownership semantics are pure; live DNS apply is supervised-only (see
// docs/contracts/service-dns.md). No router mutations in this suite.
//
// Run: node --test tests/service-dns-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as serviceDnsLogic from './lib/service-dns-logic.mjs';
import {
	validateDataset, validateProvider, validateProfile,
	normalizeHostname, normalizeAddress, normalizeRecord,
	computeCompleteness, classifyTrust, classifyStaleness,
	computeDesiredRecords, computeRecordOwnership, buildPreview,
	renderAddnhosts, parseAddnhosts, assembleStatus,
	KNOWN_SERVICE_IDS
} from './lib/service-dns-logic.mjs';

// ---- fixtures --------------------------------------------------------------
function baseProvider(overrides = {}) {
	return {
		id: 'prov-a',
		name: 'Provider A',
		sourceUrl: 'https://example.com/prov-a',
		sourceRevision: 'abc123',
		sourceHash: 'sha256:' + 'a'.repeat(64),
		reviewedAt: '2026-07-28',
		expiresAt: '2027-07-30',
		trust: 'bundled-reviewed',
		notes: 'test provider',
		...overrides
	};
}
function baseProfile(overrides = {}) {
	return {
		id: 'prof-1',
		providerId: 'prov-a',
		serviceId: 'youtube',
		requiredDomains: ['youtube.com'],
		optionalDomains: [],
		diagnosticTargets: ['youtube.com'],
		records: [{ hostname: 'youtube.com', A: ['1.2.3.4'], AAAA: [] }],
		notes: '',
		limitations: '',
		...overrides
	};
}
function baseDataset(overrides = {}) {
	return {
		schemaVersion: overrides.schemaVersion != null ? overrides.schemaVersion : 1,
		datasetVersion: '1.0.0',
		generatedAt: '2026-07-30T00:00:00Z',
		providers: overrides.providers || [baseProvider()],
		profiles: overrides.profiles || [baseProfile()]
	};
}
function baseState(overrides = {}) {
	return {
		serviceDns: {
			selections: {},
			applied: { selections: {}, generatedAt: null, revision: 0, fileHash: null },
			ownership: {},
			events: [],
			...(overrides.serviceDns || {})
		},
		...(overrides.catalog ? { catalog: overrides.catalog } : {}),
		...(overrides.proxy ? { proxy: overrides.proxy } : {})
	};
}

// ---- 1..5 dataset validation ----------------------------------------------
test('1. valid dataset', () => {
	const r = validateDataset(baseDataset());
	assert.ok(r.ok, JSON.stringify(r.errors));
	assert.equal(r.providersValid, 1);
	assert.equal(r.profilesValid, 1);
});
test('2. schemaVersion mismatch', () => {
	const r = validateDataset(baseDataset({ schemaVersion: 99 }));
	assert.ok(!r.ok);
	assert.ok(r.errors.some(e => e.reason.includes('schemaVersion')));
});
test('3. duplicate provider ID', () => {
	const r = validateDataset(baseDataset({ providers: [baseProvider(), baseProvider({ name: 'B' })] }));
	assert.ok(!r.ok);
	assert.ok(r.errors.some(e => e.reason.includes('duplicate provider id')));
});
test('4. duplicate profile ID', () => {
	const r = validateDataset(baseDataset({ profiles: [baseProfile(), baseProfile({ providerId: 'prov-a' })] }));
	assert.ok(!r.ok);
	assert.ok(r.errors.some(e => e.reason.includes('duplicate profile id')));
});
test('5. unknown service ID', () => {
	const r = validateDataset(baseDataset({ profiles: [baseProfile({ serviceId: 'totally-fake' })] }));
	assert.ok(!r.ok);
	assert.ok(r.errors.some(e => e.reason.includes('unknown serviceId')));
});

// ---- 6..17 validation edge cases -----------------------------------------
test('6. invalid hostname', () => {
	assert.ok(!normalizeHostname('not valid!').ok);
});
test('7. URL instead of hostname', () => {
	assert.ok(!normalizeHostname('http://example.com').ok);
	assert.ok(!normalizeHostname('https://example.com/path').ok);
});
test('8. shell/whitespace injection', () => {
	assert.ok(!normalizeHostname('example.com; rm -rf /').ok);
	assert.ok(!normalizeHostname('example.com && cat /etc/shadow').ok);
	assert.ok(!normalizeHostname('example.com\n').ok);
	assert.ok(!normalizeHostname('example\t.com').ok);
});
test('9. invalid IPv4', () => {
	assert.ok(!normalizeAddress('1.2.3', 'A').ok);
	assert.ok(!normalizeAddress('1.2.3.4.5', 'A').ok);
	assert.ok(!normalizeAddress('256.1.1.1', 'A').ok);
	assert.ok(!normalizeAddress('1.2.3.abc', 'A').ok);
});
test('10. invalid IPv6', () => {
	assert.ok(!normalizeAddress('gggg::1', 'AAAA').ok);
	assert.ok(!normalizeAddress('::1::1', 'AAAA').ok);
	assert.ok(!normalizeAddress('not-an-ipv6', 'AAAA').ok);
});
test('11. private IPv4 rejected', () => {
	assert.ok(!normalizeAddress('10.0.0.1', 'A').ok);
	assert.ok(!normalizeAddress('192.168.1.1', 'A').ok);
	assert.ok(!normalizeAddress('172.16.0.1', 'A').ok);
	assert.ok(!normalizeAddress('100.64.0.1', 'A').ok); // CGNAT
});
test('12. loopback rejected', () => {
	assert.ok(!normalizeAddress('127.0.0.1', 'A').ok);
});
test('13. link-local rejected', () => {
	assert.ok(!normalizeAddress('169.254.1.1', 'A').ok);
	assert.ok(!normalizeAddress('fe80::1', 'AAAA').ok);
});
test('14. multicast rejected', () => {
	assert.ok(!normalizeAddress('224.0.0.1', 'A').ok);
	assert.ok(!normalizeAddress('ff00::1', 'AAAA').ok);
});
test('15. TEST-NET/documentation rejected', () => {
	assert.ok(!normalizeAddress('192.0.2.1', 'A').ok);   // TEST-NET-1
	assert.ok(!normalizeAddress('198.51.100.1', 'A').ok); // TEST-NET-2
	assert.ok(!normalizeAddress('203.0.113.1', 'A').ok); // TEST-NET-3
	assert.ok(!normalizeAddress('2001:db8::1', 'AAAA').ok);
});
test('16. multiple A records', () => {
	const r = normalizeRecord({ hostname: 'example.com', A: ['1.2.3.4', '5.6.7.8'], AAAA: [] });
	assert.ok(r.ok);
	assert.equal(r.record.A.length, 2);
});
test('17. multiple AAAA records', () => {
	const r = normalizeRecord({ hostname: 'example.com', A: [], AAAA: ['2606:4700:4700::1111', '2606:4700:4700::1001'] });
	assert.ok(r.ok);
	assert.equal(r.record.AAAA.length, 2);
});

// ---- 18..22 completeness & staleness --------------------------------------
test('18. deterministic ordering', () => {
	const recs = [
		{ hostname: 'z.example.com', A: ['3.3.3.3'], AAAA: [] },
		{ hostname: 'a.example.com', A: ['1.1.1.1'], AAAA: [] },
		{ hostname: 'm.example.com', A: ['2.2.2.2'], AAAA: [] }
	];
	assert.equal(renderAddnhosts(recs), renderAddnhosts(recs.slice().reverse()));
});
test('19. complete required coverage', () => {
	const p = baseProfile({ requiredDomains: ['a.com', 'b.com'], records: [
		{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] },
		{ hostname: 'b.com', A: ['5.6.7.8'], AAAA: [] }
	] });
	assert.equal(computeCompleteness(p).status, 'complete');
});
test('20. partial required coverage', () => {
	const p = baseProfile({ requiredDomains: ['a.com', 'b.com'], records: [
		{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] }
	] });
	const c = computeCompleteness(p);
	assert.equal(c.status, 'partial');
	assert.ok(c.missingRequired.includes('b.com'));
});
test('21. missing optional stays complete', () => {
	const p = baseProfile({ requiredDomains: ['a.com'], optionalDomains: ['b.com'], records: [
		{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] }
	] });
	assert.equal(computeCompleteness(p).status, 'complete');
});
test('22. expired profile refusal', () => {
	const prov = baseProvider({ expiresAt: '2020-01-01' });
	const t = classifyTrust(prov, { now: '2026-07-30' });
	assert.ok(!t.applicable);
	assert.ok(t.reason.includes('expired'));
});

// ---- 23..26 trust & IPv4/IPv6 --------------------------------------------
test('23. untrusted profile refusal', () => {
	const t = classifyTrust(baseProvider({ trust: 'untrusted' }), { now: '2026-07-30' });
	assert.ok(!t.applicable);
	assert.ok(t.reason.includes('untrusted'));
});
test('24. experimental requires opt-in', () => {
	const t = classifyTrust(baseProvider({ trust: 'experimental' }), { now: '2026-07-30' });
	assert.ok(!t.applicable);
	assert.ok(t.warning);
	assert.ok(t.reason.includes('experimental'));
});
test('25. IPv4 target preserves but does not apply AAAA', () => {
	const desired = computeDesiredRecords(
		[{ hostname: 'example.com', A: ['1.2.3.4'], AAAA: ['2606:4700::1'] }], 'A'
	);
	assert.ok(desired.records.some(r => r.A.includes('1.2.3.4')));
	assert.ok(desired.unsupported.includes('2606:4700::1'));
	// AAAA not in applied records
	assert.ok(!desired.records.some(r => r.AAAA && r.AAAA.length));
});
test('26. existing user record preserved', () => {
	const existing = [{ hostname: 'user.com', A: ['9.9.9.9'], AAAA: [], owner: 'user' }];
	const service = [{ hostname: 'svc.com', A: ['1.2.3.4'], AAAA: [], owner: 'service:prof-1' }];
	const preview = buildPreview(existing, service);
	assert.ok(preview.preserved.some(r => r.hostname === 'user.com'));
	assert.ok(!preview.removed.some(r => r.hostname === 'user.com'));
});

// ---- 27..33 ownership model ----------------------------------------------
test('27. preexisting user record not claimed', () => {
	const existing = [{ hostname: 'keep.com', A: ['9.9.9.9'], AAAA: [], owner: 'user' }];
	const service = [{ hostname: 'keep.com', A: ['9.9.9.9'], AAAA: [], owner: 'service:prof-1' }];
	const preview = buildPreview(existing, service);
	// the user record is preserved and NOT claimed by the service — ownership
	// stays 'user' (anti-wipe: a preexisting record is never re-homed)
	assert.deepEqual(preview.ownership['keep.com']['9.9.9.9'].A, ['user']);
});
test('28. shared ownership', () => {
	const s1 = [{ hostname: 'shared.com', A: ['1.2.3.4'], AAAA: [], owner: 'service:prof-1' }];
	const s2 = [{ hostname: 'shared.com', A: ['1.2.3.4'], AAAA: [], owner: 'service:prof-2' }];
	const preview = buildPreview([], [...s1, ...s2]);
	const owners = preview.ownership['shared.com']['1.2.3.4'].A;
	assert.ok(owners.includes('service:prof-1'));
	assert.ok(owners.includes('service:prof-2'));
});
test('29. service enable adds records', () => {
	const service = [{ hostname: 'svc.com', A: ['1.2.3.4'], AAAA: [], owner: 'service:prof-1' }];
	const preview = buildPreview([], service);
	assert.equal(preview.added.length, 1);
	assert.equal(preview.removed.length, 0);
});
test('30. service disable removes only owned records', () => {
	const existing = [
		{ hostname: 'svc.com', A: ['1.2.3.4'], AAAA: [], owner: 'service:prof-1' },
		{ hostname: 'user.com', A: ['9.9.9.9'], AAAA: [], owner: 'user' }
	];
	const preview = buildPreview(existing, []);
	assert.ok(preview.removed.some(r => r.hostname === 'svc.com'));
	assert.ok(!preview.removed.some(r => r.hostname === 'user.com'));
	assert.ok(preview.preserved.some(r => r.hostname === 'user.com'));
});
test('31. profile switch removes old adds new', () => {
	const oldP = [{ hostname: 'old.com', A: ['1.1.1.1'], AAAA: [], owner: 'service:prof-old' }];
	const newP = [{ hostname: 'new.com', A: ['2.2.2.2'], AAAA: [], owner: 'service:prof-new' }];
	const preview = buildPreview(oldP, newP);
	assert.ok(preview.removed.some(r => r.hostname === 'old.com'));
	assert.ok(preview.added.some(r => r.hostname === 'new.com'));
});
test('32. duplicate record deduplication', () => {
	const r = normalizeRecord({ hostname: 'dup.com', A: ['1.2.3.4'], AAAA: [] });
	assert.ok(r.ok);
	const rendered = renderAddnhosts([r.record, r.record, r.record]);
	assert.equal(rendered.trim().split('\n').length, 1);
});
test('33. failed-state-read anti-wipe', () => {
	const preview = buildPreview(null, [], { stateReadFailed: true });
	assert.ok(!preview.ok);
	assert.equal(preview.error.code, 'ESTATE');
});

// ---- 34..38 conflict detection ------------------------------------------
test('34. failed-file-read anti-wipe', () => {
	const preview = buildPreview(null, [], { fileReadFailed: true });
	assert.ok(!preview.ok);
	assert.equal(preview.error.code, 'ETARGET');
});
test('35. draft optimistic conflict', () => {
	const state = baseState({ serviceDns: { applied: { revision: 2 } } });
	const r = computeRecordOwnership(state, [], { revision: 1 });
	assert.ok(!r.ok);
	assert.equal(r.error.code, 'ECONFLICT');
});
test('36. file-hash conflict', () => {
	const state = baseState({ serviceDns: { applied: { revision: 1, fileHash: 'abc' } } });
	const r = computeRecordOwnership(state, [], { expectedFileHash: 'def' });
	assert.ok(!r.ok);
	assert.equal(r.error.code, 'ECONFLICT');
});
test('37. preview performs zero writes', () => {
	const status = assembleStatus(baseDataset(), baseState(), { mode: 'preview' });
	assert.ok(status.preview);
	assert.ok(status.preview.zeroWrites);
});
test('38. atomic write produces clean file', () => {
	const recs = [{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] }];
	const rendered = renderAddnhosts(recs);
	assert.ok(rendered.endsWith('\n'));
	assert.ok(!rendered.includes('#'));
});

// ---- 39..43 apply verification (pure-logic projection) -------------------
test('39. reread membership verification', () => {
	const rendered = renderAddnhosts([{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] }]);
	const parsed = parseAddnhosts(rendered);
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].hostname, 'a.com');
	assert.equal(parsed[0].A[0], '1.2.3.4');
});
test('40. local resolver verification (expected in desired set)', () => {
	const desired = computeDesiredRecords([{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] }], 'A');
	assert.ok(desired.records.some(r => r.hostname === 'a.com' && r.A.includes('1.2.3.4')));
});
test('41. resolver failure rollback', () => {
	const r = computeRecordOwnership(baseState(), [], { resolveFailed: true });
	assert.ok(!r.ok);
	assert.equal(r.error.code, 'ETARGET');
});
test('42. state-write failure rollback', () => {
	const r = computeRecordOwnership(baseState({ serviceDns: { applied: { revision: 1 } } }), [], { stateWriteFailed: true });
	assert.ok(!r.ok);
	assert.equal(r.error.code, 'ESTATE');
});
test('43. dnsmasq reload failure rollback', () => {
	const r = computeRecordOwnership(baseState(), [], { reloadFailed: true });
	assert.ok(!r.ok);
	assert.equal(r.error.code, 'ETARGET');
});

// ---- 44..48 coexistence & bounds ----------------------------------------
test('44. rollback failure reported critical', () => {
	const r = computeRecordOwnership(baseState(), [], { rollbackFailed: true });
	assert.ok(!r.ok);
	assert.equal(r.error.code, 'ECRITICAL');
});
test('45. existing DNS override coexistence', () => {
	const existing = [{ hostname: 'override.com', A: ['5.5.5.5'], AAAA: [], owner: 'user' }];
	const service = [{ hostname: 'svc.com', A: ['1.2.3.4'], AAAA: [], owner: 'service:prof-1' }];
	const preview = buildPreview(existing, service);
	assert.ok(preview.preserved.some(r => r.hostname === 'override.com'));
	assert.ok(!preview.removed.some(r => r.hostname === 'override.com'));
});
test('46. catalog state preserved', () => {
	const state = baseState({ catalog: { version: '1.0.0' } });
	const status = assembleStatus(baseDataset(), state, {});
	assert.equal(status.state.catalog.version, '1.0.0');
});
test('47. proxy state preserved', () => {
	const state = baseState({ proxy: { enabled: true } });
	const status = assembleStatus(baseDataset(), state, {});
	assert.equal(status.state.proxy.enabled, true);
});
test('48. oversized dataset', () => {
	const providers = Array.from({ length: 65 }, (_, i) => baseProvider({ id: 'p' + i, name: 'P' + i }));
	const r = validateDataset(baseDataset({ providers }));
	assert.ok(!r.ok);
	assert.ok(r.errors.some(e => e.reason.includes('too many providers')));
});

// ---- 49..55 edge cases & UI states -------------------------------------
test('49. oversized output bounded', () => {
	const recs = Array.from({ length: 300 }, (_, i) => ({ hostname: 'x' + i + '.com', A: ['1.2.3.' + (i % 256)], AAAA: [] }));
	const rendered = renderAddnhosts(recs);
	const lines = rendered.trim().split('\n');
	assert.ok(lines.length <= 256, 'output lines must be bounded (got ' + lines.length + ')');
});
test('50. event data safety (bounded tail)', () => {
	const state = baseState({ serviceDns: { events: Array.from({ length: 20 }, (_, i) => ({ i })) } });
	const status = assembleStatus(baseDataset(), state, {});
	assert.ok(Array.isArray(status.events));
	assert.ok(status.events.length <= 10);
});
test('51. ui unavailable state', () => {
	const status = assembleStatus(baseDataset({ providers: [], profiles: [] }), baseState(), {});
	assert.ok(status.uiUnavailable);
});
test('52. ui partial-profile warning', () => {
	const ds = baseDataset({ profiles: [baseProfile({ requiredDomains: ['a.com', 'b.com'], records: [
		{ hostname: 'a.com', A: ['1.2.3.4'], AAAA: [] }
	] })] });
	const status = assembleStatus(ds, baseState(), {});
	assert.ok(status.warnings.some(w => w.type === 'partial-profile'));
});
test('53. ui drift state', () => {
	const state = baseState({ serviceDns: {
		selections: { youtube: 'prof-1' },
		applied: { selections: { youtube: 'prof-old' }, revision: 1 }
	} });
	const status = assembleStatus(baseDataset(), state, {});
	assert.ok(status.drift);
	assert.equal(status.drift.serviceId, 'youtube');
});
test('54. read/write ACL separation in final wiring', () => {
	const acl = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf-8'));
	const read = acl['zapret2-manager'].read.ubus['zapret2-manager'];
	const write = acl['zapret2-manager'].write.ubus['zapret2-manager'];
	for (const m of ['service_dns_providers', 'service_dns_status', 'service_dns_preview', 'service_dns_check'])
		assert.ok(read.includes(m), 'read ACL missing ' + m);
	for (const m of ['service_dns_set', 'service_dns_apply', 'service_dns_rollback'])
		assert.ok(write.includes(m), 'write ACL missing ' + m);
});
test('55. package contents in final wiring', () => {
	const makefile = readFileSync('zapret2-manager/Makefile', 'utf-8');
	assert.ok(makefile.includes('service-dns.uc'), 'Makefile missing service-dns.uc');
	assert.ok(makefile.includes('service-dns-cli.uc'), 'Makefile missing service-dns-cli.uc');
	assert.ok(makefile.includes('catalog/service-dns-profiles.json'), 'Makefile missing profiles catalog');
});

test('56. native server ownership preserves external values byte-for-byte', () => {
	assert.equal(typeof serviceDnsLogic.calculateServerOwnership, 'function');
	const result = serviceDnsLogic.calculateServerOwnership(
		['/custom.example/1.1.1.1#53', '/custom.example/2.2.2.2@wan', '//', '/domain/#'],
		[],
		['/Gemini.Google.Com/83.220.169.155']
	);
	assert.deepEqual(result.resultingEntries, [
		'/custom.example/1.1.1.1#53', '/custom.example/2.2.2.2@wan', '//', '/domain/#',
		'/gemini.google.com/83.220.169.155'
	]);
	assert.deepEqual(result.managedServerEntries, ['/gemini.google.com/83.220.169.155']);
});

test('57. matching user route is externally satisfied and never claimed', () => {
	const result = serviceDnsLogic.calculateServerOwnership(
		['/gemini.google.com/83.220.169.155'], [], ['/gemini.google.com/83.220.169.155']
	);
	assert.deepEqual(result.managedServerEntries, []);
	assert.deepEqual(result.externallySatisfiedEntries, ['/gemini.google.com/83.220.169.155']);
	assert.deepEqual(result.resultingEntries, ['/gemini.google.com/83.220.169.155']);
});

test('58. previous manager routes are removed only when no longer desired', () => {
	const old = '/chatgpt.com/83.220.169.155';
	const next = '/chatgpt.com/212.109.195.93';
	const result = serviceDnsLogic.calculateServerOwnership([old, '/user.example/9.9.9.9#53'], [old], [next]);
	assert.deepEqual(result.externalEntries, ['/user.example/9.9.9.9#53']);
	assert.deepEqual(result.managedServerEntries, [next]);
	assert.deepEqual(result.resultingEntries, ['/user.example/9.9.9.9#53', next]);
});

test('59. All Off preserves external list and removes exact manager entries', () => {
	const owned = '/gemini.google.com/83.220.169.155';
	const result = serviceDnsLogic.calculateServerOwnership(['/user.example/1.1.1.1#5353', owned], [owned], []);
	assert.deepEqual(result.resultingEntries, ['/user.example/1.1.1.1#5353']);
	assert.deepEqual(result.managedServerEntries, []);
});
