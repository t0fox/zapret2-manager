import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Failure-injection acceptance for the engine worker transaction (category N).
//
// Runs the REAL worker script inside a throwaway root environment with stub
// system boundaries (/opt/zapret2 seed tree, fake init.d/zapret2, fake apk /
// pidof / nft, fixture artifact served by a stub uclient-fetch). Two injected
// failures must both produce: NO committed state, previous runtime restored,
// operation marked rolled_back:
//   1. Z2K materialization failure (unwritable lua target)
//   2. capability proof failure (binary without z2k tokens)
//
// Root + Linux only (the worker mutates absolute paths); skipped elsewhere.

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');
const WORKER = path.join(ROOT_DIR, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-operation-worker.sh');
const SYNC = path.join(ROOT_DIR, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'strategy-runtime-assets-sync.sh');
const RUNNER = path.join(ROOT_DIR, 'tests', 'product', 'support', 'engine-worker-sandbox.sh');

const canRun = process.platform === 'linux'
  && (() => {
    try { execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' }); return true; }
    catch { return false; }
  })();

function runSandbox(injection) {
  const out = execFileSync('sudo', ['-n', 'bash', RUNNER, WORKER, SYNC, injection], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    cwd: ROOT_DIR
  });
  return JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop());
}

test('materialize failure rolls back to the previous engine payload', { skip: !canRun && 'requires passwordless sudo on Linux' }, () => {
  const verdict = runSandbox('materialize');
  assert.equal(verdict.phase, 'rolled_back', JSON.stringify(verdict));
  assert.equal(verdict.errorCode, 'EZ2K_ASSETS');
  assert.equal(verdict.oldTreeRestored, true);
  assert.equal(verdict.committedState, false);
});

test('capability proof failure rolls back and never commits engine-state', { skip: !canRun && 'requires passwordless sudo on Linux' }, () => {
  const verdict = runSandbox('capabilities');
  assert.equal(verdict.phase, 'rolled_back', JSON.stringify(verdict));
  assert.equal(verdict.errorCode, 'ECAPABILITY');
  assert.equal(verdict.oldTreeRestored, true);
  assert.equal(verdict.committedState, false);
});
