import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHelperTransport } from './fs-helper-mutation-transport-fixture.mjs';

test('mutation incomplete transport forbids automatic retry and requires reread reconciliation', () => {
  assert.deepEqual(classifyHelperTransport({ operation: 'atomic_write', exitCode: 74, response: null }), {
    code: 'EDEPENDENCY', commitState: 'unknown', automaticRetry: false, recovery: 'reread_reconcile'
  });
  assert.deepEqual(classifyHelperTransport({ operation: 'read_regular', exitCode: 74, response: null }), {
    code: 'EDEPENDENCY', commitState: 'not_applicable', automaticRetry: false, recovery: 'none'
  });
});
