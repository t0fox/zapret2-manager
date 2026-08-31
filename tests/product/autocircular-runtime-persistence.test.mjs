import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const persistPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/z2k-state-persist.lua');
const opsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');

test('Autocircular runtime defaults to the manager canonical state path', () => {
  const source = fs.readFileSync(persistPath, 'utf8');
  assert.match(source, /or\s+"\/etc\/zapret2-manager\/state\/autocircular"/);
  assert.doesNotMatch(source, /or\s+"\/opt\/zapret2\/extra_strats\/cache\/autocircular"/);
});

test('Autocircular control-plane writes keep state readable by nfqws2 daemon', () => {
  const source = fs.readFileSync(opsPath, 'utf8');
  assert.match(source, /chgrp\s+daemon/);
  assert.match(source, /chmod\s+0660/);
});
