import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-atomic-json-cas-'));
const helper = path.join(root, 'helper');
const prefix = path.join(root, 'prefix');
const target = path.join(prefix, 'etc/zapret2-manager/state/manager-state.json');
let seq = 0;

function request(value, expectedSha256, targetPath = 'manager-state.json', allowCreate = true) {
  const argumentsValue = {
    root: 'persistent_state', path: targetPath, value,
    mode: '0600', uid: 0, gid: 0, allowCreate,
  };
  if (expectedSha256 != null) argumentsValue.expectedSha256 = expectedSha256;
  return {
    protocolVersion: 1, requestId: `cas-${++seq}`,
    operation: 'atomic_write_json', arguments: argumentsValue,
  };
}

function invoke(value, expectedSha256, targetPath, allowCreate) {
  const run = spawnSync(helper, [], {
    input: JSON.stringify(request(value, expectedSha256, targetPath, allowCreate)),
    env: { ...process.env, Z2M_TEST_ROOT_PREFIX: prefix }, encoding: 'utf8',
  });
  return { ...run, response: JSON.parse(run.stdout) };
}

before(() => {
  assert.equal(process.getuid?.(), 0, 'CAS helper test requires root');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  for (const p of [prefix, path.join(prefix, 'etc'), path.join(prefix, 'etc/zapret2-manager'), path.dirname(target)])
    fs.chmodSync(p, 0o700);
  const build = spawnSync('sh', ['tests/native/core/build-fs-helper.sh', helper, '-DZ2M_TESTING'], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: root },
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('atomic_write_json expectedSha256 performs content CAS under the helper lock', () => {
  const initial = invoke({ generation: 1 }, null);
  assert.equal(initial.status, 0, initial.stderr);
  const initialBytes = fs.readFileSync(target);
  const expected = createHash('sha256').update(initialBytes).digest('hex');

  const replace = invoke({ generation: 2 }, expected, 'manager-state.json', false);
  assert.equal(replace.status, 0, replace.stderr || replace.stdout);
  assert.equal(replace.response.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"generation":2}');

  const beforeBytes = fs.readFileSync(target);
  const stale = invoke({ generation: 3 }, '0'.repeat(64), 'manager-state.json', false);
  assert.equal(stale.status, 4, stale.stderr || stale.stdout);
  assert.equal(stale.response.error.code, 'ECONFLICT');
  assert.equal(stale.response.error.stage, 'precondition');
  assert.deepEqual(fs.readFileSync(target), beforeBytes);
});

test('atomic_write_json expectedSha256 never creates a missing target', () => {
  const run = invoke({ generation: 1 }, '0'.repeat(64), 'missing.json', true);
  assert.equal(run.status, 4, run.stderr || run.stdout);
  assert.equal(run.response.error.code, 'ECONFLICT');
  assert.equal(run.response.error.stage, 'precondition');
  assert.equal(fs.existsSync(path.join(path.dirname(target), 'missing.json')), false);
});
