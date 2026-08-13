import test from 'node:test';
import assert from 'node:assert';
import { validate } from '../../scripts/validate-knowledge.mjs';

test('fails on duplicate global id', async () => {
  const result = await validate('tests/knowledge/fixtures/duplicate-id/');
  assert.strictEqual(result.passed, false);
  assert.match(result.errors[0], /duplicate id/i);
});

test('fails on broken relative link and wikilink', async () => {
  const result = await validate('tests/knowledge/fixtures/broken-link.md');
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some(e => /broken link/i.test(e)));
});
test('fails on legacy path reference', async () => {
  const result = await validate('tests/knowledge/fixtures/legacy-path.md');
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some(e => /legacy path/i.test(e)));
});

test('fails on unpublished leak', async () => {
  const result = await validate('tests/knowledge/fixtures/unpublished-leak.md');
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some(e => /unpublished leak/i.test(e)));
});

test('fails on orphan normative doc', async () => {
  const result = await validate('tests/knowledge/fixtures/orphan-normative.md');
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some(e => /orphan normative/i.test(e)));
});
import { readFileSync } from 'node:fs';

test('validates context-map schema', async () => {
  const yaml = readFileSync('tests/knowledge/fixtures/valid-context-map.yaml','utf8');
  const result = await validate('tests/knowledge/fixtures/valid-context-map.yaml');
  // schema validation stub: passes if file loads without error
  assert.strictEqual(result.passed, true);
});

test('validates migration-manifest schema', async () => {
  const result = await validate('tests/knowledge/fixtures/valid-migration-manifest.json');
  assert.strictEqual(result.passed, true);
});
