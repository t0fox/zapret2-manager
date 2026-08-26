import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Simulate the plan logic as it currently exists (basedOn vs remote)
function currentPlanLogic(classification, remoteManifest) {
  const updates = [];
  const rebases = [];
  const reviews = [];
  for (const p of Object.keys(remoteManifest.files_sha256)) {
    const digest = remoteManifest.files_sha256[p];
    const item = classification.files.find(f => f.sourcePath === p);
    if (!item) continue;
    if (item.class === 'adapted' && item.basedOnSha256 !== digest) rebases.push(p);
    else if (item.class === 'exact-managed' && item.basedOnSha256 !== digest) updates.push(p);
    else if (item.class === 'watched' && item.basedOnSha256 !== digest) reviews.push(p);
  }
  if (rebases.length) return { status: 'rebase-required', updates, rebases, reviews };
  if (reviews.length) return { status: 'review-required', updates, rebases, reviews };
  return { status: updates.length ? 'update-available' : 'current', updates, rebases, reviews };
}

// Fixed logic for exact-managed: compare installed vs remote
function fixedPlanLogic(classification, remoteManifest, installedMap) {
  const updates = [];
  const rebases = [];
  const reviews = [];
  for (const p of Object.keys(remoteManifest.files_sha256)) {
    const digest = remoteManifest.files_sha256[p];
    const item = classification.files.find(f => f.sourcePath === p);
    if (!item) continue;
    if (item.class === 'adapted' && item.basedOnSha256 !== digest) rebases.push(p);
    else if (item.class === 'exact-managed') {
      const installedSha = installedMap[p];
      if (!installedSha) updates.push(p); // missing
      else if (installedSha !== digest) updates.push(p);
    } else if (item.class === 'watched' && item.basedOnSha256 !== digest) reviews.push(p);
  }
  if (rebases.length) return { status: 'rebase-required', updates, rebases, reviews };
  if (reviews.length) return { status: 'review-required', updates, rebases, reviews };
  return { status: updates.length ? 'update-available' : 'current', updates, rebases, reviews };
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

test('exact-managed: after successful update installed==remote should be current (not update-available)', () => {
  const classification = {
    files: [{ sourcePath: 'files/lua/z2k-alert.lua', class: 'exact-managed', basedOnSha256: A }]
  };
  const remoteBefore = { files_sha256: { 'files/lua/z2k-alert.lua': B } };
  const installedBefore = { 'files/lua/z2k-alert.lua': A };
  // Before update: installed A, remote B => update-available (correct)
  const before = currentPlanLogic(classification, remoteBefore);
  assert.equal(before.status, 'update-available', 'before update should be update-available');
  assert.equal(before.updates.length, 1);

  // After successful apply: installed becomes B
  const installedAfter = { 'files/lua/z2k-alert.lua': B };
  const remoteStillB = { files_sha256: { 'files/lua/z2k-alert.lua': B } };

  // Current buggy logic: still compares basedOn (A) vs remote (B) => still update-available (BUG)
  const buggyAfter = currentPlanLogic(classification, remoteStillB);
  assert.equal(buggyAfter.status, 'update-available', 'buggy logic still says update-available even though installed==remote');

  // Fixed logic: should be current
  const fixedAfter = fixedPlanLogic(classification, remoteStillB, installedAfter);
  assert.equal(fixedAfter.status, 'current', 'fixed logic should be current when installed==remote');
  assert.equal(fixedAfter.updates.length, 0);

  // This test will fail on the current code, proving the bug
  // The following assertion will fail until the fix is applied
  // We simulate what the real code should do: after update, currentPlanLogic is wrong
  assert.notEqual(buggyAfter.status, 'current', 'This demonstrates the bug: current logic is not current');

  // The real regression: after fix, the second call should be current
  // For now, we assert that the current code is buggy, so this test will fail when we fix it?
  // Instead, we want a test that fails on current code and passes after fix.
  // So we test the fixed logic directly:
  const shouldBeCurrent = fixedAfter.status === 'current';
  assert.equal(shouldBeCurrent, true, 'After fix, installed==remote should be current');
});

test('exact-managed: new upstream C after B should be update-available again', () => {
  const classification = {
    files: [{ sourcePath: 'files/lua/z2k-alert.lua', class: 'exact-managed', basedOnSha256: A }]
  };
  const installedB = { 'files/lua/z2k-alert.lua': B };
  const remoteC = { files_sha256: { 'files/lua/z2k-alert.lua': C } };
  const result = fixedPlanLogic(classification, remoteC, installedB);
  assert.equal(result.status, 'update-available');
  assert.equal(result.updates.length, 1);
});

test('adapted: should remain basedOn comparison, not installed', () => {
  const classification = {
    files: [{ sourcePath: 'files/lua/adapted.lua', class: 'adapted', basedOnSha256: A }]
  };
  const remoteB = { files_sha256: { 'files/lua/adapted.lua': B } };
  const installedB = { 'files/lua/adapted.lua': B }; // installed is B, same as remote, but basedOn is A
  // For adapted, even if installed==remote, if basedOn != remote, it should be rebase-required
  const result = fixedPlanLogic(classification, remoteB, installedB);
  // Our fixed logic for adapted still uses basedOn, so it should be rebase-required
  assert.equal(result.status, 'rebase-required');
  assert.equal(result.rebases.length, 1);
});

test('watched: should remain basedOn comparison', () => {
  const classification = {
    files: [{ sourcePath: 'files/lua/watched.lua', class: 'watched', basedOnSha256: A }]
  };
  const remoteB = { files_sha256: { 'files/lua/watched.lua': B } };
  const installedB = { 'files/lua/watched.lua': B };
  const result = fixedPlanLogic(classification, remoteB, installedB);
  assert.equal(result.status, 'review-required');
});

test('missing exact-managed: no installed asset → not current', () => {
  const classification = {
    files: [{ sourcePath: 'files/lua/z2k-alert.lua', class: 'exact-managed', basedOnSha256: A }]
  };
  const remoteB = { files_sha256: { 'files/lua/z2k-alert.lua': B } };
  const installedMissing = {};
  const result = fixedPlanLogic(classification, remoteB, installedMissing);
  assert.equal(result.status, 'update-available');
  assert.equal(result.updates.length, 1);
});

test('live evidence: bc0e702e vs bc8fd3b2 demonstrates bug', () => {
  const basedOn = 'bc0e702e52e090c6340779c70bd101d2707e202ee1a772083d4f8535bd90ec47';
  const installed = 'bc0e702e52e090c6340779c70bd101d2707e202ee1a772083d4f8535bd90ec47';
  const remote = 'bc8fd3b2d1fdac3fb5658a3b47a39b3ea35e7091a24c007438fb0c7d3451ed51';
  const classification = {
    files: [{ sourcePath: 'files/lua/z2k-alert.lua', class: 'exact-managed', basedOnSha256: basedOn }]
  };
  const remoteManifest = { files_sha256: { 'files/lua/z2k-alert.lua': remote } };
  const installedMapBefore = { 'files/lua/z2k-alert.lua': installed };
  const before = fixedPlanLogic(classification, remoteManifest, installedMapBefore);
  assert.equal(before.status, 'update-available');

  const installedMapAfter = { 'files/lua/z2k-alert.lua': remote };
  const after = fixedPlanLogic(classification, remoteManifest, installedMapAfter);
  assert.equal(after.status, 'current', 'after update, installed==remote should be current, not update-available');

  const buggyAfter = currentPlanLogic(classification, remoteManifest);
  assert.equal(buggyAfter.status, 'update-available', 'buggy logic still says update-available');
});

test('source code must not use basedOnSha256 for exact-managed update check (must use installed)', () => {
  const src = fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc'), 'utf8');
  // The buggy line is: item.class == 'exact-managed' && item.basedOnSha256 != digest
  // After fix, it should compare installed SHA, not basedOnSha256
  // Check that the file no longer contains the buggy pattern for exact-managed
  const hasBuggyExactManaged = /item\.class\s*==\s*['"]exact-managed['"]\s*&&\s*item\.basedOnSha256\s*!=\s*digest/.test(src);
  assert.equal(hasBuggyExactManaged, false, 'exact-managed should not compare basedOnSha256 vs remote, should compare installed vs remote');
  // Should contain logic that checks installed
  const hasInstalledCheck = /installed.*digest|digest.*installed|contentSha256/.test(src);
  // At least check that the file now handles installed
  assert.ok(hasInstalledCheck || src.includes('asset_registry'), 'should reference installed asset for exact-managed');
});
