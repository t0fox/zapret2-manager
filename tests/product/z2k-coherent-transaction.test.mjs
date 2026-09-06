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

function invoke(expression, env = {}) {
  const source = `import * as transaction from ${JSON.stringify(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'))}; import { writefile, stat, unlink } from 'fs'; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000,
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

test('apply consumes the persisted prior snapshot and has no prepare-local priorStrategy dependency', () => {
  const applyBody = coordinator.slice(coordinator.indexOf('function z2k_apply_prepared'), coordinator.indexOf('export const resource_center_status'));
  assert.match(applyBody, /target\.priorActivation|target\.priorStrategy/);
  assert.doesNotMatch(applyBody, /priorStrategy\.catalog/);
  assert.match(coordinator, /priorActivation/);
  assert.match(coordinator, /ESNAPSHOT/);
});

test('durable intent phases cover Registry, runtime, and source/catalog mutation windows', () => {
  const applyBody = coordinator.slice(coordinator.indexOf('function z2k_apply_prepared'), coordinator.indexOf('export const resource_center_status'));
  const registryApply = applyBody.indexOf('asset_registry_apply_bundle');
  const runtimeActivate = applyBody.indexOf('z2k_runtime_activate(');
  const sourceActivate = applyBody.indexOf('strategy_source_install_verified_snapshot');
  assert.ok(applyBody.indexOf("z2k_pending_write(pending, 'REGISTRY_COMMITTING')") < registryApply);
  assert.ok(applyBody.indexOf("z2k_pending_write(pending, 'RUNTIME_ACTIVATING')") < runtimeActivate);
  assert.ok(applyBody.indexOf("z2k_pending_write(pending, 'SOURCE_ACTIVATING')") < sourceActivate);
  assert.match(coordinator, /REGISTRY_COMMITTING|RUNTIME_ACTIVATING|SOURCE_ACTIVATING/);
  assert.match(coordinator, /runtimeActivationIntent/);
});

test('recovery never clears an ambiguous pre-commit marker and treats runtime intent as activated', () => {
  const recovery = coordinator.slice(coordinator.indexOf('export const resource_center_recover_pending'), coordinator.length);
  assert.match(recovery, /REGISTRY_COMMITTING/);
  assert.match(recovery, /RUNTIME_ACTIVATING/);
  assert.match(recovery, /ERECOVERY_REQUIRED/);
  assert.doesNotMatch(recovery, /pending\.phase == 'PREPARED'[\s\S]*pendingClear\(\)/);
  assert.match(coordinator, /runtimeActivationIntent === true/);
});

test('candidate strategy gate is built from the new Core snapshot and rollback verifies exact prior catalog identity', () => {
  assert.match(coordinator, /z2k_candidate_catalog/);
  assert.match(coordinator, /core\.snapshot[\s\S]*candidateCatalog/);
  assert.match(coordinator, /z2k_catalog_restore/);
  assert.match(coordinator, /priorCatalog[\s\S]*indexDigest/);
  assert.match(coordinator, /catalogRestore\(pending\.priorCatalog\)/);
});

test('rollback passes the captured catalog identity and rejects mismatched restore evidence', { skip: !hasUcode }, () => {
  const result = invoke(`(() => {
    let priorCatalog = { generationId: 'generation-old', indexDigest: '${'a'.repeat(64)}', sourceInputs: {} }, seen = null;
    let base = { phase: 'COMMITTED', catalogRestoreRequired: true, priorCatalog };
    let seams = {
      pendingLoad: function() { return base; }, pendingWrite: function(value, phase) { value.phase = phase; return true; }, pendingClear: function() { return true; },
      runtimeRollback: function() { return { ok: true }; }, registryList: function() { return { ok: true, revision: 2, assets: [], activationReceipts: [] }; }, registryAlreadyRestored: function() { return true; },
      registryRollback: function() { return { ok: true }; }, sourceRestore: function() { return { ok: true }; },
      catalogRestore: function(value) { seen = value; return { ok: true, generationId: value.generationId, indexDigest: value.indexDigest }; }, detectRestore: function() { return { ok: true }; }
    };
    let good = transaction.resource_center_test_rollback_transaction({ testOnly: true, selected: { id: 'z2k-curated-lua' }, applied: { committedAssetRevision: 2 }, diagnostics: {}, runtimeActivated: false, seams });
    seams.catalogRestore = function(value) { return { ok: true, generationId: 'generation-wrong', indexDigest: value.indexDigest }; };
    let bad = transaction.resource_center_test_rollback_transaction({ testOnly: true, selected: { id: 'z2k-curated-lua' }, applied: { committedAssetRevision: 2 }, diagnostics: {}, runtimeActivated: false, seams });
    return { good, bad, seen };
  })()`);
  assert.equal(result.good.ok, true, JSON.stringify(result));
  assert.equal(result.seen.generationId, 'generation-old', JSON.stringify(result));
  assert.equal(result.bad.ok, false, JSON.stringify(result));
  assert.equal(result.bad.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
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

test('Registry crash window remains pending until prior identity is proven or rolled back', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_recovery_contract({ testOnly: true, phase: 'REGISTRY_COMMITTING', registryMatchesPrior: false, runtimeMatchesPrior: true, catalogMatchesPrior: true, detectMatchesPrior: true, receiptMatchesPrior: false })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
  assert.equal(result.cleared, false, JSON.stringify(result));
  assert.equal(result.rollbackRequired, true, JSON.stringify(result));
});

test('runtime activation crash window requires physical runtime rollback before closure', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_recovery_contract({ testOnly: true, phase: 'RUNTIME_ACTIVATING', registryMatchesPrior: true, runtimeMatchesPrior: false, catalogMatchesPrior: true, detectMatchesPrior: true, receiptMatchesPrior: true })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
  assert.equal(result.cleared, false, JSON.stringify(result));
  assert.equal(result.runtimeActivated, true, JSON.stringify(result));
});

test('actual recovery retains an ambiguous PREPARED marker instead of clearing it', { skip: !hasUcode }, () => {
  const pendingPath = `/tmp/z2m-z2k-detect-recovery-test-${process.pid}-task7-ambiguous`;
  const result = invoke(`(() => {
    let pendingPath = ${JSON.stringify(pendingPath)}, pending = { schema: 1, candidateSnapshotId: 'snapshot-task7', membershipDigest: '${'a'.repeat(64)}', baseRegistryRevision: 1, targetVersion: 'p-82.14', targetCommit: '${'b'.repeat(40)}', planToken: 'plan-task7', rollbackIdentity: { registryRevision: 1, receipt: null, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' }, sourceRestoreRequired: true, phase: 'PREPARED' };
    writefile(pendingPath, sprintf('%J', pending) + '\\n');
    let recovered = transaction.resource_center_recover_pending(), pendingPresent = stat(pendingPath) != null;
    try { unlink(pendingPath); } catch (e) {}
    return { recovered, pendingPresent };
  })()`, { Z2M_UPDATE_SOURCE_TEST: '1', Z2M_RESOURCE_UPDATE_PENDING_TEST_PATH: pendingPath });
  assert.equal(result.recovered.ok, false, JSON.stringify(result));
  assert.equal(result.recovered.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
  assert.equal(result.pendingPresent, true, JSON.stringify(result));
});
