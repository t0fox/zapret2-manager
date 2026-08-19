import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RECONCILE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-reconcile.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN && !process.env.UCODE_ARGS_PIPE ? ['-L', MODULE_PATTERN] : [];

function invokeReconcile(expression, env = {}, timeout = 10000) {
  const source = `import * as subject from ${JSON.stringify(RECONCILE)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout,
  });
  if (result.status !== 0) {
    throw new Error(`ucode failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

test('scanner_terminal_reconcile rejects incomplete stale identity', () => {
  const result = invokeReconcile("subject.scanner_terminal_reconcile({ sid: 's1', cid: 'c1', gen: 1, nonce: 'n1', table: 'z2m_sc_s1_c1_0001_n1' })");
  assert.equal(result.ok, false);
  assert.equal(result.error && result.error.code, 'EINPUT');
});
