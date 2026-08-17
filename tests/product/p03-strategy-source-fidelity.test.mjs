import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const CLI_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');

test('P03-SF catalog is fingerprint/provenance based, not ID based', () => {
  const source = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf8'));
  assert.match(source, /semantic_fingerprint/);
  assert.match(source, /provenance/);
  assert.match(source, /semanticFingerprintCount/);
  assert.match(source, /provenanceLinkCount/);
  const z2k = manifest.physicalEntries.find(entry => entry.id === 'z2k_all_in_one');
  assert.ok(z2k);
  assert.match(z2k.args, /--filter-tcp=80,443/);
  assert.match(z2k.args, /--filter-udp=443/);
  assert.match(z2k.args, /--filter-udp=50000-50099/);
  assert.match(z2k.args, /--new/);
});

test('P03-SF list projection cannot manufacture generic Profile labels', () => {
  const cli = fs.readFileSync(CLI_MODULE, 'utf8');
  assert.doesNotMatch(cli, /name:\s*'Профиль '\s*\+/,
    'list must derive profile identity from canonical filter semantics');
  assert.match(cli, /catalog_entry_to_strategy\(entry\)/,
    'list/get must share the canonical Strategy conversion');
});

test('P03-SF operational source is the complete curated catalog', () => {
  const catalog = fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc'), 'utf8');
  assert.match(catalog, /"repository"\s*:\s*"avatarDD\/zapret-gui"/);
  assert.doesNotMatch(source, /PACKAGE_ROOT\s*=\s*'\/usr\/share\/zapret2-manager\/catalog\/forgejo'/,
    'the complete catalog must be the operational default');
});

test('P03-SF bundles the referenced runtime closure and correct official blob root', () => {
  const registry = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'), 'utf8');
  const sync = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf8'));
  const args = manifest.physicalEntries.map(entry => entry.args || '').join('\n');
  assert.match(registry, /blobRoot:\s*'\/opt\/zapret2\/files\/fake'/);
  assert.match(sync, /runtime-assets/);
  for (const match of args.matchAll(/@bin\/([^\s]+)/g)) {
    const name = match[1].replace(/[,'";)]+$/, '');
    assert.equal(fs.existsSync(path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/bin', name)), true, name);
  }
  for (const match of args.matchAll(/@lua\/([^\s]+)/g)) {
    const name = match[1].replace(/[,'";)]+$/, '');
    assert.equal(fs.existsSync(path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua', name)), true, name);
  }
});
