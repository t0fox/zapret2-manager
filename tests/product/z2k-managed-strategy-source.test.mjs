import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
const SOURCE_STORE_MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
const HARNESS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh');
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function invoke(root, expression, extraEnv = {}, module = MODULE) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      Z2M_STRATEGY_SOURCES_ROOT: root,
      Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(root, 'metadata-cache'),
      Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(root, 'metadata-state'),
      Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(root, 'metadata-locks'),
      Z2M_STRATEGY_SOURCE_CONTENT_TRANSPORT: TRANSPORT,
      Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS,
      Z2M_Z2K_REFRESH_NATIVE_VALIDATE: '0',
      Z2M_UPDATE_SOURCE_TEST: '1',
      Z2M_FIXTURE_MODE: 'ok',
      ...extraEnv,
    },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

test('direct Z2K strategy refresh is Core-managed and fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-managed-'));
  const result = invoke(root, "mod.strategy_source_refresh('z2k')");
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EMANAGED');
  assert.equal(result.error.owner, 'z2k-core');
});

test('source snapshot installation rejects an unbound Z2K mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-store-'));
  const result = invoke(root, "mod.strategy_source_install_verified_snapshot('z2k', { verified: true, snapshot: {} })", {}, SOURCE_STORE_MODULE);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EMANAGED');
  assert.equal(result.error.owner, 'z2k-core');
});

test('Core compiler preparation uses the selected sourceCommit for every source URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-z2k-selected-'));
  const log = path.join(root, 'transport.log');
  const selected = 'd'.repeat(40);
  const branchHeadWhenDifferent = 'a'.repeat(40);
  const prepared = invoke(root, `mod.strategy_source_z2k_compiler_plan({ sourceCommit: '${selected}' })`, {
    Z2M_FIXTURE_TRANSPORT_LOG: log,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.compilerSourceCommit, selected);
  const urls = Object.values(prepared.sourceUrls);
  assert.equal(urls.length, 5);
  assert.ok(urls.every((url) => url.includes(`/${selected}/`)), JSON.stringify(urls));
  assert.ok(urls.every((url) => !url.includes(`/${branchHeadWhenDifferent}/`)), JSON.stringify(urls));
});
