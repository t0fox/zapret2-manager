// Self-test for the blockcheck job model (ЦЕЛЬ ТРИ — ui/09-blockcheck-jobs).
//
// The job model: create → pending → running → succeeded/failed/cancelled.
// At most ONE blockcheck job runs at a time (create refuses if a running job
// exists). Cancel must actually STOP the process (kill), not just mark the
// job. Result saved as a file. The page polls job state and survives a
// browser reload (state is on disk, not in-memory).
//
// ucode does not run locally; node self-test proves the STATE-MACHINE logic.
// The ucode jobs.uc mirrors tests/lib/jobs-logic.mjs; runtime confirmed on
// target via smoke.sh.
//
// Run: node --test tests/jobs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_job, transition, can_start, cancel_job, job_status } from './lib/jobs-logic.mjs';

test('a new job starts in pending', () => {
	const j = create_job('quick', ['example.com']);
	assert.equal(j.status, 'pending');
	assert.ok(j.id);
	assert.equal(j.level, 'quick');
	assert.deepEqual(j.domains, ['example.com']);
	assert.ok(j.createdAt > 0);
	assert.equal(j.finishedAt, null);
});

test('can_start refuses when a running job exists', () => {
	const running = { status: 'running', id: 'job-1' };
	assert.equal(can_start(running), false);
});

test('can_start allows when the existing job is terminal', () => {
	for (const s of ['succeeded', 'failed', 'cancelled', 'expired']) {
		assert.equal(can_start({ status: s, id: 'job-1' }), true);
	}
});

test('can_start allows when no existing job', () => {
	assert.equal(can_start(null), true);
});

test('transition: pending → running is valid', () => {
	const j = create_job('medium', ['a.com', 'b.com']);
	const t = transition(j, 'running');
	assert.equal(t.status, 'running');
	assert.ok(t.startedAt > 0);
});

test('transition: running → succeeded sets finishedAt and result', () => {
	let j = create_job('full', []);
	j = transition(j, 'running');
	j = transition(j, 'succeeded', { resultFile: '/tmp/result.txt' });
	assert.equal(j.status, 'succeeded');
	assert.ok(j.finishedAt > 0);
	assert.equal(j.resultFile, '/tmp/result.txt');
});

test('transition: running → failed sets error', () => {
	let j = create_job('quick', ['x.com']);
	j = transition(j, 'running');
	j = transition(j, 'failed', { error: 'timeout' });
	assert.equal(j.status, 'failed');
	assert.equal(j.error, 'timeout');
	assert.ok(j.finishedAt > 0);
});

test('cancel_job: running → cancelled', () => {
	let j = create_job('medium', ['a.com']);
	j = transition(j, 'running');
	const c = cancel_job(j);
	assert.equal(c.status, 'cancelled');
	assert.ok(c.finishedAt > 0);
	assert.equal(c.cancelled, true);
});

test('cancel_job: a pending job can be cancelled (before it starts)', () => {
	let j = create_job('quick', []);
	const c = cancel_job(j);
	assert.equal(c.status, 'cancelled');
});

test('cancel_job: a terminal job cannot be cancelled', () => {
	let j = create_job('quick', []);
	j = transition(j, 'running');
	j = transition(j, 'succeeded', {});
	const c = cancel_job(j);
	assert.equal(c.status, 'succeeded');  // unchanged
	assert.equal(c.cancelled, false);     // not set to true
});

test('transition rejects invalid transitions (no going back to pending)', () => {
	let j = create_job('quick', []);
	j = transition(j, 'running');
	j = transition(j, 'succeeded', {});
	const t = transition(j, 'pending');
	assert.equal(t.status, 'succeeded');  // unchanged — invalid transition rejected
});

test('transition rejects running → running (no double-start)', () => {
	let j = create_job('quick', []);
	j = transition(j, 'running');
	const t = transition(j, 'running');
	assert.equal(t.status, 'running');  // unchanged
});

test('job_status returns the full state for the page to render', () => {
	let j = create_job('full', ['a.com', 'b.com', 'c.com']);
	j = transition(j, 'running');
	const s = job_status(j);
	assert.equal(s.id, j.id);
	assert.equal(s.status, 'running');
	assert.equal(s.level, 'full');
	assert.ok(s.startedAt > 0);
	assert.equal(s.finishedAt, null);
});
