import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const ACL = JSON.parse(fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'), 'utf8'));
const READ = ACL['zapret2-manager'].read.ubus['zapret2-manager'];
const WRITE = ACL['zapret2-manager'].write.ubus['zapret2-manager'];

test('strategy source RPCs route to source lifecycle ownership', () => {
  assert.match(RPC, /strategy-catalog-refresh\.uc/);
  assert.match(RPC, /strategy-sources\.uc/);
  assert.match(RPC, /function strategies_sources_get_method/);
  assert.match(RPC, /function strategies_source_refresh_method/);
  assert.match(RPC, /function strategies_source_set_enabled_method/);
  assert.match(RPC, /strategies_sources_get/);
  assert.match(RPC, /strategies_source_refresh/);
  assert.match(RPC, /catalog_refresh_source/);
  assert.match(RPC, /strategies_source_set_enabled/);
  assert.ok(READ.includes('strategies_sources_get'));
  assert.ok(WRITE.includes('strategies_source_refresh'));
  assert.ok(WRITE.includes('strategies_source_set_enabled'));
});
