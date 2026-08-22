// write-manifest.mjs — assemble the z2m-compatible-engine artifact manifest.
//
// Usage: node scripts/engine/write-manifest.mjs <input.json> <output.json>
//
// The input carries the raw build observations; this script merges them with
// the canonical engine-integration authority (patch series, capabilities,
// required Lua functions) so the producer cannot emit a manifest that
// disagrees with the pinned identity. The output is then verified by
// validate-engine-manifest.mjs — fail-closed end to end.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('usage: write-manifest.mjs <input.json> <output.json>');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const integration = JSON.parse(fs.readFileSync(path.join(ROOT,
    'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json'), 'utf8'));

  for (const field of ['version', 'architecture', 'artifactSha256', 'artifactSize',
    'nfqws2Sha256', 'builtAt']) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      console.error(`write-manifest: missing required input field ${field}`);
      process.exit(1);
    }
  }

  const head = input.upstreamHeadSha || null;
  const baseCommit = integration.engineBase.commit;

  const manifest = {
    schema: 'zapret2-manager.engine-artifact.v1',
    artifactKind: 'z2m-compatible-engine',
    version: String(input.version),
    artifact: {
      name: String(input.artifactName),
      sha256: String(input.artifactSha256),
      sizeBytes: Number(input.artifactSize),
      container: 'tar.gz'
    },
    base: {
      repository: integration.engineBase.repository,
      commit: baseCommit,
      headAtBuild: head,
      pinnedBehindUpstream: Boolean(head) && head !== baseCommit
    },
    patchSeries: integration.patchSeries.map(p => ({ id: p.id, sha256: p.sha256 })),
    architecture: String(input.architecture),
    requiredCapabilities: [...integration.requiredCapabilities],
    capabilityEvidence: {
      Z2K_TLS_MOD: {
        method: 'binary-tokens',
        tokens: ['z2k_grease', 'z2k_alpn_flood', 'z2k_psk', 'z2k_keyshare', 'z2k_earlydata', 'z2k_pha'],
        sourceMarker: 'nfq2/z2k_tls_mod.h'
      },
      ANTIDPI_REPEATS_LOOP: {
        method: 'lua-source-marker',
        file: 'lua/zapret-antidpi.lua',
        marker: 'repeats > 1 and desync.reasm_data and desync.arg.tls_mod'
      },
      AUTO_FAMILY_SPLIT: {
        method: 'lua-source-marker',
        file: 'lua/zapret-auto.lua',
        marker: 'family_split'
      }
    },
    nfqws2Sha256: String(input.nfqws2Sha256),
    luaFiles: Array.isArray(input.luaFiles) ? input.luaFiles : [],
    runtimeCompatibility: {
      requiredFunctions: [...integration.runtimeCompatibility.requiredFunctions]
    },
    buildProvenance: {
      sdkVersion: String(input.sdkVersion ?? 'unknown'),
      toolchain: String(input.toolchain ?? 'unknown'),
      builtAt: String(input.builtAt),
      producerCommit: String(input.producerCommit)
    },
    upstreamState: { headSha: head, advanced: Boolean(head) && head !== baseCommit }
  };

  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
}

main();
