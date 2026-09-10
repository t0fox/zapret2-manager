import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const SOURCE_STORE_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const HARNESS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh');
const TIMEOUT_HELPER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-timeout.sh');
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function invoke(root, expression, extraEnv = {}, module = MODULE) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_STRATEGY_SOURCES_ROOT: root,
      Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(root, 'metadata-cache'),
      Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(root, 'metadata-state'),
      Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(root, 'metadata-locks'),
      Z2M_STRATEGY_SOURCE_CONTENT_TRANSPORT: TRANSPORT,
      Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS,
      Z2M_Z2K_OFFICIAL_TIMEOUT_HELPER: TIMEOUT_HELPER,
      Z2M_UPDATE_SOURCE_TEST: '1',
      Z2M_FIXTURE_MODE: 'ok',
      ...extraEnv,
    },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

const SOURCE_COMMIT = 'a'.repeat(40);
const FOREIGN_COMMIT = 'b'.repeat(40);
const SOURCE_FILES = ['strats_new2.txt', 'quic_strats.ini', 'lib/utils.sh', 'lib/strategies.sh', 'lib/config_official.sh'];

function compatibilityIdentity(sourceCommit) {
  const release = 'p-82.14';
  const runtimeBundleDigest = 'd'.repeat(64);
  const compilerSnapshotDigest = 'f'.repeat(64);
  const identityText = `z2k-compatibility-v1\nrelease=${release}\nsourceCommit=${sourceCommit}\nmanifestRevision=90\nruntimeBundleDigest=${runtimeBundleDigest}\ncompilerSnapshotDigest=${compilerSnapshotDigest}\n`;
  return {
    release, sourceCommit, manifestRevision: 90, runtimeBundleDigest, compilerSnapshotDigest,
    digest: crypto.createHash('sha256').update(identityText).digest('hex'),
  };
}

function validZ2kSnapshot() {
  const snapshotId = 'z2k-valid-1';
  const entry = {
    canonicalId: 'z2k:z2k_all_in_one', sourceId: 'z2k', upstreamId: 'z2k_all_in_one',
    sourceSnapshotId: snapshotId, sourceCommit: SOURCE_COMMIT, entryKind: 'all-in-one', usable: true,
    sourcePath: 'official:generate_nfqws2_opt_from_strategies', officialNfqws2Opt: '--filter-tcp=443',
    nativeValidation: { status: 'verified' }, profiles: [{ officialProfileIndex: 0 }],
    provenance: {
      repository: 'necronicle/z2k', sourceId: 'z2k', sourceCommit: SOURCE_COMMIT,
      sourcePath: 'official:generate_nfqws2_opt_from_strategies', kind: 'strategy-catalog-import',
      compilerSchema: 'z2m.z2k-official-compiler-snapshot.v1', compilerSnapshotDigest: 'f'.repeat(64),
      nfqws2OptSha256: 'e'.repeat(64), templates: 'disabled',
    },
  };
  return {
    schema: 'z2m.strategy-source-snapshot.v1', sourceId: 'z2k', repository: 'necronicle/z2k',
    sourceCommit: SOURCE_COMMIT, contentDigest: 'c'.repeat(64), snapshotId,
    sourcePath: 'official:generate_nfqws2_opt_from_strategies', sourceFiles: SOURCE_FILES,
    fileSha256: Object.fromEntries(SOURCE_FILES.map((name) => [name, 'f'.repeat(64)])),
    compilerSchema: 'z2m.z2k-official-compiler-snapshot.v1', compilerSnapshotDigest: 'f'.repeat(64),
    nfqws2OptSha256: 'e'.repeat(64),
    allInOne: { canonicalId: 'z2k:z2k_all_in_one', digest: 'e'.repeat(64), profileCount: 1 },
    entries: [entry], entryCount: 1, normalizedEntryCount: 1, immutable: true, published: true,
  };
}

function installZ2kSnapshot(root, snapshot, extra = {}) {
  return invoke(root, `mod.strategy_source_install_verified_snapshot('z2k', ${JSON.stringify({
    verified: true, managedBy: 'z2k-core', snapshot, ...extra,
  })})`, {}, SOURCE_STORE_MODULE);
}

test('Z2K source preparation is Core-managed and fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-managed-'));
  const result = invoke(root, "mod.strategy_source_refresh_prepare('z2k')");
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EMANAGED');
  assert.equal(result.error.owner, 'z2k-core');
});

test('source snapshot installation rejects an unbound Z2K mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-store-'));
  const result = invoke(root, "mod.strategy_source_install_verified_snapshot('z2k', { verified: true, snapshot: {} })", {}, SOURCE_STORE_MODULE);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EMANAGED');
  assert.equal(result.error.owner, 'z2k-core');
});

test('durable Z2K snapshots reject abbreviated or mismatched source identity before persistence', () => {
  const cases = [
    ['abbreviated snapshot commit', (snapshot) => { snapshot.sourceCommit = SOURCE_COMMIT.slice(0, 39); }],
    ['abbreviated entry commit', (snapshot) => { snapshot.entries[0].sourceCommit = SOURCE_COMMIT.slice(0, 39); }],
    ['mismatched entry commit', (snapshot) => { snapshot.entries[0].sourceCommit = FOREIGN_COMMIT; }],
    ['abbreviated provenance commit', (snapshot) => { snapshot.entries[0].provenance.sourceCommit = SOURCE_COMMIT.slice(0, 39); }],
    ['mismatched provenance commit', (snapshot) => { snapshot.entries[0].provenance.sourceCommit = FOREIGN_COMMIT; }],
  ];
  for (const [label, mutate] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-identity-'));
    const snapshot = validZ2kSnapshot();
    mutate(snapshot);
    const result = installZ2kSnapshot(root, snapshot);
    assert.equal(result.ok, false, `${label}: ${JSON.stringify(result)}`);
    assert.equal(invoke(root, "mod.strategy_source_current_snapshot('z2k')", {}, SOURCE_STORE_MODULE).snapshot, null, label);
  }
});

test('durable Z2K snapshots reject mismatched compatibility and selected Core identities before persistence', () => {
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-compat-'));
  const snapshot = validZ2kSnapshot();
  const foreignIdentity = compatibilityIdentity(FOREIGN_COMMIT);
  snapshot.z2kCompatibilityIdentity = foreignIdentity;
  snapshot.compatibilityIdentity = foreignIdentity.digest;
  snapshot.z2kRelease = foreignIdentity.release;
  snapshot.manifestRevision = foreignIdentity.manifestRevision;
  snapshot.runtimeBundleDigest = foreignIdentity.runtimeBundleDigest;
  snapshot.entries[0].z2kCompatibilityIdentity = foreignIdentity;
  snapshot.entries[0].compatibilityIdentity = foreignIdentity.digest;
  snapshot.entries[0].provenance.z2kCompatibilityIdentity = foreignIdentity;
  snapshot.entries[0].provenance.compatibilityIdentity = foreignIdentity.digest;
  const mismatchedSnapshot = installZ2kSnapshot(snapshotRoot, snapshot);
  assert.equal(mismatchedSnapshot.ok, false, JSON.stringify(mismatchedSnapshot));
  assert.equal(invoke(snapshotRoot, "mod.strategy_source_current_snapshot('z2k')", {}, SOURCE_STORE_MODULE).snapshot, null);

  const selectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-selected-core-'));
  const selectedSnapshot = validZ2kSnapshot();
  const selectedIdentity = compatibilityIdentity(SOURCE_COMMIT);
  selectedSnapshot.z2kCompatibilityIdentity = selectedIdentity;
  selectedSnapshot.compatibilityIdentity = selectedIdentity.digest;
  selectedSnapshot.z2kRelease = selectedIdentity.release;
  selectedSnapshot.manifestRevision = selectedIdentity.manifestRevision;
  selectedSnapshot.runtimeBundleDigest = selectedIdentity.runtimeBundleDigest;
  selectedSnapshot.entries[0].z2kCompatibilityIdentity = selectedIdentity;
  selectedSnapshot.entries[0].compatibilityIdentity = selectedIdentity.digest;
  selectedSnapshot.entries[0].provenance.z2kCompatibilityIdentity = selectedIdentity;
  selectedSnapshot.entries[0].provenance.compatibilityIdentity = selectedIdentity.digest;
  const mismatchedSelected = installZ2kSnapshot(selectedRoot, selectedSnapshot, {
    selectedCoreIdentity: compatibilityIdentity(FOREIGN_COMMIT),
  });
  assert.equal(mismatchedSelected.ok, false, JSON.stringify(mismatchedSelected));
  assert.equal(invoke(selectedRoot, "mod.strategy_source_current_snapshot('z2k')", {}, SOURCE_STORE_MODULE).snapshot, null);
});

test('Core compiler preparation uses the selected sourceCommit for every source URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-selected-'));
  const log = path.join(root, 'transport.log');
  const selected = 'd'.repeat(40);
  const branchHeadWhenDifferent = 'a'.repeat(40);
  const prepared = invoke(root, `mod.strategy_source_z2k_compile_exact({ sourceCommit: '${selected}' })`, {
    Z2M_FIXTURE_TRANSPORT_LOG: log,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.compilerSourceCommit, selected);
  const urls = Object.values(prepared.sourceUrls);
  assert.equal(urls.length, 5);
  assert.ok(urls.every((url) => url.includes(`/${selected}/`)), JSON.stringify(urls));
  assert.ok(urls.every((url) => !url.includes(`/${branchHeadWhenDifferent}/`)), JSON.stringify(urls));
});
