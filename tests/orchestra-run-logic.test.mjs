import test from 'node:test';
import assert from 'node:assert/strict';
import {
	validateStart, transition, scoreCandidate, appendBoundedEvent
} from './lib/orchestra-run-logic.mjs';

test('validateStart rejects unsafe domains and accepts a bounded HTTPS run', () => {
	assert.equal(validateStart({ targetType: 'domain', domain: 'bad;id', protocols: ['tcp_https'] }).ok, false);
	const valid = validateStart({ targetType: 'domain', domain: 'Example.COM', protocols: ['tcp_https'], repeats: 2, perAttemptTimeoutSec: 15, totalTimeoutSec: 120 });
	assert.deepEqual(valid, { ok: true, value: { targetType: 'domain', domain: 'example.com', protocols: ['tcp_https'], candidateMode: 'recommended', candidateIds: [], repeats: 2, perAttemptTimeoutSec: 15, totalTimeoutSec: 120 } });
});

test('transition only permits explicit orchestration state transitions', () => {
	assert.equal(transition('queued', 'preparing').ok, true);
	assert.equal(transition('testing', 'paused').ok, true);
	assert.equal(transition('completed', 'testing').ok, false);
});

test('scoring prefers stable HTTPS and supported QUIC over HTTPS-only', () => {
	const httpsOnly = scoreCandidate({ strategyId: 'a', attempts: [
		{ protocol: 'tcp_https', success: true, durationMs: 100 }, { protocol: 'tcp_https', success: true, durationMs: 120 },
		{ protocol: 'quic_udp', status: 'unsupported' }
	] }, 2);
	const dual = scoreCandidate({ strategyId: 'b', attempts: [
		{ protocol: 'tcp_https', success: true, durationMs: 200 }, { protocol: 'tcp_https', success: true, durationMs: 220 },
		{ protocol: 'quic_udp', success: true, durationMs: 300 }, { protocol: 'quic_udp', success: true, durationMs: 320 }
	] }, 2);
	assert.equal(dual.verdict, 'best');
	assert.ok(dual.score > httpsOnly.score);
	assert.equal(httpsOnly.verdict, 'working');
});

test('bounded event retention keeps only the newest 500 events', () => {
	let events = [];
	for (let i = 0; i < 501; i++) events = appendBoundedEvent(events, { sequence: i });
	assert.equal(events.length, 500);
	assert.equal(events[0].sequence, 1);
});
