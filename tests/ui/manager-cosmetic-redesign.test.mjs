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
const menu = JSON.parse(
  readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8')
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

test('navigation keeps seven product pages and hides advanced Orchestra', () => {
  const entries = Object.values(menu);
  assert.equal(entries.some((entry) => entry.title === 'Advanced'), false);
  assert.equal(entries.some((entry) => entry.title === 'Combo presets'), false);

  const proxy = entries.find((entry) => entry.action && entry.action.path === 'zapret2-manager/proxy');
  assert.equal(proxy.title, 'TG PROXY');

  const advanced = menu['admin/services/zapret2-manager/advanced'];
  assert.equal(advanced.hidden, true);
  assert.equal(advanced.action.path, 'zapret2-manager/orchestra');
});
