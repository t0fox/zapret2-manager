import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
const source = fs.readFileSync(
  path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc'),
  'utf8',
);

test('release details use the upstream human release body and deterministic fallback counts', () => {
  assert.match(source, /function manifest_body\s*\(/);
  assert.match(source, /manifest && manifest\.history/);
  assert.match(source, /function human_body\s*\(/);
  assert.match(source, /function fallback_body\s*\(/);
  assert.match(source, /Изменено/);
  assert.match(source, /Добавлено/);
  assert.match(source, /Удалено/);
  assert.match(source, /releaseBody:\s*body/);
});

test('lazy install diff is derived from exact-managed membership only', () => {
  assert.match(source, /function changes_between\s*\(/);
  assert.match(source, /managedPaths:\s*(?:releaseChangeSet|installChangeSet)\.managedPaths/);
  assert.match(source, /sourcePath:\s*path/);
  assert.match(source, /function release_changes_between\s*\(/);
});

test('release and install diffs are explicit and compare against different baselines', () => {
  assert.match(source, /let installedRow = target_release\(installedVersion, catalog\.versions\)/);
  assert.match(source, /let installedManifest = null/);
  assert.match(source, /let releaseChangeSet = release_changes_between\(checked\.manifest, previousManifest\)/);
  assert.match(source, /installChangeSet = changes_between\(checked\.manifest, installedManifest, map\)/);
  assert.match(source, /body = manifest_body\(checked\.manifest, version\) \|\| human_body\(metadata && metadata\.message\) \|\| \(releaseChangeSet\.known \? fallback_body\(releaseChangeSet\) : null\)/);
  assert.match(source, /releaseChanges:/);
  assert.match(source, /installChanges:/);
});

test('release details expose immutable compare identity without leaking raw internals as copy', () => {
  assert.match(source, /compareUrl:\s*previousVersion\s*\?/);
  assert.match(source, /manifestSha256:\s*checked\.manifestSha256/);
  assert.match(source, /commitSha:\s*row\.commitSha/);
  assert.doesNotMatch(source, /releaseBody:\s*.*planToken/);
});

test('release details expose the operation relative to the confirmed installed release', () => {
  assert.match(source, /function target_operation\s*\(/);
  assert.match(source, /release_compare\(\{ version: version \}, \{ version: installed \}\)/);
  assert.match(source, /comparison < 0 \? 'upgrade' : \(comparison > 0 \? 'downgrade' : 'reinstall'\)/);
  assert.match(source, /operation:\s*operation/);
  assert.match(source, /installedVersion:\s*installedVersion/);
});

test('installChanges exposes grouped managed resource identities without replacing upstream release history', () => {
  assert.match(source, /export const z2k_managed_delta\s*=\s*function/);
  assert.match(source, /modifiedPaths:/);
  assert.match(source, /addedPaths:/);
  assert.match(source, /removedPaths:/);
  assert.match(source, /modifiedItems:/);
  assert.match(source, /addedItems:/);
  assert.match(source, /removedItems:/);
  assert.match(source, /releaseChangeSet\.changedPaths/);
  assert.match(source, /installChangeSet\.modifiedItems/);
});

test('transient tag resolution cannot poison a usable immutable catalog cache', () => {
  assert.match(source, /read_cache\(\)/);
  assert.match(source, /cached.*commitSha|commitSha.*cached/);
  assert.match(source, /stale/);
  assert.doesNotMatch(source, /save_cache\(result\); return result;/);
});

test('non-fresh catalog browse consumes warm volatile cache before network', () => {
  assert.match(source, /function cached_result\s*\(/);
  assert.match(source, /if \(!fresh && cached != null\) return cached_result\(cached, installed\)/);
  assert.match(source, /diagnostics: \{ requestCount: REQUEST_COUNT, cache: 'warm'/);
  assert.match(source, /z2k_resolve_tag_fresh\s*\(/);
});
