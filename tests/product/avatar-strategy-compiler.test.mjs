import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UCODE_ROOT = process.platform === 'win32' && ROOT.startsWith('\\\\wsl.localhost\\Ubuntu\\')
  ? '/home/kirill/z2m-work/m5-native-state-store' : ROOT;
const COMPILER = path.posix.join(UCODE_ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
const MODEL = path.posix.join(UCODE_ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-model.uc');
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
    autoHostlist: '/lists/auto.txt',
  },
  blobs: {
    fake_default_tls: { path: 'fake_default_tls.bin', present: true },
    fake_default_http: { path: 'fake_default_http.bin', present: true },
    fake_default_quic: { path: 'fake_default_quic.bin', present: true },
    tls_google: { path: 'tls_google.bin', present: true },
  },
  lua: {
    'desync.lua': { present: true },
    'missing.lua': { present: false },
  },
  lists: {
    'scan/other.txt': { path: '/scan/other.txt', present: true },
    'scan/missing.txt': { path: '/scan/missing.txt', present: false },
  },
};

function invoke(functionName, ...args) {
  const source = `import { ${functionName} } from ${JSON.stringify(COMPILER)}; print(sprintf('%J', ${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function model(functionName, ...args) {
  const source = `import { ${functionName} } from ${JSON.stringify(MODEL)}; print(sprintf('%J', ${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function strategy(profiles, extra = {}) {
  return { id: 'compiler-test', name: 'Compiler test', profiles, ...extra };
}

test('compiler filters disabled Profiles, preserves order, and inserts separators', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'a', args: '--filter-tcp=80', enabled: true },
    { id: 'b', args: '--filter-tcp=443', enabled: false },
    { id: 'c', args: '--filter-udp=443', enabled: true },
  ]), environment);

  assert.equal(result.ok, true);
  assert.equal(result.strategyArgs, '--filter-tcp=80 --new --filter-udp=443');
  assert.equal(result.profilesCount, 2);
  assert.deepEqual(result.fragments, ['--filter-tcp=80', '--filter-udp=443']);
});

test('compiler autowraps only the pinned payload and Lua combinations', () => {
  const cases = [
    ['--payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls', '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls'],
    ['--payload=http_req --lua-desync=fake:blob=fake_default_http', '--filter-tcp=80 --filter-l7=http --payload=http_req --lua-desync=fake:blob=fake_default_http'],
    ['--payload=http_reply --lua-desync=fake', '--filter-tcp=80 --filter-l7=http --payload=http_reply --lua-desync=fake'],
    ['--payload=quic_initial --lua-desync=fake', '--filter-udp=443 --filter-l7=quic --payload=quic_initial --lua-desync=fake'],
    ['--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --lua-desync=fake', '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --lua-desync=fake'],
    ['--payload=tls_client_hello', '--payload=tls_client_hello'],
    ['--payload=dns_query --lua-desync=fake', '--payload=dns_query --lua-desync=fake'],
    ['--payload=all --lua-desync=fake:blob=fake_default_quic:repeats=6', '--payload=all --lua-desync=fake:blob=fake_default_quic:repeats=6'],
  ];

  for (const [input, expected] of cases) {
    const result = invoke('strategy_compile', strategy([{ id: 'p1', args: input }]), environment);
    assert.equal(result.ok, true, input);
    assert.equal(result.fragments[0], expected, input);
  }
});

test('compiler places injected list flags after filters and before the first payload', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --payload=tls_client_hello --lua-desync=fake' },
  ]), {
    ...environment,
    listMode: 'autohostlist',
    paths: { ...environment.paths, hostlistExclude: '/lists/netrogat.txt' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fragments[0], '--filter-tcp=443 --hostlist-auto=/lists/auto.txt --hostlist-exclude=/lists/netrogat.txt --payload=tls_client_hello --lua-desync=fake');
});

test('compiler adds each required Blob declaration once and resolves portable paths', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--lua-init=@lua/desync.lua --blob=tls_google:@bin/tls_google.bin --lua-desync=fake:blob=tls_google' },
    { id: 'p2', args: '--lua-desync=fake:blob=tls_google' },
  ], { blobs: ['tls_google', 'tls_google'] }), environment);

  assert.equal(result.ok, true);
  assert.equal(result.strategyArgs.split('--blob=tls_google:/opt/zapret2/bin/tls_google.bin').length - 1, 1);
  assert.match(result.strategyArgs, /--lua-init=\/opt\/zapret2\/lua\/desync\.lua/);
  assert.match(result.strategyArgs, /--blob=tls_google:\/opt\/zapret2\/bin\/tls_google\.bin/);
});

test('compiler preserves unknown options while exposing manager diagnostics', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --unknown=keep' },
  ]), environment);

  assert.equal(result.ok, true);
  assert.equal(result.strategyArgs, '--filter-tcp=443 --unknown=keep');
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'MANAGER_UNKNOWN_OPTION'));
});

test('zero enabled Profiles produce a successful empty structural candidate', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443', enabled: false },
  ]), environment);
  const candidate = invoke('strategy_candidate', strategy([
    { id: 'p1', args: '--filter-tcp=443', enabled: false },
  ]), environment);

  assert.deepEqual({
    ok: result.ok,
    strategyArgs: result.strategyArgs,
    fragments: result.fragments,
    profilesCount: result.profilesCount,
  }, { ok: true, strategyArgs: '', fragments: [], profilesCount: 0 });
  assert.deepEqual(candidate, { ok: true, candidate: '', fragments: [], profilesCount: 0 });
});

test('compiler preserves token semantics after canonicalization', () => {
  const original = "  --filter-tcp=443 --filter-l7=tls\t--lua-init=code='hello world'\n--payload=http_req --lua-desync=fake  ";
  const result = invoke('strategy_compile', strategy([{ id: 'p1', args: original }]), environment);
  const originalTokens = model('avatar_tokenize', original).tokens.map(token => token.value);
  const compiledTokens = model('avatar_tokenize', result.fragments[0]).tokens.map(token => token.value);

  assert.equal(result.ok, true);
  assert.deepEqual(compiledTokens, originalTokens);
});

test('missing dependencies remain inspectable and only execution admission is unavailable', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--lua-init=@lua/missing.lua --lua-desync=fake:blob=missing_blob' },
  ], { blobs: ['missing_blob'] }), {
    ...environment,
    blobs: { missing_blob: { path: 'missing_blob.bin', present: false } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dependencies.available, false);
  assert.equal(result.dependencies.missing.length, 2);
  assert.equal(result.applicable, false);
  assert.match(result.strategyArgs, /missing_blob/);
});

test('effective argv uses the same engine, base, Lua-init, hostlist, and strategy inputs', () => {
  const runtimeInputs = {
    source: 'live',
    enginePath: '/opt/zapret2/nfq2/nfqws2',
    baseArgs: ['--qnum=30999'],
    luaInit: ['/opt/zapret2/lua/zapret-lib.lua', '/opt/zapret2/lua/zapret-antidpi.lua'],
    hostlists: ['/lists/netrogat.txt'],
  };
  const result = invoke('strategy_effective_argv', '--filter-tcp=443 --new --filter-udp=443', runtimeInputs);

  assert.equal(result.ok, true);
  assert.deepEqual(result.argv, [
    '/opt/zapret2/nfq2/nfqws2',
    '--qnum=30999',
    '--lua-init=/opt/zapret2/lua/zapret-lib.lua',
    '--lua-init=/opt/zapret2/lua/zapret-antidpi.lua',
    '--hostlist=/lists/netrogat.txt',
    '--filter-tcp=443', '--new', '--filter-udp=443',
  ]);
  assert.equal(result.command, result.argv.map(argument => `'${argument}'`).join(' '));
});
