import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStart, deadlineState, requestControl, childTermination } from './lib/orchestra-run-logic.mjs';

test('A3.2 backend bounds service scans and exposes immutable deadline contract', () => {
	const result = validateStart({ targetType: 'service', targetId: 'discord', protocols: ['tcp_https'], repeats: 1, perAttemptTimeoutSec: 10, totalTimeoutSec: 120, maxCandidates: 8, maxAttempts: 24 });
	assert.equal(result.ok, true);
	assert.equal(result.value.maxCandidates, 8);
	assert.equal(result.value.maxAttempts, 24);
	assert.deepEqual(Object.keys(deadlineState({ startedAt: 100, deadlineAt: 220, runTimeoutSec: 120, perAttemptTimeoutSec: 10 }, 205)), ['remainingSec', 'attemptTimeoutSec', 'expired']);
	assert.deepEqual(deadlineState({ startedAt: 100, deadlineAt: 220, runTimeoutSec: 120, perAttemptTimeoutSec: 10 }, 205), { remainingSec: 15, attemptTimeoutSec: 10, expired: false });
});

test('A3.2 stop is idempotent and stale generation is rejected', () => {
	const run = { runId: 'or-00000001-0001', generation: 4, phase: 'testing', control: { revision: 0, stopRequested: false } };
	assert.equal(requestControl(run, 'stop', { runId: run.runId, generation: 3, expectedRevision: 0, requestId: 'stop-stale-1' }).error, 'ESTALE');
	const accepted = requestControl(run, 'stop', { runId: run.runId, generation: 4, expectedRevision: 0, requestId: 'stop-ok-1' });
	assert.equal(accepted.status, 'stopping');
	assert.equal(requestControl(accepted.run, 'stop', { runId: run.runId, generation: 4, expectedRevision: 1, requestId: 'stop-ok-2' }).status, 'stopping');
});

test('A3.2 child termination is TERM then bounded KILL only for matching identity', () => {
	assert.deepEqual(childTermination({ pid: 42, starttime: '100' }, { pid: 42, starttime: '101' }), { signals: [], owned: false });
	assert.deepEqual(childTermination({ pid: 42, starttime: '100' }, { pid: 42, starttime: '100' }), { signals: ['TERM', 'KILL'], owned: true });
});
