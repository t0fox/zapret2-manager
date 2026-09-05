import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const source = fs.readFileSync(modulePath, 'utf8');
const ucode = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const args = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS_JSON
  ? JSON.parse(process.env.UCODE_ARGS_JSON)
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const modulePattern = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const libraryArgs = modulePattern ? ['-L', modulePattern] : [];

function invoke(expression) {
  const source = `import * as subject from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, [...args, ...libraryArgs, '-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([ucode, ...args, ...libraryArgs, '-e', source], modulePattern)}`);
  return JSON.parse(result.stdout);
}

const digest = 'a'.repeat(64);
const closure = {
  available: true,
  resolution: 'complete',
  runtimeBundleDigest: digest,
  counts: { lua: 1, blobs: 2, hostlists: 2, ipsets: 0, dynamic: 1, runtime: 1, builtins: 1, missing: 0 },
  items: [
    { id: 'package:lua', class: 'lua', kind: 'lua', type: 'package-static', owner: 'package', runtimeTarget: '/runtime-assets/lua/package.lua' },
    { id: 'lua:core', class: 'lua', kind: 'lua', type: 'lifecycle-managed', owner: 'z2k-core', runtimeTarget: '/runtime-assets/lua/core.lua' },
    { id: 'blob:list', class: 'hostlist-static', kind: 'hostlist', type: 'lifecycle-managed', owner: 'z2k-core', runtimeTarget: '/runtime-assets/lists/list.txt' },
    { id: 'dynamic:list', class: 'hostlist-dynamic', kind: 'hostlist', type: 'runtime-generated', owner: 'manager', runtimeTarget: '/etc/zapret2-manager/lists/list.txt' },
    { id: 'blob:generated', class: 'blob-runtime', kind: 'blob', type: 'runtime-generated', owner: 'strategy', runtimeTarget: '/runtime-assets/bin/generated.bin' },
    { id: 'blob:builtin', class: 'blob-engine-builtin', kind: 'blob', type: 'engine-builtin', owner: 'nfqws2', runtimeTarget: null },
  ],
};

const local = {
  installed: true,
  integrity: 'verified',
  integrityOk: true,
  installedRelease: { value: 'r-81.6', confidence: 'registry', authority: 'z2k-core' },
  commit: 'c'.repeat(40),
  dependencyClosure: closure,
  runtimeBundleDigest: digest,
  strategyCount: 8,
};
const engine = { installed: true, compatible: true, serviceState: 'running', runtimeRunning: true, ready: true };
const installed = [
  { id: 'lua:core', provenance: { kind: 'catalog/upstream' } },
  { id: 'blob:user', ownership: 'user', provenance: { kind: 'imported' } },
];

test('backend summary exposes one typed runtime reconciliation for Resources and Components', { skip: !fs.existsSync(ucode) }, () => {
  const summary = invoke(`subject.z2k_runtime_summary_projection(${JSON.stringify(local)}, { updateState: 'update-available', canApply: true, advisoryReviews: ['files/lists/new.txt'] }, ${JSON.stringify(engine)}, 1, ${JSON.stringify(installed)})`);
  assert.equal(summary.schema, 'z2m.z2k-runtime-summary.v1');
  assert.deepEqual(summary.counts, closure.counts);
  assert.equal(summary.staticManagedCount, 1);
  assert.deepEqual(summary.reconciliation.partitions, {
    packageStatic: 1,
    lifecycleManaged: 2,
    dynamic: 1,
    runtimeGenerated: 1,
    engineBuiltins: 1,
    user: 1,
  });
  assert.deepEqual(summary.reconciliation.duplicateRuntimeAssets, []);
  assert.deepEqual(summary.reconciliation.ownerConflicts, []);
  assert.equal(summary.reconciliation.uniqueRuntimeOwner, true);
  assert.equal(summary.health, 'ready');
  assert.equal(summary.canApply, true, 'advisory/unknown files must not block apply');
  assert.equal(summary.attentionState, 'review-advisory');
});

test('consumed unresolved and adapted/rebase evidence remain blocking in the canonical summary', { skip: !fs.existsSync(ucode) }, () => {
  const blocking = invoke(`subject.z2k_runtime_summary_projection(${JSON.stringify(local)}, { updateState: 'update-available', canApply: true, blockingReviews: ['files/lists/sni_wl_candidates.txt'], rebases: ['files/lists/tcp16_targets.txt'] }, ${JSON.stringify(engine)}, 1, ${JSON.stringify(installed)})`);
  assert.equal(blocking.canApply, false);
  assert.equal(blocking.attentionState, 'rebase-required');
  assert.deepEqual(blocking.blockingReviews, ['files/lists/sni_wl_candidates.txt']);
  assert.deepEqual(blocking.rebases, ['files/lists/tcp16_targets.txt']);
});

test('closure availability and digest are readiness gates independent of Lua totals', { skip: !fs.existsSync(ucode) }, () => {
  const brokenClosure = { ...closure, available: false, counts: { ...closure.counts, missing: 1 } };
  const broken = invoke(`subject.z2k_runtime_summary_projection(${JSON.stringify({ ...local, dependencyClosure: brokenClosure })}, { updateState: 'current', canApply: false }, ${JSON.stringify(engine)}, 1, ${JSON.stringify(installed)})`);
  assert.equal(broken.health, 'degraded');
  assert.equal(broken.identity.coherent, false);
  assert.equal(broken.counts.missing, 1);

  const mismatched = invoke(`subject.z2k_runtime_summary_projection(${JSON.stringify({ ...local, runtimeBundleDigest: 'b'.repeat(64) })}, { updateState: 'current', canApply: false }, ${JSON.stringify(engine)}, 1, ${JSON.stringify(installed)})`);
  assert.equal(mismatched.health, 'degraded');
  assert.equal(mismatched.identity.coherent, false);
});

test('missing Engine cannot project a stale Z2K installed release from the Registry', { skip: !fs.existsSync(ucode) }, () => {
  const engineMissing = { installed: false, compatible: false, serviceState: 'engine_missing', runtimeRunning: false, ready: false };
  const summary = invoke(`subject.z2k_runtime_summary_projection(${JSON.stringify(local)}, { updateState: 'unknown', canApply: false }, ${JSON.stringify(engineMissing)}, 0, ${JSON.stringify(installed)})`);
  assert.equal(summary.health, 'missing');
  assert.deepEqual(summary.installedRelease, { value: null, confidence: 'unknown', authority: null });
});

test('runtime summary gates its installed release on Engine readiness', () => {
  assert.match(source, /installedRelease:\s*engineReady\s*\?/);
});
