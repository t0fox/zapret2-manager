import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const expectedRpc = JSON.parse(
  readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8')
);

test('frontend RPC method sets remain unchanged', () => {
  assert.deepEqual(collectUiContract(), expectedRpc);
});
