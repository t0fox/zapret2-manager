import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc');
const runtime = read('zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const apply = read('zapret2-manager/files/usr/libexec/zapret2-manager/apply.uc');
const runtimePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const activeStrategySnapshot = coordinator.slice(
  coordinator.indexOf('function z2k_active_strategy_snapshot'),
  coordinator.indexOf('export const resource_center_test_prior_activation_diagnostics'),
);

const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS ? process.env.UCODE_ARGS.split(' ').filter(Boolean) : [];
const UCODE_LIBRARY_ARGS = process.env.UCODE_LIBRARY_PATH ? ['-L', process.env.UCODE_LIBRARY_PATH] : [];
const hasUcode = fs.existsSync(UCODE_BIN);

function invoke(expression, env = {}) {
  const source = `import * as transaction from ${JSON.stringify(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'))}; import { writefile, stat, unlink } from 'fs'; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env }, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

function invokeRuntime(expression, env = {}) {
  const source = `import * as composition from ${JSON.stringify(runtimePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env }, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

const DIGEST = 'a'.repeat(64);
function compatibilityIdentity(sourceCommit) {
  const value = {
    release: 'r-80.3', sourceCommit, manifestRevision: 80,
    runtimeBundleDigest: DIGEST, compilerSnapshotDigest: DIGEST,
  };
  const identityText = 'z2k-compatibility-v1\n'
    + `release=${value.release}\nsourceCommit=${value.sourceCommit}\n`
    + `manifestRevision=${value.manifestRevision}\n`
    + `runtimeBundleDigest=${value.runtimeBundleDigest}\n`
    + `compilerSnapshotDigest=${value.compilerSnapshotDigest}\n`;
  return { ...value, digest: createHash('sha256').update(identityText).digest('hex') };
}
function priorActivationFixture() {
  return {
    selected: {
      id: 'avatar:stable', canonicalStrategyId: 'avatar:stable', sourceId: 'avatar', selected: true,
      origin: 'avatar_builtin', revision: 3, sourceSnapshotId: 'avatar-old', sourceCommit: 'b'.repeat(40),
      candidateSha256: DIGEST, strategyDigest: DIGEST,
    },
    selectionRevision: 7,
    catalog: {
      generationId: 'catalog-old', indexDigest: DIGEST, generatedAt: 1,
      index: { generationId: 'catalog-old', indexDigest: DIGEST, generatedAt: 1, entries: [], userRevision: 2 },
      sourceInputs: { avatar: { enabled: true, currentSnapshotId: 'avatar-old', snapshot: { snapshotId: 'avatar-old', contentDigest: DIGEST, fileSha256: DIGEST } } },
      userEntries: [],
    },
    config: { bytes: 'old-config', sha256: DIGEST },
    runtimeEnabled: '1', runtimeEnabledPresent: true,
  };
}

function preparedTargetFixture() {
  const sourceCommit = 'c'.repeat(40), identity = compatibilityIdentity(sourceCommit);
  return {
    schema: 2, targetVersion: 'r-80.3', targetCommitSha: sourceCommit,
    manifestSha256: DIGEST, localFingerprint: DIGEST, classificationSha256: DIGEST,
    operation: 'upgrade', preparedAt: 17, targetCanApply: true,
    targetAttentionState: 'review-advisory', targetBlockingReasons: [], targetReviewDetails: [],
    assets: [{ id: 'lua:alpha', sourcePath: 'files/lua/alpha.lua', type: 'lua', sha256: DIGEST, runtimeTarget: '/runtime-assets/lua/alpha.lua' }],
    removeIds: [], removeTargets: [], priorActivation: priorActivationFixture(),
    z2kRelease: 'r-80.3', manifestRevision: 80, runtimeBundleDigest: DIGEST,
    compilerSnapshotDigest: DIGEST, z2kCompatibilityIdentity: identity,
    compatibilityIdentity: identity.digest, migration: null,
  };
}

function catalogEntry(sourceId, canonicalId) {
  return {
    id: canonicalId, canonicalId, sourceId,
    origin: sourceId === 'z2k' ? 'z2k_builtin' : sourceId === 'avatar' ? 'avatar_builtin' : 'user',
    owner: sourceId === 'z2k' ? 'z2k-core' : sourceId,
    strategyClass: sourceId === 'z2k' ? 'official-z2k' : sourceId === 'avatar' ? 'avatar' : 'user',
    entryKind: sourceId === 'z2k' ? 'all-in-one' : null,
    sourceSnapshotId: `${sourceId}-snapshot`,
    provenance: {
      repository: sourceId === 'z2k' ? 'necronicle/z2k' : sourceId === 'avatar' ? 'avatarDD/zapret-gui' : null,
      sourceId, sourceSnapshotId: `${sourceId}-snapshot`,
      kind: sourceId === 'z2k' ? 'strategy-catalog-import' : sourceId === 'avatar' ? 'strategy-catalog' : 'user-strategy',
    },
  };
}

test('prepare is staging-only and worker remains a progress coordinator', () => {
  assert.match(coordinator, /resource_center_prepare_version/);
  assert.match(coordinator, /save_prepared_target\(target\)/);
  const prepare = coordinator.slice(coordinator.indexOf('export const resource_center_prepare_version'), coordinator.indexOf('function z2k_target_policy'));
  assert.doesNotMatch(prepare, /asset_registry_apply_bundle|asset_registry_finalize_activation|z2k_detect_publish_prepared/);
  assert.doesNotMatch(worker, /asset_registry_apply_bundle|asset_registry_finalize_activation|z2k_detect_publish_prepared/);
  assert.match(worker, /resource_center_operation_write/);
});

test('active strategy lifecycle snapshot uses the canonical copy helper', () => {
  assert.equal((activeStrategySnapshot.match(/\bz2k_copy\s*\(/g) || []).length, 3);
  assert.doesNotMatch(activeStrategySnapshot, /\bcopy\s*\(/);
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

test('pending rollback evidence captures exact receipt identity and runtime bundle digest', () => {
  const applyBody = coordinator.slice(coordinator.indexOf('function z2k_apply_prepared'), coordinator.indexOf('export const resource_center_status'));
  assert.match(applyBody, /rollbackIdentity:\s*\{[\s\S]*receiptId/);
  assert.match(applyBody, /rollbackIdentity:\s*\{[\s\S]*runtimeBundleDigest/);
  assert.match(coordinator, /keysToCompare[\s\S]*receiptId/);
  assert.match(coordinator, /keysToCompare[\s\S]*runtimeBundleDigest/);
});

test('config rollback is idempotent for an already-restored digest and remains fail-closed otherwise', () => {
  const start = apply.indexOf('export const restore_transaction_config');
  const end = apply.indexOf('const APPLIED_IDENTITY', start);
  const restore = apply.slice(start, end);
  const direct = restore.indexOf('if (locked() || lockedOverride === true)');
  const current = restore.indexOf('let current = config_sha256();', direct);
  const alreadyRestored = restore.indexOf('alreadyRestored: true', direct);
  const writer = restore.indexOf('restore_whole_file(', direct);
  const verification = restore.indexOf('config_sha256() != snapshot.sha256');
  assert.ok(direct >= 0 && current > direct && alreadyRestored > current && current < writer,
    'locked/override rollback must check the digest before restore_whole_file');
  assert.ok(writer >= 0 && verification > writer,
    'locked/override mismatch must retain restore and post-write verification');
  assert.match(restore, /let digest_cmd = [\s\S]*let inner = [\s\S]*digest_cmd[\s\S]*digest_cmd/,
    'unlocked rollback must build both digest checks inside the lock command');
  assert.match(restore, /shell_escape\(APPLY_CLI\)[\s\S]*do_restore_file/,
    'unlocked rollback must use the canonical locked restore writer');
  assert.match(restore, /Z2M_CONFIG_LOCKED=1 flock -x/,
    'unlocked rollback must acquire config.lock');
  assert.match(restore, /code: 'EROLLBACK'/);
});

test('production target operation fails closed for unresolved cross-family releases', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_target_operation({ testOnly: true, targetVersion: 'r-80.3', installedVersion: 'p-80.3' })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EORDER_UNRESOLVED', JSON.stringify(result));
  assert.equal(result.operation, null, JSON.stringify(result));
  assert.equal(result.mutations, 0, JSON.stringify(result));
});

test('persisted prepared target validates after JSON round-trip', { skip: !hasUcode }, () => {
  const target = preparedTargetFixture();
  const token = invoke(`transaction.resource_center_test_prepared_target_token({ testOnly: true, target: ${JSON.stringify(target)} })`);
  assert.equal(token.tokenEqual, false, JSON.stringify(token));
  target.planToken = token.computedPlanToken;
  const persisted = JSON.parse(JSON.stringify(target));
  const result = invoke(`transaction.resource_center_test_valid_prepared_target({ testOnly: true, target: ${JSON.stringify(persisted)} })`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.valid, true, JSON.stringify(result));
});

test('rollback verification consumes captured receipt identity and runtime digest', { skip: !hasUcode }, () => {
  const prior = { schema: 'asset-activation-receipt.v1', receiptId: 'receipt-lkg', runtimeBundleDigest: 'a'.repeat(64), assets: [] };
  const pending = { rollbackIdentity: { receipt: prior, receiptId: prior.receiptId, runtimeBundleDigest: prior.runtimeBundleDigest } };
  const exact = invoke(`transaction.resource_center_test_rollback_identity({ testOnly: true, pending: ${JSON.stringify(pending)}, actualReceipt: ${JSON.stringify(prior)} })`);
  const wrongReceipt = { ...prior, receiptId: 'receipt-other' };
  const wrongDigest = { ...prior, runtimeBundleDigest: 'b'.repeat(64) };
  const receiptMismatch = invoke(`transaction.resource_center_test_rollback_identity({ testOnly: true, pending: ${JSON.stringify(pending)}, actualReceipt: ${JSON.stringify(wrongReceipt)} })`);
  const digestMismatch = invoke(`transaction.resource_center_test_rollback_identity({ testOnly: true, pending: ${JSON.stringify(pending)}, actualReceipt: ${JSON.stringify(wrongDigest)} })`);
  assert.equal(exact.ok, true, JSON.stringify(exact));
  assert.equal(receiptMismatch.ok, false, JSON.stringify(receiptMismatch));
  assert.equal(digestMismatch.ok, false, JSON.stringify(digestMismatch));
});

test('apply consumes the persisted prior snapshot and has no prepare-local priorStrategy dependency', () => {
  const applyBody = coordinator.slice(coordinator.indexOf('function z2k_apply_prepared'), coordinator.indexOf('export const resource_center_status'));
  assert.match(applyBody, /target\.priorActivation|target\.priorStrategy/);
  assert.doesNotMatch(applyBody, /priorStrategy\.catalog/);
  assert.match(coordinator, /priorActivation/);
  assert.match(coordinator, /ESNAPSHOT/);
});

test('apply re-projects the authoritative prior selection after rebuilding the candidate catalog', () => {
  const applyBody = coordinator.slice(coordinator.indexOf('function z2k_apply_prepared'), coordinator.indexOf('export const resource_center_status'));
  const catalogAt = applyBody.indexOf('target.candidateCatalog = z2k_candidate_catalog');
  const projectionAt = applyBody.indexOf('strategy_selection_project_candidate', catalogAt);
  const fingerprintAt = applyBody.indexOf('z2k_local_fingerprint', catalogAt);
  const consumeAt = applyBody.indexOf('consume_prepared_target', catalogAt);
  assert.ok(catalogAt >= 0, 'apply must rebuild the candidate catalog from authoritative prior activation');
  assert.ok(projectionAt > catalogAt && projectionAt < fingerprintAt && projectionAt < consumeAt,
    'apply must project selection before stale checks and before consuming the target');
  const projection = applyBody.slice(projectionAt, fingerprintAt);
  assert.match(projection, /selected:\s*priorActivation\.selected/);
  assert.match(projection, /candidateCatalog:\s*target\.candidateCatalog/);
  assert.match(projection, /if\s*\(!projectedSelection\.ok\)\s*return\s+projectedSelection/);
  assert.match(projection, /target\.activeStrategy\s*=\s*projectedSelection\.selected\s*==\s*null\s*\?\s*null/,
    'missing authoritative selection must project to a null runtime selection');
  assert.match(projection, /selected:\s*true/,
    'present authoritative selection must be marked selected only in the local target projection');
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
  assert.match(coordinator, /transactionCatalog/);
  assert.match(coordinator, /CATALOG_ACTIVATED/);
  assert.ok(applyBody.indexOf("z2k_pending_write(pending, 'CATALOG_ACTIVATED')") < applyBody.indexOf('z2k_coherent_finalize_request'), 'catalog activation identity must be durable before receipt finalization');
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

test('rollback defines the active strategy snapshot before its UCode consumer', () => {
  const snapshotAt = coordinator.indexOf('function z2k_active_strategy_snapshot');
  const guardAt = coordinator.indexOf('function z2k_rollback_active_state_guard');
  assert.ok(snapshotAt >= 0 && guardAt >= 0 && snapshotAt < guardAt,
    'UCode rollback must not call a forward-referenced active snapshot helper');
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

test('unknown and missing active strategy sources fail closed before candidate mutation', { skip: !hasUcode }, () => {
  for (const selected of [
    { id: 'x', canonicalStrategyId: 'x', selected: true, sourceId: 'unknown' },
    { id: 'x', canonicalStrategyId: 'x', selected: true },
    { id: 'x', canonicalStrategyId: 'x', selected: true, sourceId: 7 },
  ]) {
    const result = invokeRuntime(`composition.runtime_strategy_preflight({ activeStrategy: ${JSON.stringify(selected)}, candidateCatalog: { ids: [] }, candidateRuntime: { closureReady: true, nativeReady: true } })`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'ECOMPATIBILITY', JSON.stringify(result));
  }
});

test('recognized official, Avatar, and User sources still require candidate closure evidence', { skip: !hasUcode }, () => {
  for (const sourceId of ['z2k', 'avatar', 'user']) {
    const selected = { id: `${sourceId}:stable`, canonicalStrategyId: `${sourceId}:stable`, sourceId, origin: sourceId === 'z2k' ? 'z2k_builtin' : sourceId === 'avatar' ? 'avatar_builtin' : 'user', selected: true };
    const accepted = invokeRuntime(`composition.runtime_strategy_preflight({ activeStrategy: ${JSON.stringify(selected)}, candidateCatalog: { entries: [${JSON.stringify(catalogEntry(sourceId, `${sourceId}:stable`))}] }, candidateRuntime: { closureReady: true, nativeReady: true } })`);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const rejected = invokeRuntime(`composition.runtime_strategy_preflight({ activeStrategy: ${JSON.stringify(selected)}, candidateCatalog: { entries: [${JSON.stringify(catalogEntry(sourceId, `${sourceId}:stable`))}] }, candidateRuntime: { closureReady: false, nativeReady: true } })`);
    assert.equal(rejected.ok, false, JSON.stringify(rejected));
    assert.equal(rejected.error.code, 'ECOMPATIBILITY', JSON.stringify(rejected));
  }
});

test('runtime preflight rejects Avatar/User provenance mismatches and flat-list attribution', { skip: !hasUcode }, () => {
  const cases = [
    [{ id: 'avatar:stable', canonicalStrategyId: 'avatar:stable', sourceId: 'avatar', origin: 'avatar_builtin', selected: true }, catalogEntry('user', 'avatar:stable')],
    [{ id: 'user:stable', canonicalStrategyId: 'user:stable', sourceId: 'user', origin: 'user', selected: true }, catalogEntry('avatar', 'user:stable')],
  ];
  for (const [selected, entry] of cases) {
    const result = invokeRuntime(`composition.runtime_strategy_preflight({ activeStrategy: ${JSON.stringify(selected)}, candidateCatalog: { entries: [${JSON.stringify(entry)}] }, candidateRuntime: { closureReady: true, nativeReady: true } })`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'ECOMPATIBILITY', JSON.stringify(result));
  }
  const flatOnly = invokeRuntime(`composition.runtime_strategy_preflight({ activeStrategy: ${JSON.stringify(cases[0][0])}, candidateCatalog: { ids: ['avatar:stable'] }, candidateRuntime: { closureReady: true, nativeReady: true } })`);
  assert.equal(flatOnly.ok, false, JSON.stringify(flatOnly));
  assert.equal(flatOnly.error.code, 'ECOMPATIBILITY', JSON.stringify(flatOnly));
});

test('transaction precommit rejects Avatar/User provenance mismatches before mutation', { skip: !hasUcode }, () => {
  for (const [selectedSource, catalogSource] of [['avatar', 'user'], ['user', 'avatar']]) {
    const result = invoke(`transaction.resource_center_test_precommit_failure({ testOnly: true, failure: 'strategy-provenance-mismatch', selectedSource: '${selectedSource}', catalogSource: '${catalogSource}' })`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'ECOMPATIBILITY', JSON.stringify(result));
    assert.equal(result.mutations.registry, 0, JSON.stringify(result));
    assert.equal(result.mutations.runtime, 0, JSON.stringify(result));
    assert.equal(result.activeIdentity, 'X', JSON.stringify(result));
  }
});

test('prepared active-state token binds selection, catalog, config, and enabled state; stale apply never mutates', { skip: !hasUcode }, () => {
  const prepared = priorActivationFixture();
  const valid = invoke(`transaction.resource_center_test_prepared_state_guard({ testOnly: true, preparedActivation: ${JSON.stringify(prepared)}, currentActivation: ${JSON.stringify(prepared)}, preparedAt: 17 })`);
  assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.mutationCount, 1, JSON.stringify(valid));
  assert.match(valid.planToken, /^z2k-target-v2:/, JSON.stringify(valid));

  const changes = [
    ['selection', current => ({ ...current, selectionRevision: current.selectionRevision + 1, selected: { ...current.selected, id: 'avatar:changed', canonicalStrategyId: 'avatar:changed' } })],
    ['catalog', current => ({ ...current, catalog: { ...current.catalog, generationId: 'catalog-changed', indexDigest: 'b'.repeat(64), index: { ...current.catalog.index, generationId: 'catalog-changed', indexDigest: 'b'.repeat(64) } } })],
    ['config', current => ({ ...current, config: { ...current.config, bytes: 'new-config', sha256: 'c'.repeat(64) } })],
    ['enabled', current => ({ ...current, runtimeEnabled: '0' })],
  ];
  for (const [name, change] of changes) {
    const current = change(structuredClone(prepared));
    const stale = invoke(`transaction.resource_center_test_prepared_state_guard({ testOnly: true, preparedActivation: ${JSON.stringify(prepared)}, currentActivation: ${JSON.stringify(current)}, preparedAt: 17 })`);
    assert.equal(stale.ok, false, `${name}: ${JSON.stringify(stale)}`);
    assert.equal(stale.error.code, 'ECHECK_STALE', `${name}: ${JSON.stringify(stale)}`);
    assert.equal(stale.mutationCount, 0, `${name}: ${JSON.stringify(stale)}`);
  }

  const changedPrepared = { ...structuredClone(prepared), config: { bytes: 'different-prepared-config', sha256: 'd'.repeat(64) } };
  const rebound = invoke(`transaction.resource_center_test_prepared_state_guard({ testOnly: true, preparedActivation: ${JSON.stringify(changedPrepared)}, currentActivation: ${JSON.stringify(changedPrepared)}, preparedAt: 17 })`);
  assert.notEqual(rebound.planToken, valid.planToken, 'the persisted plan token must bind prior active config identity');
});

test('rollback accepts an internal selection revision bump when active identity is unchanged', { skip: !hasUcode }, () => {
  const prior = priorActivationFixture();
  const current = { ...structuredClone(prior), selectionRevision: prior.selectionRevision + 1 };
  const result = invoke(`(() => {
    let calls = { runtime: 0, registry: 0, source: 0, catalog: 0, strategy: 0, config: 0 };
    let seams = {
      pendingLoad: function() { return { phase: 'COMMITTED', priorActivation: ${JSON.stringify(prior)}, priorActiveStrategy: ${JSON.stringify(prior.selected)}, priorConfig: ${JSON.stringify(prior.config)}, priorRuntimeEnabledPresent: false, priorRuntimeEnabled: '1', sourceRestoreRequired: true, catalogRestoreRequired: true, priorCatalog: ${JSON.stringify(prior.catalog)}, sourceActivation: {} }; },
      pendingWrite: function() { return true; }, pendingClear: function() { return true; },
      activeStateSnapshot: function() { return { ok: true, activation: ${JSON.stringify(current)} }; },
      runtimeRollback: function() { calls.runtime++; return { ok: true }; }, registryList: function() { return { ok: true, revision: 2, assets: [] }; }, registryAlreadyRestored: function() { return true; },
      registryRollback: function() { calls.registry++; return { ok: true }; }, sourceRestore: function() { calls.source++; return { ok: true }; },
      catalogRestore: function() { calls.catalog++; return { ok: true, generationId: 'catalog-old', indexDigest: '${DIGEST}' }; }, strategyRestore: function() { calls.strategy++; return { ok: true }; },
      configRestore: function() { calls.config++; return { ok: true }; }, detectRestore: function() { return { ok: true }; }
    };
    let answer = transaction.resource_center_test_rollback_transaction({ testOnly: true, selected: { id: 'z2k-curated-lua' }, applied: { committedAssetRevision: 2 }, diagnostics: {}, runtimeActivated: false, seams });
    return { answer, calls };
  })()`);
  assert.equal(result.answer.ok, true, JSON.stringify(result));
  assert.equal(result.answer.recoveryRequired, false, JSON.stringify(result));
  assert.deepEqual(result.calls, { runtime: 0, registry: 0, source: 1, catalog: 1, strategy: 1, config: 1 }, JSON.stringify(result));
});

test('rollback refuses to overwrite a newer user config or selection state', { skip: !hasUcode }, () => {
  const prior = priorActivationFixture();
  const newer = { ...structuredClone(prior), config: { bytes: 'user-new-config', sha256: 'e'.repeat(64) } };
  const result = invoke(`(() => {
    let calls = { runtime: 0, registry: 0, source: 0, catalog: 0, strategy: 0, config: 0 };
    let seams = {
      pendingLoad: function() { return { phase: 'COMMITTED', priorActivation: ${JSON.stringify(prior)}, priorActiveStrategy: ${JSON.stringify(prior.selected)}, priorConfig: ${JSON.stringify(prior.config)}, priorRuntimeEnabledPresent: true, priorRuntimeEnabled: '1', sourceRestoreRequired: true, catalogRestoreRequired: true, priorCatalog: ${JSON.stringify(prior.catalog)}, sourceActivation: {} }; },
      pendingWrite: function() { return true; }, pendingClear: function() { return true; },
      activeStateSnapshot: function() { return { ok: true, activation: ${JSON.stringify(newer)} }; },
      runtimeRollback: function() { calls.runtime++; return { ok: true }; }, registryList: function() { return { ok: true, revision: 2, assets: [] }; }, registryAlreadyRestored: function() { return true; },
      registryRollback: function() { calls.registry++; return { ok: true }; }, sourceRestore: function() { calls.source++; return { ok: true }; },
      catalogRestore: function() { calls.catalog++; return { ok: true, generationId: 'catalog-old', indexDigest: '${DIGEST}' }; }, strategyRestore: function() { calls.strategy++; return { ok: true }; },
      configRestore: function() { calls.config++; return { ok: true }; }, detectRestore: function() { return { ok: true }; }
    };
    let answer = transaction.resource_center_test_rollback_transaction({ testOnly: true, selected: { id: 'z2k-curated-lua' }, applied: { committedAssetRevision: 2 }, diagnostics: {}, runtimeActivated: true, seams });
    return { answer, calls };
  })()`);
  assert.equal(result.answer.ok, false, JSON.stringify(result));
  assert.equal(result.answer.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
  assert.deepEqual(result.calls, { runtime: 0, registry: 0, source: 0, catalog: 0, strategy: 0, config: 0 }, JSON.stringify(result));
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
  assert.deepEqual(result.lkgEvidence, {
    initialActiveReceiptId: 'receipt-candidate', initialActiveRuntimeBundleDigest: 'b'.repeat(64), restoreInvoked: true,
    priorReceiptId: 'receipt-lkg', currentReceiptId: 'receipt-candidate', restoredReceiptId: 'receipt-lkg',
    priorRuntimeBundleDigest: 'a'.repeat(64), currentRuntimeBundleDigest: 'b'.repeat(64), restoredRuntimeBundleDigest: 'a'.repeat(64),
    restored: true, restoredByIdentity: true,
    restoredReceipt: { schema: 'asset-activation-receipt.v1', receiptId: 'receipt-lkg', runtimeBundleDigest: 'a'.repeat(64), assets: [] },
  }, JSON.stringify(result));
});

test('postflight failure exposes a canonical top-level rollback outcome and preserves the LKG identity', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_postflight_failure({ testOnly: true })`);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual(result.error, { code: 'EPOSTFLIGHT', message: 'postflight failed' }, JSON.stringify(result));
  assert.deepEqual(result.rollback, {
    attempted: true,
    ok: true,
    restored: {
      release: 'p-82.18',
      runtimeBundleDigest: 'a'.repeat(64),
      detectSha256: 'b'.repeat(64),
      catalogDigest: 'c'.repeat(64),
      strategyIdentity: 'd'.repeat(64),
    },
  }, JSON.stringify(result));
});

test('pre-commit failure exposes no-mutation rollback outcome', { skip: !hasUcode }, () => {
  const result = invoke(`transaction.resource_center_test_precommit_failure({ testOnly: true, failure: 'detect-sha' })`);
  assert.deepEqual(result.rollback, { attempted: false, ok: true, restored: null }, JSON.stringify(result));
  assert.equal(result.mutations.registry, 0, JSON.stringify(result));
  assert.equal(result.mutations.runtime, 0, JSON.stringify(result));
  assert.equal(result.activeIdentity, 'X', JSON.stringify(result));
});

test('Task 12 rollback result contract is owned by the existing coordinator', () => {
  assert.match(coordinator, /function z2k_rollback_outcome/);
  assert.match(coordinator, /answer\.rollback\s*=.*z2k_rollback_outcome/);
  assert.match(coordinator, /attempted:\s*false/);
  assert.match(coordinator, /EPOSTFLIGHT/);
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
