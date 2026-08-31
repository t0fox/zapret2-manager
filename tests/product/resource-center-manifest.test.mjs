import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json';

function manifest() {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

test('Resource Center manifest is Z2M-owned and carries real source provenance', () => {
  const value = manifest();
  assert.equal(value.schema, 'zapret2-manager.resource-manifest.v1');
  assert.match(value.bundleId, /^[a-z][a-z0-9-]+$/);
  assert.match(value.generatedAt, /^2026-08-21T/);
  assert.deepEqual(value.sources.map(source => source.id), ['avatar-strategy-source', 'z2k-strategy-source', 'z2k-resources', 'package-baseline']);
  assert.equal(value.sources[0].repository, 'avatarDD/zapret-gui');
  assert.equal(value.sources[1].repository, 'necronicle/z2k');
  assert.equal(value.sources[1].kind, 'strategy-catalog');
  assert.equal(value.sources[2].kind, 'asset-bundle');
  for (const source of value.sources) {
    assert.match(source.commit, /^[0-9a-f]{40}$/);
    assert.ok(source.label);
    assert.ok(source.status);
  }
});

test('Resource bundles have stable identity, exact evidence, and consumer compatibility', () => {
  const value = manifest();
  const ids = new Set();
  for (const bundle of value.bundles) {
    assert.match(bundle.id, /^[a-z][a-z0-9-]+$/);
    assert.match(bundle.sourceCommit, /^[0-9a-f]{40}$/);
    assert.ok(value.sources.some(source => source.id === bundle.sourceId));
    for (const asset of bundle.assets) {
      assert.ok(['lua', 'blob', 'ipset', 'hostlist', 'hosts', 'geosite', 'geoip'].includes(asset.type));
      assert.match(asset.id, new RegExp(`^${asset.type}:[a-z][a-z0-9._-]*$`));
      assert.equal(ids.has(asset.id), false, `duplicate asset ${asset.id}`);
      ids.add(asset.id);
      assert.match(asset.sourcePath, /^files\//);
      assert.match(asset.contentUrl, /^https:\/\//);
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
      assert.equal(Number.isInteger(asset.byteSize), true);
      assert.ok(asset.byteSize > 0);
      assert.ok(Array.isArray(asset.dependencies));
      assert.ok(asset.compatibility && asset.compatibility.consumer);
    }
  }
  assert.equal(ids.size, 7);
});
