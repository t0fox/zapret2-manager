import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { boundedRunRequest, reconcileScanResult } from './lib/auto-strategy-scan.mjs';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');

test('auto scan submits only a bounded registry-backed service run', () => {
	assert.deepEqual(boundedRunRequest('youtube'), {
		targetType: 'service', targetId: 'youtube', candidateMode: 'zapret2gui-only',
		repeats: 2, perAttemptTimeoutSec: 20, totalTimeoutSec: 600
	});
});

test('no-winner preserves the applied baseline and enters cooldown', () => {
	const state = { activeRunId: 'or-aaaaaaaa-bbbb', phase: 'scanning', lastGoodCandidateId: 'old', lastGoodProfileRevision: 'old-rev' };
	const out = reconcileScanResult(state, { runId: 'or-aaaaaaaa-bbbb', phase: 'completed', serviceVerdict: 'failed' }, 1000);
	assert.equal(out.action, 'no-winner');
	assert.equal(out.state.lastGoodCandidateId, 'old');
	assert.equal(out.state.phase, 'cooldown');
	assert.equal(out.state.activeRunId, null);
});

test('only a current ready service run becomes an apply candidate', () => {
	const state = { activeRunId: 'or-aaaaaaaa-bbbb', phase: 'scanning' };
	const out = reconcileScanResult(state, { runId: 'or-aaaaaaaa-bbbb', phase: 'completed', serviceVerdict: 'ready', selectedWinner: { candidateId: 'p000001' }, candidateEvidenceUsable: true }, 1000);
	assert.equal(out.action, 'apply');
	assert.equal(out.state.pendingApplyRunId, 'or-aaaaaaaa-bbbb');
	assert.equal(out.state.phase, 'applying');
});

test('source delegates ranking and cancellation to existing orchestra contracts', () => {
	assert.match(SOURCE, /import \{ orchestra_run_start, orchestra_run_status \} from '\.\/orchestra-run\.uc';/);
	assert.match(SOURCE, /candidateMode: 'zapret2gui-only'/);
	assert.match(SOURCE, /perAttemptTimeoutSec: 20/);
	assert.match(SOURCE, /totalTimeoutSec: 600/);
	assert.doesNotMatch(SOURCE, /blockcheck2\.sh.*--payload/);
});
