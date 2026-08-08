import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EngineOperation,
  decideRollback,
  operationConflict,
  managerSurvivesRemoval
} from './lib/engine-provider-logic.mjs';

const flows = [
  ['clean install', 'install', null, 'andrevich'],
  ['same-provider update', 'update', 'remittor', 'remittor'],
  ['Remittor to 1andrevich', 'switch', 'remittor', 'andrevich'],
  ['1andrevich to Remittor', 'switch', 'andrevich', 'remittor'],
  ['remove engine', 'remove', 'andrevich', null]
];

for (const [name, action, installed, selected] of flows) {
  test(name + ' follows only declared stages', () => {
    const op = new EngineOperation({ action, installedProvider: installed, selectedProvider: selected });
    const stages = op.complete();
    assert.equal(stages[0], 'queued');
    assert.equal(stages.at(-1), 'completed');
    assert.ok(stages.includes('preflight'));
    assert.ok(stages.includes('backup'));
    if (action !== 'remove') assert.ok(stages.includes('verifying'));
  });
}

test('failure modes request verified rollback after mutation begins', () => {
  for (const stage of ['downloading', 'verifying', 'installing', 'postflight']) {
    const result = decideRollback({ stage, hadPrevious: true, rollbackPostflight: true });
    assert.equal(result.finalStage, 'rolled_back');
    assert.equal(result.rollbackVerified, true);
  }
});

test('failed rollback is never reported as rolled back', () => {
  const result = decideRollback({ stage: 'postflight', hadPrevious: true, rollbackPostflight: false });
  assert.equal(result.finalStage, 'failed');
  assert.equal(result.rollbackVerified, false);
});

test('failed first install returns engine_missing', () => {
  const result = decideRollback({ stage: 'installing', hadPrevious: false, rollbackPostflight: true });
  assert.equal(result.engineState, 'engine_missing');
});

test('conflicting operations and concurrent engine jobs are rejected', () => {
  assert.equal(operationConflict({ engineBusy: true }), 'engine-operation');
  assert.equal(operationConflict({ strategyApply: true }), 'strategy-apply');
  assert.equal(operationConflict({ orchestraApply: true }), 'orchestra-apply');
  assert.equal(operationConflict({ backupRestore: true }), 'backup-restore');
});

test('engine removal never includes manager packages', () => {
  assert.equal(managerSurvivesRemoval(['zapret2']), true);
  assert.equal(managerSurvivesRemoval(['zapret2', 'zapret2-manager']), false);
  assert.equal(managerSurvivesRemoval(['zapret2', 'luci-app-zapret2-manager']), false);
});
