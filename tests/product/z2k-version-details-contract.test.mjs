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
  assert.match(source, /function human_body\s*\(/);
  assert.match(source, /function fallback_body\s*\(/);
  assert.match(source, /Изменено/);
  assert.match(source, /Добавлено/);
  assert.match(source, /Удалено/);
  assert.match(source, /releaseBody:\s*body/);
});

test('lazy detail diff is derived from exact-managed membership only', () => {
  assert.match(source, /function changes_between\s*\(/);
  assert.match(source, /managedPaths:\s*changeSet\.managedPaths/);
  assert.match(source, /sourcePath:\s*path/);
  assert.doesNotMatch(source, /z2k-config-validator\.sh.*managedPaths/);
});

test('release details expose immutable compare identity without leaking raw internals as copy', () => {
  assert.match(source, /compareUrl:\s*previousVersion\s*\?/);
  assert.match(source, /manifestSha256:\s*checked\.manifestSha256/);
  assert.match(source, /commitSha:\s*row\.commitSha/);
  assert.doesNotMatch(source, /releaseBody:\s*.*planToken/);
});

test('transient tag resolution cannot poison a usable immutable catalog cache', () => {
  assert.match(source, /read_cache\(\)/);
  assert.match(source, /cached.*commitSha|commitSha.*cached/);
  assert.match(source, /stale/);
  assert.doesNotMatch(source, /save_cache\(result\); return result;/);
});
