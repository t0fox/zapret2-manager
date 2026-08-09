import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vectors from './canonical-json-v1-vectors.json' with { type: 'json' };
import mutations from './canonical-json-v1-mutations.json' with { type: 'json' };
import { materializeGenerator } from './canonical-json-v1-oracle.mjs';

const sourceRoot = 'zapret2-manager/src/z2m-core-helper';
const temporaryRoot = mkdtempSync(join(tmpdir(), 'z2m-canonical-validator-'));
const binary = join(temporaryRoot, 'canonical-validator');
const helperBinary = join(temporaryRoot, 'z2m-core-helper');
const sentinel = join(temporaryRoot, 'sentinel');

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

before(() => {
  writeFileSync(sentinel, 'unchanged');
  const compile = spawnSync('cc', [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-I', sourceRoot,
    'tests/native/core/canonical-validator-fixture.c',
    `${sourceRoot}/canonical.c`,
    '-o', binary,
  ], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const helperCompile = spawnSync('sh', [
    'tests/native/core/build-fs-helper.sh', helperBinary,
  ], { encoding: 'utf8' });
  assert.equal(helperCompile.status, 0, helperCompile.stderr);
});

function inputFor(testCase) {
  if (testCase.inputBytesHex) return Buffer.from(testCase.inputBytesHex, 'hex');
  if (testCase.generator) return Buffer.from(materializeGenerator(testCase.generator));
  return Buffer.from(testCase.input);
}

function validate(input) {
  const run = spawnSync(binary, [], { input, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

function expectedResult(classification) {
  if (classification === 'trailing_data') return 'EMALFORMED trailing_data';
  if (classification === 'malformed_lexical_json') return 'EMALFORMED json_decode';
  if (classification === 'invalid_utf8') return 'EMALFORMED utf8';
  return 'ESCHEMA canonical_validate';
}

function requestWithValue(value) {
  return Buffer.from('{"protocolVersion":1,"requestId":"canonical-test",'
    + '"operation":"atomic_write_json","arguments":{"root":"runtime",'
    + `"path":"canonical.json","value":${value},"mode":"0600","uid":0,`
    + '"gid":0,"allowCreate":true}}');
}

function invokeHelper(input) {
  const run = spawnSync(helperBinary, [], { input, encoding: 'utf8' });
  return { status: run.status, response: JSON.parse(run.stdout), stderr: run.stderr };
}

test('raw validator accepts prepared lexical vectors including every exact Task B bound', () => {
  const cases = vectors.accept.filter(({ id }) => id !== 'output-boundary');
  for (const testCase of cases)
    assert.equal(validate(inputFor(testCase)), 'VALID', testCase.id);
});

test('raw validator classifies prepared lexical rejections before semantic construction', () => {
  const cases = vectors.reject.filter(({ id }) => id !== 'output-over');
  for (const testCase of cases)
    assert.equal(validate(inputFor(testCase)), expectedResult(testCase.class), testCase.id);
});

test('raw validator rejects every prepared malformed mutation with its exact error stage', () => {
  for (const mutation of mutations)
    assert.equal(validate(inputFor(mutation)), expectedResult(mutation.class), mutation.id);
});

test('raw validator recognizes only JSON whitespace and applies the escaped NUL key policy', () => {
  assert.equal(validate(Buffer.from(' \t\r\n[0] \t\r\n')), 'VALID');
  assert.equal(validate(Buffer.from('\"\\u0000\"')), 'VALID');
  assert.equal(validate(Buffer.from('{\"\\u0000\":1}')), 'ESCHEMA canonical_validate');
  for (const byte of [0x0b, 0x0c])
    assert.equal(validate(Buffer.from([byte, 0x30])), 'EMALFORMED json_decode');
});

test('direct raw validator fixture has no filesystem target or side effects', () => {
  const before = readdirSync(temporaryRoot).sort();
  assert.equal(validate(Buffer.from('{"a":1,"\\u0061":2}')), 'ESCHEMA canonical_validate');
  assert.deepEqual(readdirSync(temporaryRoot).sort(), before);
  assert.equal(readFileSync(sentinel, 'utf8'), 'unchanged');
});

test('request reader validates only the raw atomic_write_json value before json-c construction', () => {
  for (const value of ['1.0', '{"a":1,"\\u0061":2}', '{"\\u0000":1}']) {
    const run = invokeHelper(requestWithValue(value));
    assert.equal(run.status, 2, run.stderr);
    assert.equal(run.response.error.code, 'ESCHEMA');
    assert.equal(run.response.error.stage, 'canonical_validate');
  }

  const exactMembers = invokeHelper(requestWithValue(materializeGenerator({
    kind: 'object_member_count', count: 1024,
  })));
  assert.equal(exactMembers.status, 3, exactMembers.stderr);
  assert.equal(exactMembers.response.error.code, 'EUNSUPPORTED');
  assert.equal(exactMembers.response.error.stage, 'operation_dispatch');

  const overMembers = invokeHelper(requestWithValue(materializeGenerator({
    kind: 'object_member_count', count: 1025,
  })));
  assert.equal(overMembers.status, 2, overMembers.stderr);
  assert.equal(overMembers.response.error.code, 'ESCHEMA');
  assert.equal(overMembers.response.error.stage, 'canonical_validate');

  const duplicateEnvelope = invokeHelper(Buffer.from('{"protocolVersion":1,'
    + '"requestId":"a","requestId":"b","operation":"atomic_write_json",'
    + '"arguments":{}}'));
  assert.equal(duplicateEnvelope.status, 2, duplicateEnvelope.stderr);
  assert.equal(duplicateEnvelope.response.error.code, 'EMALFORMED');
  assert.equal(duplicateEnvelope.response.error.stage, 'json_decode');

  const trailing = invokeHelper(Buffer.concat([requestWithValue('0'), Buffer.from(' 1')]));
  assert.equal(trailing.status, 2, trailing.stderr);
  assert.equal(trailing.response.error.code, 'EMALFORMED');
  assert.equal(trailing.response.error.stage, 'trailing_data');
});
