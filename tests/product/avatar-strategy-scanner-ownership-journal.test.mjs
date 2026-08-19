import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN && !process.env.UCODE_ARGS_PIPE ? ['-L', MODULE_PATTERN] : [];

function invoke(expression, env) {
  const source = `import * as subject from ${JSON.stringify(STATE)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source], {
    cwd: ROOT, env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('ownership journal durably records PREPARED then TABLE_CREATED evidence in order', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-journal-'));
  const env = { Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_STATE_ROOT: stateRoot };
  try {
    const prepared = invoke("subject.scanner_journal_write('scan-journal', 'PREPARED', { sid: 'scan-journal', cid: 'c1', gen: 1, table: 'z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef' })", env);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const created = invoke("subject.scanner_journal_write('scan-journal', 'TABLE_CREATED', { tableCreated: true, ownerVerified: true, kernelReadBack: true, table: 'z2m_sc_01234567_89abcdef_0001_0123456789abcdef0123456789abcdef' })", env);
    assert.equal(created.ok, true, JSON.stringify(created));
    const loaded = invoke("subject.scanner_journal_load('scan-journal')", env);
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    assert.deepEqual(loaded.journal.entries.map(entry => entry.state), ['PREPARED', 'TABLE_CREATED']);
    assert.equal(loaded.journal.entries[1].evidence.kernelReadBack, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
