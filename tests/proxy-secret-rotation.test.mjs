import test from 'node:test';
import assert from 'node:assert/strict';
import { planSecretRotationOutcome } from './lib/proxycfg-logic.mjs';

function secretKeys(value) {
  return Object.keys(value || {}).filter((key) => /secret/i.test(key));
}

test('stopped service rotates without restart and exposes no secret material', () => {
  const result = planSecretRotationOutcome({
    wasRunning: false,
    writeOk: true
  });
  assert.deepEqual(result, {
    ok: true,
    stage: 'complete',
    rotated: true,
    restarted: false,
    verified: true,
    rolledBack: false,
    rollbackFailed: false
  });
  assert.deepEqual(secretKeys(result), []);
});

test('running service succeeds only after restart and listener verification', () => {
  const result = planSecretRotationOutcome({
    wasRunning: true,
    writeOk: true,
    restartOk: true,
    verificationOk: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.restarted, true);
  assert.equal(result.verified, true);
  assert.equal(result.rolledBack, false);
  assert.deepEqual(secretKeys(result), []);
});

for (const scenario of [
  { name: 'write', input: { wasRunning: true, writeOk: false, rollbackOk: true }, stage: 'write-secret' },
  { name: 'restart', input: { wasRunning: true, writeOk: true, restartOk: false, rollbackOk: true }, stage: 'restart' },
  { name: 'verify', input: { wasRunning: true, writeOk: true, restartOk: true, verificationOk: false, rollbackOk: true }, stage: 'verify-listener' }
]) {
  test(`${scenario.name} failure restores the previous secret and is never success`, () => {
    const result = planSecretRotationOutcome(scenario.input);
    assert.equal(result.ok, false);
    assert.equal(result.stage, scenario.stage);
    assert.equal(result.rolledBack, true);
    assert.equal(result.rollbackFailed, false);
    assert.deepEqual(secretKeys(result), []);
  });
}

test('rollback failure is explicit and requires manual recovery', () => {
  const result = planSecretRotationOutcome({
    wasRunning: true,
    writeOk: true,
    restartOk: true,
    verificationOk: false,
    rollbackOk: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'verify-listener');
  assert.equal(result.rolledBack, false);
  assert.equal(result.rollbackFailed, true);
  assert.match(result.message, /manual recovery/i);
  assert.deepEqual(secretKeys(result), []);
});
