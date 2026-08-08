import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectFacadeMethods } from '../scripts/test/ui-rpc-contract.mjs';

const rpcDir = 'zapret2-manager/files/usr/share/rpcd/ucode';
const rpcSources = readdirSync(rpcDir)
  .filter((name) => name.endsWith('.uc'))
  .map((name) => readFileSync(join(rpcDir, name), 'utf8'))
  .join('\n');
const api = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');
const architecture = readFileSync('docs/architecture/repository-layout.md', 'utf8');

test('every central facade RPC method is backed by a shipped rpcd registration', () => {
  const missing = collectFacadeMethods().filter((method) => !rpcSources.includes(method));
  assert.deepEqual(missing, []);
});

test('central facade keeps positional JSON edit transport and rejected ubus errors', () => {
  assert.match(api, /params\s*:\s*\['edit'\]/);
  assert.match(api, /reject\s*:\s*true/);
});

test('repository architecture documents public RPC compatibility instead of a stale frozen frontend document', () => {
  assert.match(architecture, /Public compatibility boundary/i);
  assert.match(architecture, /public ubus\/RPC method names/);
  assert.match(architecture, /compatibility facade/i);
});
