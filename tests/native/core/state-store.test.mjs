import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SOCKET_PATH, childExited, requestFrameBody, withPeer,
} from './ucode-test-harness.mjs';

after(() => fs.rmSync(SOCKET_PATH, { force: true }));

const MODULE = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/core/state-store.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS_JSON
  ? JSON.parse(process.env.UCODE_ARGS_JSON)
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const UCODE_LIBRARY_ARGS = process.env.UCODE_MODULE_PATH ? ['-L', process.env.UCODE_MODULE_PATH] : [];

const success = (id, data) => `${JSON.stringify({ protocolVersion: 1, requestId: id, ok: true, data })}\n`;
const helperFailure = (id, code, stage, exitCode, overrides = {}) => ({
  exitCode,
  stdout: `${JSON.stringify({
    protocolVersion: 1, requestId: id, ok: false,
    error: {
      code,
      message: overrides.message ?? 'State helper failure.',
      retryable: overrides.retryable ?? false,
      committed: overrides.committed ?? false,
      durability: overrides.durability ?? 'unchanged',
      stage,
    },
  })}\n`,
});

function invokeState(expression, timeout = 10000) {
  const source = `import * as state from '${MODULE}'; print(sprintf('%J', ${expression}));`;
  const child = spawn(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: process.cwd(),
    env: { ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? '/opt/ucode/lib' },
  });
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const guard = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('state-store ucode timeout')); }, timeout);
    child.once('error', error => { clearTimeout(guard); reject(error); });
    child.once('close', (status, signal) => {
      clearTimeout(guard);
      try {
        assert.equal(signal, null, stderr);
        assert.equal(status, 0, stderr || stdout);
        resolve(JSON.parse(stdout));
      } catch (error) { reject(error); }
    });
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function state(generation = 0, serviceState = 'stopped') {
  return {
    schemaVersion: 1,
    generation,
    generatedAt: '2026-08-10T12:00:00Z',
    serviceState,
    runtime: { processes: [], namespaces: [] },
    transactions: [], jobs: [], warnings: [],
  };
}

async function withStore(initial, options, callback) {
  let current = initial == null ? null : canonical(initial);
  let writes = 0;
  let requests = 0;
  const history = [];
  const run = await withPeer((socket, wire) => {
    requests++;
    const request = requestFrameBody(wire);
    history.push(request.body.operation);
    const { requestId } = request.header;
    const args = request.body.arguments;

    if (request.body.operation === 'read_regular') {
      assert.deepEqual(args, { root: 'persistent_state', path: 'manager-state.json', maxBytes: 521028 });
      if (current == null) {
        const f = helperFailure(requestId, 'ENOENT', 'object_open', 4);
        socket.end(childExited(requestId, f.stdout, f.exitCode));
      } else {
        socket.end(childExited(requestId, success(requestId, {
          content: Buffer.from(current).toString('base64'), byteLength: Buffer.byteLength(current),
        })));
      }
      return;
    }

    if (request.body.operation === 'sha256_regular') {
      assert.deepEqual(args, { root: 'persistent_state', path: 'manager-state.json', maxBytes: 521028 });
      if (current == null) {
        const f = helperFailure(requestId, 'ENOENT', 'object_open', 4);
        socket.end(childExited(requestId, f.stdout, f.exitCode));
      } else socket.end(childExited(requestId, success(requestId, {
        sha256: createHash('sha256').update(current).digest('hex'), byteLength: Buffer.byteLength(current),
      })));
      return;
    }

    if (request.body.operation === 'atomic_write_json') {
      writes++;
      assert.equal(args.root, 'persistent_state');
      assert.equal(args.path, 'manager-state.json');
      assert.equal(args.mode, '0600'); assert.equal(args.uid, 0); assert.equal(args.gid, 0);
      if (args.allowCreate === false) assert.equal(args.expectedSha256,
        createHash('sha256').update(current).digest('hex'));
      const candidate = canonical(args.value);
      const action = options?.onWrite?.({ writes, request, candidate, current }) ?? { kind: 'success', commit: true };
      if (action.commit) current = candidate;
      if (action.replaceWith !== undefined) current = action.replaceWith == null ? null : canonical(action.replaceWith);
      if (action.kind === 'disconnect') { socket.destroy(); return; }
      if (action.kind === 'uncertain') {
        const f = helperFailure(requestId, 'ECOMMITUNKNOWN', 'directory_fsync', 6, {
          committed: true, durability: 'unknown', message: 'Commit may be visible but durability is unknown.',
        });
        socket.end(childExited(requestId, f.stdout, f.exitCode));
        return;
      }
      if (action.kind === 'conflict') {
        const f = helperFailure(requestId, 'ECONFLICT', 'precondition', 4);
        socket.end(childExited(requestId, f.stdout, f.exitCode));
        return;
      }
      socket.end(childExited(requestId, success(requestId, {
        byteLength: Buffer.byteLength(candidate), committed: true, durability: 'durable',
      })));
      return;
    }

    throw new Error(`unexpected helper operation ${request.body.operation}`);
  }, async () => callback({ get current() { return current; }, get writes() { return writes; }, get requests() { return requests; }, history }));
  return run;
}

test('state_validate accepts the frozen v1 envelope and rejects corrupt shapes', async () => {
  const valid = await invokeState(`state.state_validate(${JSON.stringify(state(4, 'running'))})`);
  assert.equal(valid.ok, true);
  assert.equal(valid.state.generation, 4);

  for (const bad of [
    { ...state(), schemaVersion: 2 },
    { ...state(), generation: -1 },
    { ...state(), serviceState: 'unknown' },
    { ...state(), runtime: { processes: [] } },
    { ...state(), warnings: [{ code: 'x' }] },
    { ...state(), extra: true },
  ]) {
    const result = await invokeState(`state.state_validate(${JSON.stringify(bad)})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ESCHEMA');
  }
});

test('state_validate enforces every frozen nested v1 shape and primitive type', async () => {
  const processIdentity = {
    pid: 123, startTime: 456, exe: '/usr/bin/nfqws2', argvSha256: 'a'.repeat(64),
    owner: 'runtime/nfqws2', generation: 4,
  };
  const full = {
    ...state(4, 'partial'),
    runtime: { processes: [processIdentity], namespaces: [{
      namespace: 'config/global', owner: 'transaction/01J4', generation: 4,
      acquiredAt: '2026-08-10T12:00:00Z', process: processIdentity,
    }] },
    transactions: [{
      id: '01J4', kind: 'config_apply', phase: 'verifying', generation: 4,
      namespaces: ['config/global'], createdAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:00:01Z', error: null,
    }],
    jobs: [{
      id: '01J5', kind: 'dns_verify', state: 'running', generation: 4,
      owner: 'jobs/dns_verify', createdAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:00:01Z', result: null, error: null,
    }],
    warnings: [{ code: 'WTEST', message: 'test warning' }],
  };
  assert.equal((await invokeState(`state.state_validate(${JSON.stringify(full)})`)).ok, true);

  const invalid = [
    { ...full, generatedAt: '2026-08-10T12:00:00+01:00' },
    { ...full, generation: 1.5 },
    { ...full, runtime: { ...full.runtime, processes: [{
      pid: processIdentity.pid, startTime: processIdentity.startTime, exe: processIdentity.exe,
      argvSha256: processIdentity.argvSha256, generation: processIdentity.generation,
    }] } },
    { ...full, runtime: { ...full.runtime, namespaces: [{ ...full.runtime.namespaces[0], namespace: '/bad' }] } },
    { ...full, transactions: [{ ...full.transactions[0], phase: 'unknown' }] },
    { ...full, jobs: [{ ...full.jobs[0], state: 'unknown' }] },
    { ...full, warnings: [{ code: 'WTEST', message: 1 }] },
  ];
  for (const value of invalid) {
    const result = await invokeState(`state.state_validate(${JSON.stringify(value)})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ESCHEMA');
  }
});

test('state_read returns validated state and never defaults malformed storage', async () => {
  await withStore(state(7, 'paused'), {}, async store => {
    const result = await invokeState('state.state_read()');
    assert.equal(result.ok, true);
    assert.equal(result.generation, 7);
    assert.equal(result.data.state.serviceState, 'paused');
    assert.equal(store.writes, 0);
  });

  await withStore(null, {}, async store => {
    const result = await invokeState('state.state_read()');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EDEPENDENCY');
    assert.equal(store.writes, 0);
  });
});

test('state_initialize creates generation zero exactly once when state is absent', async () => {
  await withStore(null, {}, async store => {
    const result = await invokeState('state.state_initialize()');
    assert.equal(result.ok, true);
    assert.equal(result.generation, 0);
    assert.equal(result.data.state.schemaVersion, 1);
    assert.equal(result.data.state.serviceState, 'stopped');
    assert.deepEqual(result.data.state.runtime, { processes: [], namespaces: [] });
    assert.equal(store.writes, 1);
    assert.deepEqual(store.history, ['read_regular', 'atomic_write_json']);
  });
});

test('state_initialize rereads a concurrent winner after create conflict without retrying the write', async () => {
  const winner = state(3, 'running');
  await withStore(null, {
    onWrite: () => ({ kind: 'conflict', commit: false, replaceWith: winner }),
  }, async store => {
    const result = await invokeState('state.state_initialize()');
    assert.equal(result.ok, true);
    assert.equal(result.generation, 3);
    assert.equal(result.data.state.serviceState, 'running');
    assert.equal(store.writes, 1);
    assert.deepEqual(store.history, ['read_regular', 'atomic_write_json', 'read_regular']);
  });
});

test('state_mutate enforces CAS generation and increments exactly once', async () => {
  await withStore(state(5), {}, async store => {
    const stale = await invokeState(`state.state_mutate(4, (s) => { s.serviceState = 'running'; return s; })`);
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, 'ECONFLICT');
    assert.equal(stale.generation, 5);
    assert.equal(store.writes, 0);
  });

  await withStore(state(5), {}, async store => {
    const result = await invokeState(`state.state_mutate(5, (s) => { s.serviceState = 'running'; return s; })`);
    assert.equal(result.ok, true);
    assert.equal(result.generation, 6);
    assert.equal(result.data.state.generation, 6);
    assert.equal(result.data.state.serviceState, 'running');
    assert.equal(store.writes, 1);
  });
});

test('state_mutate rejects callback writes to reserved envelope metadata before publication', async () => {
  for (const body of [
    `s.schemaVersion = 9`, `s.generation = 99`, `s.generatedAt = '2000-01-01T00:00:00Z'`,
  ]) await withStore(state(2), {}, async store => {
    const result = await invokeState(`state.state_mutate(2, (s) => { ${body}; return s; })`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EINPUT');
    assert.equal(result.generation, 2);
    assert.equal(store.writes, 0);
  });
});

test('uncertain mutation reconciles exact candidate as committed success with one write', async () => {
  await withStore(state(8), {
    onWrite: () => ({ kind: 'uncertain', commit: true }),
  }, async store => {
    const result = await invokeState(`state.state_mutate(8, (s) => { s.serviceState = 'paused'; return s; })`);
    assert.equal(result.ok, true);
    assert.equal(result.generation, 9);
    assert.equal(result.data.reconciled, true);
    assert.equal(result.data.state.serviceState, 'paused');
    assert.equal(store.writes, 1);
  });
});

test('uncertain mutation reconciles exact previous as not visible without retry', async () => {
  await withStore(state(8), {
    onWrite: () => ({ kind: 'uncertain', commit: false }),
  }, async store => {
    const result = await invokeState(`state.state_mutate(8, (s) => { s.serviceState = 'paused'; return s; })`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EAPPLY');
    assert.equal(result.generation, 8);
    assert.equal(result.error.details.reconciliation, 'previous_visible');
    assert.equal(store.writes, 1);
  });
});

test('uncertain mutation reports a valid third state as conflict without retry', async () => {
  const third = state(10, 'running');
  await withStore(state(8), {
    onWrite: () => ({ kind: 'uncertain', commit: false, replaceWith: third }),
  }, async store => {
    const result = await invokeState(`state.state_mutate(8, (s) => { s.serviceState = 'paused'; return s; })`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ECONFLICT');
    assert.equal(result.generation, 10);
    assert.equal(result.error.details.reconciliation, 'third_state');
    assert.equal(store.writes, 1);
  });
});

test('transport uncertainty after delivery reconciles by reread and never issues a second write', async () => {
  await withStore(state(12), {
    onWrite: () => ({ kind: 'disconnect', commit: true }),
  }, async store => {
    const result = await invokeState(`state.state_mutate(12, (s) => { s.serviceState = 'running'; return s; })`);
    assert.equal(result.ok, true);
    assert.equal(result.generation, 13);
    assert.equal(result.data.reconciled, true);
    assert.equal(store.writes, 1);
  });
});

for (const [label, action] of [
  ['helper ECOMMITUNKNOWN', { kind: 'uncertain' }],
  ['transport unknown', { kind: 'disconnect' }],
]) {
  for (const [observed, replaceWith, code] of [
    ['candidate', undefined, null],
    ['previous', state(8), 'EAPPLY'],
    ['third valid', state(10, 'running'), 'ECONFLICT'],
    ['missing', null, 'EDEPENDENCY'],
    ['malformed', '{bad', 'EDEPENDENCY'],
  ]) test(`${label} classifies ${observed} after exactly one mutation publication`, async () => {
    await withStore(state(8), {
      onWrite: ({ candidate }) => ({
        ...action, commit: observed === 'candidate',
        ...(observed === 'candidate' ? {} : { replaceWith }),
      }),
    }, async store => {
      const result = await invokeState(`state.state_mutate(8, (s) => { s.serviceState = 'paused'; return s; })`);
      if (code == null) assert.equal(result.ok, true);
      else assert.equal(result.error.code, code);
      assert.equal(store.writes, 1);
    });
  });
}
