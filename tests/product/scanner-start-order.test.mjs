import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const RPC = join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');

test('Legacy Scanner start adapter is absent from target ucode', () => {
  const source = readFileSync(RPC, 'utf8');
  assert.doesNotMatch(source, /function scanner_edit_action|function scanner_request_root_ready|function scanner_start_async\(req\)|function scanner_start_async_impl\(req\)/);
});

test('Legacy Scanner async worker shell is absent from target ucode', () => {
  const source = readFileSync(RPC, 'utf8');
  assert.doesNotMatch(source, /SCANNER_CLI|scanner-cli-entry|setsid sh -c/);
});
