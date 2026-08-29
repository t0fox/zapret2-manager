import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const source = fs.readFileSync(modulePath, 'utf8');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const hasUcode = fs.existsSync(ucodeBin);

const map = {
  files: [
    { sourcePath: 'files/lua/z2k-modern-core.lua', class: 'exact-managed', type: 'lua', localName: 'runtime-assets/lua/z2k-modern-core.lua' },
    { sourcePath: 'files/fake/added.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/added.bin' },
    { sourcePath: 'files/fake/removed.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/removed.bin' },
    { sourcePath: 'files/fake/active.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/active.bin' },
    { sourcePath: 'files/init.d/S51z2k-warp', class: 'watched-only', type: 'sh', localName: 'init.d/S51z2k-warp' },
    { sourcePath: 'mtproxy-client/client.bin', class: 'watched-only', type: 'bin', localName: 'mtproxy-client/client.bin' },
    { sourcePath: 'webpanel/www/index.html', class: 'watched-only', type: 'html', localName: 'webpanel/www/index.html' },
  ],
};

const installed = { files_sha256: {
  'files/lua/z2k-modern-core.lua': '1'.repeat(64),
  'files/fake/removed.bin': '2'.repeat(64),
  'files/fake/active.bin': '3'.repeat(64),
  'files/init.d/S51z2k-warp': '4'.repeat(64),
  'mtproxy-client/client.bin': '5'.repeat(64),
  'webpanel/www/index.html': '6'.repeat(64),
} };
const selected = { files_sha256: {
  'files/lua/z2k-modern-core.lua': '7'.repeat(64),
  'files/fake/added.bin': '8'.repeat(64),
  'files/fake/active.bin': '3'.repeat(64),
  'files/init.d/S51z2k-warp': '9'.repeat(64),
  'mtproxy-client/client.bin': 'a'.repeat(64),
  'webpanel/www/index.html': 'b'.repeat(64),
} };

function invokeDelta() {
  const expression = `mod.z2k_managed_delta(${JSON.stringify(selected)}, ${JSON.stringify(installed)}, ${JSON.stringify(map)})`;
  const program = `import * as mod from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucodeBin, ['-e', program], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('managed delta groups only exact-managed changes and preserves removed identity', { skip: !hasUcode }, () => {
  const delta = invokeDelta();

  assert.equal(delta.known, true);
  assert.equal(delta.modified, 1);
  assert.equal(delta.added, 1);
  assert.equal(delta.removed, 1);
  assert.deepEqual(delta.modifiedPaths, ['files/lua/z2k-modern-core.lua']);
  assert.deepEqual(delta.addedPaths, ['files/fake/added.bin']);
  assert.deepEqual(delta.removedPaths, ['files/fake/removed.bin']);
  assert.equal(delta.modifiedItems.length, delta.modified);
  assert.equal(delta.addedItems.length, delta.added);
  assert.equal(delta.removedItems.length, delta.removed);
  assert.deepEqual(delta.removedItems[0], {
    id: 'blob:removed',
    name: 'runtime-assets/bin/removed.bin',
    sourcePath: 'files/fake/removed.bin',
    type: 'blob',
  });
  assert.deepEqual(delta.managedPaths, [
    'files/fake/added.bin',
    'files/fake/removed.bin',
    'files/lua/z2k-modern-core.lua',
  ]);
  assert.doesNotMatch(JSON.stringify(delta), /S51z2k-warp|mtproxy-client|webpanel/);
});

test('managed delta export remains a pure comparison helper', () => {
  assert.match(source, /function changes_between\s*\(/);
  assert.match(source, /export const z2k_managed_delta\s*=\s*function/);
  assert.match(source, /modifiedItems/);
  assert.match(source, /addedItems/);
  assert.match(source, /removedItems/);
});
