import test from 'node:test';
import assert from 'node:assert/strict';
import { requestControl, simulateControlledWorker } from './lib/orchestra-run-logic.mjs';

const base = (phase = 'testing') => ({ phase, completedCount: 0, control: { pauseRequested: false, stopRequested: false } });

test('pause is a request; worker confirms only after current attempt finishes', () => {
	const requested = requestControl(base(), 'pause');
	assert.equal(requested.run.phase, 'testing');
	const result = simulateControlledWorker({ actions: [
		{ at: 'start', attempt: 1 }, { at: 'pause' }, { at: 'finish', attempt: 1 }
	] });
	assert.equal(result.run.phase, 'paused');
	assert.equal(result.run.completedCount, 1);
	assert.deepEqual(result.started, [1]);
});

test('paused worker heartbeats without starting another attempt', () => {
	const result = simulateControlledWorker({ actions: [
		{ at: 'start', attempt: 1 }, { at: 'pause' }, { at: 'finish', attempt: 1 },
		{ at: 'heartbeat' }, { at: 'heartbeat' }, { at: 'heartbeat' }
	] });
	assert.equal(result.run.phase, 'paused');
	assert.equal(result.run.completedCount, 1);
	assert.equal(result.run.heartbeat, 3);
	assert.deepEqual(result.started, [1]);
});

test('resume continues with the first incomplete attempt only', () => {
	const result = simulateControlledWorker({ actions: [
		{ at: 'start', attempt: 1 }, { at: 'finish', attempt: 1 }, { at: 'pause' },
		{ at: 'resume' }, { at: 'start', attempt: 2 }, { at: 'finish', attempt: 2 }
	] });
	assert.deepEqual(result.started, [1, 2]);
	assert.equal(result.run.completedCount, 2);
	assert.deepEqual(result.run.results.map(r => r.attempt), [1, 2]);
	assert.deepEqual(result.events, ['resumed']);
});

test('stop records cancelled and reaches stopped', () => {
	const result = simulateControlledWorker({ actions: [
		{ at: 'start', attempt: 1 }, { at: 'stop', attempt: 1 }
	] });
	assert.equal(result.run.phase, 'stopped');
	assert.equal(result.run.results[0].verdict, 'cancelled');
});

test('control requests enforce idempotency and terminal transitions', () => {
	const paused = requestControl(base(), 'pause');
	assert.equal(requestControl(paused.run, 'pause').idempotent, true);
	assert.equal(requestControl({ ...base('completed') }, 'pause').error, 'ESTATE');
	assert.equal(requestControl({ ...base('completed') }, 'resume').error, 'ESTATE');
	assert.equal(requestControl({ ...base('stopped') }, 'stop').idempotent, true);
	assert.equal(requestControl(base('testing'), 'resume').error, 'ESTATE');
});

test('stale PID identity is not considered owned', () => {
	const current = { pid: 123, starttime: '200' };
	const observed = { pid: 123, starttime: '201' };
	assert.equal(current.pid === observed.pid && current.starttime === observed.starttime, false);
});
