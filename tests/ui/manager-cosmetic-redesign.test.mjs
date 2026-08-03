import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const expectedRpc = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8');
const menu = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8'));

test('frontend RPC method sets remain unchanged', () => {
  assert.deepEqual(collectUiContract(), expectedRpc);
});

test('shared design system exposes approved tokens and primitives', () => {
  for (const token of [
    '#191919', '#202020', '#282827', '#383836',
    '#5E9FE8', '#72BC8F', '#DE9255', '#E97366'
  ]) assert.match(css.toUpperCase(), new RegExp(token.toUpperCase()));
  for (const cls of [
    '.z2m-segmented', '.z2m-button-primary', '.z2m-button-secondary',
    '.z2m-button-danger', '.z2m-table', '.z2m-field', '.z2m-switch',
    '.z2m-progress', '.z2m-console', '.z2m-empty-state', '.z2m-sticky-actions'
  ]) assert.match(css, new RegExp(cls.replace('.', '\\.')));
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

test('Profiles and Lists use the shared shell without replacing legacy handlers', () => {
  for (const name of ['strategies.js', 'lists.js']) {
    const page = readFileSync(`${root}/${name}`, 'utf8');
    assert.match(page, /z2m-page/);
    assert.match(page, /z2m-hero/);
    assert.match(page, /z2m-card/);
    assert.match(page, new RegExp(`view\\.zapret2-manager\\.${name.replace('.js', '-legacy')}`));
  }
  const lists = readFileSync(`${root}/lists.js`, 'utf8');
  assert.match(lists, /z2m-tabs/);
  assert.match(lists, /data-list-group/);
});

test('DNS keeps all five workspaces inside the shared shell', () => {
  const dns = readFileSync(`${root}/dns.js`, 'utf8');
  for (const id of ['setup', 'providers', 'services', 'advanced', 'history'])
    assert.match(dns, new RegExp(`id:\\s*['"]${id}['"]`));
  for (const cls of ['z2m-page', 'z2m-hero', 'z2m-tabs', 'z2m-provider-grid', 'z2m-table'])
    assert.match(dns, new RegExp(cls));
  assert.match(dns, /view\.zapret2-manager\.dns-legacy/);
});

test('Monitor and Maintenance use responsive shared presentation', () => {
  for (const name of ['monitor.js', 'maintenance.js']) {
    const page = readFileSync(`${root}/${name}`, 'utf8');
    assert.match(page, /z2m-page/);
    assert.match(page, /z2m-hero/);
    assert.match(page, /z2m-card-grid/);
    assert.match(page, /z2m-table/);
    assert.match(page, new RegExp(`view\\.zapret2-manager\\.${name.replace('.js', '-legacy')}`));
  }
  assert.match(readFileSync(`${root}/monitor.js`, 'utf8'), /buildContainer/);
  assert.match(readFileSync(`${root}/maintenance.js`, 'utf8'), /z2m-danger-zone/);
});

test('TG PROXY keeps existing actions and QR implementation behind a new shell', () => {
  const proxy = readFileSync(`${root}/proxy.js`, 'utf8');
  const legacy = readFileSync(`${root}/proxy-legacy.js`, 'utf8');
  assert.match(proxy, /TG PROXY/);
  assert.match(proxy, /z2m-proxy-hero/);
  assert.match(proxy, /z2m-proxy-connection/);
  assert.match(proxy, /z2m-proxy-advanced/);
  assert.match(proxy, /callProxyStart/);
  assert.match(proxy, /callProxyStop/);
  assert.match(proxy, /callProxyLinkInfo/);
  assert.match(proxy, /view\.zapret2-manager\.proxy-legacy/);
  assert.match(legacy, /qrcode/);
  assert.match(legacy, /doQRCode/);
});
