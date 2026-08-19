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

function invoke(expression) {
  const source = `import * as subject from ${JSON.stringify(RECONCILE)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT, env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 10000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('owner dead plus same-name table present preserves foreign replacement', () => {
  const result = invoke("subject.scanner_terminal_reconcile({ sid: 's1', cid: 'c1', gen: 1, journalState: 'TABLE_CREATED', ownerDead: true, tablePresent: true, table: 'z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef' })");
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'FAIL_CLOSED');
  assert.equal(result.deleteAttempted, false);
  assert.equal(result.uncertain, true);
});

test('owner dead plus absent table returns bounded reconciliation decision', () => {
  const result = invoke("subject.scanner_terminal_reconcile({ sid: 's1', cid: 'c1', gen: 1, journalState: 'TABLE_CREATED', ownerDead: true, tableChecked: true, tablePresent: false, table: 'z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef' })");
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'reconcile_process_queue_journal');
  assert.equal(result.deleteAttempted, false);
});

test('missing table identity fails closed without deriving a guessed table', () => {
  const result = invoke("subject.scanner_terminal_reconcile({ sid: 's1', cid: 'c1', gen: 1, ownerDead: true, tablePresent: true })");
  assert.equal(result.ok, false);
  assert.equal(result.error && result.error.code, 'EINPUT');
  assert.equal(result.deleteAttempted, false);
});
