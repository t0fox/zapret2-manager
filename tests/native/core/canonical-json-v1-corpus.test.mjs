import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vectors from './canonical-json-v1-vectors.json' with { type: 'json' };
import mutations from './canonical-json-v1-mutations.json' with { type: 'json' };
import * as canonicalOracle from './canonical-json-v1-oracle.mjs';
import {
  LIMITS, canonicalizeReference, canonicalizeValue, compareCodePointKeys,
  compareUtf16Keys, compareUtf8Keys, deterministicValues, expectedBytes,
  materializeGenerator, makeRequestWithValue, permutedObjectEntries,
} from './canonical-json-v1-oracle.mjs';

function inputFor(vector) {
  if (vector.input !== undefined) return vector.input;
  return materializeGenerator(vector.generator);
}

function expectedFor(vector, input) {
  if (vector.expectedGenerator?.kind === 'reference') return canonicalizeReference(input);
  return expectedBytes(vector.expected);
}

function assertStaticCorpusShape() {
  assert.equal(vectors.format, 'z2m-canonical-json-v1-test-corpus');
  assert.equal(vectors.canonicalization, 'z2m-canonical-json-v1');
  assert.deepEqual(vectors.limits, {
    canonicalBytes: LIMITS.outputBytes, depth: LIMITS.depth, containers: LIMITS.containers,
    members: LIMITS.members, nodes: LIMITS.nodes, keyBytes: LIMITS.keyBytes,
    requestBytes: LIMITS.requestBytes,
  });
  const ids = new Set();
  for (const vector of [...vectors.accept, ...vectors.reject]) {
    assert.equal(ids.has(vector.id), false, `duplicate vector id ${vector.id}`);
    ids.add(vector.id);
    assert.ok(vector.category);
    assert.ok(vector.rationale);
    assert.ok(vector.input !== undefined || vector.inputBytesHex || vector.generator);
  }
  assert.ok(vectors.accept.length >= 40);
  assert.ok(vectors.reject.length >= 25);
  assert.equal(vectors.contractGaps.length, 1);
  assert.equal(vectors.contractGaps[0].id, 'escaped-nul-key-policy');
  const categories = new Set(vectors.accept.concat(vectors.reject).map(({ category }) => category));
  for (const category of ['objects', 'arrays', 'numbers', 'strings', 'unicode', 'boundaries', 'framing'])
    assert.equal(categories.has(category), true, category);
  assert.equal(mutations.length, 23);
  assert.equal(new Set(mutations.map(({ id }) => id)).size, mutations.length);
  for (const mutation of mutations) {
    assert.ok(mutation.input !== undefined || mutation.inputBytesHex);
    assert.ok(mutation.class);
  }
}

test('canonical JSON corpus is complete, bounded, and has unique traceable vectors', () => {
  assertStaticCorpusShape();
});

test('accepted vectors match the independent contract oracle', () => {
  for (const vector of vectors.accept) {
    const input = inputFor(vector);
    const expected = expectedFor(vector, input);
    assert.equal(Buffer.byteLength(expected) <= LIMITS.outputBytes, true, vector.id);
    if (vector.expectedGenerator?.kind !== 'reference')
      assert.equal(canonicalizeReference(input), expected, vector.id);
    else assert.equal(expected, canonicalizeReference(input), vector.id);
  }
});

test('rejected vectors carry a deterministic failure class without production implementation claims', () => {
  const allowedClasses = new Set([
    'malformed_lexical_json', 'trailing_data', 'forbidden_number', 'integer_overflow',
    'duplicate_key', 'invalid_unicode', 'invalid_utf8', 'depth_exceeded', 'count_exceeded',
    'key_too_large', 'output_too_large',
  ]);
  for (const vector of vectors.reject) {
    assert.equal(allowedClasses.has(vector.class), true, vector.id);
    if (vector.inputBytesHex) assert.equal(vector.inputBytesHex.length % 2, 0, vector.id);
  }
});

test('every rejected vector and mutation is rejected by the independent contract model', () => {
  for (const vector of [...vectors.reject, ...mutations]) {
    const input = vector.inputBytesHex ? Buffer.from(vector.inputBytesHex, 'hex') : inputFor(vector);
    const classification = canonicalOracle.classifyReference?.(input);
    assert.deepEqual(classification, { valid: false, class: vector.class }, vector.id);
  }
});

test('ordering oracle is UTF-8 byte lexical and exposes UTF-16 and code-point traps', () => {
  const supplementary = '\ud800\udc00';
  const privateUse = '\ue000';
  assert.ok(compareUtf8Keys(privateUse, supplementary) < 0);
  assert.ok(compareCodePointKeys(privateUse, supplementary) < 0);
  assert.ok(compareUtf16Keys(privateUse, supplementary) > 0);
  assert.ok(compareUtf8Keys('Z', 'a') < 0);
  assert.ok(compareUtf8Keys('a', 'aa') < 0);
  assert.ok(compareUtf8Keys('e\u0301', '\u00e9') < 0);
});

test('ordinary entries array properties do not collide with parsed objects', () => {
  assert.equal(canonicalizeValue({ entries: [1, 2] }), '{"entries":[1,2]}');
});

test('deterministic boundary generators materialize exact frozen limits', () => {
  const cases = [
    ['nested_object', 64], ['container_count', 1024], ['object_member_count', 1024],
    ['node_count', 65536], ['key_bytes', 4096], ['canonical_output_bytes', 521028],
  ];
  for (const [kind, value] of cases) {
    const field = kind === 'nested_object' ? 'depth' : kind === 'key_bytes' ? 'bytes' : kind === 'canonical_output_bytes' ? 'bytes' : 'count';
    const input = materializeGenerator({ kind, [field]: value });
    if (kind === 'canonical_output_bytes') assert.equal(Buffer.byteLength(input), value);
    else assert.ok(input.length > 0, kind);
  }
  const value = '0';
  assert.equal(Buffer.byteLength(makeRequestWithValue(value, LIMITS.requestBytes)), LIMITS.requestBytes);
});

test('boundary generators distinguish UTF-8 key bytes and globally split members', () => {
  const keyInput = materializeGenerator({ kind: 'key_utf8_bytes', bytes: LIMITS.keyBytes });
  const key = Object.keys(JSON.parse(keyInput))[0];
  assert.equal(key.length, LIMITS.keyBytes / 2);
  assert.equal(Buffer.byteLength(key), LIMITS.keyBytes);

  const memberInput = materializeGenerator({ kind: 'global_member_count', count: LIMITS.members });
  const objects = JSON.parse(memberInput);
  assert.equal(objects.length, 2);
  assert.equal(objects.reduce((total, object) => total + Object.keys(object).length, 0), LIMITS.members);
});

test('bounded deterministic properties preserve canonical fixed points and arrays', () => {
  for (const value of deterministicValues()) {
    const canonical = canonicalizeValue(value);
    assert.equal(canonicalizeReference(canonical), canonical);
    assert.match(canonical, /^\{.*\}$/);
  }
  const object = { z: [3, 2, 1], a: { y: 2, x: 1 }, n: null };
  const entries = Object.entries(object);
  const expected = canonicalizeValue(object);
  for (const seed of [1, 2, 3, 0x5eed]) {
    assert.equal(canonicalizeValue(permutedObjectEntries(entries, seed)), expected);
  }
  assert.equal(canonicalizeValue({ a: [3, 2, 1] }), '{"a":[3,2,1]}');
});

test('mutation corpus is deterministic and independent from atomic_write_json', () => {
  const source = readFileSync('tests/native/core/canonical-json-v1-mutations.json', 'utf8');
  assert.equal(JSON.parse(source).length, mutations.length);
  assert.equal(Object.hasOwn(vectors, 'productionImplementation'), false);
  assert.equal(Object.hasOwn(vectors, 'atomicWriteJsonPass'), false);
});
