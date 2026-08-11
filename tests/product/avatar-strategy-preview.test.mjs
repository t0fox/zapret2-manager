import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const CATALOG_DIGEST = JSON.parse(fs.readFileSync(path.join(CATALOG_ROOT, 'manifest.json'), 'utf8')).aggregateDigest;
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const environment = {
  listMode: 'none',
  paths: {
    luaRoot: '/opt/zapret2/lua',
    blobRoot: '/opt/zapret2/bin',
    listRoot: '/lists',
    ipsetRoot: '/lists',
  },
  functions: { fake: { present: true } },
  blobs: { fake_default_tls: { path: 'fake_default_tls.bin', present: true } },
  lua: { 'desync.lua': { present: true } },
  lists: {},
};

const runtimeInputs = {
  source: 'live',
  enginePath: '/opt/zapret2/nfq2/nfqws2',
  baseArgs: ['--qnum=30999'],
  luaInit: ['/opt/zapret2/lua/zapret-lib.lua'],
  hostlists: ['/lists/netrogat.txt'],
};

function invoke(functionName, input, context, env = {}) {
  const args = [JSON.stringify(input)];
  if (context !== undefined) args.push(JSON.stringify(context));
  const source = `import { ${functionName} } from ${JSON.stringify(CLI)}; print(sprintf('%J', ${functionName}(${args.join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function inlineStrategy(overrides = {}) {
  return {
    id: 'preview-inline',
    name: 'Preview inline',
    profiles: [{ id: 'p1', args: '--filter-tcp=443 --lua-desync=fake' }],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    environment: { ...environment, ...(overrides.environment || {}) },
    runtimeInputs: { ...runtimeInputs, ...(overrides.runtimeInputs || {}) },
  };
}

function withUserRecord(callback, revision = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-preview-'));
  const strategies = path.join(root, 'strategies');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  const recordPath = path.join(strategies, 'persisted-user.json');
  const record = {
    schema: 1,
    id: 'persisted-user',
    revision,
    name: 'Persisted user',
    origin: 'user',
    is_builtin: false,
    metadata: {},
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: true }],
    updatedAt: 1,
  };
  fs.writeFileSync(recordPath, JSON.stringify(record));
  fs.chmodSync(recordPath, 0o600);
  const env = {
    Z2M_STRATEGY_ROOT: root,
    Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(root, 'reconciliation.json'),
    Z2M_STRATEGY_LOCK: path.join(root, 'strategy.lock'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
  };
  fs.writeFileSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, JSON.stringify({ schema: 1, extensions: [] }));
  fs.chmodSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, 0o644);
  try { return callback({ ...record, path: recordPath }, env, root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('inline zero-enabled Preview is inspectable while Validate rejects', () => {
  const strategy = inlineStrategy({
    profiles: [
      { id: 'p1', args: '--filter-tcp=443', enabled: false },
      { id: 'p2', args: '--filter-udp=443', enabled: false },
    ],
  });
  const preview = invoke('strategy_preview', { strategy_data: strategy }, context());
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.args, []);
  assert.equal(preview.profiles_count, 0);
  assert.equal(preview.applicable, false);
  assert.match(preview.digest, /^[a-f0-9]{64}$/);
  assert.equal(invoke('strategy_validate', { strategy_data: strategy }, context()).error.code, 'ENOENABLED');
});

test('Preview normalizes server-side and returns command, argv, aliases, digest, and dependencies', () => {
  const result = invoke('strategy_preview', { strategy_data: inlineStrategy() }, context());
  assert.equal(result.ok, true);
  assert.equal(result.strategyArgs, result.args);
  assert.match(result.strategyArgs, /--filter-tcp=443/);
  assert.equal(result.profiles_count, 1);
  assert.equal(result.profilesCount, 1);
  assert.deepEqual(result.effectiveArgv, [
    '/opt/zapret2/nfq2/nfqws2', '--qnum=30999',
    '--lua-init=/opt/zapret2/lua/zapret-lib.lua',
    '--hostlist=/lists/netrogat.txt', '--filter-tcp=443', '--lua-desync=fake',
  ]);
  assert.equal(result.effectiveCommand, result.effectiveArgv.map(value => `'${value}'`).join(' '));
  assert.equal(result.dependencies.available, true);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

test('Preview only invokes native preflight when validate is true', () => {
  const pure = invoke('strategy_preview', { strategy_data: inlineStrategy() }, context());
  const checked = invoke('strategy_preview', { strategy_data: inlineStrategy(), validate: true }, context());
  assert.equal(pure.validation, undefined);
  assert.equal(pure.dependencies.nativeValidation.status, 'not_checked');
  assert.notEqual(checked.validation, undefined);
  assert.notEqual(checked.validation.status, 'not_checked');
});

test('Validate requires dependency availability and complete native preflight', () => {
  const missing = invoke('strategy_validate', {
    strategy_data: inlineStrategy({ profiles: [{ id: 'p1', args: '--lua-init=@lua/missing.lua' }] }),
  }, context({ environment: { lua: { 'missing.lua': { present: false } } } }));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'EDEPENDENCY');
  assert.equal(missing.validation.status !== 'not_checked', true);

  const native = invoke('strategy_validate', { strategy_data: inlineStrategy() }, context());
  assert.equal(native.ok, false);
  assert.equal(native.error.code, 'EPREFLIGHT');
  assert.equal(native.validation.status !== 'not_checked', true);
});

test('request source is exclusive and client candidate/command inputs are rejected', () => {
  const strategy = inlineStrategy();
  for (const input of [
    {},
    { strategy_data: strategy, strategy_id: 'persisted-user', revision: 3, catalog_digest: CATALOG_DIGEST },
    { strategy_data: 'not-an-object' },
    { strategy_data: strategy, candidate: '--filter-tcp=80' },
    { strategy_data: strategy, args: '--filter-tcp=80' },
    { strategy_data: strategy, command: '/bin/sh -c evil' },
    { strategy_data: strategy, validate: 'true' },
  ]) {
    const result = invoke('strategy_preview', input, context());
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, 'EINPUT', JSON.stringify(input));
  }
});

test('persisted Preview resolves the server record and rejects stale revision or catalog digest', () => withUserRecord((record, env, root) => {
  const source = { strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST };
  const preview = invoke('strategy_preview', source, context(), env);
  assert.equal(preview.ok, true);
  assert.equal(preview.strategyId, record.id);
  assert.equal(preview.origin, 'user');

  const staleRevision = invoke('strategy_preview', { ...source, revision: record.revision - 1 }, context(), env);
  assert.equal(staleRevision.error.code, 'ECONFLICT');
  const staleCatalog = invoke('strategy_preview', { ...source, catalog_digest: 'a'.repeat(64) }, context(), env);
  assert.equal(staleCatalog.error.code, 'ECONFLICT');
  assert.equal(fs.existsSync(path.join(root, 'strategy-state.json')), false);
}));

test('persisted source remains unchanged and Preview does not write Strategy or manager state', () => withUserRecord((record, env, root) => {
  const before = fs.readFileSync(record.path, 'utf8');
  const result = invoke('strategy_preview', {
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  }, context(), env);
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(record.path, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'strategy-state.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'state.json')), false);
}));

test('CLI request files are bounded and dispatch only Preview or Validate', () => {
  const request = path.join(os.tmpdir(), `z2m-strategy-preview.${process.pid}.json`);
  fs.writeFileSync(request, JSON.stringify({ args: { strategy_data: {
    id: 'cli-inline', name: 'CLI inline', profiles: [{ id: 'p1', args: '--filter-tcp=443' }],
  } } }));
  try {
    const source = `import { strategy_cli_request } from ${JSON.stringify(CLI)}; print(sprintf('%J', strategy_cli_request('preview', ${JSON.stringify(request)})));`;
    const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
      cwd: ROOT,
      env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
        LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.profiles_count, 1);
  } finally { fs.rmSync(request, { force: true }); }
});

test('CLI source has no state, config, runtime, install, or network write path', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  assert.doesNotMatch(source, /\b(?:writefile|unlink|mkdir|rename|set_var|set_var_cas|restart|install|opkg|apk|uci|curl|wget)\s*\(/);
  assert.doesNotMatch(source, /strategy_(?:user_create|user_update|user_delete|favorite|selection_set|reconcile_record)/);
});
