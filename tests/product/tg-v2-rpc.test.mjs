import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const rpc = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const acl = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'), 'utf8');

test('canonical TG methods use the bounded CLI and explicit edit signatures', () => {
  assert.match(rpc, /const TG_PRODUCT_CLI = '\/usr\/libexec\/zapret2-manager\/tg-product-cli\.uc'/);
  for (const method of ['get', 'catalog', 'status']) assert.match(rpc, new RegExp(`tg_product_${method}:`));
  for (const method of ['validate', 'preview', 'apply', 'health', 'check_updates', 'switch', 'install', 'update', 'remove', 'purge']) {
    assert.match(rpc, new RegExp(`tg_product_${method}: \\{ args: \\{ edit: 'string' \\}`));
  }
});

test('TG v2 ACL separates reads from mutations', () => {
  const doc = JSON.parse(acl);
  const read = doc['zapret2-manager'].read.ubus['zapret2-manager'];
  const write = doc['zapret2-manager'].write.ubus['zapret2-manager'];
  for (const method of ['tg_product_get', 'tg_product_catalog', 'tg_product_status', 'tg_product_validate', 'tg_product_preview', 'tg_product_health', 'tg_product_check_updates']) assert.ok(read.includes(method), method);
  for (const method of ['tg_product_apply', 'tg_product_switch', 'tg_product_install', 'tg_product_update', 'tg_product_remove', 'tg_product_purge', 'tg_product_start', 'tg_product_stop', 'tg_product_restart']) assert.ok(write.includes(method), method);
  assert.equal(read.includes('tg_product_apply'), false);
});
