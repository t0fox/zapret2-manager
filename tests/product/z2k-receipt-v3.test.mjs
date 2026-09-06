import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const installedPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc');
const registryPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const resourcePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const runtimePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const pattern = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const libraryArgs = pattern ? ['-L', pattern] : [];
const hasUcode = fs.existsSync(UCODE_BIN);
const digest = value => value.repeat(64);
const commit = 'a'.repeat(40);
const release = 'p-81.1';
const bundleId = 'z2k-curated-lua';
function compatibilityIdentity() {
  const text = `z2k-compatibility-v1\nrelease=${release}\nsourceCommit=${commit}\nmanifestRevision=81\nruntimeBundleDigest=${digest('a')}\ncompilerSnapshotDigest=${digest('e')}\n`;
  return { schema: 'z2k-compatibility.v1', release, sourceCommit: commit, manifestRevision: 81,
    runtimeBundleDigest: digest('a'), compilerSnapshotDigest: digest('e'),
    digest: crypto.createHash('sha256').update(text).digest('hex') };
}

function member(id, kind, index) {
  return {
    id, owner: 'z2k-core', role: kind === 'lua' ? 'lua-init' : 'dependency',
    sourcePath: `files/${kind}/${id.split(':')[1]}`, runtimeTarget: `/runtime-assets/${kind}/${id.split(':')[1]}`,
    contentSha256: digest(String.fromCharCode(98 + index)), byteSize: index + 10,
    runtimeOrder: kind === 'lua' ? index : undefined, kind, type: 'lifecycle-managed',
    version: release, sourceCommit: commit, manifestSha256: digest('b'), classificationSha256: digest('c'),
    runtimeBundleDigest: digest('a'), compatibilityIdentity: digest('a'),
  };
}

function fixture() {
  const runtimeMembership = [member('lua:core', 'lua', 0), member('blob:fake', 'blob', 1)];
  const assets = runtimeMembership.map((entry, index) => ({
    ...entry, type: entry.kind === 'blob' ? 'blob' : entry.kind,
    path: `/etc/zapret2-manager/assets/${entry.kind}/${entry.id.split(':')[1]}`,
    ownership: 'manager', revision: index + 1,
    provenance: {
      kind: 'catalog/upstream', bundleId, source: 'necronicle/z2k',
      sourceCommit: commit, sourcePath: entry.sourcePath, version: release,
      compatibilityIdentity: digest('a'),
    },
  }));
  const receipt = {
    schema: 'asset-activation-receipt.v3', bundleId, release, version: release,
    source: 'necronicle/z2k', sourceCommit: commit, manifestSeq: 81,
    manifestSha256: digest('b'), classificationSha256: digest('c'),
    runtimeMembership, detect: { arch: 'aarch64', digest: digest('d'), size: 1234, sourceCommit: commit },
    detectIdentity: { arch: 'aarch64', digest: digest('d'), size: 1234 },
    compilerInputsDigest: digest('e'), catalogDigest: digest('f'), runtimeBundleDigest: digest('a'),
    compatibilityIdentity: digest('a'), installedAuthorityRevision: 17,
    candidateSnapshotId: 'snapshot-finalize', membershipDigest: digest('m'), committedRegistryRevision: 16,
    z2kMembership: runtimeMembership, receiptId: 'receipt-v3',
  };
  return { receipt, registry: { ok: true, schema: 1, revision: 17, assets, activationReceipts: [receipt] } };
}

function invoke(expression) {
  const source = `import * as authority from ${JSON.stringify(installedPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...libraryArgs, '-e', source], {
    cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...libraryArgs, '-e', source], pattern)}`);
  return JSON.parse(result.stdout);
}

function invokeModules(expression, env = {}) {
  const source = `import * as resource from ${JSON.stringify(resourcePath)}; import * as runtime from ${JSON.stringify(runtimePath)}; import * as registry from ${JSON.stringify(registryPath)}; import * as authority from ${JSON.stringify(installedPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...libraryArgs, '-e', source], {
    cwd: root, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...libraryArgs, '-e', source], pattern)}`);
  return JSON.parse(result.stdout);
}

test('V3 receipt validates the complete coherent Core identity', { skip: !hasUcode }, () => {
  const value = fixture();
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(value.receipt)}, ${JSON.stringify(value.registry)})`), true);
  assert.equal(invoke(`authority.z2k_registry_receipt_state(${JSON.stringify(value.registry)})`).state, 'COHERENT_VERIFIED');
});

test('V3 receipt rejects missing Detect identity and Detect digest mismatch', { skip: !hasUcode }, () => {
  const missing = fixture();
  missing.receipt.detect = null;
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(missing.receipt)}, ${JSON.stringify(missing.registry)})`), false);
  const mismatch = fixture();
  mismatch.receipt.detect.digest = digest('e');
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(mismatch.receipt)}, ${JSON.stringify(mismatch.registry)})`), false);
});

test('V3 receipt rejects extra or missing lifecycle assets', { skip: !hasUcode }, () => {
  const extra = fixture();
  extra.registry.assets.push({ ...extra.registry.assets[0], id: 'lua:extra' });
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(extra.receipt)}, ${JSON.stringify(extra.registry)})`), false);
  const missing = fixture();
  missing.receipt.runtimeMembership = missing.receipt.runtimeMembership.slice(0, 1);
  missing.receipt.z2kMembership = missing.receipt.z2kMembership.slice(0, 1);
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(missing.receipt)}, ${JSON.stringify(missing.registry)})`), false);
});

test('V3 receipt requires canonical runtimeMembership and binds every member to release/source', { skip: !hasUcode }, () => {
  const missing = fixture();
  delete missing.receipt.runtimeMembership;
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(missing.receipt)}, ${JSON.stringify(missing.registry)})`), false);
  const crossIdentity = fixture();
  crossIdentity.receipt.runtimeMembership[0].sourceCommit = 'b'.repeat(40);
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(crossIdentity.receipt)}, ${JSON.stringify(crossIdentity.registry)})`), false);
  const crossRelease = fixture();
  crossRelease.receipt.runtimeMembership[0].version = 'p-80.9';
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(crossRelease.receipt)}, ${JSON.stringify(crossRelease.registry)})`), false);
});

test('V3 receipt rejects non-Core ownership, non-canonical role, and malformed kind', { skip: !hasUcode }, () => {
  for (const mutate of [
    entry => { entry.owner = 'package'; },
    entry => { entry.role = 'lua-dependency'; },
    entry => { entry.kind = 'hostlist'; },
    entry => { entry.kind = 'lua'; entry.role = 'dependency'; },
  ]) {
    const value = fixture();
    mutate(value.receipt.runtimeMembership[0]);
    assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(value.receipt)}, ${JSON.stringify(value.registry)})`), false);
  }
});

test('V3 receipt rejects release/source provenance mismatch and preserves V1/V2 legacy state', { skip: !hasUcode }, () => {
  const mismatch = fixture();
  mismatch.registry.assets[0].provenance.sourceCommit = 'b'.repeat(40);
  assert.equal(invoke(`authority.z2k_registry_receipt_valid(${JSON.stringify(mismatch.receipt)}, ${JSON.stringify(mismatch.registry)})`), false);
  const legacy = fixture();
  legacy.receipt.schema = 'asset-activation-receipt.v2';
  delete legacy.receipt.release;
  delete legacy.receipt.manifestSeq;
  delete legacy.receipt.runtimeMembership;
  delete legacy.receipt.detect;
  delete legacy.receipt.compilerInputsDigest;
  delete legacy.receipt.catalogDigest;
  delete legacy.receipt.runtimeBundleDigest;
  legacy.receipt.z2kMembership = legacy.receipt.z2kMembership.map(entry => ({ ...entry, type: 'lifecycle-managed' }));
  assert.equal(invoke(`authority.z2k_registry_receipt_state(${JSON.stringify(legacy.registry)})`).state, 'LEGACY_VERIFIED');
});

test('V3 registry finalization writes the coherent receipt without changing the wire bundle id', { skip: !hasUcode }, () => {
  const source = fs.readFileSync(registryPath, 'utf8');
  assert.match(source, /asset-activation-receipt\.v3/);
  assert.match(source, /bundleId == 'z2k-curated-lua'/);
  assert.match(source, /compilerInputsDigest/);
  assert.match(source, /catalogDigest/);
});

test('production-shaped finalization carries all coherent evidence into the sole Registry receipt', { skip: !hasUcode }, () => {
  const value = fixture();
  const compatibility = compatibilityIdentity();
  const memberValue = { ...value.receipt.runtimeMembership[0], compatibilityIdentity: compatibility.digest };
  const asset = { ...value.registry.assets[0], provenance: { ...value.registry.assets[0].provenance, compatibilityIdentity: compatibility.digest } };
  const registryStatePath = `/tmp/z2m-task6-finalize-${process.pid}.json`;
  const input = {
    testOnly: true,
    selected: { id: bundleId },
    target: {
      targetVersion: release, targetCommitSha: commit, manifestSha256: value.receipt.manifestSha256,
      classificationSha256: value.receipt.classificationSha256, manifestRevision: value.receipt.manifestSeq,
      compilerSnapshotDigest: value.receipt.compilerInputsDigest, runtimeBundleDigest: value.receipt.runtimeBundleDigest,
      compatibilityIdentity: compatibility.digest, z2kCompatibilityIdentity: compatibility,
      candidateSnapshotId: 'snapshot-finalize', membershipDigest: digest('m'), baseRegistryRevision: 3,
    },
    candidate: { snapshotId: 'snapshot-finalize', membershipDigest: digest('m'), runtimeAssets: [memberValue] },
    detectStaged: { candidate: { arch: value.receipt.detect.arch, sha256: value.receipt.detect.digest, byteSize: value.receipt.detect.size, sourceCommit: commit } },
    activationEvidence: { verified: true, detectDigest: value.receipt.detect.digest },
    committedAssetRevision: 4, catalogDigest: value.receipt.catalogDigest,
  };
  const snapshotMismatchInput = JSON.parse(JSON.stringify(input));
  snapshotMismatchInput.target.candidateSnapshotId = 'stale-candidate-snapshot';
  const membershipMismatchInput = JSON.parse(JSON.stringify(input));
  membershipMismatchInput.target.membershipDigest = digest('x');
  const missingIdentityInput = JSON.parse(JSON.stringify(input));
  delete missingIdentityInput.target.candidateSnapshotId;
  const state = { schema: 1, revision: 4, assets: [asset], activationReceipts: [] };
  fs.writeFileSync(registryStatePath, JSON.stringify(state));
  try {
    const rerun = invokeModules(`(() => { let identityMismatch = resource.resource_center_test_coherent_finalize_request(${JSON.stringify(snapshotMismatchInput)}); let membershipMismatch = resource.resource_center_test_coherent_finalize_request(${JSON.stringify(membershipMismatchInput)}); let missingIdentity = resource.resource_center_test_coherent_finalize_request(${JSON.stringify(missingIdentityInput)}); let request = resource.resource_center_test_coherent_finalize_request(${JSON.stringify(input)}); if (!request.ok) return { identityMismatch: identityMismatch, membershipMismatch: membershipMismatch, missingIdentity: missingIdentity, request: request }; let finalized = registry.asset_registry_finalize_activation(request.request); let listed = registry.asset_registry_list(null); return { identityMismatch: identityMismatch, membershipMismatch: membershipMismatch, missingIdentity: missingIdentity, request: request, finalized: finalized, authority: authority.z2k_registry_receipt_state(listed), bundleId: finalized.receipt && finalized.receipt.bundleId, schema: finalized.receipt && finalized.receipt.schema }; })()`, {
      Z2M_ASSET_REGISTRY_STATE: registryStatePath,
      Z2M_UPDATE_SOURCE_TEST: '1',
    });
    assert.equal(rerun.identityMismatch.ok, false, JSON.stringify(rerun));
    assert.equal(rerun.membershipMismatch.ok, false, JSON.stringify(rerun));
    assert.equal(rerun.missingIdentity.ok, false, JSON.stringify(rerun));
    assert.equal(rerun.request.ok, true, JSON.stringify(rerun));
    assert.equal(rerun.finalized.ok, true, JSON.stringify(rerun));
    assert.equal(rerun.schema, 'asset-activation-receipt.v3', JSON.stringify(rerun));
    assert.equal(rerun.bundleId, bundleId, JSON.stringify(rerun));
    assert.equal(rerun.authority.state, 'COHERENT_VERIFIED', JSON.stringify(rerun));
    assert.equal(rerun.request.request.runtimeMembership.length, 1);
    assert.equal(rerun.request.request.detectIdentity.digest, value.receipt.detect.digest);
    assert.equal(rerun.request.request.catalogDigest, value.receipt.catalogDigest);
  } finally {
    try { fs.unlinkSync(registryStatePath); } catch {}
  }
});

test('FINALIZED recovery independently verifies materialized runtime and process identity', { skip: !hasUcode }, () => {
  const value = fixture();
  const pending = {
    testOnly: true, phase: 'FINALIZED', candidateSnapshotId: 'snapshot-finalize', membershipDigest: digest('m'),
    baseRegistryRevision: 15, committedAssetRevision: 16, targetVersion: release, targetCommit: commit,
    planToken: 'plan-finalize', rollbackIdentity: { registryRevision: 15, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' },
  };
  const packageCompositionPath = `/tmp/z2m-task6-package-${process.pid}.json`;
  fs.writeFileSync(packageCompositionPath, JSON.stringify({
    schema: 1,
    entries: [{ id: 'package:base', type: 'package-static', owner: 'package', role: 'lua-init', kind: 'lua', sourcePath: 'files/lua/package.lua', runtimeTarget: '/runtime-assets/lua/package.lua', contentSha256: '1'.repeat(64), byteSize: 1, runtimeOrder: 0 }],
  }));
  const result = invokeModules(`(() => {
    let staticBase = [{ id: 'package:base', type: 'package-static', owner: 'package', role: 'lua-init', kind: 'lua', sourcePath: 'files/lua/package.lua', runtimeTarget: '/runtime-assets/lua/package.lua', contentSha256: ${JSON.stringify('1'.repeat(64))}, byteSize: 1, runtimeOrder: 0 }];
    let installed = runtime.resolveInstalled({ registry: ${JSON.stringify(value.registry)}, staticBase });
    if (!installed.ok || installed.runtimeAssets == null) return { installed: installed, runtimeAssets: installed.runtimeAssets };
    let files = {}, runtimeHashes = {};
    for (let i = 0; i < length(installed.runtimeAssets); i++) {
      let entry = installed.runtimeAssets[i];
      files[entry.id] = { exists: true, present: true, sha256: entry.contentSha256, byteSize: entry.byteSize, owner: entry.owner };
      files[entry.runtimeTarget] = files[entry.id];
      runtimeHashes[entry.id] = entry.contentSha256;
    }
    let materialized = { snapshotId: installed.snapshotId, membershipDigest: installed.membershipDigest, files, configHash: 'config-proof' };
    let luaInitIds = []; for (let i = 0; i < length(installed.luaInit); i++) push(luaInitIds, installed.luaInit[i].id);
    let process = { snapshotId: installed.snapshotId, membershipDigest: installed.membershipDigest, queueReady: true, pid: 321, processStarttime: '654', processGeneration: 'generation-proof', configHash: 'config-proof', activeConfigHash: 'config-proof', runtimeHashes, luaInitIds };
    let direct = runtime.verifyMaterialized(installed, materialized);
    if (!direct.ok) return { diagnostic: direct };
    let listed = ${JSON.stringify(value.registry)}, coherentPending = ${JSON.stringify(pending)};
    let receipt = listed.activationReceipts[0];
    coherentPending.runtimeSnapshotId = installed.snapshotId;
    coherentPending.membershipDigest = installed.membershipDigest;
    receipt.membershipDigest = installed.membershipDigest;
    let good = resource.resource_center_test_finalized_recovery({ testOnly: true, pending: coherentPending, listed: listed, runtimeProof: { staticBase, materialized, process } });
    coherentPending.runtimeSnapshotId = 'snapshot-mismatch';
    let snapshotMismatch = resource.resource_center_test_finalized_recovery({ testOnly: true, pending: coherentPending, listed: listed, runtimeProof: { staticBase, materialized, process } });
    coherentPending.runtimeSnapshotId = installed.snapshotId;
    receipt.membershipDigest = ${JSON.stringify(digest('m'))};
    coherentPending.membershipDigest = ${JSON.stringify(digest('m'))};
    let membershipMismatch = resource.resource_center_test_finalized_recovery({ testOnly: true, pending: coherentPending, listed: listed, runtimeProof: { staticBase, materialized, process } });
    receipt.membershipDigest = installed.membershipDigest;
    coherentPending.membershipDigest = installed.membershipDigest;
    process.runtimeHashes[installed.runtimeAssets[0].id] = ${JSON.stringify('e'.repeat(64))};
    let bad = resource.resource_center_test_finalized_recovery({ testOnly: true, pending: coherentPending, listed: listed, runtimeProof: { staticBase, materialized, process } });
    return { installed: installed, direct: direct, good: good, snapshotMismatch: snapshotMismatch, membershipMismatch: membershipMismatch, bad: bad };
  })()`, { Z2M_UPDATE_SOURCE_TEST: '1', Z2M_RUNTIME_PACKAGE_COMPOSITION: packageCompositionPath });
  assert.equal(result.installed.ok, true, JSON.stringify(result));
  assert.equal(result.good.ok, true, JSON.stringify(result));
  assert.equal(result.snapshotMismatch.ok, false, JSON.stringify(result));
  assert.equal(result.membershipMismatch.ok, false, JSON.stringify(result));
  assert.equal(result.bad.ok, false, JSON.stringify(result));
  try { fs.unlinkSync(packageCompositionPath); } catch {}
});
