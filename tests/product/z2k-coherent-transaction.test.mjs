import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc');
const runtime = read('zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const apply = read('zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc');

const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS ? process.env.UCODE_ARGS.split(' ').filter(Boolean) : [];
const UCODE_LIBRARY_ARGS = process.env.UCODE_LIBRARY_PATH ? ['-L', process.env.UCODE_LIBRARY_PATH] : [];
const hasUcode = fs.existsSync(UCODE_BIN);

function invoke(expression) {
  const source = `import * as transaction from ${JSON.stringify(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'))}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

test('prepare is staging-only and worker remains a progress coordinator', () => {
  assert.match(coordinator, /resource_center_prepare_version/);
  assert.match(coordinator, /save_prepared_target\(target\)/);
  const prepare = coordinator.slice(coordinator.indexOf('export const resource_center_prepare_version'), coordinator.indexOf('function z2k_target_policy'));
  assert.doesNotMatch(prepare, /asset_registry_apply_bundle|asset_registry_finalize_activation|z2k_detect_publish_prepared/);
  assert.doesNotMatch(worker, /asset_registry_apply_bundle|asset_registry_finalize_activation|z2k_detect_publish_prepared/);
  assert.match(worker, /resource_center_operation_write/);
});

test('pending activation records every prior authority needed for fail-closed rollback', () => {
  const applyBody = coordinator.slice(coordinator.indexOf('function z2k_apply_prepared'), coordinator.indexOf('export const resource_center_status'));
  for (const field of [
    'priorReceipt', 'priorRegistryMembership', 'priorRegistryRevision', 'priorRuntimeComposition',
    'priorDetect', 'priorCatalog', 'priorActiveStrategy', 'priorConfig', 'priorRuntimeEnabled',
  ]) assert.match(applyBody, new RegExp(field), `pending evidence must include ${field}`);
  assert.match(coordinator, /strategy_selection_restore/);
  assert.match(coordinator, /restore_transaction_config/);
  assert.match(coordinator, /catalogRestoreRequired/);
});

test('active strategy candidate preflight preserves official IDs and selected Avatar/User closure', () => {
  assert.match(runtime, /runtime_strategy_preflight/);
  assert.match(runtime, /ECOMPATIBILITY/);
  assert.match(runtime, /canonicalStrategyId|canonicalId/);
  assert.match(runtime, /closureReady|nativeReady/);
  assert.match(coordinator, /runtime_strategy_preflight/);
});

test('Detect SHA failure before commit does not invoke Registry or runtime mutation', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_precommit_failure({ testOnly: true, failure: 'detect-sha' })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY', JSON.stringify(result));
  assert.equal(result.mutations.registry, 0, JSON.stringify(result));
  assert.equal(result.mutations.runtime, 0, JSON.stringify(result));
  assert.equal(result.activeIdentity, 'X', JSON.stringify(result));
});

test('active-strategy candidate preflight failure leaves active X unchanged before commit', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_precommit_failure({ testOnly: true, failure: 'strategy-preflight' })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ECOMPATIBILITY', JSON.stringify(result));
  assert.equal(result.mutations.registry, 0, JSON.stringify(result));
  assert.equal(result.activeIdentity, 'X', JSON.stringify(result));
});

test('post-materialize readiness failure restores the physical X snapshot', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_post_materialize_failure({ testOnly: true })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ERUNTIME', JSON.stringify(result));
  assert.equal(result.restored, true, JSON.stringify(result));
  assert.equal(result.physicalIdentity, 'X', JSON.stringify(result));
  assert.equal(result.recoveryRequired, false, JSON.stringify(result));
});

