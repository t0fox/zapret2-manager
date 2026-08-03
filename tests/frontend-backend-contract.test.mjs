import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectFacadeMethods } from '../tools/ui-rpc-contract.mjs';

const contract = readFileSync('docs/frontend-backend-contract.md', 'utf8');
const api = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');

test('every central facade RPC method is named in the frozen contract', () => {
  const missing = collectFacadeMethods().filter((method) => !contract.includes('`' + method + '`') && !contract.includes(method));
  assert.deepEqual(missing, []);
});

test('contract documents positional JSON edit transport and rejected ubus errors', () => {
  assert.match(contract, /params: \['edit'\]/);
  assert.match(contract, /one positional JSON string/i);
  assert.match(contract, /reject: true/);
  assert.match(api, /params: \['edit'\]/);
});

test('contract documents rollback TTL and secret reveal semantics', () => {
  assert.match(contract, /rollback_ttl/);
  assert.match(contract, /confirm_alive/);
  assert.match(contract, /"confirm": "REVEAL"/);
});

test('contract documents known backend gaps instead of presenting them as frontend success', () => {
  for (const gap of ['events_tail','dnsmasq','zero targets','profiles_import_applied','nft table zapret2','nfqws2 process gone'])
    assert.match(contract, new RegExp(gap, 'i'));
});
