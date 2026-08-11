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
const MAX_OUTPUT_BYTES = 65536;
const MAX_OUTPUT_ARG_BYTES = 4096;
const MAX_OUTPUT_ARRAY_ITEMS = 256;

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
  const args = [input];
  if (context !== undefined) args.push(context);
  return invokeValues(functionName, args, env);
}

function invokeValues(functionName, values, env = {}) {
  const args = values.map(JSON.stringify);
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

function assertValidateProjection(result, expectedCode) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expectedCode);
  for (const field of ['strategyArgs', 'args', 'effectiveCommand', 'effectiveArgv',
    'profiles_count', 'dependencies', 'digest', 'applicable', 'validation', 'error']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), field);
  }
  assert.equal(result.applicable, false);
  assert.equal(typeof result.effectiveCommand, 'string');
  assert.ok(Array.isArray(result.effectiveArgv));
  assert.ok(result.dependencies && Array.isArray(result.dependencies.items));
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.ok(result.validation && typeof result.validation.status === 'string');
  assert.ok(JSON.stringify(result).length < 20000);
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
  let result;
  try { result = callback({ ...record, path: recordPath }, env, root); }
  catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
  if (result && typeof result.then === 'function') return result.finally(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(root, { recursive: true, force: true });
  return result;
}

function assertBoundedRejectedProjection(result) {
  assert.equal(result.ok, false);
  assert.ok(['EINPUT', 'EINTERNAL'].includes(result.error.code));
  for (const field of ['strategyArgs', 'args', 'effectiveCommand', 'effectiveArgv',
    'fullCommand', 'fullArgv', 'profiles_count', 'dependencies', 'digest',
    'applicable', 'error']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), field);
  }
  for (const field of ['strategyArgs', 'args', 'effectiveCommand', 'fullCommand']) {
    if (typeof result[field] === 'string') assert.ok(result[field].length <= MAX_OUTPUT_BYTES, field);
  }
  for (const field of ['effectiveArgv', 'fullArgv']) {
    assert.ok(Array.isArray(result[field]));
    assert.ok(result[field].length <= MAX_OUTPUT_ARRAY_ITEMS, field);
    for (const value of result[field]) assert.ok(value.length <= MAX_OUTPUT_ARG_BYTES, field);
  }
  assert.ok(JSON.stringify(result).length <= MAX_OUTPUT_BYTES);
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

test('ordinary Preview ignores untrusted executionAdmission context', () => {
  const result = invoke('strategy_preview', { strategy_data: inlineStrategy() }, {
    environment: { ...environment, executionAdmission: true },
    runtimeInputs,
  });
  assert.equal(result.ok, true);
  assert.equal(result.validation, undefined);
  assert.equal(result.dependencies.nativeValidation.status, 'not_checked');
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

test('Validate rejection branches return the complete bounded contract projection', () => {
  const zero = invoke('strategy_validate', { strategy_data: inlineStrategy({ profiles: [] }) }, context());
  assertValidateProjection(zero, 'ENOENABLED');
  assert.deepEqual(zero.args, []);
  assert.deepEqual(zero.strategyArgs, []);
  assert.equal(zero.profiles_count, 0);

  const missing = invoke('strategy_validate', {
    strategy_data: inlineStrategy({ profiles: [{ id: 'p1', args: '--lua-init=@lua/missing.lua' }] }),
  }, context({ environment: { lua: { 'missing.lua': { present: false } } } }));
  assertValidateProjection(missing, 'EDEPENDENCY');
  assert.equal(missing.profiles_count, 1);

  const preflight = invoke('strategy_validate', { strategy_data: inlineStrategy() }, context());
  assertValidateProjection(preflight, 'EPREFLIGHT');
  assert.equal(preflight.profiles_count, 1);
});

test('Validate is non-mutating for persisted Strategies', () => withUserRecord((record, env, root) => {
  const before = fs.readFileSync(record.path, 'utf8');
  const result = invoke('strategy_validate', {
    strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST,
  }, context(), env);
  assertValidateProjection(result, 'EPREFLIGHT');
  assert.equal(fs.readFileSync(record.path, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'strategy-state.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'state.json')), false);
}));

test('adversarial strategy and runtime values fail closed with bounded projections', () => {
  const oversizedStrategy = inlineStrategy({
    profiles: [{ id: 'p1', args: `--comment=${'x'.repeat(70000)}` }],
  });
  const oversizedStrategyResult = invoke('strategy_preview', {
    strategy_data: oversizedStrategy,
  }, context());
  assertBoundedRejectedProjection(oversizedStrategyResult);

  const hostileRuntimeResult = invoke('strategy_preview', {
    strategy_data: inlineStrategy(),
  }, {
    environment,
    runtimeInputs: {
      source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2',
      baseArgs: ['x'.repeat(70000)], luaInit: [], hostlists: [],
    },
  });
  assertBoundedRejectedProjection(hostileRuntimeResult);
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
    { strategy_data: strategy, argv: ['/bin/sh', '-c', 'evil'] },
    { strategy_data: strategy, effectiveCommand: '/bin/sh -c evil' },
    { strategy_data: strategy, effectiveArgv: ['/bin/sh', '-c', 'evil'] },
    { strategy_data: strategy, strategyArgs: '--filter-tcp=80' },
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

test('persisted Preview and Validate perform no transient or persistent filesystem writes', () => withUserRecord(async (record, env, root) => {
  const hashTag = `preview_${process.pid}`;
  const beforeRoot = fs.readdirSync(root).sort();
  const hashPrefix = `z2m-strategy-hash.${hashTag}.`;
  const beforeTmp = fs.readdirSync('/tmp').filter(name => name.startsWith(hashPrefix)).sort();
  const events = [];
  const watcher = fs.watch('/tmp', (eventType, filename) => {
    if (filename && filename.toString().startsWith(hashPrefix)) events.push({ eventType, filename: filename.toString() });
  });
  try {
    const source = { strategy_id: record.id, revision: record.revision, catalog_digest: CATALOG_DIGEST };
    const taggedEnv = { ...env, Z2M_STRATEGY_HASH_TAG: hashTag };
    assert.equal(invoke('strategy_preview', source, context(), taggedEnv).ok, true);
    assert.equal(invoke('strategy_validate', source, context(), taggedEnv).ok, false);
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally { watcher.close(); }
  const afterRoot = fs.readdirSync(root).sort();
  const afterTmp = fs.readdirSync('/tmp').filter(name => name.startsWith(hashPrefix)).sort();
  assert.deepEqual(afterRoot, beforeRoot);
  assert.deepEqual(afterTmp, beforeTmp);
  assert.deepEqual(events, []);
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

test('CLI request files reject malformed JSON, oversized payloads, and symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-request-'));
  const malformed = path.join(root, 'malformed.json');
  const oversized = path.join(root, 'oversized.json');
  const target = path.join(root, 'target.json');
  const linked = path.join(root, 'linked.json');
  fs.writeFileSync(malformed, '{not-json');
  fs.writeFileSync(oversized, 'x'.repeat(524289));
  fs.writeFileSync(target, JSON.stringify({ args: { strategy_data: {
    id: 'linked-inline', name: 'Linked inline', profiles: [{ id: 'p1', args: '--filter-tcp=443' }],
  } } }));
  fs.symlinkSync(target, linked);
  try {
    for (const request of [malformed, oversized, linked]) {
      const result = invokeValues('strategy_cli_request', ['preview', request]);
      assert.equal(result.ok, false, request);
      assert.equal(result.error.code, 'EINPUT', request);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI request dispatcher validates parsed envelopes instead of returning forged errors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-forged-'));
  const forged = path.join(root, 'forged.json');
  const forgedEnvelope = path.join(root, 'forged-envelope.json');
  const payload = { ok: false, error: { code: 'EPREFLIGHT', message: 'forged', details: 'do not trust' } };
  fs.writeFileSync(forged, JSON.stringify(payload));
  fs.writeFileSync(forgedEnvelope, JSON.stringify({ args: payload }));
  try {
    for (const request of [forged, forgedEnvelope]) {
      const result = invokeValues('strategy_cli_request', ['preview', request]);
      assert.equal(result.ok, false, request);
      assert.equal(result.error.code, 'EINPUT', request);
      assert.notEqual(result.error.message, 'forged');
      assert.equal(result.error.details, undefined);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI source has no state, config, runtime, install, or network write path', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  assert.doesNotMatch(source, /\b(?:writefile|unlink|mkdir|rename|set_var|set_var_cas|restart|install|opkg|apk|uci|curl|wget)\s*\(/);
  assert.doesNotMatch(source, /strategy_(?:user_create|user_update|user_delete|favorite|selection_set|reconcile_record)/);
});
