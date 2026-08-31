import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc',
  'utf8',
);

const applyStart = source.indexOf('function z2k_apply_prepared');
const applyEnd = source.indexOf('export const resource_center_status', applyStart);
const apply = source.slice(applyStart, applyEnd);

test('Z2K intentional runtime guard owns the canonical watchdog pause', () => {
  assert.match(source, /const Z2K_PAUSE_FILE\s*=\s*['"]\/tmp\/zapret2-manager\/paused['"]/);
  assert.match(source, /function z2k_runtime_guard_acquire\s*\(/);
  assert.match(source, /function z2k_runtime_guard_release\s*\(/);
  assert.match(source, /stat\(Z2K_PAUSE_FILE\)/);
  assert.match(source, /writefile\(Z2K_PAUSE_FILE/);
  assert.match(source, /owned:\s*!preexisting/);
  assert.match(source, /guard\.owned\s*!==\s*true/);
  assert.match(source, /unlink\(Z2K_PAUSE_FILE\)/);
  assert.match(source, /pause-acquire-failed|pause-release-failed/);
});

test('Z2K guard spans activation and both rollback branches with ownership-safe release', () => {
  const consume = apply.indexOf('consume_prepared_target(state, target)');
  const acquire = apply.indexOf('z2k_runtime_guard_acquire()');
  const download = apply.indexOf('uclient-fetch');
  const registryApply = apply.indexOf('asset_registry_apply_bundle');
  const runtimeActivate = apply.indexOf('z2k_runtime_activate');
  const registryFailure = apply.indexOf('z2k_rollback_after_runtime_failure');
  const runtimeFailure = apply.indexOf('z2k_rollback_after_runtime_failure(selected, applied, diagnostics, runtime.activated === true)', runtimeActivate);
  const release = apply.lastIndexOf('z2k_runtime_guard_finish');

  assert.ok(consume >= 0, 'prepared target must be consumed under the lifecycle lock');
  assert.ok(acquire > consume, 'pause must be acquired after target consumption');
  assert.ok(download > acquire, 'pause must cover downloads and materialization');
  assert.ok(registryApply > download, 'pause must cover Registry activation');
  assert.ok(runtimeActivate > registryApply, 'pause must cover runtime activation and readiness');
  assert.ok(registryFailure > registryApply && registryFailure < runtimeActivate, 'Registry postflight rollback must happen before runtime activation');
  assert.ok(runtimeFailure > runtimeActivate, 'runtime rollback must happen before guard release');
  assert.ok(release > runtimeFailure, 'guard finish must happen after rollback or success');
  assert.match(source, /function z2k_runtime_guard_finish[\s\S]*z2k_runtime_guard_release\(guard\)[\s\S]*z2k_lifecycle_lock_release\(\)/);
  assert.match(apply, /catch\s*\(e\)[\s\S]*z2k_runtime_guard_finish/);
});

test('guard preserves a pre-existing pause and removes only its own pause', () => {
  const acquireStart = source.indexOf('function z2k_runtime_guard_acquire');
  const releaseStart = source.indexOf('function z2k_runtime_guard_release');
  const acquire = source.slice(acquireStart, releaseStart);
  const releaseEnd = source.indexOf('function ', releaseStart + 10);
  const release = source.slice(releaseStart, releaseEnd < 0 ? source.length : releaseEnd);

  assert.match(acquire, /preexisting\s*=\s*stat\(Z2K_PAUSE_FILE\)/);
  assert.match(acquire, /if \(preexisting\)/);
  assert.match(acquire, /owned:\s*!preexisting/);
  assert.match(release, /if \(!guard \|\| guard\.owned !== true\)/);
  assert.match(release, /unlink\(Z2K_PAUSE_FILE\)/);
  assert.match(release, /stat\(Z2K_PAUSE_FILE\)/);
});

test('recovery does not consume the Registry rollback snapshot twice', () => {
  const helperStart = source.indexOf('function z2k_rollback_registry_already_restored');
  const rollbackStart = source.indexOf('function z2k_rollback_after_runtime_failure');
  const rollback = source.slice(rollbackStart);
  const alreadyRestored = rollback.indexOf('z2k_rollback_registry_already_restored');
  const registryRollback = rollback.indexOf('asset_registry_rollback_bundle');
  assert.ok(alreadyRestored >= 0, 'recovery must detect an already-restored Registry');
  assert.ok(registryRollback > alreadyRestored,
    'Registry rollback must run only after the already-restored check');
  assert.ok(helperStart >= 0, 'already-restored helper must be defined');
  const helper = source.slice(helperStart, rollbackStart);
  assert.match(helper, /rollbackIdentity\.receipt/);
  assert.match(helper, /rollbackIdentity\.registryRevision/);
  assert.match(helper, /z2k_registry_receipt_state/);
  assert.match(source, /actual\.contentSha256\s*\|\|\s*actual\.sha256/,
    'rollback identity must compare both Registry and v1 receipt SHA field names');
  assert.match(source, /actual\.sourcePath\s*\|\|\s*provenance\.sourcePath/,
    'rollback identity must compare both Registry and v1 receipt source-path field locations');
});

test('ROLLING_BACK with an exact restored V1 identity resumes the canonical same-release reconciliation', () => {
  assert.match(source, /function z2k_pending_legacy_reconciliation_eligible\s*\(/,
    'recovery must have an explicit V1 reconciliation eligibility gate');
  const recoveryStart = source.indexOf('export const resource_center_recover_pending');
  const recovery = source.slice(recoveryStart);
  const reconcileStart = source.indexOf('function z2k_reconcile_legacy_pending');
  const reconcile = source.slice(reconcileStart, recoveryStart);
  assert.match(recovery, /z2k_pending_legacy_reconciliation_eligible/);
  assert.match(reconcile, /resource_center_prepare_version/,
    'recovery must rebuild the target through authoritative preparation');
  assert.match(reconcile, /resource_center_update/,
    'recovery must reuse the normal same-release update transaction');
  assert.match(reconcile, /fresh|FRESH/,
    'V1 recovery must use a FRESH same-release resolution');
  assert.match(recovery, /phase\s*==\s*['"]ROLLING_BACK['"]/);
});
