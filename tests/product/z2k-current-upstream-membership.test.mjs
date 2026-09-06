import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const classification = JSON.parse(fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'), 'utf8'));
const byPath = Object.fromEntries(classification.files.map(item => [item.sourcePath, item]));
const resources = JSON.parse(fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json'), 'utf8'));
const resourceByPath = Object.fromEntries(resources.bundles.flatMap(bundle => bundle.assets).map(item => [item.sourcePath, item]));

test('current Z2K runtime membership includes exact lists and architecture-specific Detect', () => {
  assert.equal(byPath['files/lua/z2k-alert.lua'].dependencyClass, 'runtime-exact');
  assert.equal(byPath['files/lists/sni_wl_candidates.txt'].dependencyClass, 'runtime-exact');
  assert.equal(byPath['files/lists/tcp16_targets.txt'].dependencyClass, 'runtime-exact');
  assert.equal(byPath['files/lists/tcp16_nets.txt'].dependencyClass, 'runtime-exact');
  assert.equal(byPath['z2k-detect/builds/z2k-detect-linux-arm64'].dependencyClass, 'detect-arch');
  assert.equal(byPath['z2k-detect/builds/z2k-detect-linux-arm64'].localName, undefined);
  assert.equal(byPath['z2k-detect/builds/z2k-detect-linux-arm64'].runtimeTarget, undefined);
  assert.equal(byPath['z2k-detect/builds/z2k-detect-linux-arm64'].packageBaselinePath, undefined);
  assert.equal(byPath['files/lua/z2k-detectors.lua'], undefined);
});

test('production classification does not present fixture-only list or Detect digests as verified bytes', () => {
  for (const sourcePath of [
    'files/lists/sni_wl_candidates.txt',
    'files/lists/tcp16_targets.txt',
    'files/lists/tcp16_nets.txt',
    'z2k-detect/builds/z2k-detect-linux-arm64',
  ]) {
    assert.equal(byPath[sourcePath].basedOnSha256, null, sourcePath);
    assert.equal(byPath[sourcePath].digestStatus, 'unverified', sourcePath);
  }
});

test('classification generation rejects an unknown upstream path instead of ignoring it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2k-classification-'));
  try {
    const manifestPath = path.join(dir, 'UPDATES.json');
    const outputPath = path.join(dir, 'classification.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      schema: 1,
      branch: 'z2k-enhanced',
      seq: 1,
      current: 'r-1.0',
      files_sha256: { 'files/new-consumed.dat': 'a'.repeat(64) },
    }));
    fs.writeFileSync(outputPath, 'stale classification');
    const result = spawnSync(process.execPath, [
      'tools/generate-z2k-classification.mjs', manifestPath, outputPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Unknown upstream classification/);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('classification generation preserves a valid digest unless the manifest marks it fixture-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2k-classification-real-'));
  try {
    const manifestPath = path.join(dir, 'UPDATES.json');
    const outputPath = path.join(dir, 'classification.json');
    const digest = 'f'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify({
      schema: 1,
      branch: 'z2k-enhanced',
      seq: 2,
      current: 'r-2.0',
      files_sha256: { 'files/lists/sni_wl_candidates.txt': digest },
    }));
    const result = spawnSync(process.execPath, [
      'tools/generate-z2k-classification.mjs', manifestPath, outputPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(output.files[0].basedOnSha256, digest);
    assert.equal(output.files[0].digestStatus, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource manifest points at the canonical classification while legacy removal stays explicit', () => {
  assert.equal(resources.z2kClassificationPath, 'upstreams/z2k-integration.json');
  assert.ok(resourceByPath['files/lua/z2k-detectors.lua']);
  assert.ok(resourceByPath['files/lua/z2k-alert.lua']);
});
