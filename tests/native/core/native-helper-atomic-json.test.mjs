import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SOCKET_PATH, childExited, invoke, requestFrameBody, withPeer,
} from './ucode-test-harness.mjs';

after(() => fs.rmSync(SOCKET_PATH, { force: true }));

const success = (id, data) => `${JSON.stringify({
  protocolVersion: 1, requestId: id, ok: true, data,
})}\n`;

async function roundTrip(expression, makeResponse) {
  let request;
  const result = await withPeer((socket, wire) => {
    request = requestFrameBody(wire);
    socket.end(makeResponse(request));
  }, () => invoke(expression));
  return { result, request };
}

test('atomic_write_json is a typed fixed-policy mutation', async () => {
  const value = { z: 2, a: [true, null, 'x'] };
  const { result, request } = await roundTrip(
    `native.atomic_write_json('persistent_state', 'manager-state.json', ${JSON.stringify(value)}, true)`,
    ({ header }) => childExited(header.requestId, success(header.requestId, {
      byteLength: 29, committed: true, durability: 'durable',
    })),
  );

  assert.deepEqual(result, { ok: true, data: {
    byteLength: 29, committed: true, durability: 'durable',
  } });
  assert.deepEqual(request.body.arguments, {
    root: 'persistent_state', path: 'manager-state.json', value,
    mode: '0600', uid: 0, gid: 0, allowCreate: true,
  });
  assert.equal(request.body.operation, 'atomic_write_json');
  assert.equal(request.header.timeoutMs, 30000);
});

test('atomic_write_json validates typed arguments before socket access', async () => {
  fs.rmSync(SOCKET_PATH, { force: true });
  for (const expression of [
    `native.atomic_write_json('/absolute', 'x', {}, true)`,
    `native.atomic_write_json('persistent_state', '../x', {}, true)`,
    `native.atomic_write_json('persistent_state', 'x', {}, 1)`,
    `native.atomic_write_json('persistent_state', 'x', {}, false, '${'A'.repeat(64)}')`,
  ]) assert.equal((await invoke(expression)).error.code, 'EINPUT');
});

test('atomic_write_json sends an optional lowercase content CAS precondition', async () => {
  const expectedSha256 = 'a'.repeat(64);
  const { result, request } = await roundTrip(
    `native.atomic_write_json('persistent_state', 'manager-state.json', { generation: 2 }, false, '${expectedSha256}')`,
    ({ header }) => childExited(header.requestId, success(header.requestId, {
      byteLength: 16, committed: true, durability: 'durable',
    })),
  );
  assert.equal(result.ok, true);
  assert.equal(request.body.arguments.expectedSha256, expectedSha256);
  assert.equal(request.body.arguments.allowCreate, false);
});

test('atomic_write_json transport damage is mutation uncertainty and is never retried', async () => {
  let requests = 0;
  const result = await withPeer((socket) => {
    requests++;
    socket.destroy();
  }, () => invoke(`native.atomic_write_json('persistent_state', 'manager-state.json', {}, true)`));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EDEPENDENCY');
  assert.equal(result.error.commitState, 'unknown');
  assert.equal(result.error.automaticRetry, false);
  assert.equal(result.error.recovery, 'reread_reconcile');
  assert.equal(requests, 1);
});
