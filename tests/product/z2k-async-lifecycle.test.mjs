import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const rpcPath = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const cliPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-cli.uc');
const coordinatorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const workerPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc');
const maintenancePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const apiPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
const aclPath = path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');

const rpc = fs.readFileSync(rpcPath, 'utf8');
const cli = fs.readFileSync(cliPath, 'utf8');
const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
const worker = fs.readFileSync(workerPath, 'utf8');
const maintenance = fs.readFileSync(maintenancePath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'];

test('Z2K resource update is queued outside the bounded rpcd request and exposes backend status', () => {
  assert.match(coordinator, /resource_center_enqueue_update/);
  assert.match(coordinator, /resource_center_update_status/);
  assert.match(worker, /resource_center_update\(job\.request\)/);
  assert.match(cli, /update-async/);
  assert.match(cli, /update-status/);
  assert.match(rpc, /resources_update_status/);
  assert.match(rpc, /let mode = parsed && parsed\.bundleId == 'z2k-curated-lua' \? 'update-async' : 'update'/);
  assert.match(coordinator, /command\('sh \/etc\/init\.d\/zapret2 restart'\)/);
  assert.ok(acl.read.ubus['zapret2-manager'].includes('resources_update_status'));
});

test('Components UI polls the backend-owned Z2K operation before reporting success', () => {
  assert.match(api, /resourcesUpdateStatus/);
  assert.match(api, /updateStatus:/);
  assert.match(maintenance, /operationId/);
  assert.match(maintenance, /updateStatus/);
  assert.match(maintenance, /setTimeout/);
  assert.match(maintenance, /accepted/);
});
