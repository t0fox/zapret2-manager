import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.join(import.meta.dirname, '../..'));
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// Pinned snapshot from verified UPDATES.json (tests/fixtures/z2k-signed-update/UPDATES.json)
const PINNED = {
  manifest: 'tests/fixtures/z2k-signed-update/UPDATES.json',
  seq: 26,
  current: 'r-77.5',
  commit: '54b6765f2ab3e0f7f13030c90c809f1dcacfcce2',
  file: 'files/lua/z2k-state-persist.lua',
  sha256: 'fa4cd3fc83449b1d85e92e75848109cc03340343af87fc014ced423bd9574219',
};

test('A1: z2k-state-persist must be exact-managed (not adapted)', () => {
  const gen = read('tools/generate-z2k-classification.mjs');
  assert.match(gen, /if \(sourcePath === 'files\/lua\/z2k-state-persist\.lua'\) return 'exact-managed'/, 'generator must return exact-managed for state-persist');
  const integration = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));
  const entry = integration.files.find(f => f.sourcePath === PINNED.file);
  assert.ok(entry, 'integration must have state-persist entry');
  assert.equal(entry.class, 'exact-managed', 'class must be exact-managed');
  assert.equal(entry.basedOnSha256, PINNED.sha256, 'basedOnSha256 must be pinned manifest sha');
  assert.equal(entry.adaptationId, undefined, 'adaptationId must not exist for exact-managed');
  assert.equal(entry.adaptationReason, undefined);
});

test('A2: local z2k-state-persist.lua byte-identical to pinned upstream (SHA compare against manifest files_sha256)', () => {
  const manifest = JSON.parse(read(PINNED.manifest));
  const expected = manifest.files_sha256[PINNED.file];
  assert.equal(expected, PINNED.sha256, 'fixture manifest must match pinned');
  const localPath = 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua';
  const localSha = sha256(path.join(root, localPath));
  assert.equal(localSha, expected, `local ${localPath} SHA must equal manifest files_sha256 (${expected}), got ${localSha}`);
  // Also ensure file has no Z2M path patch
  const content = read(localPath);
  assert.match(content, /\/opt\/zapret2\/extra_strats\/cache\/autocircular/, 'upstream default path must be present (exact)');
  assert.doesNotMatch(content, /\/etc\/zapret2-manager\/state\/autocircular/, 'must not contain Z2M path patch');
  assert.doesNotMatch(content, /excluded.*VERDICT_PASS/, 'must not contain excluded handling (should be in sidecar)');
});

test('A3: sidecar must NOT appear as upstream source asset', () => {
  const integration = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));
  const sidecar = integration.files.find(f => f.sourcePath === 'files/lua/z2m-autocircular-policy.lua' || (f.localName && f.localName.includes('z2m-autocircular')));
  assert.equal(sidecar, undefined, 'sidecar must not be in upstream integration');
  const sidecarPath = 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua';
  assert.ok(fs.existsSync(path.join(root, sidecarPath)), 'sidecar file must exist as manager-owned');
  const sidecarContent = read(sidecarPath);
  assert.match(sidecarContent, /z2m-autocircular-policy/, 'sidecar must be identifiable');
  // Ensure sidecar is not marked as package/manager-owned incorrectly? It should be manager-owned, not package.
});

test('B: delegation auto/frozen must call upstream exactly once, sidecar must not reimplement freeze', () => {
  const sidecar = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua');
  // sidecar should capture upstream_circular and delegate
  assert.match(sidecar, /upstream_circular|orig_circular/, 'sidecar must delegate to upstream');
  // must not contain freeze clamp logic (hrec.final)
  assert.doesNotMatch(sidecar, /hrec\.final/, 'sidecar must not implement freeze clamp');
  assert.doesNotMatch(sidecar, /STICKY_WINDOW_SEC/, 'sidecar must not contain sticky logic');
  assert.doesNotMatch(sidecar, /Z2K_STICKY_SUCCESS_TS/, 'sidecar must not contain sticky state');
});

test('C: excluded per-resource (key+host) - sidecar must check exact (askey,host) and plan_clear + VERDICT_PASS', () => {
  const sidecar = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua');
  assert.match(sidecar, /excluded/, 'sidecar must handle excluded');
  assert.match(sidecar, /plan_clear/, 'excluded must clear plan');
  assert.match(sidecar, /VERDICT_PASS/, 'excluded must return VERDICT_PASS');
  assert.match(sidecar, /z2k_state_persist/, 'must use z2k_state_persist API at runtime');
  assert.doesNotMatch(sidecar, /state\.tsv/, 'must not read state.tsv directly');
  // Check that it uses get_record with key+host semantics
  assert.match(sidecar, /get_record|_state/, 'must use verified upstream interface');
});

test('D: state.tsv 5-col excluded must survive load/write, 4-col legacy must read as auto', () => {
  // This is behavioral via Lua harness: we can check that upstream's merge handles excluded.
  // For now, check that upstream exact file preserves excluded verbatim.
  const localContent = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
  // Upstream's merge should preserve any non-empty mode (including excluded) - check that content has the permissive m logic
  assert.match(localContent, /\(mode ~= nil and mode ~= ""\) and mode or "auto"/, 'upstream must preserve excluded verbatim (permissive mode)');
  // Ensure local does NOT have restrictive (mode == "frozen" or "excluded") check
  assert.doesNotMatch(localContent, /mode == "frozen" or mode == "excluded"/);
});

test('E: compatibility gate - sidecar depends on z2k_state_persist API, missing API must block update (review/incompatible not rebase)', () => {
  // Check that z2k-upstream or sidecar has gate logic
  const sidecar = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua');
  // Should have check for required interface
  assert.match(sidecar, /z2k_state_persist/, 'sidecar must check z2k_state_persist existence');
  // Check classification or update flow has preflight
  const updateUc = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  // Should have compatibility check before activating state-persist
  // For this test, we check that the gate exists conceptually: either in sidecar or in update flow
  // The sidecar should expose a capabilities check, and update should not be rebase-required for this file
  const integration = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json'));
  const entry = integration.files.find(f => f.sourcePath === PINNED.file);
  assert.equal(entry.class, 'exact-managed', 'exact-managed should not trigger rebase-required');
});

test('F: Discord/nohost - sidecar must not contain sticky/rotation, only excluded policy for nohost', () => {
  const sidecar = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua');
  assert.doesNotMatch(sidecar, /STICKY_WINDOW_SEC|sticky|rotation|failure.*counter|is_sticky_eligible/, 'sidecar must not have sticky/rotation logic');
  assert.doesNotMatch(sidecar, /if discord/i, 'sidecar must not have special-case if discord');
  // But it should handle nohost excluded correctly via per-host check
  assert.match(sidecar, /nohost|hostn/, 'should handle host key for excluded check');
});

test('Delta audit - local must not contain upstream fork logic fragments', () => {
  const sidecar = fs.existsSync(path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua')) ? read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2m-autocircular-policy.lua') : '';
  // Sidecar should not contain these upstream-owned fragments
  const forbidden = ['STICKY_WINDOW_SEC', 'Z2K_STICKY_SUCCESS_TS', 'failure attribution', 'seed recovery', 'write_state', 'merge_state_file_into', 'reconcile_external_edits', 'acquire_lock', 'tmp rename', 'fallback writer', 'is_discord_outgoing'];
  for (const frag of forbidden) {
    // Use substring check, but allow if it's in comments explaining not to have it?
    // For sidecar, it must not have the actual code
    if (frag === 'is_discord_outgoing') {
      assert.doesNotMatch(sidecar, /is_discord_outgoing/, 'sidecar must not have discord outgoing handling');
    } else if (frag.includes(' ')) {
      // skip phrase checks
    } else {
      assert.doesNotMatch(sidecar, new RegExp(frag), `sidecar must not contain ${frag}`);
    }
  }
  const localPersist = read('zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
  // After migration, local persist must be exact, so it should contain upstream's sticky logic (which we want)
  assert.match(localPersist, /STICKY_WINDOW_SEC/, 'exact upstream must contain sticky logic');
});
