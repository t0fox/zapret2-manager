import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const catalog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-legacy-detect.uc'), 'utf8');
const assetRegistry = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'), 'utf8');
const scannerProbe = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc'), 'utf8');

test('active official engine modules use target-compatible regex syntax', () => {
  assert.doesNotMatch(catalog, /\(\?:/);
  assert.doesNotMatch(legacy, /\(\?:/);
});

test('unrelated target ucode modules retain their syntax gate', () => {
  assert.doesNotMatch(assetRegistry, /\(\?:/);
  assert.doesNotMatch(scannerProbe, /\(\?:/);
});
