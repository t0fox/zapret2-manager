// validate-engine-manifest.mjs — canonical validator for z2m-compatible-engine
// artifact manifests.
//
// The producer (scripts/engine/build-compatible-engine.sh) and the on-device
// consumer (engine-catalog.uc) share this contract. A manifest is valid ONLY
// when it proves, machine-readably, that the artifact was built from the
// pinned bol-van base with the exact SHA-pinned 3-patch series for a concrete
// OpenWrt architecture, carries real capability evidence for all three Z2K
// capabilities, and self-describes its digests.



import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const SCHEMA = 'zapret2-manager.engine-artifact.v1';
const KIND = 'z2m-compatible-engine';
const HEX64 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(errors, message) {
  errors.push(message);
}

function checkPatchSeries(manifest, integration, errors) {
  if (!Array.isArray(manifest.patchSeries)) {
    return fail(errors, 'patchSeries must be an array');
  }
  const expected = integration.patchSeries;
  if (manifest.patchSeries.length !== expected.length) {
    return fail(errors,
      `patch series length ${manifest.patchSeries.length} != pinned ${expected.length}`);
  }
  expected.forEach((patch, index) => {
    const actual = manifest.patchSeries[index];
    if (!isObject(actual)) return fail(errors, `patchSeries[${index}] must be an object`);
    if (actual.id !== patch.id) {
      fail(errors, `patchSeries[${index}].id ${actual.id} != pinned ${patch.id}`);
    }
    if (actual.sha256 !== patch.sha256) {
      fail(errors, `patchSeries[${index}] (${patch.id}) digest drift from pinned series`);
    }
  });
}

function checkCapabilityEvidence(manifest, integration, errors) {
  const evidence = manifest.capabilityEvidence;
  if (!isObject(evidence)) {
    return fail(errors, 'capabilityEvidence must be an object with one entry per required capability');
  }
  for (const capability of integration.requiredCapabilities) {
    const entry = evidence[capability];
    if (!isObject(entry) || typeof entry.method !== 'string' || entry.method === '') {
      fail(errors, `capabilityEvidence.${capability} must carry non-empty method evidence`);
    }
  }
}

export function validateEngineManifest(manifest, options = {}) {
  const errors = [];
  const integration = options.integration;

  if (!integration || integration.schema !== 'zapret2-manager.engine-integration.v1') {
    return { ok: false, errors: ['a valid engine-integration authority is required'] };
  }
  if (!isObject(manifest)) return { ok: false, errors: ['manifest must be an object'] };

  if (manifest.schema !== SCHEMA) fail(errors, `schema must be ${SCHEMA}`);
  if (manifest.artifactKind !== KIND) fail(errors, `artifactKind must be ${KIND}`);

  // Base identity — single pinned source of truth.
  if (!isObject(manifest.base)) fail(errors, 'base identity is missing');
  else {
    if (manifest.base.repository !== integration.engineBase.repository) {
      fail(errors, `base repository ${manifest.base.repository} != pinned ${integration.engineBase.repository}`);
    }
    if (manifest.base.commit !== integration.engineBase.commit) {
      fail(errors, `base commit ${manifest.base.commit} != pinned ${integration.engineBase.commit}`);
    }
  }

  checkPatchSeries(manifest, integration, errors);

  // Architecture.
  const arch = manifest.architecture;
  if (typeof arch !== 'string' || arch.length === 0) {
    fail(errors, 'architecture is required');
  } else if (options.architecture && arch !== options.architecture) {
    fail(errors, `architecture ${arch} != requested ${options.architecture}`);
  }

  // Required capabilities superset.
  const caps = Array.isArray(manifest.requiredCapabilities) ? manifest.requiredCapabilities : [];
  for (const capability of integration.requiredCapabilities) {
    if (!caps.includes(capability)) fail(errors, `requiredCapabilities missing ${capability}`);
  }

  checkCapabilityEvidence(manifest, integration, errors);

  // Artifact self-description.
  const artifact = manifest.artifact;
  if (!isObject(artifact)) fail(errors, 'artifact description is missing');
  else {
    if (typeof artifact.name !== 'string' || !/^[\w.-]+\.tar\.gz$/.test(artifact.name)) {
      fail(errors, 'artifact.name must reference a .tar.gz payload');
    }
    if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) {
      fail(errors, 'artifact.sha256 must be a lowercase hex sha256');
    }
    if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      fail(errors, 'artifact.sizeBytes must be a positive integer');
    }
    if (artifact.container !== 'tar.gz') fail(errors, 'artifact.container must be tar.gz');
  }

  if (typeof manifest.nfqws2Sha256 !== 'string' || !SHA256.test(manifest.nfqws2Sha256)) {
    fail(errors, 'nfqws2Sha256 must be a lowercase hex sha256');
  }

  // Runtime Lua compatibility contract.
  const functions = manifest.runtimeCompatibility?.requiredFunctions;
  const expectedFunctions = integration.runtimeCompatibility?.requiredFunctions ?? [];
  if (!Array.isArray(functions) || functions.join('\u0000') !== expectedFunctions.join('\u0000')) {
    fail(errors, 'runtimeCompatibility.requiredFunctions must match the pinned list');
  }

  // Build provenance.
  const provenance = manifest.buildProvenance;
  if (!isObject(provenance)) fail(errors, 'buildProvenance is missing');
  else {
    for (const field of ['sdkVersion', 'toolchain', 'builtAt', 'producerCommit']) {
      if (typeof provenance[field] !== 'string' || provenance[field] === '') {
        fail(errors, `buildProvenance.${field} is required`);
      }
    }
    if (typeof provenance.producerCommit === 'string'
      && provenance.producerCommit !== '' && !HEX64.test(provenance.producerCommit)) {
      fail(errors, 'buildProvenance.producerCommit must be a full git sha');
    }
  }

  // When actual bytes are supplied, recompute the digest and size.
  if (options.artifactPath && errors.length === 0) {
    try {
      const bytes = fs.readFileSync(options.artifactPath);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== artifact.sha256) {
        fail(errors, `artifact digest mismatch: file ${digest} != manifest ${artifact.sha256}`);
      }
      if (bytes.length !== artifact.sizeBytes) {
        fail(errors, `artifact size mismatch: file ${bytes.length} != manifest ${artifact.sizeBytes}`);
      }
    } catch (error) {
      fail(errors, `artifact unreadable: ${error.message}`);
    }
  }

  return { ok: errors.length === 0, errors };
}




// CLI: validate a manifest file against this repository's integration authority.
//   node scripts/engine/validate-engine-manifest.mjs <manifest.json> [artifact.tar.gz]
if (process.argv[1] && process.argv[1].endsWith('validate-engine-manifest.mjs')) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('usage: node scripts/engine/validate-engine-manifest.mjs <manifest.json> [artifact]');
    process.exit(2);
  }
  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  const integration = JSON.parse(fs.readFileSync(path.join(rootDir,
    'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json'), 'utf8'));
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`manifest unreadable: ${error.message}`);
    process.exit(1);
  }
  const verdict = validateEngineManifest(manifest, {
    integration,
    artifactPath: process.argv[3] || undefined
  });
  if (verdict.ok) {
    console.log('engine manifest OK');
    process.exit(0);
  }
  console.error(verdict.errors.map(line => `- ${line}`).join('\n'));
  process.exit(1);
}
