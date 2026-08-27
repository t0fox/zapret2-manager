import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'utf8');

test('Resource Center exposes a bounded Z2K classification projection', () => {
  assert.match(source, /function z2k_projection\s*\(/);
  assert.match(source, /z2k_projection\(/);
  assert.match(source, /answer\.z2k/);
  assert.match(source, /let status = signed\.status/);
  assert.match(source, /updateState:\s*(signed\.updateState|plan\.updateState|updateState)/);
  assert.match(source, /attentionState:/);
  assert.match(source, /canApply:/);
  assert.match(source, /updates:\s*plan\.updates/);
  assert.match(source, /rebases:\s*plan\.rebases/);
  assert.match(source, /reviews:\s*plan\.reviews/);
});

test('initial Resource Center status stays network-free while explicit check carries trust and manifest identity', () => {
  assert.match(source, /status:\s*'unknown'/);
  assert.match(source, /trustMode:\s*'allow-untrusted'/);
  assert.match(source, /manifestSeq:\s*signed\.manifest\.seq/);
  assert.match(source, /manifestCurrent:\s*signed\.manifest\.current/);
  assert.match(source, /z2k_component_apply\(request\)/);
});
