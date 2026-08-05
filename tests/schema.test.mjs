// Self-test for the status schema (point 4 — camelCase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(here, '..', 'docs/contracts/status.schema.json'), 'utf8'));
const P = SCHEMA.properties;
const CHECK_IDS = new Set(['dns_consistency', 'tls12_reachable', 'udp443_quic', 'queue_health', 'lua_version_match']);
function isSnake(name) { return name.includes('_') && !CHECK_IDS.has(name); }

test('top-level has the mandatory blocks', () => {
	for (const k of ['schema', 'generatedAt', 'generation', 'serviceState', 'engine', 'runtime', 'runtimeSummary', 'applied',
		'draft', 'drift', 'health', 'system', 'upstream', 'jobs', 'warnings']) {
		assert.ok(k in P, `top-level block present: ${k}`);
	}
});

test('serviceState is a scalar field with the closed enum', () => {
	assert.ok('serviceState' in P, 'serviceState is a top-level field');
	const st = P.serviceState;
	const en = st.enum || (st.anyOf && st.anyOf.flatMap(x => x.enum || []));
	assert.deepEqual(en, ['engine_missing', 'running', 'stopped', 'partial', 'error', 'paused', 'passthrough'],
		'serviceState enum includes the explicit optional-engine state');
});

test('generatedAt is an ISO-8601 string (not unix seconds)', () => {
	const g = P.generatedAt;
	const types = Array.isArray(g.type) ? g.type : [g.type];
	assert.ok(types.includes('string'), 'generatedAt is a string (ISO-8601 with timezone)');
});

test('engine block distinguishes package, binary and service evidence', () => {
	const engine = P.engine;
	assert.equal(engine.type, 'object');
	for (const key of ['installed', 'packagePresent', 'binaryPresent', 'servicePresent'])
		assert.ok(key in engine.properties, `engine.${key}`);
});

test('qlenHealth has state, threshold=50, consecutiveOverThreshold, critTurns=3', () => {
	const qh = P.health.properties.qlenHealth.properties;
	assert.ok('state' in qh, 'qlenHealth.state');
	assert.ok('threshold' in qh, 'qlenHealth.threshold');
	assert.ok('consecutiveOverThreshold' in qh, 'qlenHealth.consecutiveOverThreshold');
	assert.ok('critTurns' in qh, 'qlenHealth.critTurns');
	assert.equal(qh.threshold.const, 50, 'threshold is the constant 50');
	assert.equal(qh.critTurns.const, 3, 'critTurns is the constant 3');
});

test('health.checks[].id is the closed set', () => {
	const checks = P.health.properties.checks;
	const items = checks.items;
	const idProp = items.properties.id;
	const en = idProp.enum;
	assert.deepEqual([...en].sort(), [...CHECK_IDS].sort(), 'checks[].id enum is the closed set (order-independent)');
});

test('no snake_case field names in the top-level and core sub-blocks', () => {
	for (const k of Object.keys(P)) assert.ok(!isSnake(k), `top-level key is camelCase: ${k}`);
	const inst = P.runtime.properties.instances.items.properties;
	for (const k of Object.keys(inst)) assert.ok(!isSnake(k), `runtime.instances[].${k} is camelCase`);
	assert.ok('rssKb' in inst, 'runtime.instances[].rssKb present');
	for (const k of Object.keys(P.applied.properties)) assert.ok(!isSnake(k), `applied.${k} is camelCase`);
	for (const k of Object.keys(P.drift.properties)) assert.ok(!isSnake(k), `drift.${k} is camelCase`);
});

test('schema version field is an integer (bump on extension)', () => {
	assert.equal(P.schema.type, 'integer', 'schema is an integer version');
});

const STATUS_UC = readFileSync(join(here, '..', 'zapret2-manager/files/usr/libexec/zapret2-manager/status.uc'), 'utf8');

test('collector no longer emits the old snake_case top-level keys', () => {
	for (const old of ['collected_at:', 'cache_ttl:', 'service_state:', 'queues:', 'meta:', 'signals:', 'passthrough:']) {
		assert.ok(!STATUS_UC.includes(old), `status.uc does not emit the old snake_case/removed key ${old}`);
	}
});

test('collector emits the new camelCase top-level keys', () => {
	for (const k of ['generatedAt:', 'serviceState:', 'engine:', 'health:', 'system:', 'upstream:', 'jobs:', 'warnings:', 'qlenHealth:'])
		assert.ok(STATUS_UC.includes(k), `status.uc emits ${k}`);
});
