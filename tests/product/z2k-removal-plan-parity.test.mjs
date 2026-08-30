import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const upstreamPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc');
const versionsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const resourceUpdatePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const upstream = fs.readFileSync(upstreamPath, 'utf8');
const versions = fs.readFileSync(versionsPath, 'utf8');
const resourceUpdate = fs.readFileSync(resourceUpdatePath, 'utf8');
const ucodeBin = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ucodeLib = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const hasUcode = fs.existsSync(ucodeBin);

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-removal-'));
  const classification = path.join(dir, 'classification.json');
  const registry = path.join(dir, 'asset-registry.json');
  const detectorPath = 'files/lua/z2k-detectors.lua';
  const detectorSha = '1'.repeat(64);
  const sourceCommit = '2'.repeat(40);
  fs.writeFileSync(classification, JSON.stringify({
    schema: 'zapret2-manager.z2k-integration.v1',
    files: [
      { sourcePath: 'files/lua/z2k-alert.lua', class: 'exact-managed', type: 'lua', localName: 'z2k-alert.lua', runtimeTarget: '/runtime-assets/lua/z2k-alert.lua' },
      { sourcePath: detectorPath, class: 'exact-managed', type: 'lua', localName: 'z2k-detectors.lua', runtimeTarget: '/runtime-assets/lua/z2k-detectors.lua' },
    ],
  }));
  fs.writeFileSync(registry, JSON.stringify({
    schema: 1,
    revision: 4,
    assets: [{
      schema: 1,
      type: 'lua',
      id: 'lua:z2k-detectors',
      name: 'z2k-detectors.lua',
      ownership: 'manager',
      mutable: true,
      provenance: {
        kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit,
        sourcePath: detectorPath, bundleId: 'z2k-curated-lua', version: 'r-79.7',
      },
      contentSha256: detectorSha,
      byteSize: 1,
      revision: 3,
      path: path.join(dir, 'z2k-detectors.lua'),
      references: [],
      validation: { status: 'passed', errors: [] },
    }],
    activationReceipts: [],
  }));
  return { dir, classification, registry, detectorPath };
}

function invokePlan(sb) {
  const manifest = {
    schema: 1,
    branch: 'z2k-enhanced',
    seq: 48,
    current: 'r-80.3',
    files_sha256: { 'files/lua/z2k-alert.lua': '3'.repeat(64) },
  };
  const program = `import * as mod from ${JSON.stringify(upstreamPath)}; print(sprintf('%J', mod.z2k_upstream_plan(${JSON.stringify(manifest)})));`;
  const result = spawnSync(ucodeBin, ['-L', ucodeLib, '-e', program], {
    cwd: root,
    env: {
      ...process.env,
      Z2M_UPDATE_SOURCE_TEST: '1',
      Z2M_Z2K_CLASSIFICATION_PATH: sb.classification,
      Z2M_ASSET_REGISTRY_STATE: sb.registry,
      LD_LIBRARY_PATH: ucodeLib,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode expression failed`);
  return JSON.parse(result.stdout);
}

test('canonical Z2K plan includes lifecycle removals for assets absent from target membership', { skip: !hasUcode }, () => {
  const sb = fixture();
  const plan = invokePlan(sb);
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.deepEqual(plan.removedItems.map(item => item.sourcePath), [sb.detectorPath]);
  assert.equal(plan.updateState, 'update-available');
});

test('device presentation and prepare consume the same removal-bearing canonical plan', () => {
  assert.match(upstream, /removedItems/);
  assert.match(versions, /targetPlan\.removedItems/);
  assert.match(versions, /device_changes_from_plan\(targetPlan, membership\)/);
  assert.match(resourceUpdate, /let targetPlan = targetGate\.plan/);
  assert.match(resourceUpdate, /z2k_target_removals\(listed, resolved\.assets, classification, targetPlan\)/);
});

test('package baseline rows are filtered by the active Z2K target membership', () => {
  const buildStart = resourceUpdate.indexOf('function build_status');
  const buildEnd = resourceUpdate.indexOf('\nfunction make_stage_root', buildStart);
  assert.ok(buildStart >= 0 && buildEnd > buildStart);
  const build = resourceUpdate.slice(buildStart, buildEnd);
  assert.match(build, /activeZ2KManifest/);
  assert.match(build, /sourceId == 'z2k-resources'/);
  assert.match(build, /sourcePath/);
  assert.match(build, /files_sha256/);
});
