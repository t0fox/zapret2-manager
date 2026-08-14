import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AssetRegistry, resolveAssetReference } from '../lib/asset-registry.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-assets-'));
}

test('import creates a stable typed identity with hash, revision, provenance, and server path', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    const created = registry.importAsset({
      type: 'lua', id: 'lua:custom', name: 'Custom Lua',
      content: Buffer.from('-- manager asset\nreturn true\n'),
      provenance: { kind: 'imported', source: 'unit-test' },
    });
    assert.equal(created.ok, true);
    assert.equal(created.asset.id, 'lua:custom');
    assert.equal(created.asset.type, 'lua');
    assert.equal(created.asset.revision, 1);
    assert.match(created.asset.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(created.asset.provenance.kind, 'imported');
    assert.equal(created.asset.path, path.join(root, 'lua', 'custom.lua'));
    assert.equal(fs.readFileSync(created.asset.path, 'utf8'), '-- manager asset\nreturn true\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('registry rejects arbitrary paths, traversal, symlink escapes, and non-regular files', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    for (const id of ['../escape', '/etc/passwd', 'lua:../escape']) {
      const result = registry.importAsset({ type: 'lua', id, content: Buffer.from('return true') });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'EINPUT');
    }
    const outside = path.join(root, '..', 'outside.lua');
    fs.writeFileSync(outside, 'outside');
    fs.rmSync(path.join(root, 'lua'), { recursive: true, force: true });
    try {
      fs.symlinkSync(outside, path.join(root, 'lua'), 'file');
      const result = registry.importAsset({ type: 'lua', id: 'lua:escape', content: Buffer.from('inside') });
      assert.equal(result.ok, false);
      assert.ok(['ESAFETY', 'EINPUT'].includes(result.error.code));
    } catch (cause) {
      assert.ok(['EPERM', 'EACCES'].includes(cause.code), `unexpected symlink setup error: ${cause}`);
    }
    fs.rmSync(outside, { force: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('blob registry preserves binary bytes exactly and bounds size', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root, limits: { blob: 4 } });
    const bytes = Buffer.from([0, 255, 1, 2]);
    const created = registry.importAsset({ type: 'blob', id: 'blob:bytes', content: bytes,
      provenance: { kind: 'imported', source: 'binary-test' } });
    assert.equal(created.ok, true);
    assert.deepEqual(fs.readFileSync(created.asset.path), bytes);
    assert.equal(created.asset.byteSize, 4);
    const tooLarge = registry.importAsset({ type: 'blob', id: 'blob:large', content: Buffer.alloc(5) });
    assert.equal(tooLarge.ok, false);
    assert.equal(tooLarge.error.code, 'ESIZE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ipset and hostlist validators normalize supported entries and reject malformed values', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    const ipset = registry.importAsset({ type: 'ipset', id: 'ipset:main', content: Buffer.from(
      '# comment\n192.0.2.1\n2001:DB8::/32\n192.0.2.0/24\n') });
    assert.equal(ipset.ok, true);
    assert.equal(fs.readFileSync(ipset.asset.path, 'utf8'), '# comment\n192.0.2.1\n2001:db8::/32\n192.0.2.0/24\n');
    const badIp = registry.importAsset({ type: 'ipset', id: 'ipset:bad', content: Buffer.from('999.1.1.1\n') });
    assert.equal(badIp.ok, false);
    assert.equal(badIp.error.code, 'EVALIDATION');
    const hosts = registry.importAsset({ type: 'hostlist', id: 'hostlist:main', content: Buffer.from(
      '# keep\n.Example.COM\nexample.com\ncdn.example.com\n') });
    assert.equal(hosts.ok, true);
    assert.equal(fs.readFileSync(hosts.asset.path, 'utf8'), '# keep\nexample.com\ncdn.example.com\n');
    const badHost = registry.importAsset({ type: 'hostlist', id: 'hostlist:bad', content: Buffer.from('https://example.com\n') });
    assert.equal(badHost.ok, false);
    assert.equal(badHost.error.code, 'EVALIDATION');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('referenced assets cannot be deleted and missing or wrong-type references fail preflight', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    assert.equal(registry.importAsset({ type: 'hostlist', id: 'hostlist:one', content: Buffer.from('example.com\n') }).ok, true);
    assert.equal(registry.setReferences('strategy:one', [{ type: 'hostlist', id: 'hostlist:one', revision: 1 }]).ok, true);
    const refused = registry.deleteAsset('hostlist:one');
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, 'EREFERENCED');
    const resolved = resolveAssetReference(registry, { type: 'hostlist', id: 'hostlist:one', revision: 1 });
    assert.equal(resolved.ok, true);
    assert.equal(resolveAssetReference(registry, { type: 'blob', id: 'hostlist:one' }).error.code, 'ETYPE');
    assert.equal(resolveAssetReference(registry, { type: 'hostlist', id: 'hostlist:missing' }).error.code, 'EDEPENDENCY');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy trusted canonical paths resolve to IDs without accepting caller paths', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root, legacyRoots: { hostlist: '/opt/zapret2/ipset' } });
    const created = registry.importAsset({ type: 'hostlist', id: 'hostlist:legacy', name: 'legacy',
      canonicalPath: '/opt/zapret2/ipset/legacy.txt', content: Buffer.from('example.com\n'),
      provenance: { kind: 'imported', source: 'legacy-fixture' } });
    assert.equal(created.ok, true);
    assert.equal(resolveAssetReference(registry, { type: 'hostlist', legacyPath: '/opt/zapret2/ipset/legacy.txt' }).asset.id, 'hostlist:legacy');
    assert.equal(resolveAssetReference(registry, { type: 'hostlist', legacyPath: '/etc/passwd' }).error.code, 'EINPUT');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('package-owned assets are hash-bound and preserved beside mutable user assets', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    const packageBytes = Buffer.from('package.example\n');
    assert.equal(registry.importAsset({ type: 'hostlist', id: 'hostlist:bad-package', content: packageBytes,
      provenance: { kind: 'builtin/package', source: 'package-manifest', expectedSha256: '0'.repeat(64) } }).error.code, 'EVERIFY');
    const packageAsset = registry.importAsset({ type: 'hostlist', id: 'hostlist:package-default', content: packageBytes,
      provenance: { kind: 'builtin/package', source: 'package-manifest', expectedSha256: cryptoHash(packageBytes) } });
    assert.equal(packageAsset.ok, true);
    assert.equal(registry.updateAsset(packageAsset.asset.id, { expectedRevision: 1, content: Buffer.from('changed') }).error.code, 'EPOLICY');
    const userAsset = registry.importAsset({ type: 'hostlist', id: 'hostlist:user-default', content: Buffer.from('user.example\n') });
    assert.equal(userAsset.ok, true);
    assert.equal(fs.existsSync(packageAsset.asset.path), true);
    assert.equal(fs.existsSync(userAsset.asset.path), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('package reconciliation updates builtin revision while preserving a user asset with a different identity', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    const v1 = Buffer.from('192.0.2.2\n');
    const user = registry.importAsset({ type: 'ipset', id: 'ipset:user-owned', content: Buffer.from('192.0.2.1\n') });
    const first = registry.reconcileBuiltin({ type: 'ipset', id: 'ipset:package-owned', content: v1,
      provenance: { kind: 'builtin/package', source: 'v1', expectedSha256: cryptoHash(v1) } });
    assert.equal(first.ok, true);
    const v2 = Buffer.from('198.51.100.2\n');
    const second = registry.reconcileBuiltin({ type: 'ipset', id: 'ipset:package-owned', content: v2,
      provenance: { kind: 'builtin/package', source: 'v2', expectedSha256: cryptoHash(v2) } });
    assert.equal(second.ok, true);
    assert.equal(second.asset.revision, 2);
    assert.equal(second.asset.provenance.source, 'v2');
    assert.equal(fs.existsSync(user.asset.path), true);
    assert.equal(fs.readFileSync(user.asset.path, 'utf8'), '192.0.2.1\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('geosite and geoip remain explicit schema types without pretending to have a live consumer', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    for (const type of ['geosite', 'geoip']) {
      const result = registry.importAsset({ type, id: `${type}:reserved`, content: Buffer.from([0, 1, 2]) });
      assert.equal(result.ok, true);
      assert.equal(result.asset.validation.status, 'passed');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('production boundary exposes only typed asset RPCs and no generic file CRUD', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const registrySource = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'), 'utf8');
  const rpcSource = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
  const strategySource = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc'), 'utf8');
  const scannerSource = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc'), 'utf8');
  const acl = JSON.parse(fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'), 'utf8'));
  assert.match(registrySource, /asset_registry_environment/);
  assert.match(registrySource, /atomic_write/);
  assert.match(strategySource, /asset_registry_environment/);
  assert.match(scannerSource, /asset_registry_environment/);
  assert.doesNotMatch(rpcSource, /generic.*(read|write|delete).*file/i);
  for (const method of ['assets_list', 'assets_get', 'assets_validate', 'assets_resolve', 'assets_import', 'assets_update', 'assets_delete', 'assets_references']) assert.match(rpcSource, new RegExp(`\\b${method}\\b`));
  const read = acl['zapret2-manager'].read.ubus['zapret2-manager'];
  const write = acl['zapret2-manager'].write.ubus['zapret2-manager'];
  assert.ok(read.includes('assets_list') && read.includes('assets_resolve'));
  assert.ok(write.includes('assets_import') && write.includes('assets_delete'));
});

function cryptoHash(content) { return crypto.createHash('sha256').update(content).digest('hex'); }

test('update is revisioned and failed atomic writes retain the previous content', () => {
  const root = tempRoot();
  try {
    const registry = new AssetRegistry({ root });
    const created = registry.importAsset({ type: 'lua', id: 'lua:atomic', content: Buffer.from('old') });
    assert.equal(created.ok, true);
    const failed = registry.updateAsset('lua:atomic', { expectedRevision: 1, content: Buffer.from('new'),
      failRename: true });
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, 'EWRITE');
    assert.equal(fs.readFileSync(created.asset.path, 'utf8'), 'old');
    const updated = registry.updateAsset('lua:atomic', { expectedRevision: 1, content: Buffer.from('new') });
    assert.equal(updated.ok, true);
    assert.equal(updated.asset.revision, 2);
    assert.equal(fs.readFileSync(updated.asset.path, 'utf8'), 'new');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
