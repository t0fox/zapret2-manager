import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8');
const maintenance = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/maintenance.uc', 'utf8');
const dnsProduct = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc', 'utf8');

test('DNS product facade is registered and permissioned for the active DNS UI', () => {
  for (const method of [
    'dns_product_get', 'dns_product_providers', 'dns_product_status',
    'dns_product_preview', 'dns_product_validate', 'dns_product_apply',
    'dns_product_rollback'
  ]) {
    assert.match(rpc, new RegExp(`${method}:`), `backend must register ${method}`);
    assert.match(acl, new RegExp(`"${method}"`), `LuCI ACL must allow ${method}`);
  }
});

test('events_tail accepts the Logs page cursor contract and returns last_seq', () => {
  assert.match(maintenance, /type\(input\.limit\) == 'int'/);
  assert.match(maintenance, /type\(input\.since_seq\) == 'int'/);
  assert.match(maintenance, /last_seq:\s*length\(nonEmpty\)/);
  assert.match(maintenance, /ev\.seq\s*=\s*i\s*\+\s*1/);
});

test('DNS product apply preserves the revision returned by the owning Service DNS writer', () => {
  assert.match(dnsProduct, /service_dns_set\(\{ args: \{ selections:/);
  assert.match(dnsProduct, /service_dns_apply\(\{ args: \{ revision: saved\.draftRevision \} \}\)/);
});
