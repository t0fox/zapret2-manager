// health-logic.test.mjs — Service Health Matrix v1 (Phase C).
// Run: node --test tests/health-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	pickProbeDomains, classifyCurlStage, classifyService,
	buildServiceResult, validateMatrixTargets, matrixSummary,
	evidenceBound, HEALTH_CLASSES, PROBE_TIMEOUT_SEC, SERVICE_BUDGET_SEC
} from './lib/health-logic.mjs';

const SVC = {
	youtube: { id: 'youtube', name: 'YouTube', category: 'video', domains: ['youtube.com', 'googlevideo.com', 'ytimg.com', 'youtube-nocookie.com'] },
	ai: { id: 'chatgpt-openai', name: 'ChatGPT', category: 'AI', domains: ['openai.com', 'chatgpt.com'] }
};

// ---- targets -------------------------------------------------------------------

test('pickProbeDomains bounds targets to catalog domains (max 2, no invention)', () => {
	assert.deepEqual(pickProbeDomains(SVC.youtube), ['youtube.com', 'googlevideo.com']);
	assert.deepEqual(pickProbeDomains(SVC.ai), ['openai.com', 'chatgpt.com']);
	assert.deepEqual(pickProbeDomains({ id: 'x', domains: [] }), []);
});

test('validateMatrixTargets: ledger-enabled default, explicit subset, unknown refused, cap enforced', () => {
	const services = [SVC.youtube, SVC.ai];
	let r = validateMatrixTargets(services, { enabled: ['youtube'] }, null);
	assert.deepEqual(r.targets.map((s) => s.id), ['youtube'], 'no requested ids → ledger enabled');
	r = validateMatrixTargets(services, { enabled: [] }, null);
	assert.equal(r.targets.length, 2, 'empty ledger → read-only sweep over the catalog');
	r = validateMatrixTargets(services, null, ['youtube']);
	assert.deepEqual(r.targets.map((s) => s.id), ['youtube']);
	r = validateMatrixTargets(services, null, ['ghost']);
	assert.equal(r.ok, false);
	r = validateMatrixTargets(Array.from({ length: 17 }, (_, i) => ({ id: 's' + i, domains: ['a' + i + '.com'] })), null, null);
	assert.equal(r.ok, false, 'cap at 16');
});

// ---- curl stage classification -------------------------------------------------------

test('classifyCurlStage: curl rc classes map to probe layers', () => {
	assert.deepEqual(classifyCurlStage(6, null).layer, 'dns');
	assert.deepEqual(classifyCurlStage(7, null).layer, 'connect');
	assert.deepEqual(classifyCurlStage(28, null).layer, 'timeout');
	assert.deepEqual(classifyCurlStage(35, null).layer, 'tls');
	assert.deepEqual(classifyCurlStage(60, null).layer, 'tls');
	assert.equal(classifyCurlStage(0, 200).outcome, 'ok');
	assert.equal(classifyCurlStage(0, 403).note, 'auth/region class response');
	assert.equal(classifyCurlStage(99, null).layer, 'unknown');
});

// ---- service classification --------------------------------------------------------------

test('classifyService: DNS failure stops at dns class', () => {
	const r = classifyService({ catalog: { domainsPresent: true }, dns: { ok: false } });
	assert.equal(r.class, 'dns');
});

test('classifyService: connect/TLS/HTTP layers reported distinctly', () => {
	const base = { catalog: { domainsPresent: true }, dns: { ok: true } };
	assert.equal(classifyService({ ...base, tcp: { rc: 7 }, tls: { rc: 7 }, http: { rc: 7 } }).class, 'connect');
	assert.equal(classifyService({ ...base, tcp: { rc: 0 }, tls: { rc: 35 }, http: { rc: 35 } }).class, 'tls');
	const r = classifyService({ ...base, tcp: { rc: 0 }, tls: { rc: 0 }, http: { rc: 0, httpCode: 200 } });
	assert.equal(r.class, 'reachable-http');
	assert.match(r.reason, /NOT a service-availability claim/, 'reachable-http is NOT a service-works verdict');
});

test('classifyService: 401/403 → possible-geo-account (honest, not certain)', () => {
	const r = classifyService({
		catalog: { domainsPresent: true }, dns: { ok: true },
		tcp: { rc: 0 }, tls: { rc: 0 }, http: { rc: 0, httpCode: 403 }
	});
	assert.equal(r.class, 'possible-geo-account');
	assert.match(r.reason, /not provable/);
});

test('classifyService: timeout and disabled-service skip paths', () => {
	const t = classifyService({
		catalog: { domainsPresent: true }, dns: { ok: true },
		tcp: { rc: 28 }, tls: { rc: 28 }, http: { rc: 28 }
	});
	assert.equal(t.class, 'unknown-timeout');
	const s = classifyService({ catalog: { domainsPresent: false }, dns: { ok: true } });
	assert.equal(s.class, 'skipped');
});

test('every produced class is inside the closed enum', () => {
	for (const c of [classifyService({ catalog: { domainsPresent: false }, dns: { ok: true } }),
		classifyService({ catalog: { domainsPresent: true }, dns: { ok: false } }),
		classifyService({ catalog: { domainsPresent: true }, dns: { ok: true }, tcp: { rc: 7 }, tls: { rc: 7 }, http: { rc: 7 } })]) {
		assert.ok(HEALTH_CLASSES.includes(c.class), c.class + ' must be in HEALTH_CLASSES');
	}
});

// ---- matrix rows + summary ------------------------------------------------------------------

test('buildServiceResult carries per-layer probes + enabled flag; matrixSummary counts by class', () => {
	const row = buildServiceResult(SVC.youtube, {
		catalog: { domainsPresent: true }, dns: { ok: true },
		tcp: { rc: 0 }, tls: { rc: 0 }, http: { rc: 0, httpCode: 200 },
		domains: ['youtube.com']
	}, true);
	assert.equal(row.enabledInLedger, true);
	assert.equal(row.class, 'reachable-http');
	const s = matrixSummary([row, { ...row, class: 'dns' }, { ...row, class: 'dns' }]);
	assert.equal(s.byClass['reachable-http'], 1);
	assert.equal(s.byClass.dns, 2);
	assert.match(s.note, /not service-availability/);
});

// ---- evidence bounds -----------------------------------------------------------------------------

test('evidenceBound: codes only, truncated, null-safe (no bodies/secrets)', () => {
	assert.equal(evidenceBound(null), null);
	assert.equal(evidenceBound(28), '28');
	assert.ok(evidenceBound('x'.repeat(500)).length < 180);
	assert.ok(evidenceBound('x'.repeat(500)).includes('[truncated]'));
});

// ---- policy constants -----------------------------------------------------------------------------

test('probe budgets are router-safe and documented', () => {
	assert.ok(PROBE_TIMEOUT_SEC <= 5, 'per-probe timeout bounded');
	assert.ok(SERVICE_BUDGET_SEC <= 30, 'per-service budget bounded');
});
