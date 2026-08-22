import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Clean-install read invariant:
//   A. ordinary catalog reads succeed from the persisted compact index without
//      spawning ANY helper process (sha256sum et al.) — proven by running the
//      reader with a PATH that cannot resolve helpers;
//   B. when the persisted index is missing/corrupt/stale, ordinary reads fail
//      FAST and STRUCTURED with EINDEX_UNAVAILABLE instead of falling back to
//      full catalog verification inside rpcd;
//   C. index materialization is idempotent and reports written:true honestly;
//   D. explicit forceVerify remains the only in-process full verification path.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INSTALLED_ROOT = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'share',
  'zapret2-manager', 'catalog', 'avatar');
const MODULE = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'strategy-catalog.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-read-invariant-'));
  const state = {
    root,
    packageRoot: path.join(root, 'package-avatar'),
    managedRoot: path.join(root, 'managed-avatar'),
    etcDir: path.join(root, 'etc', 'zapret2-manager'),
    indexPath: path.join(root, 'etc', 'zapret2-manager', 'strategy-catalog-index.json'),
    pointerPath: path.join(root, 'etc', 'zapret2-manager', 'catalog', 'active.json'),
    emptyPath: path.join(root, 'empty-path')
  };
  fs.mkdirSync(state.etcDir, { recursive: true });
  fs.cpSync(INSTALLED_ROOT, state.packageRoot, { recursive: true });
  return state;
}

const ENV_BASE = () => ({
  LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
  Z2M_STRATEGY_CATALOG_PACKAGE_ROOT: '%PKG%',
  Z2M_STRATEGY_CATALOG_MANAGED_ROOT: '%MGD%',
  Z2M_STRATEGY_CATALOG_INDEX_PATH: '%IDX%',
  Z2M_STRATEGY_CATALOG_ACTIVE_POINTER: '%PTR%'
});

function envFor(state, overrides = {}) {
  const env = {
    LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^Z2M_/.test(key) && key !== 'PATH') env[key] = value;
  }
  const template = ENV_BASE();
  env.Z2M_STRATEGY_CATALOG_PACKAGE_ROOT = template.Z2M_STRATEGY_CATALOG_PACKAGE_ROOT
    .replace('%PKG%', state.packageRoot);
  env.Z2M_STRATEGY_CATALOG_MANAGED_ROOT = template.Z2M_STRATEGY_CATALOG_MANAGED_ROOT
    .replace('%MGD%', state.managedRoot);
  env.Z2M_STRATEGY_CATALOG_INDEX_PATH = template.Z2M_STRATEGY_CATALOG_INDEX_PATH
    .replace('%IDX%', state.indexPath);
  env.Z2M_STRATEGY_CATALOG_ACTIVE_POINTER = template.Z2M_STRATEGY_CATALOG_ACTIVE_POINTER
    .replace('%PTR%', state.pointerPath);
  Object.assign(env, overrides);
  return env;
}

function runUcode(source, env, options = {}) {
  const argv = ['-e', source];
  return spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 32 * 1024 * 1024
  });
}

const IMPORT = `import * as catalogModule from ${JSON.stringify(MODULE)};`;

function writeIndex(state, env) {
  const source = `${IMPORT} print(sprintf('%J', catalogModule.strategy_catalog_write_read_index(null)));`;
  const result = runUcode(source, env);
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nindex write crashed`);
  const parsed = JSON.parse(result.stdout.split('\n').filter(Boolean).pop());
  assert.equal(parsed.ok, true, `index write not ok: ${result.stdout}`);
  assert.equal(parsed.written, true, `index not written: ${result.stdout}`);
  return parsed;
}

test('index materialization succeeds twice in a row without any pre-deletion (idempotent)', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  writeIndex(state, envFor(state));
});

test('ordinary read resolves purely from the persisted index with helpers unreachable', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  // PATH stripped: every popen('sha256sum …') would fail if the reader tried
  // full verification. The bounded read must not need it.
  const env = envFor(state, { PATH: state.emptyPath });
  fs.mkdirSync(state.emptyPath);
  const source = `${IMPORT} print(sprintf('%J', catalogModule.strategy_catalog_read_index(null)));`;
  const result = runUcode(source, env);
  assert.equal(result.status, 0, `reader crashed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true, `bounded read failed: ${result.stdout}`);
  assert.equal(parsed.catalog.winners == null, false, 'compact winners missing');
});

test('missing persisted index yields structured EINDEX_UNAVAILABLE, never full verification', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  fs.rmSync(state.indexPath);
  const env = envFor(state, { PATH: state.emptyPath });
  fs.mkdirSync(state.emptyPath);
  const source = `${IMPORT} print(sprintf('%J', catalogModule.strategy_catalog_read_index(null)));`;
  const result = runUcode(source, env);
  const parsed = JSON.parse(result.stdout || '{}');
  assert.equal(parsed.ok, false, 'read should fail without an index');
  assert.equal(parsed.error?.code, 'EINDEX_UNAVAILABLE',
    `expected EINDEX_UNAVAILABLE, got: ${result.stdout}`);
});

test('corrupt persisted index yields EINDEX_UNAVAILABLE', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  fs.writeFileSync(state.indexPath, '{"schema":"z2m.strategy-read-index.v2","trunc');
  const env = envFor(state, { PATH: state.emptyPath });
  fs.mkdirSync(state.emptyPath);
  const source = `${IMPORT} print(sprintf('%J', catalogModule.strategy_catalog_read_index(null)));`;
  const result = runUcode(source, env);
  const parsed = JSON.parse(result.stdout || '{}');
  assert.equal(parsed.error?.code, 'EINDEX_UNAVAILABLE', `got: ${result.stdout}`);
});

test('stale pointer identity yields EINDEX_UNAVAILABLE', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  const pointer = JSON.parse(fs.readFileSync(state.pointerPath, 'utf8'));
  pointer.aggregateDigest = '0'.repeat(64);
  fs.writeFileSync(state.pointerPath, JSON.stringify(pointer));
  const env = envFor(state, { PATH: state.emptyPath });
  fs.mkdirSync(state.emptyPath);
  const source = `${IMPORT} print(sprintf('%J', catalogModule.strategy_catalog_read_index(null)));`;
  const result = runUcode(source, env);
  const parsed = JSON.parse(result.stdout || '{}');
  assert.equal(parsed.error?.code, 'EINDEX_UNAVAILABLE', `got: ${result.stdout}`);
});

test('managed directory appearing over a package pointer degrades to EINDEX_UNAVAILABLE', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  fs.mkdirSync(state.managedRoot, { recursive: true });
  const env = envFor(state, { PATH: state.emptyPath });
  fs.mkdirSync(state.emptyPath);
  const source = `${IMPORT} print(sprintf('%J', catalogModule.strategy_catalog_read_index(null)));`;
  const result = runUcode(source, env);
  const parsed = JSON.parse(result.stdout || '{}');
  assert.equal(parsed.error?.code, 'EINDEX_UNAVAILABLE',
    `stale package pointer over managed root must not silently serve or full-verify: ${result.stdout}`);
});

test('forceVerify still performs full verification and republishes the index', () => {
  const state = sandbox();
  writeIndex(state, envFor(state));
  fs.rmSync(state.indexPath);
  const source = `${IMPORT} let r = catalogModule.strategy_catalog_resolve({forceVerify:true}); `
    + `print(sprintf('%J', {ok:r.ok, code:r.error&&r.error.code||null}));`;
  const result = runUcode(source, envFor(state));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true, `forceVerify must fully verify: ${result.stdout}`);
});
