import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relative => fs.readFileSync(relative, 'utf8');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const refresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const sourceAdapter = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc');
const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc');
const sourceStore = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const resourceUpdate = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const strategyState = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const strategyCli = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const compatibility = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compatibility.uc');

test('Z2K lifecycle resolver declares digest helpers before Core snapshot preparation', () => {
  assert.ok(versions.length > 0);
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.ok(source.indexOf('function valid_digest') < source.indexOf('function z2k_core_snapshot_for_target'),
    'UCode does not hoist the digest helper used by Core snapshot preparation');
  assert.ok(source.indexOf('function valid_commit') < source.indexOf('function z2k_core_snapshot_for_target'),
    'UCode does not hoist the commit helper used by Core snapshot preparation');
});

test('Z2K snapshot builder binds the imported entry before deriving its digest', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc');
  const builder = source.slice(source.indexOf('export const strategy_source_z2k_prepare_snapshot'));
  assert.ok(builder.indexOf('let entry = copy(imported.entry)') < builder.indexOf('entry.z2kCompatibilityIdentity'),
    'snapshot identity derivation must not read entry before it is declared');
});

test('Z2K compatibility identity has a local digest implementation', () => {
  assert.match(compatibility, /import \{[^}]*popen[^}]*writefile[^}]*\} from ['"]fs['"]/,
    'compatibility identity hashing must use the UCode filesystem boundary');
  const digestAt = compatibility.indexOf('function digest');
  const identityAt = compatibility.indexOf('export const z2k_compatibility_identity');
  assert.ok(digestAt >= 0 && digestAt < identityAt,
    'compatibility identity must not call an undeclared digest helper');
});

test('release catalog accepts r and p families and exposes authoritative identity fields', () => {
  assert.match(versions, /\/(?:\^)?\(\[rp\]\)/,
    'release parser must accept both r-* and p-* families');
  assert.match(versions, /family\s*:/);
  assert.match(versions, /manifest(?:Current|Version|Revision|Seq)|manifestSeq|authoritative/,
    'catalog rows must retain authoritative manifest identity');
  assert.doesNotMatch(versions, /if \(length\(rows\)\) rows\[0\]\.latest = true/,
    'latest must not be assigned from bounded array position');
  assert.match(versions, /current\s*==\s*requested|requested\s*==\s*current|manifest.*current/,
    'fresh resolution must reconcile manifest current with the requested tag');
  assert.match(versions, /\^\[rp\]-\[0-9\]/,
    'release labels must not leak into human-body parsing as unsupported r-only values');
});

test('rpcd accepts p-family releases at the request boundary', () => {
  assert.match(rpc, /match\(version, \/\^\(\[rp\]\)/,
    'rpcd must not reject a valid p-* release before the lifecycle resolver');
});

test('manual Z2K strategy source refresh is rejected as Core-managed', () => {
  const rpcStart = rpc.indexOf('function strategies_source_refresh_method');
  assert.ok(rpcStart >= 0);
  const rpcBody = rpc.slice(rpcStart, rpc.indexOf('\n}', rpcStart) + 2);
  assert.match(rpcBody, /z2k|managed|catalog_refresh_source/);
  assert.match(coordinator, /if \(id == 'z2k'\).*EMANAGED|EMANAGED[\s\S]*managed by Z2K Core/);
});

test('catalog refresh all does not independently refresh Z2K HEAD', () => {
  assert.match(coordinator, /managed[- ]by[- ]core|EMANAGED/i);
  const workerStart = coordinator.indexOf('export const catalog_refresh_worker_run');
  assert.ok(workerStart >= 0);
  const worker = coordinator.slice(workerStart);
  assert.match(worker, /z2k|Z2K/);
  assert.match(worker, /continue|skip|managed[- ]by[- ]core|EMANAGED/i);
});

test('Core and compiled strategy snapshots carry one compatibility identity', () => {
  assert.match(sourceStore, /z2kCompatibilityIdentity|compatibilityIdentity/);
  assert.match(sourceAdapter, /z2kCompatibilityIdentity|compatibilityIdentity/);
  assert.match(resourceUpdate, /z2kCompatibilityIdentity|compatibilityIdentity/);
  assert.match(strategyState, /z2kCompatibilityIdentity|compatibilityIdentity/);
  assert.match(strategyCli, /z2kCompatibilityIdentity|compatibilityIdentity/);
});

test('prepared canonical assets are bound to the same compatibility identity as the target', () => {
  assert.match(resourceUpdate, /item\.type == 'lifecycle-managed'/);
  assert.match(resourceUpdate, /item\.compatibilityIdentity != value\.compatibilityIdentity/);
  assert.match(resourceUpdate, /item\.z2kCompatibilityIdentity\.compilerSnapshotDigest/);
  assert.doesNotMatch(resourceUpdate, /substr\(a\.provenance\.sourceCommit, 0, 2\) == "p-"/,
    'a release label must never be treated as an immutable source commit');
});
