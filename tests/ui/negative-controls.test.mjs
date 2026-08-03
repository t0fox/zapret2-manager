// Negative controls prove the current single-view gates have teeth. Each test
// mutates an in-memory copy; repository files are never modified.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readMenu, stripComments, checkNoLubus, checkMenuAclIsArray,
  checkPositionalCalls, checkRejectTrue
} from './lib/checks.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const lists = readFileSync(`${root}/z2m-lists.js`, 'utf8');
const overview = readFileSync(`${root}/z2m-overview.js`, 'utf8');
const api = readFileSync(`${root}/z2m-api.js`, 'utf8');

test('negative control: L.ubus injection is caught, internal modules are clean', () => {
  const poisoned = lists + "\nL.ubus.call('zapret2-manager', 'lists_get');\n";
  const errors = checkNoLubus(poisoned, 'z2m-lists (poisoned copy)');
  assert.ok(errors.length > 0, 'L.ubus injection was not caught');
  assert.match(errors[0], /L\.ubus/);
  assert.deepEqual(checkNoLubus(lists, 'z2m-lists'), []);
  assert.deepEqual(checkNoLubus(overview, 'z2m-overview'), []);
});

test('negative control: comments naming L.ubus do not hide real usage', () => {
  const documented = overview + "\n// L.ubus is forbidden here\n";
  assert.deepEqual(checkNoLubus(documented, 'documented'), []);
  const poisoned = documented + "L.ubus.call('a', 'b');\n";
  assert.ok(checkNoLubus(poisoned, 'poisoned').length > 0);
});

test('negative control: object-form depends.acl is caught', () => {
  const menu = readMenu();
  assert.deepEqual(checkMenuAclIsArray(menu), []);
  const bad = JSON.parse(JSON.stringify(menu));
  const firstKey = Object.keys(bad)[0];
  bad[firstKey].depends = { acl: { 'zapret2-manager': ['read'] } };
  const errors = checkMenuAclIsArray(bad);
  assert.ok(errors.length > 0);
  assert.match(errors[0], /not an array/);
});

test('negative control: params-array declarations reject object-form calls', () => {
  const declaration = api.match(/rpc\.declare\(\{ object: 'zapret2-manager', method: 'lists_check_domain', params: \['domain'\], reject: true \}\)/)?.[0];
  assert.ok(declaration, 'real lists_check_domain declaration missing');
  const clean = `const callListsCheck = ${declaration};\ncallListsCheck('example.com');`;
  assert.deepEqual(checkPositionalCalls(clean, 'facade fixture'), []);
  const poisoned = clean.replace("callListsCheck('example.com')", "callListsCheck({ domain: 'example.com' })");
  const errors = checkPositionalCalls(poisoned, 'facade fixture (poisoned)');
  assert.ok(errors.length > 0, 'object-form call was not caught');
  assert.match(errors[0], /positionally/);
});

test('negative control: missing reject:true is caught in the central API facade', () => {
  assert.match(stripComments(api), /reject:\s*true/);
  assert.deepEqual(checkRejectTrue(api, 'z2m-api'), []);
  const poisoned = api.replace(/,\s*reject:\s*true/g, '');
  assert.ok(!/reject:\s*true/.test(stripComments(poisoned)));
  const errors = checkRejectTrue(poisoned, 'z2m-api (poisoned copy)');
  assert.ok(errors.length > 0, 'missing reject:true was not caught');
  assert.match(errors[0], /reject: true/);
});
