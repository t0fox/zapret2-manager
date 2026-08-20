import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const RPC = join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');

test('production Scanner start uses the detached ash launcher contract', () => {
  const source = readFileSync(RPC, 'utf8');
  const start = source.slice(source.indexOf('function scanner_start_async_impl'));
  assert.match(start, /setsid ash/);
  assert.match(start, /<\/dev\/null/);
  assert.match(start, />\/dev\/null 2>&1/);
});
