import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const registry = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'), 'utf8');
const coordinator = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
const authority = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc'), 'utf8');

test('Asset Registry exposes bounded activation receipts as the installed-release authority', () => {
  assert.match(registry, /activationReceipts/);
  assert.match(registry, /asset-activation-receipt\.v1/);
  assert.match(registry, /activatedAt/);
  assert.match(registry, /sourceCommit/);
  assert.match(registry, /return \{ ok: true, schema: 1, revision: state\.revision, assets: assets, activationReceipts:/);
});

test('Z2K local projection prefers a receipt, then reports bounded inference confidence', () => {
  assert.match(coordinator, /z2k_registry_installed_release/);
  assert.match(authority, /activation-receipt/);
  assert.match(coordinator, /known-manifest/);
  assert.match(coordinator, /inconsistent/);
  assert.match(coordinator, /installedRelease\s*:/);
  assert.match(authority, /confidence/);
});

test('technical source commits remain separate from installed release identity', () => {
  const projection = coordinator.slice(coordinator.indexOf('function z2k_local_projection'), coordinator.indexOf('function load_check_state'));
  assert.match(projection, /commit:/);
  assert.match(projection, /installedRelease:/);
  assert.match(projection, /provenance:/);
});

test('Engine RPC projections expose the same independent truth fields as the UI model', () => {
  assert.match(engine, /function canonical_engine_releases\s*\(/);
  assert.match(engine, /answer\.installed\s*=\s*\{ version:/);
  assert.match(engine, /answer\.available\s*=\s*\{ version:/);
  assert.match(engine, /answer\.updateState\s*=\s*latest == null \? 'unknown'/);
  assert.match(engine, /function canonical_engine_check\s*\(/);
  assert.match(engine, /answer\.compatibility\s*=\s*\{ state:/);
  assert.match(engine, /export const engine_check_release = function \(input\) \{ return canonical_engine_check\(input\); \}/);
});
