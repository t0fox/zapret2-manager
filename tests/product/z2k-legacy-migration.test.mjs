import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const migrationPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const hasUcode = fs.existsSync(UCODE_BIN);
const digest = value => value.repeat(64);
const commit = 'a'.repeat(40);

function invoke(expression) {
  const source = `import * as migration from ${JSON.stringify(migrationPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function receipt(schema) {
  return schema === 'asset-activation-receipt.v2'
    ? { schema, bundleId: 'z2k-curated-lua', version: 'r-82.7', sourceCommit: commit,
      manifestSha256: digest('b'), classificationSha256: digest('c'), z2kMembership: [{ id: 'lua:core' }] }
    : { schema: 'asset-activation-receipt.v3', bundleId: 'z2k-curated-lua', release: 'p-82.14', version: 'p-82.14', sourceCommit: commit,
      manifestSeq: 82, manifestSha256: digest('b'), classificationSha256: digest('c'), runtimeBundleDigest: digest('d'),
      compilerInputsDigest: digest('e'), catalogDigest: digest('f'), compatibilityIdentity: digest('a'),
      runtimeMembership: [{ id: 'lua:core' }], detect: { arch: 'arm64', digest: digest('g'), size: 10 } };
}

test('V2 is legacy and V3 is coherent', { skip: !hasUcode }, () => {
  assert.equal(invoke(`migration.z2k_migration_state({ activeReceipt: ${JSON.stringify(receipt('asset-activation-receipt.v2'))} })`), 'LEGACY_Z2K');
  assert.equal(invoke(`migration.z2k_migration_state({ activeReceipt: ${JSON.stringify(receipt('asset-activation-receipt.v3'))} })`), 'COHERENT_Z2K');
});

test('failed migration preserves the active V2 receipt and every user/runtime field', { skip: !hasUcode }, () => {
  const input = { testOnly: true, activeReceipt: receipt('asset-activation-receipt.v2'), migrationCommit: false,
    discoveredDomains: ['example.org'], sourceSelection: { id: 'user' }, exclusions: ['skip.example'], userStrategies: [{ id: 'mine' }] };
  const result = invoke(`migration.z2k_migration_apply(${JSON.stringify(input)})`);
  assert.equal(result.ok, false);
  assert.equal(result.mutated, false);
  assert.equal(result.activeReceipt.schema, 'asset-activation-receipt.v2');
  assert.deepEqual(result.preserved.discoveredDomains, ['example.org']);
  assert.deepEqual(result.preserved.sourceSelection, { id: 'user' });
  assert.deepEqual(result.preserved.exclusions, ['skip.example']);
  assert.deepEqual(result.preserved.userStrategies, [{ id: 'mine' }]);
});

test('successful migration writes V3 and preserves discovered domains and user data', { skip: !hasUcode }, () => {
  const input = { testOnly: true, activeReceipt: receipt('asset-activation-receipt.v2'), migrationCommit: true,
    candidate: { release: 'p-82.14', sourceCommit: commit, manifestSeq: 83, manifestSha256: digest('h'), classificationSha256: digest('i'),
      runtimeBundleDigest: digest('j'), compilerInputsDigest: digest('k'), catalogDigest: digest('l'), compatibilityIdentity: digest('m'),
      runtimeMembership: [{ id: 'lua:new' }], detect: { arch: 'arm64', digest: digest('n'), size: 11 } },
    discoveredDomains: ['example.org'], sourceSelection: { id: 'user' }, exclusions: ['skip.example'], userStrategies: [{ id: 'mine' }] };
  const result = invoke(`migration.z2k_migration_apply(${JSON.stringify(input)})`);
  assert.equal(result.ok, true);
  assert.equal(result.activeReceipt.schema, 'asset-activation-receipt.v3');
  assert.equal(result.discoveredDomainsPreserved, true);
  assert.deepEqual(result.preserved.discoveredDomains, ['example.org']);
  assert.deepEqual(result.preserved.userStrategies, [{ id: 'mine' }]);
});
