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
  return invokeRequest(request(value, target, rootName), env);
}

function invokeRequest(input, env = {}) {
  const run = spawnSync(helper, [], {
    input,
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

function sizedRequest(value, targetBytes, target = 'request-boundary.json') {
  const base = request(value, target);
  assert.ok(targetBytes >= base.length, `request base exceeds ${targetBytes} bytes`);
  return Buffer.concat([base, Buffer.alloc(targetBytes - base.length, 0x20)]);
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

function evidenceField(evidence, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...evidence.matchAll(new RegExp(`^${escaped}: (.*)$`, 'gm'))];
  assert.equal(matches.length, 1, `evidence field ${name} must appear exactly once`);
  return matches[0][1];
}

function parseExactTargetTap(tap) {
  const lines = tap.trimEnd().split('\n');
  assert.equal(lines[0], 'TAP version 13');
  const plans = lines.filter(line => /^1\.\.\d+(?: # .+)?$/.test(line));
  assert.equal(plans.length, 1, 'TAP must have one plan');
  const planned = Number(/^1\.\.(\d+)/.exec(plans[0])[1]);
  const points = [];
  for (const line of lines) {
    const skip = /^(not )?ok (\d+) - (.*?) # SKIP (.+)$/.exec(line);
    if (skip) {
      points.push({ ok: !skip[1], number: Number(skip[2]), name: skip[3], skip: skip[4] });
      continue;
    }
    const point = /^(not )?ok (\d+) - (.+)$/.exec(line);
    if (point) points.push({ ok: !point[1], number: Number(point[2]), name: point[3] });
  }
  assert.equal(points.length, planned, 'TAP point count must match plan');
  return {
    planned,
    passed: points.filter(point => point.ok && !point.skip).length,
    failed: points.filter(point => !point.ok).length,
    skipped: points.filter(point => point.skip).length,
    points,
  };
}

function assertNoCandidates(rootName, target) {
  const parent = path.dirname(targetPath(rootName, target));
  assert.deepEqual(fs.readdirSync(parent).filter(name => name.startsWith('.z2m-write-')), []);
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
  const result = evidenceField(evidence, 'Exact-target result');
  assert.ok(['PASS', 'NOT RUN'].includes(result));
  assert.equal(evidenceField(evidence, 'STATUS'), result);
  assert.match(evidenceField(evidence, 'Executed input commit'), /^[0-9a-f]{40}$/);
  for (const [field, file] of [
    ['SHA256 canonical corpus', 'tests/native/core/canonical-json-v1-vectors.json'],
    ['SHA256 mutation corpus', 'tests/native/core/canonical-json-v1-mutations.json'],
    ['SHA256 canonical.c', 'zapret2-manager/src/z2m-core-helper/canonical.c'],
    ['SHA256 property test', 'tests/native/core/atomic-write-json-property.test.mjs'],
  ]) assert.equal(evidenceField(evidence, field), hash(fs.readFileSync(file)), field);
  assert.match(evidenceField(evidence, 'SHA256 host strict helper'), /^[0-9a-f]{64}$/);
  assert.match(evidenceField(evidence, 'SHA256 host sanitizer fixture'), /^[0-9a-f]{64}$/);
  for (const field of [
    'Host strict build command', 'Host strict build result',
    'Host sanitizer build command', 'Host sanitizer build result',
    'Host sanitizer test command', 'Host sanitizer test result',
  ]) assert.ok(evidenceField(evidence, field).length > 0);
  assert.equal(evidenceField(evidence, 'Host strict build result'), 'PASS');
  assert.equal(evidenceField(evidence, 'Host sanitizer build result'), 'PASS');
  assert.equal(evidenceField(evidence, 'Host sanitizer test result'), 'PASS');

  const tapFile = evidenceField(evidence, 'Raw TAP artifact');
  const tap = parseExactTargetTap(fs.readFileSync(tapFile, 'utf8'));
  assert.equal(evidenceField(evidence, 'SHA256 raw TAP artifact'), hash(fs.readFileSync(tapFile)));
  assert.equal(Number(evidenceField(evidence, 'Exact-target planned count')), tap.planned);
  assert.equal(Number(evidenceField(evidence, 'Exact-target pass count')), tap.passed);
  assert.equal(Number(evidenceField(evidence, 'Exact-target fail count')), tap.failed);
  assert.equal(Number(evidenceField(evidence, 'Exact-target skip count')), tap.skipped);

  if (result === 'NOT RUN') {
    const reason = evidenceField(evidence, 'Exact-target reason');
    const missing = evidenceField(evidence, 'Missing exact-target variables').split(/\s+/);
    assert.ok(missing.length > 0 && missing.every(Boolean));
    assert.equal(tap.planned, 1);
    assert.equal(tap.passed, 0);
    assert.equal(tap.failed, 0);
    assert.equal(tap.skipped, 1);
    assert.equal(tap.points[0].skip,
      `exact-target NOT RUN: ${reason}; missing variables: ${missing.join(' ')}`);
    assert.equal(evidenceField(evidence, 'Artifact architecture'), 'AArch64 musl, NOT RUN');
    for (const field of [
      'SHA256 packaged z2m-core-helper', 'SHA256 package APK',
      'SHA256 target package Makefile',
    ]) assert.equal(evidenceField(evidence, field), 'NOT RUN');
  } else {
    assert.ok(tap.planned > 0);
    assert.ok(tap.passed > 0);
    assert.equal(tap.failed, 0);
    assert.equal(tap.skipped, 0);
    assert.equal(evidenceField(evidence, 'Artifact architecture'), 'AArch64 musl');
    for (const field of [
      'SHA256 packaged z2m-core-helper', 'SHA256 package APK',
      'SHA256 target package Makefile',
    ]) assert.match(evidenceField(evidence, field), /^[0-9a-f]{64}$/);
  }
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

test('production helper accepts the request wire limit and rejects one byte over', () => {
  const target = 'property-request-bytes.json';
  const expected = Buffer.from('{"a":1}');
  const exact = invokeRequest(sizedRequest('{"a":1}', LIMITS.requestBytes, target));
  expectSuccess(exact, expected);
  assert.deepEqual(fs.readFileSync(targetPath('runtime', target)), expected);

  const overTarget = 'property-request-bytes-over.json';
  const before = snapshot(targetPath('runtime', overTarget));
  const over = invokeRequest(sizedRequest('{"a":1}', LIMITS.requestBytes + 1, overTarget));
  expectValidationFailure(over, 'EREQUESTTOOBIG', 'request_size');
  assert.deepEqual(snapshot(targetPath('runtime', overTarget)), before);
  assertNoCandidates('runtime', overTarget);
});

test('production helper enforces the global member limit across nested objects', () => {
  const exactValue = materializeGenerator({ kind: 'global_member_count', count: LIMITS.members });
  const exactTarget = 'property-global-members-exact.json';
  const exact = invoke(exactValue, exactTarget);
  expectSuccess(exact, Buffer.from(canonicalizeReference(exactValue)));

  const overValue = materializeGenerator({ kind: 'global_member_count', count: LIMITS.members + 1 });
  const overTarget = 'property-global-members-over.json';
  const before = snapshot(targetPath('runtime', overTarget));
  const over = invoke(overValue, overTarget);
  expectValidationFailure(over);
  assert.deepEqual(snapshot(targetPath('runtime', overTarget)), before);
  assertNoCandidates('runtime', overTarget);
});

test('production helper enforces decoded UTF-8 key byte boundaries', () => {
  const exactValue = materializeGenerator({ kind: 'key_utf8_bytes', bytes: LIMITS.keyBytes });
  const exactTarget = 'property-utf8-key-exact.json';
  const exact = invoke(exactValue, exactTarget);
  expectSuccess(exact, Buffer.from(canonicalizeReference(exactValue)));

  const overValue = materializeGenerator({ kind: 'key_utf8_bytes', bytes: LIMITS.keyBytes + 1 });
  const overTarget = 'property-utf8-key-over.json';
  const before = snapshot(targetPath('runtime', overTarget));
  const over = invoke(overValue, overTarget);
  expectValidationFailure(over);
  assert.deepEqual(snapshot(targetPath('runtime', overTarget)), before);
  assertNoCandidates('runtime', overTarget);
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

test('production allocator failures fail closed without publication artifacts', () => {
  for (let failAfter = 1; failAfter <= 20; failAfter++) {
    const target = `property-alloc-${failAfter}.json`;
    const before = snapshot(targetPath('runtime', target));
    const run = invoke('{"a":1}', target, {
      Z2M_TEST_ALLOC_FAIL_AFTER: String(failAfter),
    });
    assert.notEqual(run.status, null, `allocation ${failAfter} timed out`);
    assert.equal(run.signal, null, `allocation ${failAfter} crashed`);
    assert.equal(run.error, undefined, `allocation ${failAfter} failed to spawn`);
    assert.equal(run.status, 74, `allocation ${failAfter} exit status`);
    assert.equal(run.stdout, '', `allocation ${failAfter} emitted partial output`);
    assert.equal(run.response, null, `allocation ${failAfter} emitted a partial response`);
    assert.deepEqual(snapshot(targetPath('runtime', target)), before, `allocation ${failAfter}`);
    assertNoCandidates('runtime', target);
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
    const before = snapshot(targetPath('persistent_state', target));
    const run = invoke(value, target, { Z2M_TEST_ATOMIC_FAULT: phase }, 'persistent_state');
    assert.equal(run.status, 6, run.stderr || run.stdout);
    assert.equal(run.response?.error?.code, 'ECOMMITUNKNOWN', phase);
    assert.equal(run.response?.error?.stage, 'directory_fsync');
    assert.deepEqual(fs.readFileSync(targetPath('persistent_state', target)), expected, phase);
    assertNoCandidates('persistent_state', target);
    assert.notDeepEqual(snapshot(targetPath('persistent_state', target)), before, phase);
  }
  const fsyncTarget = 'property-uncertain-directory-fsync.json';
  const fsyncRun = invoke(value, fsyncTarget, {
    Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1',
  }, 'persistent_state');
  assert.equal(fsyncRun.status, 6, fsyncRun.stderr || fsyncRun.stdout);
  assert.equal(fsyncRun.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.deepEqual(fs.readFileSync(targetPath('persistent_state', fsyncTarget)), expected);
  assertNoCandidates('persistent_state', fsyncTarget);
});
