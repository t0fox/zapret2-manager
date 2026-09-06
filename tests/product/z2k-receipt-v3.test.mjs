import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const installedPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc');
const registryPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const pattern = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const libraryArgs = pattern ? ['-L', pattern] : [];
const hasUcode = fs.existsSync(UCODE_BIN);
const digest = value => value.repeat(64);
const commit = 'a'.repeat(40);
const release = 'p-81.1';
const bundleId = 'z2k-curated-lua';

function member(id, kind, index) {
  return {
    id, owner: 'z2k-core', role: kind === 'lua' ? 'lua-init' : 'dependency',
    sourcePath: `files/${kind}/${id.split(':')[1]}`, runtimeTarget: `/runtime-assets/${kind}/${id.split(':')[1]}`,
    contentSha256: digest(String.fromCharCode(98 + index)), byteSize: index + 10,
    runtimeOrder: kind === 'lua' ? index : undefined, kind, type: 'lifecycle-managed',
    version: release, sourceCommit: commit,
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
      compatibilityIdentity: digest('c'),
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
