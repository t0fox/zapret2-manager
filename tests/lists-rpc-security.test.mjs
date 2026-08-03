import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');

test('lists domain lookup quotes untrusted shell argument', () => {
  assert.match(source, /function shell_escape\s*\(/);
  assert.match(source, /lists_action\(['"]check\s+['"]\s*\+\s*shell_escape\(d\)\)/);
  assert.doesNotMatch(source, /lists_action\(['"]check\s+['"]\s*\+\s*d\)/);
});
