import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {
  SOCKET_PATH, MODULE, brokerResult, childExited, invoke, requestFrameBody, responseFrame, withPeer,
  withRawPeer,
} from './ucode-test-harness.mjs';

after(() => fs.rmSync(SOCKET_PATH, { force: true }));

const success = (id, data) =>
  `${JSON.stringify({ protocolVersion: 1, requestId: id, ok: true, data })}\n`;
const failure = (id, code = 'ENOENT', overrides = {}) => `${JSON.stringify({
  protocolVersion: 1, requestId: id, ok: false,
  error: { code, message: 'Managed object does not exist.', retryable: false,
    committed: false, durability: 'unchanged', stage: 'object_open', ...overrides },
})}\n`;

async function roundTrip(expression, makeResponse = ({ header }) => childExited(
  header.requestId, success(header.requestId, {
    type: 'regular', size: 7, mode: '0600', uid: 0, gid: 0, mtimeSec: 1, mtimeNsec: 2,
  }))) {
  let request;
  const result = await withPeer((socket, wire) => {
    request = requestFrameBody(wire);
    socket.end(makeResponse(request));
  }, () => invoke(expression));
  return { result, request };
}

test('exports only the five typed operations and sends exact closed helper requests', async () => {
  const cases = [
    [`native.stat_regular('runtime', 'state.bin')`, 'stat_regular',
      { root: 'runtime', path: 'state.bin' }, 5000,
      { type: 'regular', size: 7, mode: '0600', uid: 0, gid: 0, mtimeSec: 1, mtimeNsec: 2 }],
    [`native.read_regular('jobs', 'out.bin', 12)`, 'read_regular',
      { root: 'jobs', path: 'out.bin', maxBytes: 12 }, 10000,
      { content: 'YWJj', byteLength: 3 }],
    [`native.mkdir_private('runtime', 'child', true)`, 'mkdir_private',
      { root: 'runtime', path: 'child', mode: '0700', uid: 0, gid: 0, existOk: true }, 10000,
      { created: true, committed: true, durability: 'tmpfs_visible' }],
    [`native.sha256_regular('jobs', 'hash.bin', 99)`, 'sha256_regular',
      { root: 'jobs', path: 'hash.bin', maxBytes: 99 }, 10000,
      { sha256: 'a'.repeat(64), byteLength: 3 }],
    [`native.atomic_write('persistent_state', 'state.bin', 'YQ==', false)`, 'atomic_write',
      { root: 'persistent_state', path: 'state.bin', content: 'YQ==', mode: '0600', uid: 0, gid: 0, allowCreate: false }, 30000,
      { byteLength: 1, committed: true, durability: 'durable' }],
  ];
  const ids = new Set();
  for (const [expression, operation, args, timeoutMs, data] of cases) {
    const { result, request } = await roundTrip(expression, ({ header }) =>
      childExited(header.requestId, success(header.requestId, data)));
    assert.deepEqual(result, { ok: true, data });
    assert.deepEqual(request.body, {
      protocolVersion: 1, requestId: request.header.requestId, operation, arguments: args,
    });
    assert.deepEqual(request.header, {
      protocol: 'z2m-helper-transport-v1', requestId: request.header.requestId, timeoutMs,
    });
    assert.match(request.header.requestId, /^[A-Za-z0-9._:-]{1,128}$/);
    assert.equal(request.body.requestId, request.header.requestId);
    assert.equal(ids.has(request.header.requestId), false, 'generated request IDs must be unique');
    ids.add(request.header.requestId);
  }
  assert.deepEqual(await invoke(`sort(keys(native))`),
    ['atomic_write', 'mkdir_private', 'read_regular', 'sha256_regular', 'stat_regular']);
});

test('rejects invalid typed arguments before opening the fixed socket', async () => {
  fs.rmSync(SOCKET_PATH, { force: true });
  for (const expression of [
    `native.stat_regular('/absolute', 'x')`, `native.read_regular('runtime', '../x', 1)`,
    `native.read_regular('runtime', 'x', 1.5)`, `native.mkdir_private('runtime', 'x', 1)`,
    `native.sha256_regular('runtime', 'x', 4194305)`,
    `native.atomic_write('runtime', 'x', 'not-base64', true)`,
  ]) assert.equal((await invoke(expression)).error.code, 'EINPUT');
});

test('preserves a valid structured helper failure as a normal semantic error', async () => {
  const { result } = await roundTrip(`native.stat_regular('runtime', 'missing')`, ({ header }) =>
    childExited(header.requestId, failure(header.requestId), 4));
  assert.deepEqual(result, { ok: false, error: {
    code: 'EDEPENDENCY', message: 'Managed object does not exist.', retryable: false,
    details: { helperCode: 'ENOENT', helperRetryable: false, helperCommitted: false,
      helperDurability: 'unchanged', helperStage: 'object_open' },
  } });
});

test('accepts one helper document with protocol-permitted trailing whitespace', async () => {
  const { result } = await roundTrip(`native.stat_regular('runtime', 'state')`, ({ header }) =>
    childExited(header.requestId, `${success(header.requestId, {
      type: 'regular', size: 7, mode: '0600', uid: 0, gid: 0, mtimeSec: 1, mtimeNsec: 2,
    }).trim()} \t\n`));
  assert.equal(result.ok, true);
});

test('preserves valid helper ECOMMITUNKNOWN separately from transport uncertainty', async () => {
  const { result } = await roundTrip(
    `native.atomic_write('persistent_state', 'state.bin', 'YQ==', true)`, ({ header }) =>
      childExited(header.requestId, failure(header.requestId, 'ECOMMITUNKNOWN', {
        message: 'Commit may be visible but durability is unknown.', committed: true,
        durability: 'unknown', stage: 'directory_fsync',
      }), 6));
  assert.equal(result.error.code, 'EAPPLY');
  assert.deepEqual(result.error.details, {
    helperCode: 'ECOMMITUNKNOWN', helperRetryable: false, helperCommitted: true,
    helperDurability: 'unknown', helperStage: 'directory_fsync',
  });
  assert.equal('commitState' in result.error, false);
});

for (const [name, stdout] of [
  ['empty', ''], ['malformed', '{bad\n'], ['trailing', '{"protocolVersion":1}{}\n'],
  ['partial', '{"protocolVersion":1'],
]) test(`rejects ${name} helper stdout`, async () => {
  const { result } = await roundTrip(`native.stat_regular('runtime', 'x')`, ({ header }) =>
    childExited(header.requestId, stdout));
  assert.equal(result.error.code, 'EINTERNAL');
});

test('rejects wrong helper requestId, protocolVersion, exclusive envelope, metadata, and exit category', async () => {
  const makers = [
    id => childExited(id, success('wrong', {})),
    id => childExited(id, `${JSON.stringify({ protocolVersion: 2, requestId: id, ok: true, data: {} })}\n`),
    id => childExited(id, `${JSON.stringify({ protocolVersion: 1, requestId: id, ok: true, data: {}, error: {} })}\n`),
    id => childExited(id, failure(id, 'ENOENT', { retryable: 'no' }), 4),
    id => childExited(id, failure(id, 'ENOENT', { retryable: true }), 4),
    id => childExited(id, failure(id, 'ENOENT', { stage: 'directory_fsync' }), 4),
    id => childExited(id, failure(id, 'ENOENT', { committed: true }), 4),
    id => childExited(id, failure(id, 'ECOMMITUNKNOWN', {
      committed: false, durability: 'unknown', stage: 'directory_fsync',
    }), 6),
    id => childExited(id, failure(id), 0),
    id => childExited(id, success(id, {}), 4),
  ];
  for (const maker of makers) {
    const { result } = await roundTrip(`native.stat_regular('runtime', 'x')`, ({ header }) => maker(header.requestId));
    assert.equal(result.error.code, 'EINTERNAL');
  }
});

test('rejects duplicate helper envelope keys before JSON collapse', async () => {
  const { result } = await roundTrip(`native.stat_regular('runtime', 'x')`, ({ header }) =>
    childExited(header.requestId,
      `{"protocolVersion":1,"requestId":"${header.requestId}","ok":true,"ok":true,"data":{}}\n`));
  assert.equal(result.error.code, 'EINTERNAL');
});

test('rejects wrong transport requestId and protocol', async () => {
  for (const override of [{ requestId: 'wrong' }, { protocol: 'wrong' }]) {
    const { result } = await roundTrip(`native.stat_regular('runtime', 'x')`, ({ header }) =>
      childExited(header.requestId, success(header.requestId, {}), 0, override));
    assert.equal(result.error.code, 'EINTERNAL');
  }
});

test('validates every broker outcome and exit/envelope lifecycle consistency', async () => {
  const cases = [
    { outcome: 'timeout', startState: 'started', childReaped: true, signal: 15 },
    { outcome: 'spawn_failure', startState: 'not_started', childReaped: true, stage: 'exec', errno: 2 },
    { outcome: 'setup_failure', startState: 'not_started', childReaped: true, stage: 'stdin_dup2', errno: 9 },
    { outcome: 'transport_failure', startState: 'started', childReaped: true, reason: 'supervision_failure' },
  ];
  for (const extra of cases) {
    const { result } = await roundTrip(`native.stat_regular('runtime', 'x')`, ({ header }) => responseFrame({
      protocol: 'z2m-helper-transport-v1', requestId: header.requestId,
      stdoutLength: 0, stderrLength: 0, stdoutEof: true, stderrEof: true,
      stderrTruncated: false, stderrDrained: 0, ...extra,
    }));
    assert.equal(result.error.code, 'EDEPENDENCY');
  }
  for (const override of [{ childReaped: false }, { stdoutEof: false }, { signal: 9, exitCode: 0 }]) {
    const { result } = await roundTrip(`native.stat_regular('runtime', 'x')`, ({ header }) =>
      childExited(header.requestId, success(header.requestId, {}), 0, override));
    assert.equal(result.error.code, 'EINTERNAL');
  }
});

test('mutation transport damage after possible start is structured unknown with no retry or reconciliation', async () => {
  const result = await withPeer((socket) => socket.destroy(), () =>
    invoke(`native.atomic_write('runtime', 'state.bin', 'YQ==', true)`));
  assert.deepEqual(result.error, {
    code: 'EDEPENDENCY', message: 'Native helper transport outcome is uncertain.', retryable: false,
    commitState: 'unknown', automaticRetry: false, recovery: 'reread_reconcile',
    details: { transport: { issue: 'incomplete' } },
  });
});

test('timeout, reset, malformed, empty, trailing frame, partial, and oversized response fail closed', async () => {
  const peers = [
    socket => setTimeout(() => socket.end(), 5200),
    socket => socket.destroy(),
    socket => socket.end(Buffer.from('bad')),
    socket => socket.end(),
    socket => socket.end(Buffer.concat([responseFrame('{}'), Buffer.from('x')])),
    socket => socket.end(responseFrame('{}').subarray(0, 19)),
    socket => { const frame = responseFrame('{}'); frame.writeUInt32BE(2049, 12); socket.end(frame.subarray(0, 20)); },
  ];
  for (const peer of peers) {
    const result = await withPeer((socket) => peer(socket), () =>
      invoke(`native.stat_regular('runtime', 'x')`, 7000));
    assert.ok(['EDEPENDENCY', 'EINTERNAL'].includes(result.error.code));
  }
});

test('broker unavailable is bounded and classified as dependency failure', async () => {
  fs.rmSync(SOCKET_PATH, { force: true });
  const result = await invoke(`native.stat_regular('runtime', 'x')`);
  assert.equal(result.error.code, 'EDEPENDENCY');
  assert.equal(result.error.retryable, false);
});

function assertUncertain(result, evidence) {
  assert.deepEqual(result.error, {
    code: 'EDEPENDENCY', message: 'Native helper transport outcome is uncertain.', retryable: false,
    commitState: 'unknown', automaticRetry: false, recovery: 'reread_reconcile',
    details: evidence,
  });
}

test('mutation helper output contradictions are uncertain after proven child start without retry', async () => {
  const cases = [
    ['empty', id => childExited(id, ''), 'empty'],
    ['malformed', id => childExited(id, '{bad\n'), 'malformed'],
    ['trailing', id => childExited(id, '{"protocolVersion":1}{}\n'), 'trailing'],
    ['partial', id => childExited(id, '{"protocolVersion":1'), 'partial'],
    ['wrong-id', id => childExited(id, success('wrong', {})), 'request_id'],
    ['wrong-version', id => childExited(id, `${JSON.stringify({ protocolVersion: 2, requestId: id, ok: true, data: {} })}\n`), 'protocol'],
    ['envelope', id => childExited(id, `${JSON.stringify({ protocolVersion: 1, requestId: id, ok: true, data: {}, error: {} })}\n`), 'envelope'],
    ['exit', id => childExited(id, success(id, { byteLength: 1, committed: true, durability: 'durable' }), 4), 'exit'],
    ['signal', id => childExited(id, '', 0, { exitCode: null, signal: 9 }), 'signal'],
  ];
  for (const [name, make, issue] of cases) {
    let requests = 0;
    const { result } = await roundTrip(
      `native.atomic_write('persistent_state', 'state.bin', 'YQ==', true)`, ({ header }) => {
        requests++;
        return make(header.requestId);
      });
    assertUncertain(result, { transport: { outcome: 'child_exited', startState: 'started' }, helper: { issue } });
    assert.equal(requests, 1, `${name} must not retry`);
  }
});

test('mutation malformed transport after delivery is uncertain while proven not-started stays ordinary', async () => {
  for (const wire of [Buffer.from('bad'), responseFrame('{'), (() => {
    const frame = responseFrame('{}'); frame.writeUInt32BE(2049, 12); return frame.subarray(0, 20);
  })(), childExited('wrong', '', 0), childExited('ignored', '', 0, { protocol: 'wrong' })]) {
    const result = await withPeer(socket => socket.end(wire), () =>
      invoke(`native.atomic_write('runtime', 'state.bin', 'YQ==', true)`));
    assert.equal(result.error.commitState, 'unknown');
    assert.equal(result.error.automaticRetry, false);
    assert.equal(result.error.recovery, 'reread_reconcile');
  }
  for (const [outcome, metadata] of [
    ['spawn_failure', { stage: 'exec', errno: 2 }],
    ['setup_failure', { stage: 'stdin_dup2', errno: 9 }],
  ]) {
    const { result } = await roundTrip(`native.mkdir_private('runtime', 'x', true)`, ({ header }) =>
      brokerResult(header.requestId, outcome, { startState: 'not_started', ...metadata }));
    assert.equal(result.error.code, 'EDEPENDENCY');
    assert.equal('commitState' in result.error, false);
  }
});

test('production broker result table accepts serialized status, shutdown, timeout, and started failures', async () => {
  const table = [
    ['status_protocol', 'not_started', true, false],
    ['daemon_shutdown', 'started', true, true],
    ['client_disconnect', 'started', true, true],
    ['stdout_limit', 'started', true, true],
    ['supervision_failure', 'unknown', false, true],
  ];
  for (const [reason, startState, childReaped, mutationUncertain] of table) {
    const { result } = await roundTrip(`native.atomic_write('runtime', 'state.bin', 'YQ==', true)`,
      ({ header }) => brokerResult(header.requestId, 'transport_failure', {
        reason, startState, childReaped,
        stdoutEof: childReaped, stderrEof: childReaped,
      }));
    assert.equal(result.error.commitState == 'unknown', mutationUncertain, reason);
  }
  const { result } = await roundTrip(`native.mkdir_private('runtime', 'timeout', true)`, ({ header }) =>
    brokerResult(header.requestId, 'timeout', { signal: 15 }));
  assertUncertain(result, { transport: { outcome: 'timeout', startState: 'started', signal: 15 } });
});

test('validates exact operation success schemas and rejects wrong fields types and bounds', async () => {
  const cases = [
    [`native.stat_regular('runtime', 'x')`,
      { type: 'regular', size: 0, mode: '0600', uid: 0, gid: 0, mtimeSec: -1, mtimeNsec: 999999999 },
      [{ type: 'regular', size: -1, mode: '0600', uid: 0, gid: 0, mtimeSec: 0, mtimeNsec: 0 },
       { type: 'regular', size: 0, mode: '0600', uid: 0, gid: 0, mtimeSec: 0, mtimeNsec: 1000000000 },
       { type: 'regular', size: 0, mode: '0600', uid: 0, gid: 0, mtimeSec: 0, mtimeNsec: 0, extra: true }]],
    [`native.read_regular('jobs', 'x', 4)`, { content: 'YQ==', byteLength: 1 },
      [{ content: 'YQ', byteLength: 1 }, { content: 'YQ==', byteLength: 4194305 }, { content: 'YQ==', byteLength: 1, extra: 1 }]],
    [`native.mkdir_private('runtime', 'x', true)`, { created: false, committed: true, durability: 'tmpfs_visible' },
      [{ created: 0, committed: true, durability: 'tmpfs_visible' }, { created: true, committed: false, durability: 'durable' }]],
    [`native.sha256_regular('jobs', 'x', 4)`, { sha256: '0'.repeat(64), byteLength: 0 },
      [{ sha256: 'A'.repeat(64), byteLength: 0 }, { sha256: '0'.repeat(64), byteLength: -1 }]],
    [`native.atomic_write('runtime', 'x', 'YQ==', true)`, { byteLength: 1, committed: true, durability: 'tmpfs_visible' },
      [{ byteLength: -1, committed: true, durability: 'tmpfs_visible' }, { byteLength: 1, committed: true, durability: 'unknown' }]],
  ];
  for (const [expression, valid, invalid] of cases) {
    const accepted = await roundTrip(expression, ({ header }) =>
      childExited(header.requestId, success(header.requestId, valid)));
    assert.deepEqual(accepted.result, { ok: true, data: valid });
    for (const data of invalid) {
      const rejected = await roundTrip(expression, ({ header }) =>
        childExited(header.requestId, success(header.requestId, data)));
      if (expression.includes('atomic_write') || expression.includes('mkdir_private'))
        assert.equal(rejected.result.error.commitState, 'unknown');
      else assert.equal(rejected.result.error.code, 'EINTERNAL');
    }
  }
});

test('rejects escaped-equivalent duplicate keys recursively in helper data error details and arrays', async () => {
  const wires = [
    id => `{"protocolVersion":1,"requestId":"${id}","ok":true,"data":{"byteLength":1,"byte\\u004cength":1,"content":"YQ=="}}\n`,
    id => `{"protocolVersion":1,"requestId":"${id}","ok":false,"error":{"code":"ENOENT","c\\u006fde":"ENOENT","message":"x","retryable":false,"committed":false,"durability":"unchanged","stage":"object_open"}}\n`,
    id => `{"protocolVersion":1,"requestId":"${id}","ok":false,"error":{"code":"ENOENT","message":"x","retryable":false,"committed":false,"durability":"unchanged","stage":"object_open","details":{"path":"x","p\\u0061th":"y","items":[{"a":1,"\\u0061":2}]}}}\n`,
  ];
  for (const make of wires) {
    const { result } = await roundTrip(`native.read_regular('jobs', 'x', 4)`, ({ header }) =>
      childExited(header.requestId, make(header.requestId), make === wires[0] ? 0 : 4));
    assert.equal(result.error.code, 'EINTERNAL');
  }
});

test('stale socket refusal and reset before or after request delivery never retry', async () => {
  fs.mkdirSync('/tmp/zapret2-manager/runtime', { recursive: true, mode: 0o700 });
  fs.rmSync(SOCKET_PATH, { force: true });
  const stale = net.createServer();
  await new Promise(resolve => stale.listen(SOCKET_PATH, resolve));
  await new Promise(resolve => stale.close(resolve));
  const unavailable = await invoke(`native.atomic_write('runtime', 'x', 'YQ==', true)`);
  assert.equal(unavailable.error.code, 'EDEPENDENCY');
  assert.equal('commitState' in unavailable.error, false);
  fs.rmSync(SOCKET_PATH, { force: true });

  for (const delayed of [false, true]) {
    let requests = 0;
    const result = await withPeer((socket, wire) => {
      requests++;
      if (delayed) socket.write(responseFrame('{}').subarray(0, 8));
      socket.destroy();
      assert.ok(wire.length > 0);
    }, () => invoke(`native.atomic_write('runtime', 'x', '${'YQ=='}', true)`));
    assert.equal(result.error.commitState, 'unknown');
    assert.equal(requests, 1);
  }

  for (const afterBytes of [32]) {
    let connections = 0;
    const result = await withRawPeer(socket => {
      connections++;
      socket.once('data', chunk => {
        assert.ok(chunk.length >= afterBytes);
        socket.destroy();
      });
    }, () => invoke(`native.atomic_write('runtime', 'x', '${'A'.repeat(65536)}', true)`, 7000));
    assert.equal(result.error.commitState, 'unknown');
    assert.equal(result.error.automaticRetry, false);
    assert.equal(connections, 1);
  }
});
