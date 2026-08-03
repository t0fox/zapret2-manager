import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const expectedRpc = JSON.parse(
  readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8')
);
const css = readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css',
  'utf8'
);

test('frontend RPC method sets remain unchanged', () => {
  assert.deepEqual(collectUiContract(), expectedRpc);
});

test('shared design system exposes approved tokens and primitives', () => {
  for (const token of [
    '#191919', '#202020', '#282827', '#383836',
    '#5E9FE8', '#72BC8F', '#DE9255', '#E97366'
  ]) {
    assert.match(css.toUpperCase(), new RegExp(token.toUpperCase()));
  }

  for (const cls of [
    '.z2m-segmented',
    '.z2m-button-primary',
    '.z2m-button-secondary',
    '.z2m-button-danger',
    '.z2m-table',
    '.z2m-field',
    '.z2m-switch',
    '.z2m-progress',
    '.z2m-console',
    '.z2m-empty-state',
    '.z2m-sticky-actions'
  ]) {
    assert.match(css, new RegExp(cls.replace('.', '\\.')));
  }
});
