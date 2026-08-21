import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const classification = JSON.parse(fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/z2k-signed-update/UPDATES.json'), 'utf8'));

test('every accepted Z2K manifest path has exactly one explicit classification', () => {
  const expected = Object.keys(manifest.files_sha256).sort();
  const actual = classification.files.map(item => item.sourcePath).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  const classes = new Set(['exact-managed', 'adapted', 'watched', 'ignored-platform']);
  for (const item of classification.files) assert.ok(classes.has(item.class), item.sourcePath);
  assert.equal(classification.manifestFileCount, expected.length);
});

test('adapted and ignored Z2K files cannot be treated as raw managed assets', () => {
  const state = classification.files.find(item => item.sourcePath === 'files/lua/z2k-state-persist.lua');
  assert.equal(state.class, 'adapted');
  assert.ok(state.localSha256);
  const platform = classification.files.find(item => item.sourcePath.startsWith('files/init.d/'));
  assert.equal(platform.class, 'ignored-platform');
});
