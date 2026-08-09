import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAtomicWriteJsonCases } from './atomic-write-json-harness.mjs';

const root = mkdtempSync(join(tmpdir(), 'z2m-atomic-json-harness-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('data-driven harness compares bytes, captures results, and snapshots filesystem state', () => {
  const successParent = join(root, 'success');
  const failureParent = join(root, 'failure');
  mkdirSync(successParent);
  mkdirSync(failureParent);
  writeFileSync(join(successParent, 'keep'), 'same');
  writeFileSync(join(failureParent, 'keep'), 'same');
  const successTarget = join(successParent, 'target.json');
  const failureTarget = join(failureParent, 'target.json');
  const canonicalBytes = Buffer.from('{"a":1,"b":2}');
  const requests = {
    success: { protocolVersion: 1, requestId: 'success' },
    failure: { protocolVersion: 1, requestId: 'failure' },
  };
  const invoke = (request) => {
    if (request.requestId === 'success') {
      writeFileSync(successTarget, canonicalBytes);
      return { response: { ok: true, data: { committed: true, durability: 'tmpfs_visible' } } };
    }
    return { response: { ok: false, error: {
      code: 'ESCHEMA', stage: 'canonical_validate', committed: false, durability: 'unchanged',
    } } };
  };

  const observations = runAtomicWriteJsonCases([
    {
      id: 'success', request: requests.success, targetPath: successTarget,
      expected: {
        canonicalBytes,
        result: { code: null, stage: null, committed: true, durability: 'tmpfs_visible' },
      },
    },
    {
      id: 'failure', request: requests.failure, targetPath: failureTarget,
      expected: {
        filesystemUnchanged: true,
        result: { code: 'ESCHEMA', stage: 'canonical_validate', committed: false, durability: 'unchanged' },
      },
    },
  ], invoke);

  assert.equal(observations.length, 2);
  assert.deepEqual(observations[0].before.target, { type: 'absent' });
  assert.deepEqual(observations[0].before.parent.entries, [{ name: 'keep', type: 'file' }]);
  assert.deepEqual(observations[0].canonicalBytes, canonicalBytes);
  assert.deepEqual(observations[1].before, observations[1].after);
  assert.deepEqual(observations[1].result,
    { code: 'ESCHEMA', stage: 'canonical_validate', committed: false, durability: 'unchanged' });
});

test('harness rejects a canonical byte mismatch', () => {
  const parent = join(root, 'byte-mismatch');
  const targetPath = join(parent, 'target.json');
  mkdirSync(parent);
  writeFileSync(targetPath, '{"actual":true}');
  assert.throws(() => runAtomicWriteJsonCases([{
    id: 'byte-mismatch', request: {}, targetPath,
    expected: { canonicalBytes: Buffer.from('{"expected":true}') },
  }], () => ({ response: { ok: true, data: {} } })), /byte-mismatch: canonical bytes/);
});

test('harness rejects a parent-directory side effect', () => {
  const parent = join(root, 'parent-mismatch');
  const targetPath = join(parent, 'target.json');
  mkdirSync(parent);
  assert.throws(() => runAtomicWriteJsonCases([{
    id: 'parent-mismatch', request: {}, targetPath,
    expected: { filesystemUnchanged: true },
  }], () => {
    writeFileSync(join(parent, 'unexpected-candidate'), 'side effect');
    return { response: { ok: false, error: {} } };
  }), /parent-mismatch: filesystem changed/);
});
