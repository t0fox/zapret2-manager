import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, parseFailures } from '../scripts/test/check-gate-classification.mjs';

const WORKFLOW = readFileSync('.github/workflows/repository-gate.yml', 'utf8');

const greenLog = `
TOTAL one-line: 1036 green, 0 red
`;

test('a fully green repository gate passes classification', () => {
  const result = classify(greenLog);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.failures], []);
});

test('any frontend failure is rejected', () => {
  const result = classify('  FILE ui/single-view-manager.test.mjs cat=ui pass=8 fail=1 rc=1\n');
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, [{ file: 'ui/single-view-manager.test.mjs', count: 1 }]);
});

test('backend failures are not an allowed handoff', () => {
  const result = classify('  FILE flowseal-combo-integration.test.mjs cat=backend pass=0 fail=2 rc=1\n');
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, [{ file: 'flowseal-combo-integration.test.mjs', count: 2 }]);
});

test('StressOzz failure is rejected and current workflow runs the canonical repository runner', () => {
  const result = classify('  FILE stressozz-corpus.test.mjs cat=backend pass=0 fail=2 rc=1\n');
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, [{ file: 'stressozz-corpus.test.mjs', count: 2 }]);
  assert.match(WORKFLOW, /scripts\/test\/run-all-tests\.sh/);
  assert.doesNotMatch(WORKFLOW, /tools\/run-all-tests\.sh/);
});

test('shell failures are parsed as one failure', () => {
  assert.deepEqual([...parseFailures('  FILE target.test.sh cat=shell FAIL rc=1\n')], [['target.test.sh', 1]]);
});
