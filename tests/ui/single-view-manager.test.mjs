import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';
import { collectFacadeMethods, collectUiContract } from '../../tools/ui-rpc-contract.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const expected = JSON.parse(readFileSync('tests/fixtures/ui-rpc-contract.json', 'utf8'));

test('app.js yields a valid LuCI view', () => {
  const exported = evaluateLuciModule(`${root}/app.js`);
  assert.equal(typeof exported, 'object');
  assert.equal(typeof exported.load, 'function');
  assert.equal(typeof exported.render, 'function');
});

test('core modules never return a legacy view', () => {
  for (const file of ['app.js', 'z2m-api.js', 'z2m-store.js', 'z2m-shell.js']) {
    const src = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(src, /require\s+view\.zapret2-manager\..*-legacy/);
    assert.doesNotMatch(src, /return\s+Legacy\w*/);
  }
});

test('single API facade preserves the frozen RPC contract', () => {
  assert.deepEqual(collectUiContract(), expected);
  const flattened = [...new Set(Object.values(expected).flat())].sort();
  assert.deepEqual(collectFacadeMethods(), flattened);
});
