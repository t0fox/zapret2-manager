import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Engine release catalog gating contract:
//   - ONLY manifests proving the pinned base + full patch series + capability
//     evidence become installable candidates (artifactKind=z2m-compatible-engine,
//     compatible=true);
//   - any drift (architecture, artifact digest, patch digests, missing caps)
//     yields NO candidate rather than a degraded one;
//   - vanilla bol-van releases stay visible-but-not-installable elsewhere;
//     this module never upgrades them to compatible.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-catalog.uc');
const INTEGRATION = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'upstreams', 'engine-integration.json');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

const ARCH = 'aarch64_cortex-a53';
const sha = value => createHash('sha256').update(value).digest('hex');
const integration = JSON.parse(fs.readFileSync(INTEGRATION, 'utf8'));

function invoke(functionName, argsLiteral) {
  const source = `import * as catalogModule from ${JSON.stringify(MODULE)}; `
    + `print(sprintf('%J', catalogModule.${functionName}(${argsLiteral})));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_ENGINE_INTEGRATION_JSON: INTEGRATION },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode diagnostic for ${functionName}`);
  return JSON.parse(result.stdout);
}

function fixtureManifest(overrides = {}) {
  return {
    schema: 'zapret2-manager.engine-artifact.v1',
    artifactKind: 'z2m-compatible-engine',
    version: 'r77-z2m-test',
    artifact: { name: `z2m-engine-r77-z2m-${ARCH}.tar.gz`, sha256: sha('artifact-bytes'), sizeBytes: 14, container: 'tar.gz' },
    base: { repository: integration.engineBase.repository, commit: integration.engineBase.commit },
    patchSeries: integration.patchSeries.map(p => ({ id: p.id, sha256: p.sha256 })),
    architecture: ARCH,
    requiredCapabilities: [...integration.requiredCapabilities],
    capabilityEvidence: {
      Z2K_TLS_MOD: { method: 'binary-tokens', tokens: ['z2k_grease'] },
      ANTIDPI_REPEATS_LOOP: { method: 'lua-source-marker', file: 'lua/zapret-antidpi.lua', marker: 'x' },
      AUTO_FAMILY_SPLIT: { method: 'lua-source-marker', file: 'lua/zapret-auto.lua', marker: 'family_split' }
    },
    nfqws2Sha256: sha('nfqws2'),
    runtimeCompatibility: { requiredFunctions: [...integration.runtimeCompatibility.requiredFunctions] },
    buildProvenance: { sdkVersion: '25.12.5', toolchain: 't', builtAt: '2026-08-23T00:00:00Z', producerCommit: 'a'.repeat(40) },
    upstreamState: { headSha: null, advanced: false },
    ...overrides
  };
}

function fixtureAsset(manifest) {
  return { name: manifest.artifact.name, size: manifest.artifact.sizeBytes,
    digest: 'sha256:' + manifest.artifact.sha256,
    browser_download_url: `https://github.com/t0fox/zapret2-manager/releases/download/engine-${manifest.version}/${manifest.artifact.name}` };
}

function callCandidate(manifest, asset, arch) {
  return invoke('z2m_compatible_candidate',
    `${JSON.stringify(manifest)}, ${JSON.stringify(asset)}, ${JSON.stringify(arch)}`);
}

test('valid compatible manifest produces an installable candidate', () => {
  const manifest = fixtureManifest();
  const candidate = callCandidate(manifest, fixtureAsset(manifest), ARCH);
  assert.equal(candidate.ok, true, JSON.stringify(candidate));
  assert.equal(candidate.candidate.artifactKind, 'z2m-compatible-engine');
  assert.equal(candidate.candidate.compatible, true);
  assert.equal(candidate.candidate.architecture, ARCH);
  assert.equal(candidate.candidate.sha256, manifest.artifact.sha256);
  assert.equal(candidate.candidate.baseCommit, integration.engineBase.commit);
});

test('architecture mismatch produces no candidate', () => {
  const manifest = fixtureManifest();
  const result = callCandidate(manifest, fixtureAsset(manifest), 'x86_64');
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.error?.message ?? ''), /[Aa]rchitect|Архитектур/);
});

test('artifact digest mismatch between manifest and release asset is rejected', () => {
  const manifest = fixtureManifest();
  const asset = fixtureAsset(manifest);
  asset.digest = 'sha256:' + sha('tampered');
  const result = callCandidate(manifest, asset, ARCH);
  assert.equal(result.ok, false);
});

test('patch series drift against the pinned identity is rejected', () => {
  const manifest = fixtureManifest();
  manifest.patchSeries[0].sha256 = sha('drifted');
  const result = callCandidate(manifest, fixtureAsset(manifest), ARCH);
  assert.equal(result.ok, false);
});

test('base commit drift is rejected', () => {
  const manifest = fixtureManifest({ base: { repository: integration.engineBase.repository, commit: 'b'.repeat(40) } });
  const result = callCandidate(manifest, fixtureAsset(manifest), ARCH);
  assert.equal(result.ok, false);
});

test('missing required capability evidence is rejected', () => {
  const manifest = fixtureManifest();
  delete manifest.capabilityEvidence.AUTO_FAMILY_SPLIT;
  const result = callCandidate(manifest, fixtureAsset(manifest), ARCH);
  assert.equal(result.ok, false);
});

test('non-compatible artifactKind never becomes installable', () => {
  const manifest = fixtureManifest({ artifactKind: 'vanilla-bol-van-release' });
  const result = callCandidate(manifest, fixtureAsset(manifest), ARCH);
  assert.equal(result.ok, false);
});
