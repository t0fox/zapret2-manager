import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8');
const productPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc';

test('TG Proxy frontend contract has a canonical product facade on the main RPC object', () => {
  assert.equal(fs.existsSync(productPath), true, 'canonical TG product facade must be packaged');
  const methods = [
    'tg_product_get',
    'tg_product_catalog',
    'tg_product_status',
    'tg_product_versions',
    'tg_product_operation_status',
    'tg_product_validate',
    'tg_product_preview',
    'tg_product_apply',
    'tg_product_health',
    'tg_product_check_updates',
    'tg_product_switch',
    'tg_product_install',
    'tg_product_update',
    'tg_product_remove',
    'tg_product_purge',
    'tg_product_start',
    'tg_product_stop',
    'tg_product_restart'
  ];
  for (const method of methods) {
    assert.match(rpc, new RegExp(`${method}:`), `backend must register ${method}`);
    assert.match(acl, new RegExp(`"${method}"`), `LuCI ACL must allow ${method}`);
  }
});

test('optional TG Proxy remains a successful not-installed state, not an RPC/catalog failure', () => {
  const product = fs.readFileSync(productPath, 'utf8');
  assert.match(product, /optional:\s*true/);
  assert.match(product, /installed:\s*providers\.installed/);
  assert.match(product, /tg_product_catalog/);
  assert.match(product, /tg_product_status/);
});
