import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const rpcPath = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const aclPath = path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const rpc = fs.readFileSync(rpcPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'];
const read = acl.read.ubus['zapret2-manager'];
const write = acl.write.ubus['zapret2-manager'];

const READ = ['dns_product_get', 'dns_product_providers', 'dns_product_status', 'dns_product_preview', 'dns_product_validate'];
const WRITE = ['dns_product_apply', 'dns_product_rollback'];

test('canonical DNS product RPC wrappers use the fixed product CLI', () => {
  assert.match(rpc, /const DNS_PRODUCT_CLI = ['"]\/usr\/libexec\/zapret2-manager\/dns-product-cli\.uc['"]/);
  for (const method of [...READ, ...WRITE]) {
    assert.match(rpc, new RegExp(`function ${method}_method\\(req\\)`));
    assert.match(rpc, new RegExp(`${method}:\\s*\\{`));
  }
  assert.doesNotMatch(rpc, /dns_product_\w+_method\s*\([^)]*path/);
});

test('canonical DNS product RPC uses fixed modes and bounded edit transport', () => {
  const canonical = rpc.match(/\/\/ ---- canonical DNS product facade[\s\S]*?(?=\/\/ ---- Avatar Strategy API)/)?.[0] || '';
  assert.ok(canonical, 'canonical DNS RPC section must exist');
  assert.match(canonical, /function dns_product_action\(sub\)\s*\{\s*return cli_action\(DNS_PRODUCT_CLI, sub\);/);
  assert.match(canonical, /dns_product_get_method\(req\)\s*\{\s*return dns_product_action\('get'\);/);
  assert.match(canonical, /dns_product_edit_action\('preview'/);
  assert.match(canonical, /dns_product_edit_action\('validate'/);
  assert.match(canonical, /dns_product_edit_action\('apply'/);
  assert.match(canonical, /dns_product_edit_action\('rollback'/);
  assert.doesNotMatch(canonical, /dns_product_action\([^)]*req/);
});

test('canonical DNS product read/write ACL is explicit', () => {
  assert.deepEqual(READ.every((method) => read.includes(method)), true);
  assert.deepEqual(WRITE.every((method) => write.includes(method)), true);
  assert.deepEqual(WRITE.some((method) => read.includes(method)), false);
});
