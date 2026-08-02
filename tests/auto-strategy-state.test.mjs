import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_AUTO_STATE, normalizeAutoState, transitionAutoState } from './lib/auto-strategy-state.mjs';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');

test('auto state defaults are disabled and complete', () => {
	assert.deepEqual(DEFAULT_AUTO_STATE, {
		schema: 1, revision: 0, enabled: false, serviceIds: [], phase: 'disabled',
		consecutiveFailures: 0, activeRunId: null, lastGoodCandidateId: null,
		lastGoodProfileRevision: null, lastGoodEvidenceId: null, lastCheckAt: null,
		lastSuccessAt: null, lastFailureAt: null, lastRunAt: null, cooldownUntil: null,
		lastHealthJobId: null, infrastructureFailures: 0, scanRequestedAt: null, lastError: null
	});
});

test('auto state rejects malformed, duplicate, and untrusted service IDs', () => {
	const state = normalizeAutoState({ schema: 1, enabled: true, phase: 'scanning', serviceIds: ['youtube', 'youtube', '../escape'], activeRunId: 'or-aaaaaaaa-bbbb' });
	assert.deepEqual(state.serviceIds, ['youtube']);
	assert.equal(state.phase, 'scanning');
	assert.equal(state.activeRunId, 'or-aaaaaaaa-bbbb');
	assert.equal(normalizeAutoState({ schema: 999 }).phase, 'disabled');
});

test('auto state transitions preserve the three-failure hysteresis', () => {
	let state = normalizeAutoState({ schema: 1, enabled: true, phase: 'healthy', consecutiveFailures: 2 });
	state = transitionAutoState(state, { kind: 'strategy-failure', at: 10 });
	assert.equal(state.phase, 'degraded');
	assert.equal(state.consecutiveFailures, 3);
	state = transitionAutoState(state, { kind: 'healthy', at: 20 });
	assert.equal(state.phase, 'healthy');
	assert.equal(state.consecutiveFailures, 0);
});

test('controller source persists only through an atomic regular-file path', () => {
	assert.match(SOURCE, /const AUTO_STATE_PATH = '\/etc\/zapret2-manager\/auto-strategy\.json';/);
	assert.match(SOURCE, /-L/);
	assert.match(SOURCE, /mv -f/);
	assert.match(SOURCE, /\.tmp\./);
	assert.match(SOURCE, /export const auto_state_save = function/);
});
