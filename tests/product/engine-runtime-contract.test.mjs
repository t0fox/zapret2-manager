import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const remittor = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/providers/remittor.uc',
  'utf8',
);
const assetRegistry = fs.readFileSync(path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'), 'utf8');
const scannerProbe = fs.readFileSync(path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-executor.uc'), 'utf8');

test('Remittor provider uses regex syntax accepted by the target ucode runtime', () => {
  assert.doesNotMatch(
    remittor,
    /\(\?:/,
    'target ucode rejects non-capturing groups while loading engine status',
  );
});

test('target ucode modules avoid unsupported non-capturing regex groups', () => {
  assert.doesNotMatch(assetRegistry, /\(\?:/);
  assert.doesNotMatch(scannerProbe, /\(\?:/);
});
