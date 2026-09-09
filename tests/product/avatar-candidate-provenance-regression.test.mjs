import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESOURCE_UPDATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const STRATEGY_STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const HAS_UCODE = fs.existsSync(UCODE_BIN);

const SNAPSHOT_ID = 'avatar-e716554fa8292d8b934e809514b46dae3d3874b84a57a56934b5e30d5a768136';
const SOURCE_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const Z2K_SNAPSHOT_ID = 'z2k-e716554fa8292d8b934e809514b46dae3d3874b84a57a56934b5e30d5a768136';
const Z2K_SOURCE_COMMIT = 'a'.repeat(40);

function invoke(expression) {
  const source = [
    `import * as transaction from ${JSON.stringify(RESOURCE_UPDATE)};`,
    `import * as state from ${JSON.stringify(STRATEGY_STATE)};`,
    `print(sprintf('%J', ${expression}));`,
  ].join(' ');
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout.trim());
}

function avatarEntry(overrides = {}) {
  return {
    id: 'avatar:z2k_all_in_one',
    canonicalId: 'avatar:z2k_all_in_one',
    sourceId: 'avatar',
    sourceSnapshotId: SNAPSHOT_ID,
    sourceCommit: SOURCE_COMMIT,
    sourcePath: 'strategies/z2k_all_in_one.json',
    entryKind: 'strategy-catalog',
    provenance: {
      repository: 'avatarDD/zapret-gui',
      sourceId: 'avatar',
      sourceCommit: SOURCE_COMMIT,
      sourcePath: 'strategies/z2k_all_in_one.json',
      kind: 'strategy-catalog',
    },
    ...overrides,
  };
}

function selectedAvatar() {
  return {
    id: 'avatar:z2k_all_in_one',
    canonicalStrategyId: 'avatar:z2k_all_in_one',
    sourceId: 'avatar',
    origin: 'avatar_builtin',
    sourceSnapshotId: 'avatar-old',
    sourceCommit: 'a'.repeat(40),
  };
}

function z2kEntry(overrides = {}) {
  return {
    id: 'z2k:z2k_all_in_one',
    canonicalId: 'z2k:z2k_all_in_one',
    sourceId: 'z2k',
    sourceSnapshotId: Z2K_SNAPSHOT_ID,
    sourceCommit: Z2K_SOURCE_COMMIT,
    sourcePath: 'profiles/z2k_all_in_one.json',
    entryKind: 'all-in-one',
    provenance: {
      repository: 'necronicle/z2k',
      sourceId: 'z2k',
      sourceCommit: Z2K_SOURCE_COMMIT,
      sourcePath: 'profiles/z2k_all_in_one.json',
      kind: 'strategy-catalog-import',
    },
    ...overrides,
  };
}

test('canonical Avatar entry enriches omitted provenance snapshot before selection projection',
  { skip: !HAS_UCODE }, () => {
    const entry = avatarEntry();
    const catalogInput = `{ testOnly: true, coreSnapshot: { entries: [${JSON.stringify(entry)}] } }`;
    const expression = `({ catalog: transaction.resource_center_test_candidate_catalog(${catalogInput}), projected: state.strategy_selection_project_candidate({ selected: ${JSON.stringify(selectedAvatar())}, candidateCatalog: transaction.resource_center_test_candidate_catalog(${catalogInput}) }) })`;
    const result = invoke(expression);

    assert.equal(result.catalog.entries.length, 1, JSON.stringify(result));
    assert.equal(result.catalog.entries[0].provenance.sourceSnapshotId, SNAPSHOT_ID, JSON.stringify(result));
    assert.equal(result.catalog.entries[0].provenance.sourceCommit, SOURCE_COMMIT, JSON.stringify(result));
    assert.equal(result.projected.ok, true, JSON.stringify(result));
    assert.equal(result.projected.selected.sourceSnapshotId, SNAPSHOT_ID, JSON.stringify(result));
    assert.equal(result.projected.selected.sourceCommit, SOURCE_COMMIT, JSON.stringify(result));
  });

test('canonical Avatar projection still rejects missing or mismatched source identity',
  { skip: !HAS_UCODE }, () => {
    for (const entry of [
      avatarEntry({ sourceCommit: null, provenance: avatarEntry().provenance }),
      avatarEntry({ sourceCommit: null, provenance: { ...avatarEntry().provenance, sourceCommit: null } }),
      avatarEntry({ provenance: { ...avatarEntry().provenance, sourceCommit: '0'.repeat(40) } }),
      avatarEntry({ provenance: { ...avatarEntry().provenance, sourceSnapshotId: 'avatar-other' } }),
    ]) {
      const result = invoke(`transaction.resource_center_test_candidate_catalog({ testOnly: true, coreSnapshot: { entries: [${JSON.stringify(entry)}] } })`);
      assert.equal(result.entries.length, 0, JSON.stringify(result));
    }
  });

test('non-user Z2K entry rejects omitted provenance snapshot identity',
  { skip: !HAS_UCODE }, () => {
    const entry = z2kEntry();
    const result = invoke(`transaction.resource_center_test_candidate_catalog({ testOnly: true, coreSnapshot: { entries: [${JSON.stringify(entry)}] } })`);
    assert.equal(result.entries.length, 0, JSON.stringify(result));
  });

test('candidate catalog test seam rejects calls without the explicit testOnly guard',
  { skip: !HAS_UCODE }, () => {
    const result = invoke('transaction.resource_center_test_candidate_catalog({ coreSnapshot: { entries: [] } })');
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'EINPUT', JSON.stringify(result));
  });
