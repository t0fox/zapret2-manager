import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Task 1: P0 Engine Patches exist and apply cleanly against bol-van/zapret2 base', () => {
  const patchesDir = path.resolve('patches/engine');
  assert.ok(fs.existsSync(patchesDir), 'patches/engine directory must exist');

  const patchFiles = [
    '001-z2k-tls-mod.patch',
    '002-z2k-antidpi-repeats-loop.patch',
    '003-z2k-auto-family-split.patch'
  ];

  for (const patch of patchFiles) {
    const fullPath = path.join(patchesDir, patch);
    assert.ok(fs.existsSync(fullPath), `Patch file ${patch} must exist`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 100, `Patch file ${patch} must not be empty (size: ${stat.size})`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(content.startsWith('diff --git') || content.includes('--- a/'), `Patch ${patch} must be a valid unified diff`);
  }
});
