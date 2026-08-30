import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const registry = read('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc');
const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-cli.uc');

function functionBody(source, marker, nextMarker) {
  const start = source.indexOf(marker);
  const end = nextMarker ? source.indexOf(nextMarker, start + marker.length) : source.length;
  assert.ok(start >= 0, `missing ${marker}`);
  return source.slice(start, end < 0 ? source.length : end);
}

test('asset bundle commit and activation finalization are separate authority boundaries', () => {
  const apply = functionBody(registry, 'export const asset_registry_apply_bundle', 'export const asset_registry_finalize_activation');
  const finalize = functionBody(registry, 'export const asset_registry_finalize_activation', 'export const asset_registry_rollback_bundle');
  assert.match(apply, /committedAssetRevision|committed.*revision/i);
  assert.doesNotMatch(apply, /asset-activation-receipt\.v[12]/);
  assert.match(finalize, /asset-activation-receipt\.v2/);
  assert.match(finalize, /committedAssetRevision/);
  assert.match(finalize, /membershipDigest|candidateSnapshotId|snapshotId/);
  assert.match(finalize, /activationEvidence/);
});

test('candidate transaction persists durable evidence before the first irreversible Registry commit', () => {
  assert.match(coordinator, /z2k-pending-activation\.json/);
  assert.match(coordinator, /PREPARED|COMMITTED|MATERIALIZED|PROCESS_VERIFIED|FINALIZED|ROLLING_BACK|ROLLED_BACK/);
  const apply = functionBody(coordinator, 'function z2k_apply_prepared', 'export const resource_center_status');
  const journal = apply.indexOf('pending-activation');
  const registryApply = apply.indexOf('asset_registry_apply_bundle');
  assert.ok(journal >= 0, 'transaction must write durable pending evidence');
  assert.ok(registryApply > journal, 'durable evidence must precede Registry commit');
  assert.match(apply, /baseRegistryRevision/);
  assert.match(apply, /committedAssetRevision/);
  assert.match(apply, /asset_registry_finalize_activation/);
  assert.match(apply, /verifyMaterialized|z2k_target_postflight/);
  assert.match(apply, /verifyActivationProcess|PROCESS_VERIFIED/);
});

test('worker job is only a progress mirror and recovery is a separate durable consumer', () => {
  assert.match(worker, /resource_center_operation_write/);
  assert.match(worker, /resource_center_update/);
  assert.match(coordinator, /resource_center_recover_pending|z2k_lifecycle_recover/);
  assert.match(cli, /recover|resource_center_recover_pending/);
  assert.match(coordinator, /\/tmp\/z2m-resource-update\/jobs/);
});

test('pre-commit CAS rejects unrelated Registry changes but accepts the transaction own revision transition', () => {
  const apply = functionBody(coordinator, 'function z2k_apply_prepared', 'export const resource_center_status');
  assert.match(apply, /observedRegistryRevision/);
  assert.match(apply, /baseRegistryRevision/);
  assert.match(apply, /ESTALE/);
  assert.match(apply, /committedAssetRevision/);
  assert.match(apply, /membership.*candidate|candidate.*membership/i);
  assert.match(registry, /expectedRevision|expectedRegistryRevision/);
});

test('same-release V1 reconciliation uses FRESH resolution and the normal reinstall transaction', () => {
  assert.match(coordinator, /V1_VERIFIED_MEMBERSHIP|reconciliationRequired/);
  assert.match(coordinator, /z2k_resolve_version|z2k_upstream_check/);
  assert.match(coordinator, /FRESH|fresh/);
  assert.match(coordinator, /reinstall/);
  assert.match(coordinator, /resolveCandidate/);
  assert.doesNotMatch(coordinator, /function\s+z2k_v1_(?:update|apply)|v1.*updater/i);
});

test('successful postflight promotes v2 identity and closes the pending journal', () => {
  assert.match(registry, /manifestSha256/);
  assert.match(registry, /classificationSha256/);
  assert.match(registry, /installedAuthorityRevision/);
  assert.match(registry, /committedRegistryRevision|committedAssetRevision/);
  assert.match(coordinator, /FINALIZED/);
  assert.match(coordinator, /ROLLED_BACK/);
  assert.match(coordinator, /unlink|pending.*null|clear.*pending/i);
});
