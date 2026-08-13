import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../../scripts/validate-knowledge.mjs';

async function errorsFor(path) {
  const result = await validate(path);
  assert.equal(result.passed, false, `expected ${path} to fail`);
  return result.errors;
}

test('rejects missing canonical frontmatter fields', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/missing-metadata.md');
  assert.ok(errors.some((error) => /frontmatter.*(title|type|status|authority|updated|publish|tags)/i.test(error)));
});

test('rejects malformed metadata types, enums, dates, and tags', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/malformed-metadata.md');
  assert.ok(errors.some((error) => /title.*string/i.test(error)));
  assert.ok(errors.some((error) => /type.*enum/i.test(error)));
  assert.ok(errors.some((error) => /status.*enum/i.test(error)));
  assert.ok(errors.some((error) => /authority.*enum/i.test(error)));
  assert.ok(errors.some((error) => /updated.*date/i.test(error)));
  assert.ok(errors.some((error) => /publish.*boolean/i.test(error)));
  assert.ok(errors.some((error) => /tags.*array/i.test(error)));
});

test('fails on duplicate global id', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/duplicate-id/');
  assert.ok(errors.some((error) => /duplicate id/i.test(error)));
});

test('fails on broken relative markdown link and anchor', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/broken-link.md');
  assert.ok(errors.some((error) => /broken markdown link/i.test(error)));
  assert.ok(errors.some((error) => /broken anchor/i.test(error)));
});

test('fails on broken and ambiguous wikilinks', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/wiki-links/');
  assert.ok(errors.some((error) => /broken wikilink/i.test(error)));
  assert.ok(errors.some((error) => /ambiguous wikilink/i.test(error)));
});

test('fails on legacy path reference', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/legacy-path.md');
  assert.ok(errors.some((error) => /legacy path/i.test(error)));
});

test('fails on an unreachable normative document', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/orphan-normative.md');
  assert.ok(errors.some((error) => /unreachable authority|orphan normative/i.test(error)));
});

test('fails when a context map declares missing docs, code, or tests', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/context-map.yaml');
  assert.ok(errors.some((error) => /context map.*(required doc|code glob|test glob)/i.test(error)));
});

test('validates migration manifest rows and existing targets', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/bad-migration-manifest.json');
  assert.ok(errors.some((error) => /migration.*(AUTHORITY|STATUS|ACTION|OLD_BLOB_SHA|target)/i.test(error)));
  assert.ok(errors.some((error) => /duplicate migration|duplicate OLD_PATH/i.test(error)));
});

test('rejects a non-boolean public publish value', async () => {
  const errors = await errorsFor('tests/knowledge/fixtures/unpublished-leak.md');
  assert.ok(errors.some((error) => /publish.*boolean/i.test(error)));
});

test('validates the real repository-shaped knowledge tree', async () => {
  const result = await validate('tests/knowledge/fixtures/valid-real-tree/');
  assert.deepEqual(result.errors, []);
  assert.equal(result.passed, true);
});

test('accepts the checked-in valid context-map and migration fixtures', async () => {
  const contextMap = await validate('tests/knowledge/fixtures/valid-context-map.yaml');
  const manifest = await validate('tests/knowledge/fixtures/valid-migration-manifest.json');
  assert.equal(contextMap.passed, true, contextMap.errors.join('\n'));
  assert.equal(manifest.passed, true, manifest.errors.join('\n'));
  assert.match(readFileSync('tests/knowledge/fixtures/valid-context-map.yaml', 'utf8'), /requiredDocs/);
});

test('accepts schema-shaped context maps with generated metadata', async () => {
  const result = await validate('tests/knowledge/fixtures/valid-real-tree/docs/12-ai/context-map.yaml');
  assert.equal(result.passed, true, result.errors.join('\n'));
});
