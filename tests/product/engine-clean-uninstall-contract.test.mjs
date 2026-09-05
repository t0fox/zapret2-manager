import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh'), 'utf8');

test('Engine uninstall removes only its runtime integration artifacts and owned nft table', () => {
  assert.match(worker, /remove_engine_runtime\s*\(\)\s*\{/);
  const cleanup = worker.slice(worker.indexOf('remove_engine_runtime'), worker.indexOf('rollback()'));
  assert.match(cleanup, /nft list table inet zapret2/);
  assert.match(cleanup, /nft delete table inet zapret2/);
  assert.match(cleanup, /rm -f[^\n]*INIT/);
  assert.match(cleanup, /90-zapret2/);
  assert.match(cleanup, /firewall\.zapret2/);
  assert.match(worker, /remove_engine_runtime\s*\|\|\s*fail EREMOVE/);
});
