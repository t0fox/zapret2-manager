import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VIEW = path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const source = fs.readFileSync(path.join(VIEW, 'z2m-scanner-product.js'), 'utf8');
const scannerSource = fs.readFileSync(path.join(VIEW, 'z2m-scanner.js'), 'utf8');
const strategiesSource = fs.readFileSync(path.join(VIEW, 'z2m-strategies.js'), 'utf8');
const HISTORY_SCHEMA = 'z2m-detect-history.v1';

function node(tag, attrs, children) {
	if (typeof attrs === 'string' || Array.isArray(attrs)) {
		children = attrs;
		attrs = {};
	}
	return {
		tag,
		attrs: attrs || {},
		children: Array.isArray(children) ? children.filter(Boolean) : children == null ? [] : [children],
		addEventListener() {},
		appendChild(child) { this.children.push(child); },
		replaceChildren(...values) { this.children = values.filter(Boolean); }
	};
}

function storage(value) {
	let current = value;
	return {
		getItem() { return current; },
		setItem(_key, next) { current = String(next); },
		removeItem() { current = null; }
	};
}

function loadProduct(history) {
	const product = loadLuCIModule(source, 'view.zapret2-manager.z2m-scanner-product', {
		baseclass,
		'view.zapret2-manager.z2m-icons': { wrappedNode: () => node('icon') },
		'view.zapret2-manager.z2m-scanner': { load: () => Promise.resolve({}), render: () => node('scanner'), mount() {}, unmount() {} }
	}, {
		globals: {
			E: node,
			sessionStorage: storage(JSON.stringify(history)),
			window: undefined
		}
	});
	return product.load({ routeParams: { tab: 'history' }, api: { normalizeError: error => ({ message: String(error) }) } });
}

function typedHistory(data = { verdict: 'clear', additive: { latencyMs: 12 } }, options = {}) {
  const operation = options.operation || 'probe';
  const request = options.request || { operation, domain: 'youtube.com', timeoutMs: 6000 };
  return {
		schema: HISTORY_SCHEMA,
		id: 'detect-typed-1',
		status: 'completed',
		createdAt: '2026-09-07T07:00:00.000Z',
    request,
    operation,
    provenance: { source: 'z2k-detect', schema: HISTORY_SCHEMA, operation },
    report: { typedDetect: true, operation, data }
  };
}

test('Scanner history preserves a valid typed Detect envelope and provenance', async () => {
	const result = await loadProduct([typedHistory()]);

	assert.equal(result.history.length, 1);
	assert.equal(result.history[0].report.typedDetect, true);
	assert.equal(result.history[0].report.operation, 'probe');
	assert.equal(result.history[0].report.data.verdict, 'clear');
});

test('Scanner history rejects legacy, stale, and malformed records fail closed', async () => {
	const legacy = {
		id: 'legacy-scanner-1', status: 'completed', createdAt: Date.now(), request: { target: 'youtube.com' },
		report: { evidence: { ranked: [{ candidateId: 'generated:legacy' }] }, best: { candidateId: 'generated:legacy' } }
	};
	const staleTyped = Object.assign({}, typedHistory(), {
		id: 'stale-typed-1',
		provenance: { source: 'scanner', schema: HISTORY_SCHEMA, operation: 'probe' }
	});
	const malformedTyped = Object.assign({}, typedHistory(), {
		id: 'malformed-typed-1',
		report: { typedDetect: true, operation: 'probe', data: null }
	});

	const result = await loadProduct([legacy, staleTyped, malformedTyped]);

	assert.equal(result.history.length, 0, 'history must not expose untrusted legacy or stale records');
});

test('Scanner history has no legacy evidence or strategy handoff reader', () => {
	assert.match(source, /normalizeDetectHistory|typedDetect/);
	assert.doesNotMatch(source, /report\.evidence|evidence\.ranked|best_strategy|generatedStrategy|compiledTokens/);
	assert.doesNotMatch(source, /z2m\.strategy\.scanner-handoff\.v1/);
});

test('legacy scanner handoff cannot create a Strategies draft', () => {
	assert.doesNotMatch(scannerSource, /z2m\.strategy\.scanner-handoff\.v1|openInStrategies|reportRows|reportBest/);
	assert.doesNotMatch(strategiesSource, /z2m\.strategy\.scanner-handoff\.v1|consumeScannerHandoff|handoffConsumed/);
});

test('typed Detect history remains the only current Scanner result handoff', async () => {
	const result = await loadProduct([typedHistory({ verdict: 'detected', provenance: { source: 'z2k-detect' } })]);

	assert.equal(result.history.length, 1);
	assert.equal(result.history[0].schema, HISTORY_SCHEMA);
	assert.equal(result.history[0].report.typedDetect, true);
  assert.equal(result.history[0].provenance.source, 'z2k-detect');
});

test('typed Detect history preserves operation-specific request data and rejects retired target fields', async () => {
  const voice = typedHistory({ verdict: 'no-call' }, { operation: 'voice', request: { operation: 'voice', repeats: 2, timeoutMs: 6000 } });
  const tcp16 = typedHistory({ verdict: 'observed' }, { operation: 'tcp16', request: { operation: 'tcp16', timeoutMs: 6000 } });
  const legacyTarget = typedHistory({}, { request: { operation: 'probe', target: 'youtube.com', protocol: 'tcp', mode: 'standard' } });
  const result = await loadProduct([voice, tcp16, legacyTarget]);

  assert.deepEqual(JSON.parse(JSON.stringify(result.history.map(item => item.operation))), ['voice', 'tcp16']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.history.map(item => item.request))), [
    { operation: 'voice', repeats: 2, timeoutMs: 6000 },
    { operation: 'tcp16', timeoutMs: 6000 }
  ]);
});
