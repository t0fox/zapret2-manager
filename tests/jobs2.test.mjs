// jobs2.test.mjs — SLICE 4 full job lifecycle (extends the ЦЕЛЬ-ТРИ machine).
//
// Contract: forward-only transitions incl. rolled_back/expired; crash
// recovery; lazy sweep (ttl + max history); malformed records swept, never
// kept; elapsed time is the ONLY progress signal (no fabricated percentage).
//
// Run: node --test tests/jobs2.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	make_job_record, transition2, is_terminal, crash_recover,
	sweep_jobs, parse_job_record, elapsed_sec,
	JOB_STATUSES, JOB_TTL_SEC, JOB_MAX_HISTORY
} from './lib/jobs-logic.mjs';

const T0 = 1785000000000;

function runningJob(overrides = {}) {
	let j = make_job_record({ kind: 'blockcheck', mode: 'quick', domains: ['example.com'], timeoutSec: 300 }, T0, 1);
	j = transition2(j, 'running', { runnerPid: 100, childPid: 200 }, T0 + 1000);
	return Object.assign(j, overrides);
}

// ---- statuses + transitions ----------------------------------------------------

test('v2 record shape: pending with identity fields', () => {
	const j = make_job_record({ kind: 'blockcheck', mode: 'full', domains: ['a.com'], timeoutSec: 1800 }, T0, 7);
	assert.equal(j.status, 'pending');
	assert.equal(j.version, 2);
	assert.equal(j.timeoutSec, 1800);
	assert.equal(j.runnerPid, null);
	assert.equal(j.childPid, null);
	assert.ok(JOB_STATUSES.includes(j.status));
});

test('forward-only incl. rolled_back and expired; invalid returns null', () => {
	let j = runningJob();
	assert.equal(transition2(j, 'pending'), null, 'no going back to pending');
	assert.equal(transition2(j, 'running'), null, 'no double-start');
	const rb = transition2(j, 'rolled_back', {}, T0 + 2000);
	assert.equal(rb.status, 'rolled_back');
	assert.equal(transition2(rb, 'running'), null);
	const s = transition2(j, 'succeeded', { rc: 0 }, T0 + 3000);
	assert.equal(transition2(s, 'failed'), null, 'terminal → terminal (except expired) rejected');
	const e = transition2(s, 'expired', {}, T0 + 4000);
	assert.equal(e.status, 'expired');
	assert.ok(is_terminal('expired') && is_terminal('rolled_back'));
});

// ---- crash recovery ----------------------------------------------------------------

test('crash recovery: dead runner fails the job with a crash-recovery error', () => {
	const j = runningJob();
	const r = crash_recover(j, { runner: false, child: false }, T0 + 5000);
	assert.equal(r.status, 'failed');
	assert.match(r.error, /crash recovery/);
	assert.equal(crash_recover(j, { runner: true, child: true }), null, 'healthy runner: no recovery');
	assert.equal(crash_recover(transition2(j, 'succeeded', {}, T0 + 1), { runner: false, child: false }), null,
		'terminal jobs are never "recovered"');
});

// ---- sweep --------------------------------------------------------------------------

test('sweep: terminal records expire after ttl; non-terminal never expire', () => {
	const oldTerminal = transition2(runningJob(), 'succeeded', {}, T0 + 1000);
	oldTerminal.finishedAt = T0 - (JOB_TTL_SEC + 10) * 1000;
	const active = runningJob({ id: 'job-active' });
	const { kept, expired, removed } = sweep_jobs([oldTerminal, active], T0);
	assert.deepEqual(expired, [oldTerminal.id]);
	assert.ok(kept.some((r) => r.id === 'job-active' && r.status === 'running'),
		'a non-terminal record is never expired');
	assert.deepEqual(removed, []);
});

test('sweep: max history removes OLDEST terminal records; malformed records are swept', () => {
	const records = [];
	for (let i = 0; i < JOB_MAX_HISTORY + 2; i++) {
		const j = make_job_record({ kind: 'blockcheck' }, T0 + i * 1000, i);
		const s = transition2(transition2(j, 'running', {}, T0 + i * 1000), 'succeeded', {}, T0 + i * 1000 + 1);
		records.push(s);
	}
	records.push(null);   // malformed
	const { kept, removed } = sweep_jobs(records, T0);
	assert.equal(kept.length, JOB_MAX_HISTORY, 'history capped');
	assert.ok(removed.includes(null), 'malformed record swept');
	// the two oldest terminal records were removed
	assert.ok(!kept.some((r) => r.id === records[0].id));
	assert.ok(!kept.some((r) => r.id === records[1].id));
});

// ---- record parsing -------------------------------------------------------------------

test('parse_job_record: valid v2 record ok; malformed rejected honestly', () => {
	const j = runningJob();
	assert.equal(parse_job_record(JSON.stringify(j)).ok, true);
	assert.equal(parse_job_record('{ nope').malformed, true);
	assert.equal(parse_job_record(JSON.stringify({ id: 'x', status: 'bogus' })).malformed, true);
	assert.equal(parse_job_record(null).malformed, true);
});

// ---- elapsed (the only progress signal) --------------------------------------------------

test('elapsed_sec: computed from startedAt; never a percentage', () => {
	const j = runningJob();
	assert.equal(elapsed_sec(j, T0 + 61000), 60);
	const done = transition2(j, 'succeeded', {}, T0 + 31000);
	assert.equal(elapsed_sec(done, T0 + 999000), 30, 'frozen at finishedAt');
	assert.equal(elapsed_sec(make_job_record({}, T0, 1), T0 + 1000), null, 'never started → null');
});
