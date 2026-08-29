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
    { sourcePath: 'files/lua/example.lua', class: 'exact-managed', type: 'lua', localName: 'runtime-assets/lua/example.lua' },
    { sourcePath: 'files/fake/example.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/example.bin' },
    { sourcePath: 'files/fake/removed.bin', class: 'exact-managed', type: 'bin', localName: 'runtime-assets/bin/removed.bin' },
  ],
};

const installed = { files_sha256: {
  'files/lua/example.lua': '1'.repeat(64),
  'files/fake/removed.bin': '2'.repeat(64),
} };

const selected = { files_sha256: {
  'files/lua/example.lua': '3'.repeat(64),
  'files/fake/example.bin': '4'.repeat(64),
}, changes: {
  'files/lua/example.lua': { action: 'modified', summary: 'Immutable fixture explanation' },
} };

const historical = {
  schema: 1,
  releases: {
    'r-80.3': {
      commit: 'a'.repeat(40),
      changes: {
        'files/fake/example.bin': { action: 'added', summary: 'Repository fixture explanation XYZ' },
        'files/fake/removed.bin': { action: 'removed', summary: 'Removed by repository fixture' },
      },
    },
  },
};

function invoke(selectedManifest = selected, index = historical, version = 'r-80.3', commit = 'a'.repeat(40)) {
  const expression = `mod.z2k_explain_managed_delta(${JSON.stringify(selectedManifest)}, ${JSON.stringify(installed)}, ${JSON.stringify(map)}, ${JSON.stringify(version)}, ${JSON.stringify(commit)}, ${JSON.stringify(index)})`;
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

test('repository and immutable summaries are projected onto exact managed delta items', { skip: !hasUcode }, () => {
  const delta = invoke();
  assert.equal(delta.modifiedItems[0].summary, 'Immutable fixture explanation');
  assert.equal(delta.modifiedItems[0].summarySource, 'immutable-manifest');
  assert.equal(delta.addedItems[0].summary, 'Repository fixture explanation XYZ');
  assert.equal(delta.addedItems[0].summarySource, 'repository-index');
  assert.equal(delta.removedItems[0].summary, 'Removed by repository fixture');
  assert.equal(delta.removedItems[0].summarySource, 'repository-index');
});

test('mismatched repository identity, path, action, and oversized summaries fail closed to fallback', { skip: !hasUcode }, () => {
  const wrongCommit = invoke(selected, historical, 'r-80.3', 'b'.repeat(40));
  assert.equal(wrongCommit.addedItems[0].summary, null);
  assert.equal(wrongCommit.addedItems[0].summarySource, null);

  const wrongAction = structuredClone(historical);
  wrongAction.releases['r-80.3'].changes['files/fake/example.bin'].action = 'modified';
  const actionMismatch = invoke(selected, wrongAction);
  assert.equal(actionMismatch.addedItems[0].summary, null);

  const wrongPath = structuredClone(historical);
  wrongPath.releases['r-80.3'].changes = { 'files/fake/other.bin': { action: 'added', summary: 'wrong path' } };
  const pathMismatch = invoke(selected, wrongPath);
  assert.equal(pathMismatch.addedItems[0].summary, null);

  const tooLong = structuredClone(historical);
  tooLong.releases['r-80.3'].changes['files/fake/example.bin'].summary = 'x'.repeat(1001);
  const overlong = invoke(selected, tooLong);
  assert.equal(overlong.addedItems[0].summary, null);
});

test('Manager owns transport/cache and never embeds historical per-file reasons', () => {
  assert.match(source, /raw\.githubusercontent\.com\/\' \+ REPOSITORY/);
  assert.match(source, /update-cache/);
  assert.match(source, /MAX_RELEASE_CHANGES|256 \* 1024/);
  assert.match(source, /MAX_CHANGE_CACHE|512 \* 1024/);
  assert.match(source, /fetch_text\(RELEASE_CHANGES_URL, MAX_RELEASE_CHANGES, 'z2m-z2k-changes', false\)/);
  assert.doesNotMatch(source, /\/etc\/.*release-changes/);
  assert.match(source, /summarySource/);
  assert.doesNotMatch(source, /bad identifier|дублировал tls_clienthello|1858 строк/);
});

test('metadata remains display-only and target planning is computed independently', () => {
  assert.match(source, /let targetPlan = z2k_upstream_plan\(checked\.manifest\)/);
  assert.match(source, /installChangeSet = changes_between\(/);
  assert.match(source, /targetCanApply = targetPlan\.ok === true/);
  assert.match(source, /fetch_release_change_index|historical_change/);
});
