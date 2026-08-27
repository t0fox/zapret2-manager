import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(
  path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js'),
  'utf8'
);
const presentation = vm.runInNewContext(`(function () { ${source}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
});

test('maps every canonical update state without collapsing review or rebase', () => {
  const expected = {
    current: ['Актуально', 'g'],
    'update-available': ['Доступно обновление', 'o'],
    'review-required': ['Требуется проверка', 'o'],
    'rebase-required': ['Требуется адаптация', 'o'],
    'integration-required': ['Требуется интеграция', 'o'],
    broken: ['Ошибка', 'r'],
    failed: ['Ошибка', 'r'],
    unknown: ['Не проверено', ''],
  };

  for (const [state, [label, kind]] of Object.entries(expected)) {
    const result = presentation.describe(state);
    assert.equal(result.state, state === 'failed' ? 'failed' : state);
    assert.equal(result.label, label);
    assert.equal(result.kind, kind);
  }
});

test('does not infer a state from review, rebase, or technical metadata', () => {
  assert.equal(presentation.describe(null).state, 'unknown');
  assert.equal(presentation.describe({ reviews: ['x'] }).state, 'unknown');
  assert.equal(presentation.describe({ rebases: ['x'] }).state, 'unknown');
  assert.equal(presentation.describe({ current: 'p-79.18' }).state, 'unknown');
});

test('normalizes legacy resource aliases only when explicitly supplied', () => {
  assert.equal(presentation.describe('update').state, 'update-available');
  assert.equal(presentation.describe('attention').state, 'review-required');
  assert.equal(presentation.describe('stale').state, 'unknown');
});
