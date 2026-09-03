import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const upstream = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc'), 'utf8');
const resourceUpdate = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');

test('watched upstream changes produce an actionable review detail', () => {
  assert.match(upstream, /klass == 'watched' && item\.basedOnSha256 != digest/);
  assert.match(upstream, /reason: 'watched-upstream-file-changed'/);
  assert.match(upstream, /Z2M не устанавливает его автоматически/);
});

test('resource status/check projection preserves upstream review details', () => {
  assert.match(resourceUpdate, /reviewDetails: plan\.reviewDetails \|\| \[\]/);
});

test('Z2K revision validator returns a boolean for strict metadata validation', () => {
  assert.match(upstream, /function valid_commit\(value\) \{[\s\S]*match\(lc\(value\), \/\^\[a-f0-9\]\{40\}\$\/\) != null;/);
});
