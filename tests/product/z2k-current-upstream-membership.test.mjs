import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  assert.equal(byPath['files/lua/z2k-detectors.lua'], undefined);
});

test('resource manifest points at the canonical classification while legacy removal stays explicit', () => {
  assert.equal(resources.z2kClassificationPath, 'upstreams/z2k-integration.json');
  assert.ok(resourceByPath['files/lua/z2k-detectors.lua']);
  assert.ok(resourceByPath['files/lua/z2k-alert.lua']);
});
