import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = readFileSync(path.join(ROOT,
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const CLI_PATH = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const CLI = readFileSync(CLI_PATH, 'utf8');
const ACL = readFileSync(path.join(ROOT,
  'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'), 'utf8');
const CATALOG_ROOT = path.join(ROOT,
  'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const CATALOG_MANIFEST = JSON.parse(readFileSync(path.join(CATALOG_ROOT, 'manifest.json'), 'utf8'));
const EXPECTED_MANIFEST = JSON.parse(readFileSync(path.join(ROOT,
  'tests/fixtures/avatar-strategy/manifest.expected.json'), 'utf8'));
const NATIVE_PROTOCOL = JSON.parse(readFileSync(path.join(ROOT,
  'zapret2-manager/src/z2m-core-helper/protocol-v1.json'), 'utf8'));
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const METHODS = [
  'strategies_list', 'strategies_get', 'strategies_create', 'strategies_update',
  'strategies_delete', 'strategies_duplicate', 'strategies_favorite',
  'strategies_preview', 'strategies_validate', 'strategies_apply',
  'strategies_catalog_status', 'strategies_catalog_reload', 'strategies_import_profiles',
];
const READ_METHODS = [
  'strategies_list', 'strategies_get', 'strategies_preview', 'strategies_validate',
  'strategies_catalog_status', 'strategies_catalog_reload', 'status',
];
const WRITE_METHODS = [
  'strategies_create', 'strategies_update', 'strategies_delete',
  'strategies_duplicate', 'strategies_favorite', 'strategies_apply',
  'strategies_import_profiles',
];

function invokeValues(functionName, values, env = {}) {
  const source = `import { ${functionName} } from ${JSON.stringify(CLI_PATH)}; print(sprintf('%J', ${functionName}(${values.map(JSON.stringify).join(', ')})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function invokeUcode(source, env = {}, timeout = 15_000) {
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function rpcSignatureSource(method, request) {
  const opened = RPC
    .replace("const STRATEGY_CLI = '/usr/libexec/zapret2-manager/strategy-cli.uc';",
      `const STRATEGY_CLI = ${JSON.stringify(CLI_PATH)};`)
    .replace("import { strategy_cli_dispatch } from '/usr/libexec/zapret2-manager/strategy-cli.uc';",
      `import { strategy_cli_dispatch } from ${JSON.stringify(CLI_PATH)};`)
    .replace("return {\n\t'zapret2-manager'", "let signature = {\n\t'zapret2-manager'");
  return opened.replace(/\n};\s*$/, `\n};\nprint(sprintf('%J', signature['zapret2-manager'][${JSON.stringify(method)}].call(${JSON.stringify(request)})));`);
}

function invokeRpcMethod(method, request, env = {}) {
  fs.mkdirSync('/tmp/zapret2-manager', { recursive: true, mode: 0o700 });
  return invokeUcode(rpcSignatureSource(method, request), {
    Z2M_STRATEGY_REQUEST_UID: String(process.getuid?.() ?? 0),
    Z2M_STRATEGY_REQUEST_GID: String(process.getgid?.() ?? 0),
    ...env,
  });
}

function stubChild(mode) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-stub-')), 'ucode-stub.sh');
  const body = mode === 'oversized'
    ? '#!/bin/sh\nhead -c 4194305 /dev/zero\nexit 0\n'
    : mode === 'nonzero'
      ? '#!/bin/sh\nprintf \'{"ok":true}\'\nexit 7\n'
      : '#!/bin/sh\nprintf \'{"ok":true,"stub":true}\'\nexit 0\n';
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { file, root: path.dirname(file) };
}

function temporaryCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-catalog-'));
  fs.cpSync(CATALOG_ROOT, root, { recursive: true });
  return root;
}

function temporaryStrategyStorage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-state-'));
  const strategies = path.join(root, 'strategies');
  const extensions = path.join(root, 'extensions.json');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  fs.writeFileSync(extensions, JSON.stringify({ schema: 1, extensions: ['extension-one'] }), { mode: 0o644 });
  fs.chmodSync(extensions, 0o644);
  return {
    root,
    strategies,
    state: path.join(root, 'strategy-state.json'),
    extensions,
  };
}

function strategyStorageEnv(storage) {
  return {
    Z2M_STRATEGY_ROOT: storage.root,
    Z2M_STRATEGY_DIR: storage.strategies,
    Z2M_STRATEGY_STATE: storage.state,
    Z2M_STRATEGY_EXTENSION_MANIFEST: storage.extensions,
  };
}

function authoritativeRuntimeEnv() {
  return {
    Z2M_STRATEGY_UCODE_BIN: UCODE_BIN,
    Z2M_STRATEGY_RPC: '1',
    Z2M_STRATEGY_SERVER_TEST: '1',
    Z2M_STRATEGY_RUNTIME_INPUTS: JSON.stringify({
      source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2',
      baseArgs: ['--qnum=30999'],
      luaInit: ['/opt/zapret2/lua/zapret-lib.lua'],
      hostlists: ['/lists/netrogat.txt'],
    }),
    Z2M_STRATEGY_RUNTIME_ENVIRONMENT: JSON.stringify({
      listMode: 'none', paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/bin', listRoot: '/lists', ipsetRoot: '/lists' },
      functions: { fake: { present: true } }, blobs: {}, lua: {}, lists: {},
    }),
  };
}

function userStrategy(overrides = {}) {
  return {
    id: 'user-one', name: 'User one', origin: 'user', is_builtin: false,
    metadata: { description: 'local' },
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: true }],
    ...overrides,
  };
}

function writeUserStrategy(storage) {
  fs.writeFileSync(path.join(storage.strategies, 'user-one.json'), JSON.stringify({
    schema: 1, id: 'user-one', revision: 1, name: 'User one', origin: 'user',
    is_builtin: false, metadata: { description: 'local' },
    profiles: [{ id: 'p1', args: '--filter-tcp=443', enabled: true }], updatedAt: 1,
  }), { mode: 0o600 });
  fs.chmodSync(path.join(storage.strategies, 'user-one.json'), 0o600);
  fs.writeFileSync(storage.state, JSON.stringify({
    schema: 1, revision: 3, favorites: ['z2k_all_in_one', 'user-one'], selected: null,
  }), { mode: 0o600 });
  fs.chmodSync(storage.state, 0o600);
}

function assertFullBuiltinStrategy(strategy) {
  for (const field of ['id', 'name', 'description', 'type', 'version', 'is_builtin',
    'source', 'level', 'label', 'author', 'protocol', 'featured', 'blobs', 'profiles'])
    assert.ok(Object.hasOwn(strategy, field), `${strategy.id} missing ${field}`);
  assert.equal(strategy.is_builtin, true, `${strategy.id} builtin identity`);
  assert.equal(strategy.source, 'catalog', `${strategy.id} catalog source`);
  assert.ok(Array.isArray(strategy.blobs), `${strategy.id} blobs`);
  assert.ok(Array.isArray(strategy.profiles) && strategy.profiles.length > 0,
    `${strategy.id} profiles`);
  for (const profile of strategy.profiles) {
    for (const field of ['id', 'name', 'enabled', 'args'])
      assert.ok(Object.hasOwn(profile, field), `${strategy.id} profile missing ${field}`);
    assert.equal(profile.enabled, true, `${strategy.id} profile enabled`);
    assert.equal(typeof profile.args, 'string', `${strategy.id} profile args`);
  }
}

function protocolMemoryFields(value, prefix = '') {
  const fields = [];
  if (value == null || typeof value !== 'object') return fields;
  for (const [key, child] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (/(?:memory|rss|resident)/i.test(key)) fields.push(field);
    fields.push(...protocolMemoryFields(child, field));
  }
  return fields;
}

function strategyResponseMaxBytes() {
  const match = /const MAX_STRATEGY_RESPONSE_BYTES = (\d+) \* 1024 \* 1024/.exec(CLI);
  assert.ok(match, 'Strategy response bound must be declared in the CLI');
  return Number(match[1]) * 1024 * 1024;
}

function measureFullStrategyList(transport) {
  return {
    bytes: transport.childResponseBytes,
    requestBytes: transport.requestBytes,
    childSerializationTransportMs: transport.childElapsedMs,
    rpcTransportMs: transport.rpcElapsedMs,
    projectionAuthorized: false,
    strategyResponseMaxBytes: strategyResponseMaxBytes(),
    nativeRequestMaxBytes: NATIVE_PROTOCOL.transport.requestMaxBytes,
    nativeResponseMaxBytes: NATIVE_PROTOCOL.transport.responseMaxBytes,
    nativeAtomicWriteJsonCanonicalMaxBytes: NATIVE_PROTOCOL.operations.atomic_write_json.limits.maxCanonicalBytes,
    nativeMemory: {
      protocolFields: protocolMemoryFields(NATIVE_PROTOCOL),
      runtimeVirtualMemoryKb: transport.runtimeVirtualMemoryKb,
      runtimeResidentMemoryKb: transport.runtimeResidentMemoryKb,
    },
    childResponseSha256: transport.childResponseSha256,
  };
}

function rpcTransportProbe(storage) {
  const result = invokeRpcMethod('strategies_list', {}, strategyStorageEnv(storage));
  return { result, serializedBytes: Buffer.byteLength(JSON.stringify(result)) };
}

test('Strategy methods use the existing rpcd object and bounded edit transport', () => {
  for (const method of METHODS) assert.match(RPC, new RegExp(`\\b${method}:\\s*\\{`), method);
  assert.match(RPC, /strategy_edit_action\(/);
  assert.match(RPC, /writefile\(tmp, edit\)/);
  assert.match(RPC, /mktemp \/tmp\/z2m-strategy-edit\.XXXXXX/);
  assert.match(RPC, /unlink\(tmp\)/);
  assert.doesNotMatch(RPC, /exec.*client/i);
  assert.doesNotMatch(RPC, /generic.*action/i);
  assert.doesNotMatch(RPC, /strategy.*Orchestra|ORCH_CLI.*STRATEGY/i);
});

test('RPC mutations use package-standard flock while read methods remain concurrent', () => {
  assert.match(RPC, /STRATEGY_STATE_FLOCK[\s\S]*['"]\/tmp\/zapret2-manager\/state\.lock/);
  assert.match(RPC, /STRATEGY_CONFIG_FLOCK[\s\S]*['"]\/opt\/zapret2\/config\.lock/);
  assert.match(RPC, /flock -x/);
  assert.match(RPC, /Z2M_FLOCKED=1/);
  assert.match(RPC, /Z2M_STRATEGY_LOCKED=1/);
  assert.match(RPC, /Z2M_CONFIG_LOCKED=1/);
  const transport = RPC.slice(RPC.indexOf('function strategy_edit_action'), RPC.indexOf('function strategy_noarg_action'));
  assert.match(transport, /strategy_lock_for\(mode\)/);
  assert.match(transport, /strategy_have_flock\(\)/);
  assert.doesNotMatch(transport, /Z2M_STRATEGY_LOCKED=1[^\n]*\n[^\n]*flock/);
  assert.doesNotMatch(RPC.slice(RPC.indexOf('function strategy_noarg_action'), RPC.indexOf('// ---- service catalog')), /strategy_lock_for/);
});

test('RPC mutation invokes the real signature wrapper with a deterministic child', () => {
  const stub = stubChild('ok');
  try {
    const result = invokeRpcMethod('strategies_create', { edit: '{}' }, { Z2M_STRATEGY_UCODE_BIN: stub.file });
    assert.deepEqual(result, { ok: true, stub: true });
  } finally {
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
  for (const method of METHODS) assert.match(RPC, new RegExp(`\\b${method}:\\s*\\{`), method);
});

test('RPC child transport bounds combined output, checks status, and cleans up on every path', () => {
  assert.match(RPC, /STRATEGY_MAX_CHILD_RESPONSE_BYTES/);
  assert.match(RPC, /head -c/);
  assert.match(RPC, /__Z2M_CHILD_RC__/);
  assert.match(RPC, /strategy_child_response/);
  assert.match(RPC, /p\.close\(\)/);
  assert.match(RPC, /try \{ unlink\(tmp\); \} catch/);
  assert.match(RPC, /catch \(e\)[\s\S]*?strategy_cleanup_request\(tmp\)/);
  assert.match(RPC, /child exited|child response|response exceeds/i);
});

test('RPC returns bounded child errors and removes request files after child failure', () => {
  for (const mode of ['nonzero', 'oversized']) {
    const stub = stubChild(mode);
    const before = fs.readdirSync('/tmp').filter(name => name.startsWith('z2m-strategy-edit.')).sort();
    try {
      const result = invokeRpcMethod('strategies_create', { edit: '{}' }, { Z2M_STRATEGY_UCODE_BIN: stub.file });
      assert.equal(result.ok, false, mode);
      assert.equal(result.error.code, mode === 'nonzero' ? 'ECHILD' : 'EOUTPUT', mode);
    } finally {
      const after = fs.readdirSync('/tmp').filter(name => name.startsWith('z2m-strategy-edit.')).sort();
      assert.deepEqual(after, before, `${mode} request cleanup`);
      fs.rmSync(stub.root, { recursive: true, force: true });
    }
  }
});

test('RPC mutation waits for the shared state flock instead of bypassing it', () => new Promise((resolve, reject) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-lock-'));
  const lock = path.join(root, 'state.lock');
  const stub = stubChild('ok');
  const holder = spawn('flock', ['-x', lock, '-c', 'sleep 0.35'], { stdio: 'ignore' });
  setTimeout(() => {
    const started = Date.now();
    try {
      const result = invokeRpcMethod('strategies_create', { edit: '{}' }, {
        Z2M_STRATEGY_UCODE_BIN: stub.file, Z2M_STRATEGY_STATE_FLOCK: lock,
      });
      assert.deepEqual(result, { ok: true, stub: true });
      assert.ok(Date.now() - started >= 250, 'mutation bypassed the shared flock');
      resolve();
    } catch (error) { reject(error); }
    finally {
      holder.kill();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(stub.root, { recursive: true, force: true });
    }
  }, 40);
}));

test('CLI revalidates private request identity and size immediately around read', () => {
  const request = CLI.slice(CLI.indexOf('function request'), CLI.indexOf('function dispatch_result'));
  assert.match(request, /stat\(path\)/g);
  assert.match(request, /readlink\(path\)/g);
  assert.match(request, /\.size/);
  assert.match(request, /metadata_same/);
  assert.match(request, /uid/);
  assert.match(request, /mode % 512/);
  assert.match(request, /readfile\(path\)/);
  assert.match(request, /length\(raw\) !=/);
});

test('Strategy list and detail responses have a server serialization bound without pagination', () => {
  assert.match(CLI, /MAX_STRATEGY_RESPONSE_BYTES/);
  assert.match(CLI, /MAX_STRATEGY_LIST_RESPONSE_BYTES\s*=\s*768\s*\*\s*1024/);
  assert.match(CLI, /bounded_strategy_response/);
  assert.match(CLI, /strategy_list\(\)[\s\S]*bounded_strategy_response/);
  assert.match(CLI, /strategy_get\(input\)[\s\S]*bounded_strategy_response/);
  assert.doesNotMatch(CLI, /strategies_list.*(?:page|cursor|offset|limit)/i);
});

test('Default Strategy list resolves the real winner IDs and emits compact summaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-list-'));
  const strategies = path.join(root, 'strategies');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  try {
    const result = invokeValues('strategy_cli_dispatch', ['list', {}], {
      Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies,
    });
    assert.equal(result.ok, true);
    assert.equal(CATALOG_MANIFEST.uniqueStrategyIdCount, 732);
    assert.equal(CATALOG_MANIFEST.winnerOrder.length, 732);
    assert.deepEqual(CATALOG_MANIFEST.winnerOrder, EXPECTED_MANIFEST.winnerOrder);
    assert.equal(result.strategies.length, 732);
    const ids = result.strategies.map(strategy => strategy.id);
    assert.deepEqual(ids, EXPECTED_MANIFEST.winnerOrder);
    assert.equal(new Set(ids).size, 732);
    for (const strategy of result.strategies) {
      assert.ok(strategy.is_builtin === true);
      assert.equal(Object.hasOwn(strategy, 'blobs'), false, `${strategy.id} list blobs`);
      assert.ok(Array.isArray(strategy.profiles), `${strategy.id} list profiles`);
      for (const profile of strategy.profiles) {
        assert.equal(Object.hasOwn(profile, 'args'), false, `${strategy.id} list args`);
        assert.equal(profile.argsTruncated, true, `${strategy.id} bounded args marker`);
      }
    }
    assert.deepEqual(result.state, { revision: 0, favorites: [] });
    const bytes = Buffer.byteLength(JSON.stringify(result));
    assert.ok(bytes < 1024 * 1024, `strategies_list exceeds 1 MiB: ${bytes}`);
    assert.ok(bytes <= 768 * 1024, `strategies_list exceeds production budget: ${bytes}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Strategy list and detail emit authoritative active/favorite flags and metadata projections', () => {
  const storage = temporaryStrategyStorage();
  writeUserStrategy(storage);
  fs.writeFileSync(storage.state, JSON.stringify({ schema: 1, revision: 3,
    favorites: ['z2k_all_in_one', 'user-one'],
    selected: { id: 'z2k_all_in_one', origin: 'avatar_builtin', revision: 0, candidateSha256: 'a'.repeat(64) },
  }), { mode: 0o600 });
  try {
    const env = strategyStorageEnv(storage);
    const list = invokeValues('strategy_cli_dispatch', ['list', {}], env);
    assert.equal(list.ok, true);
    const builtin = list.strategies.find(strategy => strategy.id === 'z2k_all_in_one');
    const user = list.strategies.find(strategy => strategy.id === 'user-one');
    assert.equal(builtin.is_active, true);
    assert.equal(builtin.is_favorite, true);
    assert.equal(user.is_active, false);
    assert.equal(user.is_favorite, true);
    assert.equal(list.state.revision, 3);
    assert.deepEqual(list.state.favorites, ['z2k_all_in_one', 'user-one']);
    assert.equal(list.favoritesRevision, 3);
    assert.deepEqual(builtin.metadata, { catalogDigest: CATALOG_MANIFEST.aggregateDigest });
    assert.equal(typeof user.metadata, 'object');

    const detail = invokeValues('strategy_cli_dispatch', ['get', { id: 'z2k_all_in_one' }], env);
    assert.equal(detail.ok, true);
    assert.equal(detail.strategy.is_active, true);
    assert.equal(detail.strategy.is_favorite, true);
    assert.equal(detail.strategy.metadata.catalogDigest, CATALOG_MANIFEST.aggregateDigest);
    assert.equal(typeof detail.strategy.metadata.provenance.sourceFile, 'string');
    const userDetail = invokeValues('strategy_cli_dispatch', ['get', { id: 'user-one' }], env);
    assert.equal(userDetail.strategy.is_active, false);
    assert.equal(userDetail.strategy.is_favorite, true);
    assert.deepEqual(userDetail.strategy.metadata, { description: 'local' });
  } finally {
    fs.rmSync(storage.root, { recursive: true, force: true });
  }
});

test('RPC Preview uses authoritative server runtime composition and ignores client context', () => {
  const request = {
    edit: JSON.stringify({
      strategy_data: { id: 'rpc-runtime', name: 'RPC runtime', profiles: [{ id: 'p1', args: '--filter-tcp=443' }] },
    }),
  };
  const result = invokeRpcMethod('strategies_preview', request, authoritativeRuntimeEnv());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.effectiveArgv.slice(0, 4), [
    '/opt/zapret2/nfq2/nfqws2', '--qnum=30999',
    '--lua-init=/opt/zapret2/lua/zapret-lib.lua', '--hostlist=/lists/netrogat.txt',
  ]);
  assert.equal(result.effectiveArgv.includes('--qnum=forged'), false);
  assert.equal(result.dependencies.available, true);
  const forged = invokeRpcMethod('strategies_preview', {
    edit: JSON.stringify({
      strategy_data: { id: 'rpc-runtime', name: 'RPC runtime', profiles: [{ id: 'p1', args: '--filter-tcp=443' }] },
      runtimeInputs: { source: 'live', enginePath: '/opt/zapret2/nfq2/nfqws2', baseArgs: ['--qnum=forged'], luaInit: [], hostlists: [] },
    }),
  }, authoritativeRuntimeEnv());
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'EINPUT');
});

test('RPC Preview fails closed when authoritative runtime composition is unavailable', () => {
  const result = invokeRpcMethod('strategies_preview', {
    edit: JSON.stringify({
      strategy_data: { id: 'rpc-unavailable', name: 'RPC unavailable', profiles: [{ id: 'p1', args: '--filter-tcp=443' }] },
    }),
  }, {
    Z2M_STRATEGY_UCODE_BIN: UCODE_BIN,
    Z2M_STRATEGY_RPC: '1', Z2M_STRATEGY_SERVER_TEST: '1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EUNAVAILABLE');
});

test('full list is measured before any projection is allowed', () => {
  const storage = temporaryStrategyStorage();
  writeUserStrategy(storage);
  try {
    const probe = rpcTransportProbe(storage);
    const fullList = probe.result;
    assert.equal(fullList.ok, true);
    const builtinIds = fullList.strategies.filter(strategy => strategy.is_builtin === true)
      .map(strategy => strategy.id);
    const users = fullList.strategies.filter(strategy => strategy.origin === 'user');
    assert.deepEqual(builtinIds, EXPECTED_MANIFEST.winnerOrder);
    assert.equal(builtinIds.length, 732);
    assert.equal(new Set(builtinIds).size, 732);
    assert.equal(users.length, 1);
    assert.equal(users[0].id, 'user-one');
    assert.equal(users[0].is_active, false);
    assert.equal(users[0].is_favorite, true);
    assert.deepEqual(fullList.strategies.map(strategy => strategy.id),
      [...EXPECTED_MANIFEST.winnerOrder, 'user-one']);
    for (const strategy of fullList.strategies.filter(strategy => strategy.is_builtin === true)) {
      assert.equal(Object.hasOwn(strategy, 'blobs'), false);
      assert.ok(strategy.profiles.every(profile => profile.argsTruncated === true));
      assert.ok(strategy.profiles.every(profile => !Object.hasOwn(profile, 'args')));
    }
    assert.equal(fullList.state.revision, 3);
    assert.deepEqual(fullList.state.favorites, ['z2k_all_in_one', 'user-one']);

    const bytes = Buffer.byteLength(JSON.stringify(fullList));
    assert.ok(bytes < 1024 * 1024, `strategies_list exceeds 1 MiB: ${bytes}`);
    assert.ok(bytes <= 768 * 1024, `strategies_list exceeds production budget: ${bytes}`);
    console.log(`# strategies_list wire measurement: ${fullList.strategies.length} strategies, ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB), ${1024 * 1024 - bytes} bytes headroom`);
  } finally {
    fs.rmSync(storage.root, { recursive: true, force: true });
  }
});

test('Strategy read paths use direct in-process dispatch while mutations retain child transport', () => {
  assert.match(RPC, /import \{ strategy_cli_dispatch \} from ['"]\/usr\/libexec\/zapret2-manager\/strategy-cli\.uc['"]/);
  const list = RPC.slice(RPC.indexOf('function strategies_list_method'), RPC.indexOf('function strategies_create_method'));
  const get = RPC.slice(RPC.indexOf('function strategies_get_method'), RPC.indexOf('function strategies_create_method'));
  const status = RPC.slice(RPC.indexOf('function strategies_catalog_status_method'), RPC.indexOf('function strategies_catalog_reload_method'));
  const read = RPC.slice(RPC.indexOf('function strategy_read_input'), RPC.indexOf('function strategies_list_method'));
  assert.match(read, /strategy_cli_dispatch/);
  for (const body of [list, get, status, read]) {
    assert.doesNotMatch(body, /strategy_edit_action|head -c|popen|read\('all'\)/);
  }
  const mutations = RPC.slice(RPC.indexOf('function strategies_create_method'), RPC.indexOf('function strategies_ops_tmp'));
  assert.match(mutations, /strategy_edit_action/);

  const storage = temporaryStrategyStorage();
  writeUserStrategy(storage);
  const stub = stubChild('nonzero');
  try {
    const result = invokeRpcMethod('strategies_list', {}, {
      ...strategyStorageEnv(storage), Z2M_STRATEGY_UCODE_BIN: stub.file,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.strategies.some(strategy => strategy.id === 'user-one'), true);
  } finally {
    fs.rmSync(storage.root, { recursive: true, force: true });
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
});

test('strategies_list stays bounded under synthetic 732, 1000, and 1500-entry scaling', () => {
  const storage = temporaryStrategyStorage();
  writeUserStrategy(storage);
  try {
    const list = invokeValues('strategy_cli_dispatch', ['list', {}], strategyStorageEnv(storage));
    for (const count of [732, 1000, 1500]) {
      const synthetic = Array.from({ length: count }, (_, index) => list.strategies[index % list.strategies.length]);
      const bytes = Buffer.byteLength(JSON.stringify({ ok: true, strategies: synthetic, state: list.state }));
      assert.ok(bytes < 1024 * 1024, `${count} strategies exceeds 1 MiB: ${bytes}`);
      if (count === 732) assert.ok(bytes <= 768 * 1024, `${count} strategies exceeds production budget: ${bytes}`);
      console.log(`# synthetic strategies_list: ${count} strategies, ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB)`);
    }
  } finally {
    fs.rmSync(storage.root, { recursive: true, force: true });
  }
});

test('strategies_get retains full profiles for the largest builtin response', () => {
  const source = `import { strategy_cli_dispatch } from ${JSON.stringify(CLI_PATH)}; let ids = ${JSON.stringify(EXPECTED_MANIFEST.winnerOrder)}; let max = { id: null, bytes: 0 }; for (let id in ids) { let value = strategy_cli_dispatch('get', { id: id }); let bytes = length(sprintf('%J', value)); if (bytes > max.bytes) max = { id: id, bytes: bytes }; } print(sprintf('%J', max));`;
  const result = invokeUcode(source, {}, 45_000);
  assert.equal(result.id != null, true);
  assert.ok(result.bytes > 0);
  const detail = invokeValues('strategy_cli_dispatch', ['get', { id: result.id }]);
  assert.equal(detail.ok, true);
  assert.ok(detail.strategy.profiles.some(profile => typeof profile.args === 'string' && profile.args.length > 0));
  console.log(`# largest strategies_get: ${result.id}, ${result.bytes} bytes (${(result.bytes / 1024).toFixed(1)} KiB)`);
});

test('RPC rejects malformed or tampered catalog evidence before serving Strategy data', () => {
  const mutations = [
    ['malformed manifest', root => fs.writeFileSync(path.join(root, 'manifest.json'), '{'), 'EMANIFEST'],
    ['path traversal', root => {
      const manifestPath = path.join(root, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.files[0].path = 'advanced/../direct/tcp.txt';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }, 'EMANIFEST'],
    ['stale file hash', root => {
      const manifestPath = path.join(root, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.files[0].sha256 = '0'.repeat(64);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }, 'EDIGEST'],
    ['raw catalog byte tamper', root => {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      const target = path.join(root, ...manifest.files[0].path.split('/'));
      const original = fs.readFileSync(target);
      const mutated = Buffer.from(original);
      mutated[0] ^= 1;
      fs.writeFileSync(target, mutated);
      assert.equal(mutated.byteLength, original.byteLength);
      assert.notEqual(createHash('sha256').update(mutated).digest('hex'), manifest.files[0].sha256);
    }, 'EDIGEST'],
  ];

  for (const [name, mutate, code] of mutations) {
    const root = temporaryCatalog();
    try {
      mutate(root);
      const result = invokeRpcMethod('strategies_catalog_status', {}, {
        Z2M_STRATEGY_CATALOG_ROOT: root, Z2M_STRATEGY_UCODE_BIN: UCODE_BIN,
      });
      assert.equal(result.ok, false, name);
      assert.equal(result.error.code, 'EVERIFY', name);
      assert.match(result.error.message, /verified Strategy catalog is unavailable/);
      assert.notEqual(result.error.code, code, 'RPC must expose only its bounded verification envelope');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('RPC storage rejects traversal, builtin/extension collisions, shell input, and oversized Strategy/Profile data', () => {
  const storage = temporaryStrategyStorage();
  const env = strategyStorageEnv(storage);
  const marker = path.join(storage.root, 'shell-injection-marker');
  try {
    const traversal = invokeValues('strategy_cli_dispatch', ['create', {
      strategy: userStrategy({ id: '../escape' }),
    }], env);
    assert.equal(traversal.ok, false);
    assert.equal(traversal.error.code, 'EINPUT');
    assert.equal(fs.existsSync(path.join(storage.root, 'escape.json')), false);

    const builtin = invokeValues('strategy_cli_dispatch', ['create', {
      strategy: userStrategy({ id: 'fake_simple' }),
    }], env);
    assert.equal(builtin.ok, false);
    assert.equal(builtin.error.code, 'ECONFLICT');
    assert.equal(fs.existsSync(path.join(storage.strategies, 'fake_simple.json')), false);

    const extension = invokeValues('strategy_cli_dispatch', ['create', {
      strategy: userStrategy({ id: 'extension-one' }),
    }], env);
    assert.equal(extension.ok, false);
    assert.equal(extension.error.code, 'ECONFLICT');
    assert.equal(fs.existsSync(path.join(storage.strategies, 'extension-one.json')), false);

    const shellInput = invokeValues('strategy_cli_dispatch', ['create', {
      strategy: userStrategy({
        id: 'shell-safe',
        name: `$(touch ${marker}); &; |`,
        metadata: { description: `$(touch ${marker})` },
      }),
    }], env);
    assert.equal(shellInput.ok, true);
    assert.equal(fs.existsSync(marker), false, 'Strategy fields must never become shell commands');
    assert.equal(JSON.parse(fs.readFileSync(path.join(storage.strategies, 'shell-safe.json'), 'utf8')).name,
      `$(touch ${marker}); &; |`);

    fs.writeFileSync(path.join(storage.strategies, 'too-large.json'), 'x'.repeat(521029), { mode: 0o600 });
    fs.chmodSync(path.join(storage.strategies, 'too-large.json'), 0o600);
    const oversizedStrategy = invokeValues('strategy_cli_dispatch', ['get', { id: 'too-large' }], env);
    assert.equal(oversizedStrategy.ok, false);
    assert.equal(oversizedStrategy.error.code, 'EINPUT');

    const oversizedProfile = invokeValues('strategy_import_profiles_test', [
      { mode: 'preview' },
      { importProfiles: { draftState: {
        schema: 1,
        profiles: Array.from({ length: 257 }, (_, index) => ({
          id: `oversized-${index}`, name: 'Oversized', opt: '--filter-tcp=443',
        })),
      } } },
    ], { ...env, Z2M_STRATEGY_SERVER_TEST: '1' });
    assert.equal(oversizedProfile.ok, false);
    assert.equal(oversizedProfile.error.code, 'EINPUT');
  } finally {
    fs.rmSync(storage.root, { recursive: true, force: true });
  }
});

test('RPC rejects a stale catalog hash before compiling a Strategy', () => {
  const result = invokeValues('strategy_cli_dispatch', ['preview', {
    strategy_id: 'z2k_all_in_one', revision: 0, catalog_digest: '0'.repeat(64),
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ECONFLICT');
});

test('Strategy list returns durable ordered favorites state separately from Strategy objects', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-state-'));
  const strategies = path.join(root, 'strategies');
  const state = path.join(root, 'strategy-state.json');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  fs.writeFileSync(state, JSON.stringify({ schema: 1, revision: 7, favorites: ['z2k_all_in_one', 'user-one'], selected: null }), { mode: 0o600 });
  try {
    const result = invokeValues('strategy_cli_dispatch', ['list', {}], {
      Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies, Z2M_STRATEGY_STATE: state,
    });
    assert.deepEqual(result.state, { revision: 7, favorites: ['z2k_all_in_one', 'user-one'] });
    assert.equal(result.strategies.find(strategy => strategy.id === 'z2k_all_in_one').revision, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Strategy RPC registration keeps fixed CLI modes and explicit error envelopes', () => {
  assert.match(RPC, /STRATEGY_CLI\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/strategy-cli\.uc/);
  assert.match(RPC, /error:\s*\{\s*code:\s*'EINPUT'/);
  assert.match(RPC, /error:\s*\{\s*code:\s*'ETARGET'/);
  for (const mode of ['create', 'update', 'delete', 'duplicate', 'favorite',
    'preview', 'validate', 'apply', 'import_profiles'])
    assert.match(RPC, new RegExp(`strategy_edit_action\\(['"]${mode}['"]`), mode);
  assert.match(RPC, /strategy_noarg_action\(['"]catalog_reload['"]/);
  for (const mode of ['list', 'get', 'catalog_status'])
    assert.match(RPC, new RegExp(`strategy_read_action\\(['"]${mode}['"]`), mode);
  assert.doesNotMatch(RPC, /strategy_edit_action\([^)]*req[^)]*mode/);
});

test('Strategy CLI dispatch exposes state and catalog operations without a generic action', () => {
  for (const name of [
    'strategy_user_list', 'strategy_user_get_readonly', 'strategy_duplicate',
    'strategy_catalog_get',
    'strategy_catalog_status', 'strategy_catalog_reload',
  ]) assert.match(CLI, new RegExp(`\\b${name}\\b`), name);
  for (const name of ['user_create', 'user_update', 'user_delete', 'favorite'])
    assert.match(CLI, new RegExp(`strategy_state\\['strategy_' \\+ '${name}'\\]`), name);
  for (const mode of ['list', 'get', 'create', 'update', 'delete', 'duplicate',
    'favorite', 'preview', 'validate', 'apply', 'catalog_status', 'catalog_reload',
    'import_profiles']) {
    assert.match(CLI, new RegExp(`mode\\s*==\\s*['"]${mode}['"]`), mode);
  }
  assert.match(CLI, /strategy_cli_dispatch/);
  assert.doesNotMatch(CLI, /action\s*\(/);
  assert.doesNotMatch(CLI, /ARGV\[1\].*client|client.*ARGV/);
});

test('Strategy CLI request files reject malformed, oversized, and symlinked JSON with EINPUT', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-request-'));
  const malformed = path.join(root, 'malformed.json');
  const oversized = path.join(root, 'oversized.json');
  const target = path.join(root, 'target.json');
  const linked = path.join(root, 'linked.json');
  fs.writeFileSync(malformed, '{not-json');
  fs.writeFileSync(oversized, 'x'.repeat(524289));
  fs.writeFileSync(target, JSON.stringify({ args: {} }));
  fs.symlinkSync(target, linked);
  try {
    for (const request of [malformed, oversized, linked]) {
      const result = invokeValues('strategy_cli_request', ['preview', request]);
      assert.equal(result.ok, false, request);
      assert.equal(result.error.code, 'EINPUT', request);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI accepts an RPC-created private request after identity and size revalidation', () => {
  const request = path.join('/tmp', `z2m-strategy-edit.${process.pid}.json`);
  fs.writeFileSync(request, '{}', { mode: 0o600 });
  fs.chmodSync(request, 0o600);
  try {
    const result = invokeValues('strategy_cli_request', ['catalog_status', request], {
      Z2M_STRATEGY_REQUEST_UID: String(process.getuid?.() ?? 0),
      Z2M_STRATEGY_REQUEST_GID: String(process.getgid?.() ?? 0),
    });
    assert.equal(result.ok, true);
    assert.match(result.digest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(request, { force: true });
  }
});

test('Strategy CLI executable dispatches a fixed catalog mode through the request file', () => {
  const request = path.join(os.tmpdir(), `z2m-strategy-rpc-cli.${process.pid}.json`);
  fs.writeFileSync(request, '{}');
  const source = `import { strategy_cli_request } from ${JSON.stringify(CLI_PATH)}; print(sprintf('%J', strategy_cli_request('catalog_status', ${JSON.stringify(request)})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  try {
    const result = spawnSync(UCODE_BIN, argv, {
      cwd: ROOT,
      env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
        LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0,
      `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.match(output.digest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(request, { force: true });
  }
});

test('Preview and Validate retain inline Strategy input while Apply requires persisted identity', () => {
  assert.match(CLI, /if \(mode == 'preview'\) return strategy_preview\(input, context\)/);
  assert.match(CLI, /if \(mode == 'validate'\) return strategy_validate\(input, context\)/);
  assert.match(CLI, /if \(mode == 'apply'\) \{[\s\S]*return strategy_apply\(input, context\)/);
  assert.match(CLI, /input_shape\(input, true\)/);
  const dispatch = CLI.slice(CLI.indexOf('function dispatch_result'), CLI.indexOf('export const strategy_cli_dispatch'));
  assert.match(dispatch, /mode == 'apply'[\s\S]*input_shape\(input, true\)/);
  assert.match(CLI, /if \(requireSource == true && !hasId\)/);
});

test('Strategy CLI uses separate service catalog and Orchestra adapters', () => {
  assert.match(RPC, /CATALOG_CLI\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/catalog-cli\.uc/);
  assert.match(RPC, /ORCH_CLI\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/orchestra-cli\.uc/);
  assert.match(RPC, /catalog_(?:list|get|status|preview|apply)_method/);
  assert.doesNotMatch(RPC, /strategies_.*CATALOG_CLI|CATALOG_CLI.*strategies_/);
  assert.doesNotMatch(RPC, /strategies_.*ORCH_CLI|ORCH_CLI.*strategies_/);
});

test('ACL grants the exact Strategy read/write split and preserves existing Profile/Orchestra ACLs', () => {
  const acl = JSON.parse(ACL);
  const object = acl['zapret2-manager'];
  const read = object.read.ubus['zapret2-manager'];
  const write = object.write.ubus['zapret2-manager'];
  for (const method of READ_METHODS) assert.ok(read.includes(method), `read ${method}`);
  for (const method of WRITE_METHODS) assert.ok(write.includes(method), `write ${method}`);
  for (const method of READ_METHODS) assert.ok(!write.includes(method), `read leaked to write ${method}`);
  for (const method of WRITE_METHODS) assert.ok(!read.includes(method), `write leaked to read ${method}`);
  assert.ok(!write.includes('strategies_catalog_reload'));
  assert.ok(!read.includes('strategies_create'));
  assert.ok(read.includes('profiles_list') && write.includes('profiles_create'));
  assert.ok(read.includes('orchestra_status') && write.includes('orchestra_run_start'));
  for (const method of METHODS) assert.ok(read.includes(method) || write.includes(method), method);
});

test('Profile import dispatches the explicit Task 13 preview/create operation', () => {
  assert.match(CLI, /mode == 'import_profiles'[\s\S]*strategy_import_profiles\(input\)/);
  assert.match(CLI, /strategy_import_profiles_test\(input, context\)/);
  assert.match(CLI, /import \{ load_state \} from '\.\/profiles-draft\.uc'/);
  const result = invokeValues('strategy_cli_dispatch', ['import_profiles', {}]);
  assert.equal(result.error.code, 'EINPUT');
});

test('RPC import cannot fabricate a legacy draft through request context', () => {
  const forged = {
    schema: 1,
    profiles: [{ id: 'forged-profile', name: 'Forged', opt: '--filter-tcp=1' }],
  };
  const result = invokeRpcMethod('strategies_import_profiles', {
    edit: JSON.stringify({ mode: 'preview', importProfiles: { draftState: forged } }),
  });
  if (result.ok) assert.notEqual(result.strategy?.id, 'forged-profile');
  else assert.ok(['EINPUT', 'ECHILD'].includes(result.error.code), result.error.code);
});
