import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';


test('native backend contract is versioned', () => {
  const body = fs.readFileSync('docs/contracts/native-backend-v1.md', 'utf8');
  for (const heading of [
    '## State Envelope',
    '## RPC Envelope',
    '## Process Identity',
    '## Namespace Ownership',
    '## Transaction Phases',
    '## Job States'
  ]) assert.match(body, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
