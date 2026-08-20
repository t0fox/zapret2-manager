import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const RPC = join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const UI = join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js');

test('Scanner start avoids the reserved top-level ubus status field and UI normalizes state', () => {
  const rpc = readFileSync(RPC, 'utf8');
  const ui = readFileSync(UI, 'utf8');
  assert.match(rpc, /accepted: true, scanId: request\.id, state: 'running'/);
  assert.doesNotMatch(rpc, /accepted: true, scanId: request\.id, status: 'running'/);
  assert.match(ui, /accepted\.state/);
});
