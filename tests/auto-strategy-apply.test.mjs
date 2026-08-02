import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { admitAutoApply, buildLastGood } from './lib/auto-strategy-apply.mjs';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');

const run = { runId: 'or-aaaaaaaa-bbbb', phase: 'completed', targetType: 'service', serviceVerdict: 'ready', validity: 'valid', candidateEvidenceUsable: true, candidateRegistryDigest: 'digest', targets: [{ id: 't1' }], targetResults: [{ targetId: 't1', protocols: [{ winner: { candidateId: 'p000001', positiveEvidenceIds: ['e1', 'e2'] } }] }] };

test('admission accepts only the current evidenced service run', () => {
	assert.equal(admitAutoApply({ pendingApplyRunId: run.runId, revision: 2 }, run, 2).ok, true);
	for (const bad of [{ ...run, runId: 'or-bbbbbbbb-cccc' }, { ...run, candidateEvidenceUsable: false }, { ...run, serviceVerdict: 'failed' }, { ...run, validity: 'invalid' }])
		assert.equal(admitAutoApply({ pendingApplyRunId: run.runId, revision: 2 }, bad, 2).ok, false);
});

test('last-good is constructed only after verified apply and confirmation', () => {
	const record = buildLastGood(run, { profiles: [{ candidateId: 'p000001' }], changeHash: 'hash' }, { targetVerifications: [{ passed: true }] }, { confirmationPassed: true }, 10, null);
	assert.equal(record.candidateId, 'p000001');
	assert.deepEqual(record.evidenceIds, ['e1', 'e2']);
	assert.equal(record.runtimeVerification.status, 'partial');
	assert.equal(buildLastGood(run, {}, { targetVerifications: [{ passed: false }] }, { confirmationPassed: true }, 10, null), null);
});

test('production delegates apply and rollback to sanctioned Orchestra path', () => {
	assert.match(SOURCE, /const AUTO_LAST_GOOD_PATH = '\/etc\/zapret2-manager\/auto-strategy-last-good\.json';/);
	assert.match(SOURCE, /orchestra_preview_best/);
	assert.match(SOURCE, /orchestra_apply_best/);
	assert.match(SOURCE, /verify_service_targets/);
	assert.match(SOURCE, /export const auto_apply_pending = function/);
	assert.match(SOURCE, /service\.uc rollback/);
	assert.match(SOURCE, /runtimeVerification\.ok != true/);
});
