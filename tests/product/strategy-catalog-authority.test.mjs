import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];

function invoke(expression) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function copyPackage(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(PACKAGE_ROOT, root, { recursive: true });
  return root;
}

function resolve(packageRoot, managedRoot) {
  return invoke(`mod.strategy_catalog_resolve({packageRoot:${JSON.stringify(packageRoot)},managedRoot:${JSON.stringify(managedRoot)},persist:false})`);
}

test('manifest-only managed candidate cannot shadow a verified package baseline', () => {
  const managed = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-managed-manifest-'));
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'manifest.json'), path.join(managed, 'manifest.json'));
  const result = resolve(PACKAGE_ROOT, managed);
  const summary = JSON.stringify({ ok: result.ok, kind: result.kind, fallbackUsed: result.fallbackUsed,
    verified: result.verified, verificationError: result.verificationError?.code, error: result.error?.code });
  assert.equal(result.ok, true, summary);
  assert.equal(result.kind, 'package', summary);
  assert.equal(result.fallbackUsed, true, summary);
  assert.equal(result.verified, true, summary);
  assert.equal(result.verificationError.code, 'EPATH', summary);
});

test('fully verified managed candidate is the sole active catalog authority', () => {
  const managed = copyPackage('z2m-managed-valid-');
  const result = resolve(PACKAGE_ROOT, managed);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.root, managed);
  assert.equal(result.kind, 'managed');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.verified, true);
  assert.equal(result.sourceCommit, 'f9dd3ea47a2239514f396a843b475c92c33f0b4c');
});

test('bad managed digest falls back to package and exposes a bounded reason', () => {
  const managed = copyPackage('z2m-managed-bad-');
  const target = path.join(managed, 'advanced/http80_blockcheckw.txt');
  fs.appendFileSync(target, '\n# tamper\n');
  const result = resolve(PACKAGE_ROOT, managed);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, 'package');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.verificationError.code, 'EDIGEST');
  assert.equal(result.verified, true);
});

test('both unverified candidates fail with EVERIFY instead of selecting by manifest presence', () => {
  const managed = copyPackage('z2m-managed-both-bad-');
  fs.appendFileSync(path.join(managed, 'advanced/http80_blockcheckw.txt'), '\n# tamper\n');
  const result = resolve(path.join(os.tmpdir(), 'z2m-missing-package-root'), managed);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
  assert.equal(result.error.managed.code, 'EDIGEST');
});
