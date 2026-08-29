import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
const audit = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/z2k-version-catalog/audit.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc'), 'utf8');

function membership(row, rows = audit.versions) {
  if (row.sameMembershipAs) return membership(rows.find(item => item.version === row.sameMembershipAs), rows);
  return (row.manifest.membership || '').split('|').filter(Boolean);
}

test('release audit retains the latest ten semantic r-* releases and binds each manifest current to its tag', () => {
  assert.equal(audit.versions.length, 10);
  assert.ok(audit.versions.every(item => /^r-/.test(item.version)));
  assert.ok(audit.versions.every(item => item.manifest.current === item.version));
  assert.deepEqual(audit.versions.map(item => item.version), [
    'r-80.3', 'r-80.2', 'r-80.1', 'r-80', 'r-79.7',
    'r-79.6', 'r-79.5', 'r-79.4', 'r-79.2', 'r-79.1'
  ]);
  assert.ok(audit.versions.every(item => /^[0-9a-f]{40}$/.test(item.commitSha)));
});

test('membership gate proves supported releases are stable and older releases are explicitly incompatible', () => {
  const supported = audit.versions.slice(0, 3);
  assert.equal(new Set(supported.map(item => membership(item).join('|'))).size, 1);
  assert.ok(supported.every(item => item.manifest.exactManagedCount === 39));
  assert.equal(audit.versions[3].unsupportedReason, 'incompatible-manager');
  assert.equal(audit.versions[4].unsupportedReason, 'incompatible-manager');
  assert.equal(membership(audit.versions[0]).includes('files/lists/warp-endpoints.txt'), true);
  assert.equal(membership(audit.versions[3]).includes('files/fake/active_discord_udp.bin'), false);
  assert.equal(membership(audit.versions[4]).includes('files/lists/warp-endpoints.txt'), false);
  assert.match(source, /incompatible-manager/);
  assert.match(source, /exact-managed/);
});

test('catalog listing is bounded metadata-only and does not fetch every release manifest', () => {
  assert.match(source, /MAX_VERSIONS\s*=\s*10/);
  assert.match(source, /refs\/tags|git\/refs\/tags/);
  assert.match(source, /resolve_tag_commit/);
  assert.match(source, /objectType/);
  assert.match(source, /objectType\s*==\s*['\"]commit['\"]/);
  assert.doesNotMatch(source.slice(source.indexOf('export const z2k_versions'), source.indexOf('export const z2k_version_details')), /UPDATES\.json/);
});

test('membership audit does not require transactional removals for supported target releases', () => {
  const supported = audit.versions.slice(0, 3).map(item => new Set(membership(item)));
  for (const current of supported) for (const target of supported) {
    assert.deepEqual([...current].sort(), [...target].sort());
  }
});
