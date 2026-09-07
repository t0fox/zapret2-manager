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
const manifestPath = path.join(root, 'router-deploy-runtime-composition.manifest');

const rpc = fs.readFileSync(rpcPath, 'utf8');
const cli = fs.readFileSync(cliPath, 'utf8');
const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
const worker = fs.readFileSync(workerPath, 'utf8');
const maintenance = fs.readFileSync(maintenancePath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'];
const manifest = fs.readFileSync(manifestPath, 'utf8');

function functionBody(source, marker, nextMarker) {
  const start = source.indexOf(marker);
  const end = source.indexOf(nextMarker, start + marker.length);
  assert.ok(start >= 0, `missing ${marker}`);
  assert.ok(end > start, `missing ${nextMarker}`);
  return source.slice(start, end);
}

test('Z2K resource update is queued outside the bounded rpcd request and exposes backend status', () => {
  assert.match(coordinator, /resource_center_enqueue_update/);
  assert.match(coordinator, /resource_center_update_status/);
  assert.match(worker, /resource_center_update\(job\.request\)/);
  assert.match(cli, /update-async/);
  assert.match(cli, /update-status/);
  assert.match(rpc, /resources_update_status/);
  assert.match(rpc, /let mode = parsed && parsed\.bundleId == 'z2k-curated-lua' \? 'update-async' : 'update'/);
  assert.match(coordinator, /command\('sh \/etc\/rc\.common \/etc\/init\.d\/zapret2 restart'\)/);
  assert.ok(acl.read.ubus['zapret2-manager'].includes('resources_update_status'));
});

test('queued Z2K update jobs persist their worker kind and spawned pid for dispatch', () => {
  const enqueueUpdate = functionBody(coordinator, 'export const resource_center_enqueue_update', 'function z2k_prepare_job_result_reusable');
  assert.match(enqueueUpdate, /job = \{[\s\S]*kind: 'update'[\s\S]*pid: null/,
    'queued update jobs must be typed for the worker and start without a pid');
  const spawnIndex = enqueueUpdate.indexOf('let spawned = z2k_operation_spawn(jobPath);');
  const pidPersistIndex = enqueueUpdate.indexOf('job.pid = spawned.pid; z2k_operation_write(jobPath, job);');
  assert.ok(spawnIndex >= 0, 'update enqueue must spawn the existing worker');
  assert.ok(pidPersistIndex > spawnIndex, 'update enqueue must persist the spawned worker pid');
  assert.match(worker, /job\.kind == 'prepare' \? resource_center_prepare_version\(job\.request\) : resource_center_update\(job\.request\)/,
    'worker must dispatch typed update jobs to the canonical update operation');
});

test('Z2K prepare is queued outside the 30-second rpcd request and exposes its result', () => {
  assert.match(coordinator, /resource_center_enqueue_prepare/);
  assert.match(worker, /job\.kind == 'prepare'/);
  assert.match(worker, /resource_center_prepare_version\(job\.request\)/);
  assert.match(rpc, /z2k_prepare_version_start/);
  assert.match(rpc, /z2k_prepare_version_status/);
  assert.ok(acl.write.ubus['zapret2-manager'].includes('z2k_prepare_version_start'));
  assert.ok(acl.read.ubus['zapret2-manager'].includes('z2k_prepare_version_status'));
});

test('completed prepare jobs are reused only while their prepared target is still persisted', () => {
  assert.match(coordinator, /function z2k_prepare_job_result_reusable\(version, result\)/);
  assert.match(coordinator, /z2k_prepare_job_result_reusable\(version, job\.result\)/);
  assert.match(coordinator, /if \(!z2k_prepare_job_result_reusable\(version, job\.result\)\) continue;/);
  assert.match(coordinator, /persisted\.planToken == result\.planToken/);
});

test('Components UI polls the backend-owned Z2K operation before reporting success', () => {
  assert.match(api, /resourcesUpdateStatus/);
  assert.match(api, /updateStatus:/);
  assert.match(maintenance, /operationId/);
  assert.match(maintenance, /updateStatus/);
  assert.match(maintenance, /setTimeout/);
  assert.match(maintenance, /accepted/);
});

test('Components UI treats Z2K prepare as a bounded operation and waits for its result', () => {
  assert.match(api, /z2k_prepare_version_start/);
  assert.match(api, /z2k_prepare_version_status/);
  assert.match(api, /prepareVersion:z2kPrepareVersion/);
  assert.match(api, /prepareStatus/);
  assert.match(maintenance, /Z2K_PREPARE_TIMEOUT_MS/);
});

test('Reviewed router closure includes both halves of the async prepare UI path', () => {
  assert.match(manifest, /luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/z2m-api\.js/);
  assert.match(manifest, /luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/z2m-maintenance\.js/);
});
