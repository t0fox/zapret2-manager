import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import mutations from './canonical-json-v1-mutations.json' with { type: 'json' };
import {
  LIMITS, canonicalizeReference, canonicalizeValue, deterministicValues,
  materializeGenerator, permutedObjectEntries,
} from './canonical-json-v1-oracle.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-atomic-json-property-'));
const buildRoot = path.join(root, 'build');
const helper = path.join(buildRoot, 'helper');
const prefix = path.join(root, 'prefix');
const buildScript = 'tests/native/core/build-fs-helper.sh';
const roots = {
  persistent_state: 'etc/zapret2-manager/state', snapshots: 'etc/zapret2-manager/snapshots',
  registry: 'etc/zapret2-manager/registry', secrets: 'etc/zapret2-manager/secrets',
  runtime: 'tmp/zapret2-manager/runtime', jobs: 'tmp/zapret2-manager/jobs',
  locks: 'tmp/zapret2-manager/locks', staging: 'tmp/zapret2-manager/staging',
};

function request(value, target, rootName = 'runtime') {
  const prefix = Buffer.from('{"protocolVersion":1,"requestId":"property",'
    + '"operation":"atomic_write_json","arguments":{"root":"'
    + rootName + '","path":"' + target + '","value":');
  const rawValue = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([prefix, rawValue,
    Buffer.from(',"mode":"0600","uid":0,"gid":0,"allowCreate":true}}')]);
}

function invoke(value, target, env = {}, rootName = 'runtime') {
  const run = spawnSync(helper, [], {
    input: request(value, target, rootName),
    env: { ...process.env, Z2M_TEST_ROOT_PREFIX: prefix, ...env },
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15000,
  });
  const stdout = run.stdout.toString('utf8');
  let response = null;
  try { response = JSON.parse(stdout); } catch {}
  return { ...run, stdout, stderr: run.stderr.toString('utf8'), response };
}

function targetPath(rootName, target) {
  return path.join(prefix, roots[rootName], target);
}

function snapshot(target) {
  const parent = path.dirname(target);
  return {
    target: fs.existsSync(target) ? fs.readFileSync(target) : null,
    parent: fs.readdirSync(parent).sort(),
  };
}

function expectSuccess(run, bytes, durability = 'tmpfs_visible') {
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.response?.data, {
    byteLength: bytes.length, committed: true, durability,
  });
}

function expectValidationFailure(run, code = 'ESCHEMA', stage = 'canonical_validate') {
  assert.equal(run.status, ['ETOOBIG', 'EIO'].includes(code) ? 4 : 2, run.stderr || run.stdout);
  assert.equal(run.response?.error?.code, code);
  assert.equal(run.response?.error?.stage, stage);
  assert.equal(run.response?.error?.committed, false);
  assert.equal(run.response?.error?.durability, 'unchanged');
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function setupRoot() {
  fs.mkdirSync(buildRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(prefix, { recursive: true, mode: 0o700 });
  for (const relative of Object.values(roots)) {
    const directory = path.join(prefix, relative);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  for (const directory of [
    prefix, path.join(prefix, 'etc'), path.join(prefix, 'etc/zapret2-manager'),
    path.join(prefix, 'tmp'), path.join(prefix, 'tmp/zapret2-manager'),
  ]) fs.chmodSync(directory, 0o700);
}

test('Task H exact-target evidence records a result', () => {
  const evidence = fs.readFileSync(
    'tests/native/core/atomic-write-json-exact-target-evidence.txt', 'utf8');
  assert.match(evidence, /^Exact-target result: (PASS|NOT RUN)$/m);
  assert.match(evidence, /^Executed input commit: [0-9a-f]{40}$/m);
  assert.match(evidence, /^SHA256 canonical corpus: [0-9a-f]{64}$/m);
  assert.match(evidence, /^SHA256 mutation corpus: [0-9a-f]{64}$/m);
  assert.match(evidence, /^Pass count: [0-9]+$/m);
  assert.match(evidence, /^Fail count: [0-9]+$/m);
  assert.match(evidence, /^Skip count: [0-9]+$/m);
  assert.match(evidence, /^SHA256 raw TAP artifact: (NOT RUN|[0-9a-f]{64})$/m);
});

test.before(() => {
  assert.equal(process.getuid?.(), 0, 'production property matrix requires root');
  setupRoot();
  const build = spawnSync('sh', [buildScript, helper, '-DZ2M_TESTING'], {
    env: { ...process.env, TMPDIR: root }, encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('production canonical values are fixed points and preserve arrays and key permutation hashes', () => {
  for (const [index, value] of deterministicValues().entries()) {
    const expected = Buffer.from(canonicalizeValue(value));
    const run = invoke(JSON.stringify(value), `property-${index}.json`);
    expectSuccess(run, expected);
    assert.deepEqual(fs.readFileSync(targetPath('runtime', `property-${index}.json`)), expected);
  }

  const value = { z: [3, 2, 1], a: { y: 2, x: 1 }, n: null };
  const expected = Buffer.from(canonicalizeValue(value));
  const expectedHash = hash(expected);
  for (const [index, seed] of [1, 2, 3, 0x5eed].entries()) {
    const permuted = permutedObjectEntries(Object.entries(value), seed);
    const run = invoke(JSON.stringify(permuted), 'property-permuted.json');
    expectSuccess(run, expected);
    const actual = fs.readFileSync(targetPath('runtime', 'property-permuted.json'));
    assert.equal(hash(actual), expectedHash, `permutation ${index}`);
  }
  assert.deepEqual(fs.readFileSync(targetPath('runtime', 'property-permuted.json')), expected);
});

test('production accepts every exact frozen bound and rejects the first value over', () => {
  const cases = [
    ['depth', 'nested_object', 'depth', LIMITS.depth],
    ['containers', 'container_count', 'count', LIMITS.containers],
    ['members', 'object_member_count', 'count', LIMITS.members],
    ['nodes', 'node_count', 'count', LIMITS.nodes],
    ['key bytes', 'key_bytes', 'bytes', LIMITS.keyBytes],
    ['output bytes', 'canonical_output_bytes', 'bytes', LIMITS.outputBytes],
  ];
  for (const [name, kind, field, limit] of cases) {
    const exactValue = materializeGenerator({ kind, [field]: limit });
    const expected = Buffer.from(canonicalizeReference(exactValue));
    const exactTarget = `property-bound-${kind}-exact.json`;
    const exact = invoke(exactValue, exactTarget);
    expectSuccess(exact, expected, 'tmpfs_visible');
    assert.deepEqual(fs.readFileSync(targetPath('runtime', exactTarget)), expected, name);

    const overValue = materializeGenerator({ kind, [field]: limit + 1 });
    const overTarget = `property-bound-${kind}-over.json`;
    const before = snapshot(targetPath('runtime', overTarget));
    const over = invoke(overValue, overTarget);
    expectValidationFailure(over, kind === 'canonical_output_bytes' ? 'ETOOBIG' : 'ESCHEMA',
      kind === 'canonical_output_bytes' ? 'canonical_size' : 'canonical_validate');
    assert.deepEqual(snapshot(targetPath('runtime', overTarget)), before, name);
  }
});

test('production mutation corpus rejects before filesystem side effects', () => {
  for (const [index, mutation] of mutations.entries()) {
    const value = mutation.inputBytesHex ? Buffer.from(mutation.inputBytesHex, 'hex') : mutation.input;
    const target = `property-mutation-${index}.json`;
    const before = snapshot(targetPath('runtime', target));
    const run = invoke(value, target);
    const outputError = mutation.class === 'output_too_large';
    const malformed = ['malformed_lexical_json', 'trailing_data', 'invalid_utf8'].includes(mutation.class);
    expectValidationFailure(run, outputError ? 'ETOOBIG' : malformed ? 'EMALFORMED' : 'ESCHEMA',
      outputError ? 'canonical_size' : malformed ? (mutation.class === 'invalid_utf8' ? 'utf8' : mutation.class === 'trailing_data' ? 'trailing_data' : 'json_decode') : 'canonical_validate');
    assert.deepEqual(snapshot(targetPath('runtime', target)), before, mutation.id);
  }
});

test('production allocation failures remain publication-free', () => {
  for (let failAfter = 1; failAfter <= 20; failAfter++) {
    const target = `property-alloc-${failAfter}.json`;
    const before = snapshot(targetPath('runtime', target));
    const run = invoke('{"a":1}', target, {
      Z2M_TEST_ALLOC_FAIL_AFTER: String(failAfter),
    });
    assert.notEqual(run.status, 0, `allocation ${failAfter} unexpectedly succeeded`);
    assert.deepEqual(snapshot(targetPath('runtime', target)), before, `allocation ${failAfter}`);
  }
});

test('production JSON publication matches every atomic fault and uncertainty phase', () => {
  const value = '{"a":1}';
  const expected = Buffer.from(value);
  const prePublication = [
    'before_create', 'after_create', 'before_write', 'after_write', 'before_chown',
    'after_chown', 'before_chmod', 'after_chmod', 'before_file_fsync',
    'after_file_fsync', 'before_candidate_verify', 'after_candidate_verify',
    'before_cas', 'after_cas', 'before_rename',
  ];
  for (const phase of prePublication) {
    const target = `property-fault-${phase}.json`;
    const before = snapshot(targetPath('persistent_state', target));
    const run = invoke(value, target, { Z2M_TEST_ATOMIC_FAULT: phase }, 'persistent_state');
    const stage = ['before_create'].includes(phase) ? 'object_open'
      : ['after_chmod', 'before_file_fsync', 'after_file_fsync', 'before_candidate_verify'].includes(phase) ? 'file_fsync'
        : ['after_candidate_verify', 'before_cas'].includes(phase) ? 'object_open'
          : ['after_cas'].includes(phase) ? 'rename'
            : phase === 'before_rename' ? 'rename' : 'write';
    expectValidationFailure(run, 'EIO', stage);
    assert.deepEqual(snapshot(targetPath('persistent_state', target)), before, phase);
  }

  const uncertain = ['after_rename', 'before_parent_fsync', 'after_parent_fsync',
    'before_final_verify', 'after_final_verify'];
  for (const phase of uncertain) {
    const target = `property-uncertain-${phase}.json`;
    const run = invoke(value, target, { Z2M_TEST_ATOMIC_FAULT: phase }, 'persistent_state');
    assert.equal(run.status, 6, run.stderr || run.stdout);
    assert.equal(run.response?.error?.code, 'ECOMMITUNKNOWN', phase);
    assert.equal(run.response?.error?.stage, 'directory_fsync');
    assert.deepEqual(fs.readFileSync(targetPath('persistent_state', target)), expected, phase);
  }
  const fsyncTarget = 'property-uncertain-directory-fsync.json';
  const fsyncRun = invoke(value, fsyncTarget, {
    Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1',
  }, 'persistent_state');
  assert.equal(fsyncRun.status, 6, fsyncRun.stderr || fsyncRun.stdout);
  assert.equal(fsyncRun.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.deepEqual(fs.readFileSync(targetPath('persistent_state', fsyncTarget)), expected);
});
