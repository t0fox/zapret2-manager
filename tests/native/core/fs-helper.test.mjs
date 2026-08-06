import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const tag = `z2m-fs-helper-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const testRoot = `/tmp/${tag}`;
const testBin = `/tmp/${tag}-test`;
const prodBin = `/tmp/${tag}-prod`;
const roots = {
  persistent_state: 'etc/zapret2-manager/state', snapshots: 'etc/zapret2-manager/snapshots',
  registry: 'etc/zapret2-manager/registry', secrets: 'etc/zapret2-manager/secrets',
  runtime: 'tmp/zapret2-manager/runtime', jobs: 'tmp/zapret2-manager/jobs',
  locks: 'tmp/zapret2-manager/locks', staging: 'tmp/zapret2-manager/staging'
};

function wsl(args, options = {}) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: options.encoding === 'buffer' ? null : (options.encoding ?? 'utf8'), input: options.input, env: process.env,
    timeout: options.timeout ?? 15000, maxBuffer: 16 * 1024 * 1024
  });
}

function shell(script) {
  const result = wsl(['sh', '-c', script]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function invoke(value, { binary = testBin, env = {}, timeout = 3000 } = {}) {
  const input = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value);
  const args = Object.entries({ Z2M_TEST_ROOT_PREFIX: testRoot, ...env }).flatMap(([key, val]) => [`${key}=${val}`]);
  const result = wsl(['env', ...args, binary], { input, timeout, encoding: 'buffer' });
  const stdout = result.stdout.toString('utf8');
  let response;
  try { response = JSON.parse(stdout); } catch { response = null; }
  return { ...result, stdout, stderr: result.stderr.toString('utf8'), response };
}

function request(operation, args, requestId = 'req-1') {
  return { protocolVersion: 1, requestId, operation, arguments: args };
}

function expectFailure(run, status, code, requestId = 'req-1', context = '') {
  assert.equal(run.status, status, run.stderr || run.stdout);
  assert.ok(run.stdout.endsWith('\n'));
  assert.equal(run.response?.protocolVersion, 1);
  assert.equal(run.response?.requestId, requestId);
  assert.equal(run.response?.ok, false);
  assert.equal(run.response?.error?.code, code, context);
  assert.equal(run.response?.error?.committed, false);
  assert.equal(run.response?.error?.durability, 'unchanged');
  assert.equal(typeof run.response?.error?.stage, 'string');
}

function write(root, relative, content, mode = '0600') {
  const target = `${testRoot}/${roots[root]}/${relative}`;
  const dir = target.slice(0, target.lastIndexOf('/'));
  shell(`mkdir -p '${dir}' && chmod 0700 '${dir}' && printf '%s' '${content}' > '${target}' && chmod ${mode} '${target}'`);
}

before(() => {
  let build = wsl(['sh', 'tests/native/core/build-fs-helper.sh', testBin, '-DZ2M_TESTING']);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  build = wsl(['sh', 'tests/native/core/build-fs-helper.sh', prodBin]);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const dirs = Object.values(roots).map((entry) => `'${testRoot}/${entry}'`).join(' ');
  shell(`umask 077; mkdir -p ${dirs}; chmod 0700 '${testRoot}' '${testRoot}/etc' '${testRoot}/etc/zapret2-manager' '${testRoot}/tmp' '${testRoot}/tmp/zapret2-manager' ${dirs}`);
});

after(() => shell(`rm -rf '${testRoot}' '${testBin}' '${prodBin}'`));

test('strict framing rejects empty, truncated, malformed, duplicate, trailing, NUL, UTF-8, and oversized input', () => {
  const cases = [
    ['', 'EMALFORMED'], ['{"protocolVersion":1', 'EMALFORMED'], ['{no}', 'EMALFORMED'],
    ['{"protocolVersion":1,"protocolVersion":1,"requestId":"x","operation":"stat_regular","arguments":{}}', 'EMALFORMED'],
    ['{}{}', 'EMALFORMED'], [Buffer.from([0x7b, 0x7d, 0x00]), 'EMALFORMED'],
    [Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]), 'EMALFORMED'],
    [Buffer.alloc(4 * 1024 * 1024 + 1, 0x20), 'EREQUESTTOOBIG']
  ];
  for (const [input, code] of cases) expectFailure(invoke(input), 2, code, null);
});

test('request schema is closed and validates version, ID, operation, aliases, fields, and integer types', () => {
  const invalid = [
    {}, request('stat_regular', { root: 'runtime', path: 'x' }, ''),
    { ...request('stat_regular', { root: 'runtime', path: 'x' }), protocolVersion: 2 },
    request('read', { root: 'runtime', path: 'x' }),
    { ...request('stat_regular', { root: 'runtime', path: 'x' }), extra: true },
    request('stat_regular', { root: 'runtime', path: 'x', extra: true }),
    request('read_regular', { root: 'runtime', path: 'x', maxBytes: 1.5 })
  ];
  for (const value of invalid) expectFailure(invoke(value), 2, 'ESCHEMA', value.requestId === '' ? null : (value.requestId ?? null));
  for (const root of ['state', 'unknown'])
    expectFailure(invoke(request('stat_regular', { root, path: 'x' })), 3, 'EROOT');
});

test('all eight exact root aliases are recognized and policy authorization remains closed', () => {
  for (const root of Object.keys(roots)) {
    const run = invoke(request('stat_regular', { root, path: 'missing' }, `root-${root}`));
    if (root === 'locks') expectFailure(run, 3, 'EDENIED', `root-${root}`);
    else expectFailure(run, 4, 'ENOENT', `root-${root}`);
  }
});

test('canonical relative path rejects every forbidden form and enforces byte/component/depth limits', () => {
  const bad = ['', '/x', '.', '..', 'a/./b', 'a/../b', 'a//b', 'a/', `a\0b`,
    'a'.repeat(256), `${'a/'.repeat(16)}a`, 'a'.repeat(4097)];
  for (const pathValue of bad)
    expectFailure(invoke(request('stat_regular', { root: 'runtime', path: pathValue })), 3, 'EPATH');
  const depth12 = Array(12).fill('a').join('/');
  const allowed = invoke(request('stat_regular', { root: 'runtime', path: depth12 }));
  expectFailure(allowed, 4, 'ENOENT');
});

test('root opening rejects missing, symlinked, non-directory, and insecure roots', () => {
  const base = `${testRoot}/${roots.registry}`;
  shell(`rmdir '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`ln -s '${testRoot}/${roots.runtime}' '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`rm '${base}'; printf x > '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`rm '${base}'; mkdir '${base}'; chmod 0770 '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`chmod 0700 '${base}'`);
});

test('stat_regular returns exact descriptor metadata for a regular file', () => {
  write('runtime', 'meta.bin', 'hello');
  const run = invoke(request('stat_regular', { root: 'runtime', path: 'meta.bin' }));
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(Object.keys(run.response.data).sort(), ['gid', 'mode', 'mtimeNsec', 'mtimeSec', 'size', 'type', 'uid'].sort());
  assert.equal(run.response.data.type, 'regular');
  assert.equal(run.response.data.size, 5);
  assert.equal(run.response.data.mode, '0600');
  assert.equal(run.response.data.uid, 0);
  assert.equal(run.response.data.gid, 0);
});

test('object opening refuses final/parent symlinks and non-regular objects without blocking', () => {
  const base = `${testRoot}/${roots.runtime}`;
  shell(`mkdir -m 0700 '${base}/real'; printf x > '${base}/real/file'; chmod 0600 '${base}/real/file'; ln -s real/file '${base}/final-link'; ln -s real '${base}/parent-link'; mkdir -m 0700 '${base}/dir'; mkfifo '${base}/fifo'; python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('${base}/socket')"; mknod '${base}/device' c 1 3`);
  for (const [name, code] of [['final-link', 'ESYMLINK'], ['parent-link/file', 'ESYMLINK'], ['dir', 'ENOTREG'], ['fifo', 'ENOTREG'], ['socket', 'ENOTREG'], ['device', 'ENOTREG']])
    expectFailure(invoke(request('stat_regular', { root: 'runtime', path: name }), { timeout: 1000 }), 4, code, 'req-1', name);
});

test('read_regular returns strict canonical base64 for empty, binary, and invalid UTF-8 bytes', () => {
  const base = `${testRoot}/${roots.jobs}`;
  shell(`: > '${base}/empty'; chmod 0600 '${base}/empty'; printf '\\000\\377\\300abc' > '${base}/bytes'; chmod 0600 '${base}/bytes'`);
  for (const [name, expected] of [['empty', Buffer.alloc(0)], ['bytes', Buffer.from([0, 255, 192, 97, 98, 99])]]) {
    const run = invoke(request('read_regular', { root: 'jobs', path: name, maxBytes: 100 }));
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(run.response.data.content, expected.toString('base64'));
    assert.equal(run.response.data.byteLength, expected.length);
    assert.deepEqual(Buffer.from(run.response.data.content, 'base64'), expected);
    assert.ok(Buffer.byteLength(run.stdout) <= 6 * 1024 * 1024);
  }
});

test('read bounds reject truncation at caller, operation, and root limits', () => {
  const base = `${testRoot}/${roots.runtime}`;
  shell(`truncate -s 1048576 '${base}/exact'; chmod 0600 '${base}/exact'; truncate -s 1048577 '${base}/over'; chmod 0600 '${base}/over'; printf abc > '${base}/small'; chmod 0600 '${base}/small'`);
  const exact = invoke(request('read_regular', { root: 'runtime', path: 'exact', maxBytes: 1048576 }));
  assert.equal(exact.status, 0, exact.stderr || exact.stdout);
  assert.equal(exact.response.data.byteLength, 1048576);
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'over', maxBytes: 1048577 })), 4, 'ETOOBIG');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'small', maxBytes: 2 })), 4, 'ETOOBIG');
  expectFailure(invoke(request('read_regular', { root: 'secrets', path: 'anything', maxBytes: 0 })), 3, 'EDENIED');
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'small', maxBytes: 4194305 })), 2, 'ESCHEMA');
  shell(`truncate -s 4194304 '${testRoot}/${roots.jobs}/max'; chmod 0600 '${testRoot}/${roots.jobs}/max'; truncate -s 4194305 '${testRoot}/${roots.jobs}/too-large'; chmod 0600 '${testRoot}/${roots.jobs}/too-large'`);
  const maximum = invoke(request('read_regular', { root: 'jobs', path: 'max', maxBytes: 4194304 }));
  assert.equal(maximum.status, 0, maximum.stderr || maximum.stdout);
  assert.equal(maximum.response.data.byteLength, 4194304);
  assert.ok(Buffer.byteLength(maximum.stdout) <= 6 * 1024 * 1024);
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'too-large', maxBytes: 4194304 })), 4, 'ETOOBIG');
});

test('read loop retries EINTR and accumulates injected short reads', () => {
  write('jobs', 'shim.bin', 'short-read-proof');
  const run = invoke(request('read_regular', { root: 'jobs', path: 'shim.bin', maxBytes: 32 }), {
    env: { Z2M_TEST_READ_SHIM: '1' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'short-read-proof');
});

test('reserved operations return EUNSUPPORTED before filesystem access and have no side effects', () => {
  const marker = `${testRoot}/${roots.runtime}/must-not-exist`;
  const operations = {
    atomic_write: { root: 'runtime', path: 'must-not-exist', content: '', mode: '0600', uid: 0, gid: 0, allowCreate: true },
    atomic_write_json: { root: 'runtime', path: 'must-not-exist', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true },
    mkdir_private: { root: 'runtime', path: 'must-not-exist', mode: '0700', uid: 0, gid: 0, existOk: false },
    sha256_regular: { root: 'runtime', path: 'missing', maxBytes: 1 },
    rename_owned: { root: 'runtime', fromPath: 'missing', toPath: 'must-not-exist', ownershipToken: 'a'.repeat(64), replace: false },
    unlink_owned: { root: 'runtime', path: 'missing', ownershipToken: 'a'.repeat(64), missingOk: false },
    lock_acquire: { name: 'test', owner: 'owner', timeoutMs: 0 },
    lock_release: { name: 'test', owner: 'owner', token: 'a'.repeat(64) },
    lock_status: { name: 'test' }
  };
  for (const [operation, args] of Object.entries(operations)) {
    const run = invoke(request(operation, args));
    expectFailure(run, 3, 'EUNSUPPORTED');
  }
  assert.equal(wsl(['test', '-e', marker]).status, 1);
});

test('reserved operations validate their complete closed schemas before EUNSUPPORTED', () => {
  const invalid = [
    request('atomic_write', { root: 'runtime', path: 'x', content: '', mode: '0644', uid: 0, gid: 0, allowCreate: true }),
    request('atomic_write_json', { root: 'runtime', path: 'x', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true, extra: true }),
    request('mkdir_private', { root: 'runtime', path: 'x', mode: '0700', uid: 1, gid: 0, existOk: true }),
    request('sha256_regular', { root: 'runtime', path: 'x', maxBytes: 1.5 }),
    request('rename_owned', { root: 'runtime', fromPath: 'a', toPath: 'b', ownershipToken: 'short', replace: false }),
    request('unlink_owned', { root: 'runtime', path: 'x', ownershipToken: 'g'.repeat(64), missingOk: false }),
    request('lock_acquire', { name: 'bad name', owner: 'owner', timeoutMs: 0 }),
    request('lock_release', { name: 'test', owner: '', token: 'a'.repeat(64) }),
    request('lock_status', { name: 'x'.repeat(257) })
  ];
  for (const value of invalid) expectFailure(invoke(value), 2, 'ESCHEMA');
});

test('production binary ignores and rejects test root substitution', () => {
  const run = invoke(request('stat_regular', { root: 'runtime', path: 'meta.bin' }), { binary: prodBin });
  expectFailure(run, 3, 'EROOT');
});

test('descriptor fallback refuses mounted descendants when mounting is available', (t) => {
  const mountpoint = `${testRoot}/${roots.runtime}/mounted`;
  shell(`mkdir -m 0700 '${mountpoint}'`);
  const mounted = wsl(['mount', '-t', 'tmpfs', 'tmpfs', mountpoint]);
  if (mounted.status !== 0) {
    t.skip(`mount unavailable: ${mounted.stderr.trim()}`);
    return;
  }
  try {
    shell(`printf escape > '${mountpoint}/file'; chmod 0600 '${mountpoint}/file'`);
    expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'mounted/file', maxBytes: 32 }), {
      env: { Z2M_TEST_FORCE_FALLBACK: '1' }
    }), 4, 'EXDEV');
  } finally {
    shell(`umount '${mountpoint}'`);
  }
});

test('symlink replacement race never reads outside the selected root', () => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`printf inside > '${base}/inside'; chmod 0600 '${base}/inside'; printf outside > '${testRoot}/outside'; chmod 0600 '${testRoot}/outside'`);
  for (let i = 0; i < 100; i++) {
    shell(`rm -f '${base}/race'; if [ $(( ${i} % 2 )) -eq 0 ]; then ln '${base}/inside' '${base}/race'; else ln -s '${testRoot}/outside' '${base}/race'; fi`);
    const run = invoke(request('read_regular', { root: 'staging', path: 'race', maxBytes: 32 }));
    if (run.status === 0) assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'inside');
    else assert.ok(['ESYMLINK', 'ENOENT'].includes(run.response?.error?.code), run.stdout);
  }
});
