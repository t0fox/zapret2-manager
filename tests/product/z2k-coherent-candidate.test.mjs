import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-coherent-candidate.uc');
const ucode = process.env.UCODE_BIN;
const ucodeAvailable = ucode && fs.existsSync(ucode);

function invoke(input) {
  const source = `import { z2k_candidate_build } from ${JSON.stringify(modulePath)}; print(sprintf('%J', z2k_candidate_build(${JSON.stringify(input)})));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const commitA = 'a'.repeat(40);
const digestA = 'a'.repeat(64);
const base = {
  release: 'p-82.14',
  sourceCommit: commitA,
  manifestSeq: 82,
  manifestSha256: digestA,
  classificationSha256: 'b'.repeat(64),
  runtimeCommit: commitA,
  compilerCommit: commitA,
  catalogCommit: commitA,
  detect: { arch: 'arm64', digest: 'c'.repeat(64), size: 1234, sourceCommit: commitA },
  runtimeMembership: [
    { id: 'lua:core', sourcePath: 'files/lua/core.lua', contentSha256: digestA, byteSize: 12, sourceCommit: commitA, version: 'p-82.14' },
    { id: 'list:sni', sourcePath: 'sni_wl_candidates.txt', contentSha256: '1'.repeat(64), byteSize: 13, sourceCommit: commitA, version: 'p-82.14' },
  ],
  requiredLists: ['sni_wl_candidates.txt'],
  presentLists: ['sni_wl_candidates.txt'],
  compilerInputsDigest: 'd'.repeat(64),
  catalogDigest: 'e'.repeat(64),
};

test('coherent candidate module exposes one immutable candidate builder', () => {
  assert.equal(fs.existsSync(modulePath), true);
  assert.match(fs.readFileSync(modulePath, 'utf8'), /export const z2k_candidate_build/);
  const compat = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-compat.uc'), 'utf8');
  const closure = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc'), 'utf8');
  const composition = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc'), 'utf8');
  assert.match(compat, /z2k_candidate_identity_gate/);
  assert.match(closure, /runtimeMembership/);
  assert.match(composition, /z2k_candidate_build\(/);
  assert.match(composition, /z2k_candidate_identity_gate\(/);
});

test('mixed release revisions fail closed with ECOMPATIBILITY', { skip: !ucodeAvailable }, () => {
  const result = invoke({ ...base, compilerCommit: 'b'.repeat(40) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ECOMPATIBILITY');
});

test('missing Detect fails closed with EDETECT_UNAVAILABLE', { skip: !ucodeAvailable }, () => {
  const result = invoke({ ...base, detect: null });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EDETECT_UNAVAILABLE');
});

test('missing required release member rejects candidate', { skip: !ucodeAvailable }, () => {
  const result = invoke({
    ...base,
    presentLists: ['sni_wl_candidates.txt'],
    runtimeMembership: base.runtimeMembership.filter(item => item.sourcePath !== 'sni_wl_candidates.txt'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EMISSING_MEMBER');
});

test('runtime member commit and release provenance must match the candidate revision', { skip: !ucodeAvailable }, () => {
  for (const mutation of [
    { sourceCommit: 'b'.repeat(40) },
    { version: 'p-82.15' },
  ]) {
    const result = invoke({
      ...base,
      runtimeMembership: base.runtimeMembership.map(item => item.id === 'lua:core'
        ? { ...item, ...mutation }
        : item),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ECOMPATIBILITY');
  }
});

test('incomplete dependency closure fails closed even with non-empty membership', { skip: !ucodeAvailable }, () => {
  const result = invoke({
    ...base,
    dependencyClosure: {
      available: false,
      resolution: 'incomplete',
      missing: [{ reference: 'tcp16_targets.txt' }],
      counts: { missing: 1 },
      items: base.runtimeMembership,
      runtimeBundleDigest: '2'.repeat(64),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINCONSISTENT');
});

test('supplied runtime bundle digest must match canonical membership evidence', { skip: !ucodeAvailable }, () => {
  const result = invoke({ ...base, runtimeBundleDigest: 'f'.repeat(64) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ECOMPATIBILITY');
});

test('semantic compatibility identity ignores staging, timestamps, and Registry revisions', { skip: !ucodeAvailable }, () => {
  const first = invoke({ ...base, stagingPath: '/tmp/first', preparedAt: 1, registryRevision: 10 });
  const second = invoke({ ...base, stagingPath: '/tmp/second', preparedAt: 2, registryRevision: 11 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.compatibilityIdentity, second.compatibilityIdentity);
  assert.match(first.runtimeBundleDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.detect, base.detect);
});
