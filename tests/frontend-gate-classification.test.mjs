import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseFailures } from '../tools/check-frontend-gate-classification.mjs';

const allowedLog = `
  FILE flowseal-combo-integration.test.mjs cat=backend  pass=0 fail=2 rc=1
  FILE stressozz-corpus.test.mjs           cat=backend  pass=0 fail=2 rc=1
TOTAL one-line: 1024 green, 4 red
`;

test('exact documented backend handoff failures pass classification', () => {
  const result = classify(allowedLog);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.failures], [
    ['flowseal-combo-integration.test.mjs', 2],
    ['stressozz-corpus.test.mjs', 2]
  ]);
});

test('any frontend failure is rejected', () => {
  const result = classify(allowedLog + '  FILE ui/single-view-manager.test.mjs cat=ui pass=8 fail=1 rc=1\n');
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, [{ file: 'ui/single-view-manager.test.mjs', count: 1 }]);
});

test('changed backend failure counts are rejected for reclassification', () => {
  const result = classify(allowedLog.replace('fail=2 rc=1', 'fail=3 rc=1'));
  assert.equal(result.ok, false);
  assert.equal(result.mismatched.length, 1);
});

test('missing expected backend suite is rejected rather than silently green', () => {
  const result = classify('  FILE flowseal-combo-integration.test.mjs cat=backend pass=0 fail=2 rc=1\n');
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ file: 'stressozz-corpus.test.mjs', count: 2 }]);
});

test('shell failures are parsed as one failure', () => {
  assert.deepEqual([...parseFailures('  FILE target.test.sh cat=shell FAIL rc=1\n')], [['target.test.sh', 1]]);
});
