import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UCODE_ROOT = process.env.UCODE_ROOT || ROOT;
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
  functions: {
    fake: { present: true },
  },
  lists: {
    'lists/auto.txt': { path: '/lists/auto.txt', present: true },
    'lists/netrogat.txt': { path: '/lists/netrogat.txt', present: true },
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
  assert.equal(result.applicable, true, JSON.stringify(result.dependencies));
  assert.equal(result.fragments[0], '--filter-tcp=443 --hostlist-auto=/lists/auto.txt --hostlist-exclude=/lists/netrogat.txt --payload=tls_client_hello --lua-desync=fake');
});

test('list suppression is scoped to the corresponding include or exclude flag', () => {
  const paths = { ...environment.paths, hostlistExclude: '/lists/netrogat.txt' };
  const auto = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --hostlist=/custom/include.txt --payload=tls_client_hello' },
  ]), { ...environment, listMode: 'autohostlist', paths });
  const explicit = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --hostlist-auto=/custom/auto.txt --payload=tls_client_hello' },
  ]), {
    ...environment, listMode: 'explicit', listPath: '/scan/other.txt', paths,
  });
  const ipsetExclude = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-udp=443 --ipset-exclude=lists/ru.txt --payload=quic_initial' },
  ]), { ...environment, listMode: 'autohostlist', paths });

  assert.match(auto.fragments[0], /--hostlist=\/custom\/include\.txt --hostlist-auto=\/lists\/auto\.txt/);
  assert.match(auto.fragments[0], /--hostlist-exclude=\/lists\/netrogat\.txt/);
  assert.match(explicit.fragments[0], /--hostlist-auto=\/custom\/auto\.txt --hostlist=\/scan\/other\.txt/);
  assert.match(ipsetExclude.fragments[0], /--ipset-exclude=\/lists\/ru\.txt --hostlist-auto=\/lists\/auto\.txt/);
});

test('list and ipset dependencies resolve relative descriptors and absolute listPath safely', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --hostlist=lists/relative.txt --ipset=lists/missing-ipset.txt' },
  ]), {
    ...environment,
    listMode: 'explicit',
    listPath: '/scan/relative.txt',
    lists: {
      'scan/relative.txt': { path: 'relative.txt', present: true },
      'lists/relative.txt': { path: 'relative.txt', present: true },
      'missing-ipset.txt': { path: 'missing-ipset.txt', present: false },
    },
  });
  const unsafe = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443' },
  ]), { ...environment, listMode: 'explicit', listPath: '/etc/passwd', lists: {} });

  assert.equal(result.ok, true);
  assert.equal(result.applicable, false, JSON.stringify(result.dependencies));
  assert.ok(result.dependencies.missing.some(item => item.kind === 'ipset'
    && item.reference === 'lists/missing-ipset.txt'));
  assert.match(result.strategyArgs, /--hostlist=\/lists\/relative\.txt/);
  assert.match(result.strategyArgs, /--ipset=\/lists\/missing-ipset\.txt/);
  assert.equal(unsafe.applicable, false);
  assert.ok(unsafe.dependencies.missing.some(item => item.kind === 'hostlist'
    && item.reference === '/etc/passwd'));
  assert.doesNotMatch(unsafe.strategyArgs, /--hostlist=\/etc\/passwd/);
});

test('missing native list roots preserve original options without null executable paths', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --hostlist=lists/missing.txt --ipset=lists/missing-ipset.txt' },
  ]), {
    ...environment,
    paths: { ...environment.paths, listRoot: null, ipsetRoot: null },
  });

  assert.equal(result.ok, true);
  assert.equal(result.applicable, false);
  assert.doesNotMatch(result.strategyArgs, /=(null|undefined)(?:\s|$)/);
  assert.match(result.strategyArgs, /--hostlist=lists\/missing\.txt/);
  assert.match(result.strategyArgs, /--ipset=lists\/missing-ipset\.txt/);
  assert.ok(result.dependencies.missing.some(item => item.kind === 'hostlist'));
  assert.ok(result.dependencies.missing.some(item => item.kind === 'ipset'));
});

test('unsafe explicit list options remain inspectable and non-applicable', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --hostlist=lists/../escape.txt --ipset=/etc/passwd' },
  ]), environment);

  assert.equal(result.ok, true);
  assert.equal(result.applicable, false);
  assert.match(result.strategyArgs, /--hostlist=lists\/\.\.\/escape\.txt/);
  assert.match(result.strategyArgs, /--ipset=\/etc\/passwd/);
  assert.doesNotMatch(result.strategyArgs, /--(?:hostlist|ipset)=null/);
  assert.equal(result.dependencies.missing.filter(item => item.kind === 'hostlist' || item.kind === 'ipset').length, 2);
});

test('symlinked list descriptors are non-applicable even when marked present', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --hostlist=lists/symlink.txt' },
  ]), {
    ...environment,
    lists: { 'symlink.txt': { path: 'real.txt', present: true, symlink: true } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.applicable, false);
  assert.ok(result.dependencies.missing.some(item => item.kind === 'hostlist'
    && item.reference === 'lists/symlink.txt'));
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

test('inline hex Blob sources are available without catalog descriptors', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --blob=inline_blob:0xA1B2C3 --lua-desync=fake:blob=inline_blob' },
  ]), environment);

  assert.equal(result.ok, true);
  assert.equal(result.applicable, true, JSON.stringify(result.dependencies));
  assert.doesNotMatch(result.dependencies.missing.map(item => item.reference).join(' '), /inline_blob/);
  assert.match(result.strategyArgs, /--blob=inline_blob:0xA1B2C3/);
});

test('compiler rejects absolute, traversing, and symlinked Blob/path resolutions', () => {
  const cases = [
    { path: '../escape.bin', symlink: false },
    { path: '/etc/passwd', symlink: false },
    { path: 'real.bin', symlink: true },
  ];

  for (const descriptor of cases) {
    const result = invoke('strategy_compile', strategy([
      { id: 'p1', args: '--lua-init=@lua/../escape.lua --lua-desync=fake:blob=unsafe_blob' },
    ], { blobs: ['unsafe_blob'] }), {
      ...environment,
      blobs: { unsafe_blob: { ...descriptor, present: true } },
    });

    assert.equal(result.ok, true, JSON.stringify(descriptor));
    assert.equal(result.applicable, false, JSON.stringify(descriptor));
    assert.ok(result.dependencies.missing.some(item => item.kind === 'blob'), JSON.stringify(descriptor));
    assert.doesNotMatch(result.strategyArgs, /--blob=unsafe_blob:/, JSON.stringify(descriptor));
    assert.match(result.strategyArgs, /--lua-init=@lua\/\.\.\/escape\.lua/, JSON.stringify(descriptor));
  }

  const unsafeSource = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --blob=tls_google:/etc/passwd' },
  ]), environment);
  assert.equal(unsafeSource.applicable, false);
  assert.ok(unsafeSource.dependencies.missing.some(item => item.kind === 'blob'));
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
  assert.equal(candidate.ok, true);
  assert.equal(candidate.candidate, '');
  assert.deepEqual(candidate.fragments, []);
  assert.equal(candidate.profilesCount, 0);
  assert.equal(candidate.candidateSha256, createHash('sha256').update('').digest('hex'));
  assert.equal(candidate.expectedHash, candidate.candidateSha256);
  assert.equal(candidate.dependencies.available, true);
  assert.equal(candidate.applicable, false);
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

test('missing Blob, Lua, function, list, and ipset dependencies remain bounded and inspectable', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--lua-init=@lua/missing.lua --hostlist=lists/missing.txt --ipset=lists/missing-ipset.txt --lua-desync=missing_function:blob=missing_blob' },
  ], { blobs: ['missing_blob'] }), {
    ...environment,
    blobs: { missing_blob: { path: 'missing_blob.bin', present: false } },
    functions: { missing_function: { present: false } },
    lists: {
      'missing.txt': { path: 'missing.txt', present: false },
      'missing-ipset.txt': { path: 'missing-ipset.txt', present: false },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.structurallyCompilable, true);
  assert.equal(result.dependencies.available, false);
  assert.equal(result.applicable, false);
  for (const kind of ['blob', 'lua', 'function', 'hostlist', 'ipset']) {
    assert.ok(result.dependencies.missing.some(item => item.kind === kind
      && typeof item.id === 'string' && typeof item.reason === 'string'), kind);
  }
});

test('unknown Lua functions are unavailable when no function registry is supplied', () => {
  const { functions, ...withoutFunctionRegistry } = environment;
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --lua-desync=fake' },
  ]), withoutFunctionRegistry);

  assert.equal(result.ok, true);
  assert.equal(result.structurallyCompilable, true);
  assert.equal(result.dependencies.available, false);
  assert.equal(result.applicable, false);
  assert.ok(result.dependencies.missing.some(item => item.kind === 'function'
    && item.id === 'fake' && /registry|unknown/i.test(item.reason)));
});

test('missing injected auto-hostlist and exclusion paths remain inspectable and unavailable', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --payload=tls_client_hello --lua-desync=fake' },
  ]), {
    ...environment,
    listMode: 'autohostlist',
    lists: {},
    paths: {
      ...environment.paths,
      autoHostlist: '/lists/missing-auto.txt',
      hostlistExclude: '/lists/missing-exclude.txt',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dependencies.available, false);
  assert.equal(result.applicable, false);
  assert.match(result.strategyArgs, /--hostlist-auto=\/lists\/missing-auto\.txt/);
  assert.match(result.strategyArgs, /--hostlist-exclude=\/lists\/missing-exclude\.txt/);
  assert.ok(result.dependencies.missing.some(item => item.kind === 'hostlist'
    && item.id === '/lists/missing-auto.txt'));
  assert.ok(result.dependencies.missing.some(item => item.kind === 'hostlist'
    && item.id === '/lists/missing-exclude.txt'));
});

test('pure compilation exposes dependency/native status without invoking native dry-run', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --lua-desync=fake' },
  ]), environment);

  assert.equal(result.ok, true);
  assert.equal(result.structurallyCompilable, true);
  assert.equal(result.dependencies.available, true);
  assert.equal(result.dependencies.nativeValidation.status, 'not_checked');
  assert.equal(result.nativeValidation.status, 'not_checked');
});

test('compiler pure paths have no write, install, or network operations', () => {
  const source = readFileSync(path.join(ROOT,
    'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc'), 'utf8');

  assert.doesNotMatch(source, /\b(?:writefile|unlink|mkdir|rename|install|curl|wget|uci|opkg|apk)\s*\(/);
});

test('validate=true performs native admission and exposes the bounded result', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --lua-desync=fake' },
  ]), { ...environment, validate: true });

  assert.equal(result.ok, true);
  assert.equal(result.structurallyCompilable, true);
  assert.notEqual(result.nativeValidation.status, 'not_checked');
  assert.equal(result.dependencies.nativeValidation.status, result.nativeValidation.status);
  assert.equal(result.executable, result.applicable && result.nativeValidation.status === 'verified');
});

test('executionAdmission=true invokes native preflight while the pure path does not', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --lua-desync=fake' },
  ]), { ...environment, executionAdmission: true });

  assert.equal(result.ok, true);
  assert.notEqual(result.nativeValidation.status, 'not_checked');
  assert.equal(result.dependencies.nativeValidation.status, result.nativeValidation.status);
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
  assert.deepEqual(result.effectiveArgv, result.argv);
  assert.equal(result.effectiveCommand, result.command);
  assert.deepEqual(result.fullArgv, result.argv);
  assert.equal(result.fullCommand, result.command);
});

test('effective argv rejects client-composed inputs and shell-quotes captured values', () => {
  const captured = {
    source: 'live',
    enginePath: '/opt/zapret2/nfq2/nfqws2',
    baseArgs: ['--qnum=30999'],
    luaInit: [],
    hostlists: ["/lists/$HOME;touch '/tmp/pwned'"],
  };
  const safe = invoke('strategy_effective_argv', '--filter-tcp=443', captured);
  const rejectedArgv = invoke('strategy_effective_argv', '--filter-tcp=443', {
    ...captured, argv: ['/bin/sh', '-c', 'touch /tmp/pwned'],
  });
  const rejectedSource = invoke('strategy_effective_argv', '--filter-tcp=443', {
    ...captured, source: 'client', command: '/bin/sh -c touch',
  });

  assert.equal(safe.ok, true);
  assert.ok(safe.command.includes("'--hostlist=/lists/$HOME;touch "));
  assert.ok(safe.command.includes("'\\''/tmp/pwned'\\''"));
  assert.equal(rejectedArgv.ok, false);
  assert.equal(rejectedSource.ok, false);
});

test('strategy candidate carries Apply-compatible SHA-256 identity and admission fields', () => {
  const result = invoke('strategy_candidate', strategy([
    { id: 'p1', args: '--filter-tcp=443' },
  ]), environment);
  const expected = createHash('sha256').update(result.candidate).digest('hex');

  assert.equal(result.ok, true);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.equal(result.digest, expected);
  assert.equal(result.candidateSha256, expected);
  assert.equal(result.expectedHash, expected);
  assert.equal(result.strategyArgs, result.candidate);
  assert.equal(typeof result.dependencies.available, 'boolean');
  assert.equal(result.applicable, result.dependencies.available);
});

test('list placement remains after the last filter when options are interleaved', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --lua-desync=fake --comment=between --filter-l7=tls --payload=tls_client_hello' },
  ]), {
    ...environment,
    listMode: 'autohostlist',
    paths: { ...environment.paths, hostlistExclude: '/lists/netrogat.txt' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fragments[0], '--filter-tcp=443 --lua-desync=fake --comment=between --filter-l7=tls --hostlist-auto=/lists/auto.txt --hostlist-exclude=/lists/netrogat.txt --payload=tls_client_hello');
});

test('list placement stays before the first payload when a later filter follows it', () => {
  const result = invoke('strategy_compile', strategy([
    { id: 'p1', args: '--filter-tcp=443 --payload=tls_client_hello --filter-l7=tls --lua-desync=fake' },
  ]), {
    ...environment,
    listMode: 'autohostlist',
    paths: { ...environment.paths, hostlistExclude: '/lists/netrogat.txt' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.fragments[0], '--filter-tcp=443 --hostlist-auto=/lists/auto.txt --hostlist-exclude=/lists/netrogat.txt --payload=tls_client_hello --filter-l7=tls --lua-desync=fake');
});
