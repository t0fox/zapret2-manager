import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const persistPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
const opsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
const integrationPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json');
const deploymentManifestPath = path.join(root, 'router-deploy-runtime-composition.manifest');

test('Autocircular runtime accepts the canonical state path through the service environment', () => {
  const source = fs.readFileSync(persistPath, 'utf8');
  assert.match(source, /Z2K_STATE_DIR_OVERRIDE/);
  const sync = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh'), 'utf8');
  assert.match(sync, /export Z2K_STATE_DIR_OVERRIDE=.*autocircular/);
  assert.match(sync, /procd_set_param env Z2K_STATE_DIR_OVERRIDE=.*autocircular/);
});

test('Lifecycle-managed Lua remains pinned to its Registry baseline and is not direct-deployed', () => {
  const source = fs.readFileSync(persistPath);
  const integration = JSON.parse(fs.readFileSync(integrationPath, 'utf8'));
  const record = integration.files.find((entry) => entry.sourcePath === 'files/lua/z2k-state-persist.lua');
  assert.ok(record);
  assert.equal(record.class, 'exact-managed');
  assert.equal(record.basedOnSha256, createHash('sha256').update(source).digest('hex'));
  assert.doesNotMatch(fs.readFileSync(deploymentManifestPath, 'utf8'), /z2k-state-persist\.lua\|\/opt\/zapret2\/lua\/z2k-state-persist\.lua/);
});

test('Autocircular control-plane writes keep state readable by nfqws2 daemon', () => {
  const source = fs.readFileSync(opsPath, 'utf8');
  assert.match(source, /chgrp\s+daemon/);
  assert.match(source, /chmod\s+0660/);
});

test('Runtime sync keeps the protected state parent traversable and the leaf shared', () => {
  const source = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh'), 'utf8');
  assert.match(source, /chown root:daemon[\s\S]*STATE_ROOT/);
  assert.match(source, /chmod 0710[\s\S]*STATE_ROOT/);
  assert.match(source, /chmod 0660[\s\S]*STATE_DIR\/state\.tsv/);
});
