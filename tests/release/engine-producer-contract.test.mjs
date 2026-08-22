import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateEngineManifest } from '../../scripts/engine/validate-engine-manifest.mjs';

// ---------------------------------------------------------------------------
// Part 1: canonical z2m-compatible-engine identity contract.
//
// There must be EXACTLY ONE authority for the compatible-engine build inputs:
// upstreams/engine-integration.json. Every other surface (patch files on disk,
// native-preflight manifest) must agree with it byte-for-byte, otherwise the
// producer could silently build against a different source than the runtime
// gates expect.

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const INTEGRATION_PATH = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'upstreams', 'engine-integration.json');
const PREFLIGHT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'native-preflight.json');

const INTEGRATION = JSON.parse(fs.readFileSync(INTEGRATION_PATH, 'utf8'));
const preflightManifest = JSON.parse(fs.readFileSync(PREFLIGHT, 'utf8'));

test('integration manifest declares a complete machine-readable build contract', () => {
  assert.equal(INTEGRATION.schema, 'zapret2-manager.engine-integration.v1');
  assert.equal(INTEGRATION.engineBase.repository, 'bol-van/zapret2');
  assert.match(INTEGRATION.engineBase.commit, /^[0-9a-f]{40}$/, 'base commit must be a full sha');
  assert.ok(Array.isArray(INTEGRATION.patchSeries) && INTEGRATION.patchSeries.length === 3,
    'exactly three canonical patches are required');
  const ids = INTEGRATION.patchSeries.map(p => p.id);
  assert.deepEqual(ids, ['001-z2k-tls-mod', '002-z2k-antidpi-repeats-loop', '003-z2k-auto-family-split']);
  for (const patch of INTEGRATION.patchSeries) {
    assert.match(patch.sha256, /^[0-9a-f]{64}$/, `patch ${patch.id} digest missing`);
    assert.ok(patch.path.startsWith('patches/engine/'), `patch ${patch.id} path outside canonical dir`);
  }
  assert.deepEqual(INTEGRATION.requiredCapabilities,
    ['Z2K_TLS_MOD', 'ANTIDPI_REPEATS_LOOP', 'AUTO_FAMILY_SPLIT']);
  assert.ok(Array.isArray(INTEGRATION.runtimeCompatibility?.requiredFunctions)
    && INTEGRATION.runtimeCompatibility.requiredFunctions.length >= 4,
    'required Z2K Lua functions must be enumerated');
});

test('patch files on disk match the pinned SHA256 digests', () => {
  for (const patch of INTEGRATION.patchSeries) {
    const file = path.join(ROOT, patch.path);
    assert.ok(fs.existsSync(file), `${patch.path} missing`);
    const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(digest, patch.sha256, `${patch.id} drifted from the pinned digest`);
  }
});

test('native-preflight manifest agrees with the single integration authority', () => {
  assert.equal(preflightManifest.schema, 'zapret2-manager.native-preflight.v2');
  assert.equal(preflightManifest.engineSourceCommit, INTEGRATION.engineBase.commit,
    'preflight must reference the same pinned bol-van base commit as the producer');
  assert.deepEqual(preflightManifest.requiredCapabilities, INTEGRATION.requiredCapabilities);
  assert.deepEqual(preflightManifest.patchSeries.map(name => name.replace(/\.patch$/, '')),
    INTEGRATION.patchSeries.map(p => p.id));
  assert.equal(preflightManifest.engineIntegrationIdentity,
    '/usr/share/zapret2-manager/upstreams/engine-integration.json');
});

// ---------------------------------------------------------------------------
// Part 2: machine-readable artifact manifest validation.
//
// The consumer (engine-catalog.uc) refuses any candidate whose manifest fails
// this exact validation, so drift on any field must fail here first.

const ARCH = 'aarch64_cortex-a53';
const sha = value => createHash('sha256').update(value).digest('hex');

function goldenManifest(overrides = {}) {
  const patchSeries = INTEGRATION.patchSeries.map(p => ({ id: p.id, sha256: p.sha256 }));
  return {
    schema: 'zapret2-manager.engine-artifact.v1',
    artifactKind: 'z2m-compatible-engine',
    version: 'r77-z2m1',
    artifact: { name: `z2m-engine-${ARCH}.tar.gz`, sha256: sha('artifact-bytes'), sizeBytes: Buffer.byteLength('artifact-bytes'), container: 'tar.gz' },
    base: {
      repository: INTEGRATION.engineBase.repository,
      commit: INTEGRATION.engineBase.commit,
      headAtBuild: 'f'.repeat(40),
      pinnedBehindUpstream: true
    },
    patchSeries,
    architecture: ARCH,
    requiredCapabilities: [...INTEGRATION.requiredCapabilities],
    capabilityEvidence: {
      Z2K_TLS_MOD: { method: 'binary-tokens', tokens: ['z2k_grease', 'z2k_alpn_flood'] },
      ANTIDPI_REPEATS_LOOP: { method: 'lua-source-marker', file: 'lua/zapret-antidpi.lua', marker: 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod' },
      AUTO_FAMILY_SPLIT: { method: 'lua-source-marker', file: 'lua/zapret-auto.lua', marker: 'family_split' }
    },
    nfqws2Sha256: sha('nfqws2-bytes'),
    luaFiles: [{ path: 'lua/zapret-lib.lua', sha256: sha('lua') }],
    runtimeCompatibility: { requiredFunctions: [...INTEGRATION.runtimeCompatibility.requiredFunctions] },
    buildProvenance: {
      sdkVersion: '25.12.5',
      toolchain: 'aarch64_cortex-a53 gcc 14.3.0 musl',
      builtAt: '2026-08-23T00:00:00Z',
      producerCommit: 'a'.repeat(40)
    },
    upstreamState: { headSha: 'f'.repeat(40), advanced: true },
    ...overrides
  };
}

test('golden artifact manifest validates cleanly against the integration authority', () => {
  const verdict = validateEngineManifest(goldenManifest(), { integration: INTEGRATION });
  assert.deepEqual(verdict.errors, []);
  assert.equal(verdict.ok, true);
});

const cases = [
  ['wrong schema', m => { m.schema = 'other.v9'; }, /schema/, {}],
  ['wrong artifactKind', m => { m.artifactKind = 'vanilla-bol-van-release'; }, /artifactKind|vanilla/, {}],
  ['base commit drift', m => { m.base.commit = 'b'.repeat(40); }, /commit/i, {}],
  ['patch digest drift', m => { m.patchSeries[1].sha256 = sha('tampered'); }, /patch/i, {}],
  ['missing capability', m => { m.requiredCapabilities = ['Z2K_TLS_MOD']; }, /capabilit/i, {}],
  ['architecture mismatch', m => { m.architecture = 'x86_64'; }, /architect/i, { architecture: ARCH }],
  ['artifact digest malformed', m => { m.artifact.sha256 = 'zz'.repeat(32); }, /artifact/i, {}],
  ['nfqws2 digest malformed', m => { m.nfqws2Sha256 = ''; }, /nfqws2/i, {}],
  ['capability evidence missing', m => { delete m.capabilityEvidence.AUTO_FAMILY_SPLIT; }, /evidence|AUTO_FAMILY_SPLIT/i, {}],
  ['required functions drift', m => { m.runtimeCompatibility.requiredFunctions = ['only_one']; }, /requiredFunctions|function/i, {}],
  ['provenance incomplete', m => { delete m.buildProvenance.sdkVersion; }, /provenance|sdkVersion/i, {}]
];

for (const [name, mutate, pattern, extraOptions] of cases) {
  test(`rejects ${name}`, () => {
    const manifest = goldenManifest();
    mutate(manifest);
    const verdict = validateEngineManifest(manifest, { integration: INTEGRATION, ...extraOptions });
    assert.equal(verdict.ok, false, `${name} must not validate`);
    assert.match(verdict.errors.join('\n'), pattern);
  });
}

test('validates the actual artifact bytes when a file is supplied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-engine-manifest-'));
  const artifact = path.join(dir, goldenManifest().artifact.name);
  fs.writeFileSync(artifact, 'artifact-bytes');
  const okVerdict = validateEngineManifest(goldenManifest(), { integration: INTEGRATION, artifactPath: artifact });
  assert.equal(okVerdict.ok, true);

  const tampered = goldenManifest({ artifact: { name: `z2m-engine-${ARCH}.tar.gz`, sha256: sha('nope'), sizeBytes: 15, container: 'tar.gz' } });
  const badVerdict = validateEngineManifest(tampered, { integration: INTEGRATION, artifactPath: artifact });
  assert.equal(badVerdict.ok, false);
  assert.match(badVerdict.errors.join('\n'), /sha256|digest/i);
});
