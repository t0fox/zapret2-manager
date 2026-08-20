import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const RPC = join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');

test('Scanner start declares its implementation before the caller for target ucode', () => {
  const source = readFileSync(RPC, 'utf8');
  const action = source.indexOf('function scanner_edit_action');
  const root = source.indexOf('function scanner_request_root_ready');
  const guard = source.indexOf('function scanner_start_async(req)');
  const implementation = source.indexOf('function scanner_start_async_impl(req)');
  assert.ok(root >= 0 && implementation >= 0 && guard >= 0 && action >= 0
    && root < implementation && implementation < guard && guard < action,
    'ucode requires Scanner start dependencies to be declared before their callers');
});
