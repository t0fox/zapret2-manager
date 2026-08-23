import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// CROSS-BOUNDARY CONTRACT TEST (producer → GitHub Release → engine-catalog).
//
// Models the EXACT release object that .github/workflows/engine-build.yml
// publishes:
//   gh release create "engine-$version" <artifact.tar.gz> <artifact.manifest.json>
//     --title ... --prerelease --notes ...
// as GitHub's REST API returns it (assets with state/digest/browser_download_url,
// prerelease:true), then requires z2m_records_from_payload() to yield EXACTLY
// ONE installable candidate carrying artifactKind / architecture / artifact
// SHA / nfqws2 SHA / the three pinned patch identities.
//
// Regression locks for the two P0 mismatches found by adversarial review:
//   - prerelease:true must NOT exclude the canonical release
//   - sidecar MUST be paired by '<artifactFileName>.manifest.json'
//     (producer convention); an old-style 'x.manifest.json' sidecar alone
//     yields ZERO candidates.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-catalog.uc');
const INTEGRATION = JSON.parse(fs.readFileSync(path.join(ROOT,
  'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json'), 'utf8'));
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

const ARCH = 'aarch64_cortex-a53';
const sha = value => createHash('sha256').update(value).digest('hex');

const VERSION = 'r77-z2m-crossboundary';
const TAG = `engine-${VERSION}`;
const ART_NAME = `z2m-engine-${VERSION}-${ARCH}.tar.gz`;
const MANIFEST_NAME = `${ART_NAME}.manifest.json`;   // canonical producer sidecar
const OLD_STYLE_NAME = `z2m-engine-${VERSION}-${ARCH}.manifest.json`; // pre-fix name

const ARTIFACT_BYTES = 'fake-tar-gz-bytes';
const ARTIFACT_SHA = sha(ARTIFACT_BYTES);
const NFQWS2_SHA = sha('nfqws2-bytes');
const BASE_COMMIT = INTEGRATION.engineBase.commit;

function manifestFixture() {
  return {
    schema: 'zapret2-manager.engine-artifact.v1',
    artifactKind: 'z2m-compatible-engine',
    version: VERSION,
    artifact: { name: ART_NAME, sha256: ARTIFACT_SHA, sizeBytes: Buffer.byteLength(ARTIFACT_BYTES), container: 'tar.gz' },
    base: { repository: INTEGRATION.engineBase.repository, commit: BASE_COMMIT,
      headAtBuild: BASE_COMMIT, pinnedBehindUpstream: false },
    patchSeries: INTEGRATION.patchSeries.map(p => ({ id: p.id, sha256: p.sha256 })),
    architecture: ARCH,
    requiredCapabilities: [...INTEGRATION.requiredCapabilities],
    capabilityEvidence: {
      Z2K_TLS_MOD: { method: 'binary-tokens', tokens: ['z2k_grease'] },
      ANTIDPI_REPEATS_LOOP: { method: 'lua-source-marker', file: 'lua/zapret-antidpi.lua', marker: 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod' },
      AUTO_FAMILY_SPLIT: { method: 'lua-source-marker', file: 'lua/zapret-auto.lua', marker: 'family_split' }
    },
    nfqws2Sha256: NFQWS2_SHA,
    luaFiles: [{ path: 'lua/zapret-lib.lua', sha256: sha('lua') }],
    runtimeCompatibility: { requiredFunctions: [...INTEGRATION.runtimeCompatibility.requiredFunctions] },
    buildProvenance: { sdkVersion: '25.12.5', toolchain: 'aarch64_cortex-a53 gcc 14.3.0 musl',
      builtAt: '2026-08-23T00:00:00Z', producerCommit: 'c'.repeat(40) },
    upstreamState: { headSha: null, advanced: false }
  };
}

function ghAsset(name, bytesOrDigest, sizeOverride) {
  const digest = typeof bytesOrDigest === 'string' && /^[a-f0-9]{64}$/.test(bytesOrDigest)
    ? bytesOrDigest : sha(bytesOrDigest);
  return {
    name,
    state: 'uploaded',
    size: sizeOverride ?? Buffer.byteLength(String(bytesOrDigest)),
    digest: 'sha256:' + digest,
    browser_download_url: `https://github.com/t0fox/zapret2-manager/releases/download/${TAG}/${name}`
  };
}

// Exactly what `gh release create "$tag" <tar> <sidecar> --prerelease` yields
// when read back through GET /repos/:owner/:repo/releases.
function githubReleasePayload({ sidecarName = MANIFEST_NAME, tamperAssetDigest = false } = {}) {
  const manifest = manifestFixture();
  const tar = ghAsset(ART_NAME, ARTIFACT_SHA, manifest.artifact.sizeBytes);
  if (tamperAssetDigest) tar.digest = 'sha256:' + sha('tampered-on-github');
  return [{
    id: 987654321,
    tag_name: TAG,
    target_commitish: 'main',
    name: `z2m-compatible-engine ${VERSION} (${ARCH})`,
    draft: false,
    prerelease: true,                       // ← workflow always publishes --prerelease
    created_at: '2026-08-23T00:00:00Z',
    published_at: '2026-08-23T00:01:00Z',
    html_url: `https://github.com/t0fox/zapret2-manager/releases/tag/${TAG}`,
    assets: [
      tar,
      ghAsset(sidecarName, JSON.stringify(manifest))
    ]
  }];
}

function invokeRecordsFromPayload(payload, opts = {}) {
  const archLit = JSON.stringify(opts.architecture ?? ARCH);
  const manifestBody = opts.manifestBody != null
    ? opts.manifestBody
    : JSON.stringify(manifestFixture());
  const manifestJs = JSON.stringify(manifestBody);
  const payloadJs = JSON.stringify(payload);
  const lines = [
    'import * as m from ' + JSON.stringify(MODULE) + ';',
    'let calls = [];',
    'let r = m.z2m_records_from_payload(' + payloadJs + ', ' + archLit + ',',
    '  function(asset) { push(calls, asset.name);',
    '    const body = ' + manifestJs + ';',
    '    return json(body); });',
    'print(sprintf("%J", r) + "\\n");',
    'print("@@CALLS@" + sprintf("%J", calls));'
  ];
  const source = lines.join('\n');
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_ENGINE_INTEGRATION_JSON: path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json') },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
  if (process.env.XB_DEBUG) {
    console.error('UCODE SOURCE:\n' + source);
    console.error('UCODE STDOUT:', JSON.stringify(result.stdout));
    console.error('UCODE STDERR:', JSON.stringify(result.stderr));
  }
  const out = result.stdout;
  const callsIdx = out.indexOf('@@CALLS@');
  assert.notEqual(callsIdx, -1, out);
  const records = JSON.parse(out.slice(0, callsIdx)).records;
  const calls = JSON.parse(out.slice(callsIdx + '@@CALLS@'.length));
  return { records, calls };
}

test('exact workflow release payload → exactly one installable compatible candidate', () => {
  const { records, calls } = invokeRecordsFromPayload(githubReleasePayload());
  assert.equal(records.length, 1, `expected exactly one candidate, got: ${JSON.stringify(records)}`);
  const c = records[0];

  assert.equal(c.artifactKind, 'z2m-compatible-engine');
  assert.equal(c.compatible, true);
  assert.equal(c.architecture, ARCH);
  assert.equal(c.version, VERSION);
  assert.equal(c.releaseTag, TAG);
  assert.equal(c.sha256, ARTIFACT_SHA, 'candidate SHA must equal the artifact digest published on the release');
  assert.equal(c.nfqws2Sha256, NFQWS2_SHA);
  assert.deepEqual(c.patchSeries?.map(p => p.id),
    ['001-z2k-tls-mod', '002-z2k-antidpi-repeats-loop', '003-z2k-auto-family-split']);
  assert.deepEqual(c.patchSeries?.map(p => p.sha256),
    INTEGRATION.patchSeries.map(p => p.sha256));
  assert.equal(c.baseCommit, BASE_COMMIT);
  // worker will fetch the manifest from THIS url — must match the pairing rule
  assert.equal(c.checksumName, MANIFEST_NAME);
  assert.equal(c.downloadUrl.endsWith(`/${ART_NAME}`), true);
  assert.equal(c.checksumUrl, c.downloadUrl + '.manifest.json');

  // the consumer asked for exactly the canonical sidecar
  assert.deepEqual(calls, [MANIFEST_NAME]);
});

test('old-style sidecar name (pre-fix producer) pairs nothing — contract locked', () => {
  const { records } = invokeRecordsFromPayload(
    githubReleasePayload({ sidecarName: OLD_STYLE_NAME }));
  assert.equal(records.length, 0,
    'legacy x.manifest.json sidecar must never pair with x.tar.gz');
});

test('tampered artifact digest on the GitHub asset yields zero candidates', () => {
  const { records } = invokeRecordsFromPayload(
    githubReleasePayload({ tamperAssetDigest: true }));
  assert.equal(records.length, 0);
});

test('draft releases of the canonical feed are still skipped', () => {
  const payload = githubReleasePayload();
  payload[0].draft = true;
  const { records } = invokeRecordsFromPayload(payload);
  assert.equal(records.length, 0);
});

test('non-engine tags are ignored even with well-formed assets', () => {
  const payload = githubReleasePayload();
  payload[0].tag_name = 'v1.2.3';
  const { records } = invokeRecordsFromPayload(payload);
  assert.equal(records.length, 0);
});
