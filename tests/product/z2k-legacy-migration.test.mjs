import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const migrationPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc');
const resourcePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const hasUcode = fs.existsSync(UCODE_BIN);
const digest = value => value.repeat(64);
const commit = 'a'.repeat(40);

function invoke(expression, modulePath = migrationPath, moduleName = 'migration') {
  const source = `import * as ${moduleName} from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
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
      runtimeMembership: [{ id: 'lua:core' }], detect: { arch: 'arm64', digest: digest('a'), size: 10 } };
}

test('V2 is legacy and V3 is coherent', { skip: !hasUcode }, () => {
  assert.equal(invoke(`migration.z2k_migration_state({ activeReceipt: ${JSON.stringify(receipt('asset-activation-receipt.v2'))} })`), 'LEGACY_Z2K');
  assert.equal(invoke(`migration.z2k_migration_state({ activeReceipt: ${JSON.stringify(receipt('asset-activation-receipt.v3'))} })`), 'COHERENT_Z2K');
});

test('malformed V3 is not coherent and does not authorize migration state', { skip: !hasUcode }, () => {
  const malformed = receipt('asset-activation-receipt.v3');
  delete malformed.detect;
  assert.equal(invoke(`migration.z2k_migration_state({ activeReceipt: ${JSON.stringify(malformed)} })`), 'NONE');
});

test('production-shaped migration prepare/commit/rollback uses one transaction authority', { skip: !hasUcode }, () => {
  const data = { discoveredDomains: ['example.org'], sourceSelection: { id: 'user' }, exclusions: ['skip.example'],
    userStrategies: [{ id: 'mine' }], runtimeData: { enabled: true, configSha256: digest('r') } };
  const legacy = receipt('asset-activation-receipt.v2');
  const coherent = receipt('asset-activation-receipt.v3');
  const input = { testOnly: true, activeReceipt: legacy, finalReceipt: coherent, ...data };
  const prepared = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify({ ...input, phase: 'prepare' })})`, resourcePath, 'resource');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.migration.required, true);
  assert.deepEqual(prepared.migration.preserved.runtimeData, data.runtimeData);
  const committed = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify({ ...input, phase: 'commit', prepared: prepared.migration })})`, resourcePath, 'resource');
  assert.equal(committed.ok, true);
  assert.equal(committed.activeReceipt.schema, 'asset-activation-receipt.v3');
  assert.deepEqual(committed.preserved.discoveredDomains, data.discoveredDomains);
  const rolledBack = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify({ ...input, phase: 'failure', prepared: prepared.migration })})`, resourcePath, 'resource');
  assert.equal(rolledBack.ok, false);
  assert.equal(rolledBack.activeReceipt.schema, 'asset-activation-receipt.v2');
  assert.deepEqual(rolledBack.preserved.userStrategies, data.userStrategies);
});

test('failed migration preserves the active V2 receipt and every user/runtime field', { skip: !hasUcode }, () => {
  const input = { testOnly: true, phase: 'prepare', activeReceipt: receipt('asset-activation-receipt.v2'),
    discoveredDomains: ['example.org'], sourceSelection: { id: 'user' }, exclusions: ['skip.example'], userStrategies: [{ id: 'mine' }], runtimeData: { enabled: true } };
  const prepared = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify(input)})`, resourcePath, 'resource');
  const result = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify({ ...input, phase: 'failure', prepared: prepared.migration })})`, resourcePath, 'resource');
  assert.equal(result.ok, false);
  assert.equal(result.mutated, false);
  assert.equal(result.activeReceipt.schema, 'asset-activation-receipt.v2');
  assert.deepEqual(result.preserved.discoveredDomains, ['example.org']);
  assert.deepEqual(result.preserved.sourceSelection, { id: 'user' });
  assert.deepEqual(result.preserved.exclusions, ['skip.example']);
  assert.deepEqual(result.preserved.userStrategies, [{ id: 'mine' }]);
  assert.deepEqual(result.preserved.runtimeData, { enabled: true });
});

test('successful migration writes V3 and preserves discovered domains and user data', { skip: !hasUcode }, () => {
  const input = { testOnly: true, phase: 'prepare', activeReceipt: receipt('asset-activation-receipt.v2'), finalReceipt: receipt('asset-activation-receipt.v3'),
    discoveredDomains: ['example.org'], sourceSelection: { id: 'user' }, exclusions: ['skip.example'], userStrategies: [{ id: 'mine' }], runtimeData: { enabled: true } };
  const prepared = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify(input)})`, resourcePath, 'resource');
  const result = invoke(`resource.resource_center_test_migration_transaction(${JSON.stringify({ ...input, phase: 'commit', prepared: prepared.migration })})`, resourcePath, 'resource');
  assert.equal(result.ok, true);
  assert.equal(result.activeReceipt.schema, 'asset-activation-receipt.v3');
  assert.deepEqual(result.preserved.discoveredDomains, ['example.org']);
  assert.deepEqual(result.preserved.userStrategies, [{ id: 'mine' }]);
  assert.deepEqual(result.preserved.runtimeData, { enabled: true });
});

test('production Resource Center owns migration prepare/finalize/rollback wiring', () => {
  const source = fs.readFileSync(resourcePath, 'utf8');
  assert.match(source, /z2k_migration_prepare\(\{/);
  assert.match(source, /migration: migration/);
  assert.match(source, /z2k_migration_commit\(\{ prepared: pending\.migration/);
  assert.match(source, /asset_registry_finalize_activation\(finalizeRequest\.request\)/);
  assert.match(source, /z2k_rollback_after_runtime_failure\(selected/);
  assert.match(source, /priorReceipt: priorAuthority\.receipt/);
  assert.match(source, /priorRuntimeComposition: priorRuntimeComposition/);
});
