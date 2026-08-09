import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vectors from './canonical-json-v1-vectors.json' with { type: 'json' };
import mutations from './canonical-json-v1-mutations.json' with { type: 'json' };
import {
  canonicalizeReference, canonicalizeValue, deterministicValues, expectedBytes,
  materializeGenerator, permutedObjectEntries,
} from './canonical-json-v1-oracle.mjs';

const sourceRoot = 'zapret2-manager/src/z2m-core-helper';
const temporaryRoot = mkdtempSync(join(tmpdir(), 'z2m-canonical-validator-'));
const binary = join(temporaryRoot, 'canonical-validator');
const helperBinary = join(temporaryRoot, 'z2m-core-helper');
const sentinel = join(temporaryRoot, 'sentinel');

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

before(() => {
  writeFileSync(sentinel, 'unchanged');
  const jsonC = spawnSync('pkg-config', ['--cflags', '--libs', 'json-c'], { encoding: 'utf8' });
  assert.equal(jsonC.status, 0, jsonC.stderr);
  const compile = spawnSync('cc', [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE',
    '-I', sourceRoot,
    'tests/native/core/canonical-validator-fixture.c',
    `${sourceRoot}/canonical.c`,
    ...jsonC.stdout.trim().split(/\s+/),
    '-Wl,--wrap=free',
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

function construct(input) {
  const run = spawnSync(binary, ['construct'], { input, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

function encode(input, env = {}) {
  const run = spawnSync(binary, ['encode'], {
    input, env: { ...process.env, ...env },
  });
  assert.equal(run.status, 0, run.stderr.toString());
  return run.stdout;
}

function preparedExpected(testCase, input) {
  if (testCase.expectedGenerator?.kind === 'reference')
    return Buffer.from(canonicalizeReference(input.toString('utf8')));
  return Buffer.from(expectedBytes(testCase.expected));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

function invokeHelper(input, env = {}) {
  const run = spawnSync(helperBinary, [], {
    input, encoding: 'utf8', env: { ...process.env, ...env },
  });
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

test('semantic constructor preserves every supported value through owned cleanup', () => {
  const cases = [
    ['null', 'null\tnull'],
    ['true', 'boolean\ttrue'],
    ['false', 'boolean\tfalse'],
    ['0', 'int\t0'],
    ['-0', 'int\t0'],
    ['-1', 'int\t-1'],
    ['-9223372036854775808', 'int\t-9223372036854775808'],
    ['9223372036854775807', 'int\t9223372036854775807'],
    ['"ordinary"', 'string\t"ordinary"'],
    ['"é"', 'string\t"é"'],
    ['"\\u0000"', 'string\t"\\u0000"'],
    ['"\\ud83d\\ude00"', 'string\t"😀"'],
    ['[null,false,0,"x",[],{}]', 'array\t[null,false,0,"x",[],{}]'],
    ['{"outer":{"items":[true,-1,"é"]}}',
      'object\t{"outer":{"items":[true,-1,"é"]}}'],
    ['{"é":1,"é":2}', 'object\t{"é":1,"é":2}'],
    ['["é","é"]', 'array\t["é","é"]'],
  ];
  for (const [input, expected] of cases)
    assert.equal(construct(Buffer.from(input)), expected, input);
});

test('semantic construction rejects unsupported and information-losing raw values first', () => {
  const cases = [
    [Buffer.from('1.0'), 'ESCHEMA canonical_validate'],
    [Buffer.from('['), 'EMALFORMED json_decode'],
    [Buffer.from('{"a":1,"\\u0061":2}'), 'ESCHEMA canonical_validate'],
    [Buffer.from('"\\ud800"'), 'ESCHEMA canonical_validate'],
    [Buffer.from('9223372036854775808'), 'ESCHEMA canonical_validate'],
    [Buffer.from('{"\\u0000":1}'), 'ESCHEMA canonical_validate'],
    [Buffer.from([0x22, 0xff, 0x22]), 'EMALFORMED utf8'],
  ];
  for (const [input, expected] of cases)
    assert.equal(construct(input), expected);

  const double = spawnSync(binary, ['double'], { encoding: 'utf8' });
  assert.equal(double.status, 0, double.stderr);
  assert.equal(double.stdout.trim(), 'REJECTED');

  const uint64 = spawnSync(binary, ['uint64'], { encoding: 'utf8' });
  assert.equal(uint64.status, 0, uint64.stderr);
  assert.equal(uint64.stdout.trim(), 'REJECTED');
});

test('canonical encoder emits every accepted prepared vector byte-for-byte', () => {
  for (const testCase of vectors.accept) {
    const input = inputFor(testCase);
    assert.deepEqual(encode(input), preparedExpected(testCase, input), testCase.id);
  }
});

test('canonical encoder preserves bounded property fixed points', () => {
  for (const value of deterministicValues()) {
    const expected = Buffer.from(canonicalizeValue(value));
    assert.deepEqual(encode(Buffer.from(JSON.stringify(value))), expected);
    assert.deepEqual(encode(expected), expected);
  }
});

test('canonical encoder makes formatting and insertion permutations byte and hash identical', () => {
  const value = { z: [3, 2, 1], a: { y: 2, x: 1 }, n: null };
  const expected = Buffer.from('{"a":{"x":1,"y":2},"n":null,"z":[3,2,1]}');
  const inputs = [
    Buffer.from(' { "z" : [ 3, 2, 1 ], "a" : { "y" : 2, "x" : 1 }, "n" : null } '),
    ...[1, 2, 3, 0x5eed].map((seed) => Buffer.from(JSON.stringify(
      permutedObjectEntries(Object.entries(value), seed),
    ))),
  ];
  const expectedHash = sha256(expected);
  for (const input of inputs) {
    const output = encode(input);
    assert.deepEqual(output, expected);
    assert.equal(sha256(output), expectedHash);
  }
});

test('canonical encoder accepts exactly 521028 bytes and rejects the first byte over', () => {
  const exact = Buffer.from(materializeGenerator({
    kind: 'canonical_output_bytes', bytes: 521028,
  }));
  const over = Buffer.from(materializeGenerator({
    kind: 'canonical_output_bytes', bytes: 521029,
  }));
  assert.equal(exact.length, 521028);
  assert.deepEqual(encode(exact), exact);
  assert.equal(encode(over).toString().trim(), 'ETOOBIG canonical_size');
});

test('canonical encoder allocation failures are internal, leak-free, and filesystem-free', () => {
  const input = Buffer.from(materializeGenerator({
    kind: 'canonical_output_bytes', bytes: 521028,
  }));
  const before = readdirSync(temporaryRoot).sort();
  for (let failAfter = 1; failAfter <= 14; failAfter++) {
    assert.deepEqual(encode(input, {
      Z2M_TEST_ALLOC_FAIL_AFTER: String(failAfter),
    }), Buffer.from('EINTERNAL canonical_encode\n'));
    assert.deepEqual(readdirSync(temporaryRoot).sort(), before);
    assert.equal(readFileSync(sentinel, 'utf8'), 'unchanged');
  }
  assert.deepEqual(encode(input, {
    Z2M_TEST_ALLOC_FAIL_AFTER: '15',
  }), input);
  assert.deepEqual(readdirSync(temporaryRoot).sort(), before);
  assert.equal(readFileSync(sentinel, 'utf8'), 'unchanged');
});

test('request reader accepts an exact depth-64 canonical value inside its envelope', () => {
  const value = materializeGenerator({ kind: 'nested_object', depth: 64 });
  const run = invokeHelper(requestWithValue(value));
  assert.equal(run.status, 3, run.stderr);
  assert.equal(run.response.error.code, 'EUNSUPPORTED');
  assert.equal(run.response.error.stage, 'operation_dispatch');
});

test('request reader retains raw UTF-8 and scalar-distinct values through full construction', () => {
  for (const value of ['["é","é"]', '{"é":1,"é":2}']) {
    const run = invokeHelper(requestWithValue(value));
    assert.equal(run.status, 3, run.stderr);
    assert.equal(run.response.error.code, 'EUNSUPPORTED');
    assert.equal(run.response.error.stage, 'operation_dispatch');
  }
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

test('non-atomic arguments.value retains legacy duplicate classification', () => {
  const run = invokeHelper(Buffer.from('{"protocolVersion":1,"requestId":"legacy-value",'
    + '"operation":"rename_owned","arguments":{"root":"runtime","fromPath":"a",'
    + '"toPath":"b","ownershipToken":"'
    + `${'0'.repeat(64)}","replace":false,"value":{"a":1,"a":2}}}`));
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.response.requestId, null);
  assert.equal(run.response.error.code, 'EMALFORMED');
  assert.equal(run.response.error.stage, 'json_decode');
});

test('non-atomic operation-last arguments.value retains legacy limit classification', () => {
  const value = materializeGenerator({ kind: 'object_member_count', count: 1026 });
  const run = invokeHelper(Buffer.from('{"protocolVersion":1,"requestId":"legacy-limit",'
    + '"arguments":{"root":"runtime","fromPath":"a","toPath":"b",'
    + `"ownershipToken":"${'0'.repeat(64)}","replace":false,"value":${value}},`
    + '"operation":"rename_owned"}'));
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.response.requestId, null);
  assert.equal(run.response.error.code, 'ESCHEMA');
  assert.equal(run.response.error.stage, 'schema');
});

test('forbidden whitespace cannot bypass framing when operation follows arguments', () => {
  const run = invokeHelper(Buffer.from('{"protocolVersion":1,"requestId":"late-operation",'
    + '"arguments":{"root":"runtime","path":"canonical.json","value":\v1.0,'
    + '"mode":"0600","uid":0,"gid":0,"allowCreate":true},'
    + '"operation":"atomic_write_json"}'));
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.response.requestId, null);
  assert.equal(run.response.error.code, 'EMALFORMED');
  assert.equal(run.response.error.stage, 'json_decode');
});

test('pre-construction token handling is project-local and canonical validation is ordered first', () => {
  const source = readFileSync(`${sourceRoot}/protocol.c`, 'utf8');
  const construction = source.indexOf('request->document = json_tokener_parse_ex');
  const canonicalBoundary = source.indexOf('!z2m_canonical_construct');
  assert.ok(canonicalBoundary >= 0 && construction > canonicalBoundary);
  const preConstruction = source.slice(0, construction);
  assert.doesNotMatch(preConstruction, /\bjson_tokener_parse\s*\(/);
  assert.doesNotMatch(preConstruction, /\bisspace\s*\(/);
});

test('canonical key vector growth checks doubling before multiplication', () => {
  const source = readFileSync(`${sourceRoot}/canonical.c`, 'utf8');
  const start = source.indexOf('static bool add_key(');
  const end = source.indexOf('\nstatic bool close_object(', start);
  const addKey = source.slice(start, end);
  assert.doesNotMatch(addKey, /key_capacity\s*\*\s*2U/);
  assert.match(addKey, /key_capacity\s*>\s*SIZE_MAX\s*\/\s*2U/);
});
