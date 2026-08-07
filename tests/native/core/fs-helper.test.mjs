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
const buildTempRoot = `/tmp/${tag}-temp`;
const buildRoot = `${buildTempRoot}/build`;
const testBin = `${buildRoot}/test`;
const prodBin = `${buildRoot}/prod`;
const noStatxBin = `${buildRoot}/no-statx`;
const protocolManifest = JSON.parse(fs.readFileSync(
  'zapret2-manager/src/z2m-core-helper/protocol-v1.json', 'utf8'));
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
  assert.equal(run.status, status, `${context}: ${run.stderr || run.stdout}`);
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
  let build = wsl(['mkdir', '-p', '-m', '0700', buildRoot]);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  build = wsl(['env', `TMPDIR=${buildTempRoot}`, 'sh', 'tests/native/core/build-fs-helper.sh', testBin, '-DZ2M_TESTING']);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
  build = wsl(['env', `TMPDIR=${buildTempRoot}`, 'sh', 'tests/native/core/build-fs-helper.sh', prodBin]);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
  build = wsl(['env', `TMPDIR=${buildTempRoot}`, 'sh', 'tests/native/core/build-fs-helper.sh', noStatxBin, '-DZ2M_TESTING', '-DZ2M_NO_STATX']);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
  const dirs = Object.values(roots).map((entry) => `'${testRoot}/${entry}'`).join(' ');
  shell(`umask 077; mkdir -p ${dirs}; chmod 0700 '${testRoot}' '${testRoot}/etc' '${testRoot}/etc/zapret2-manager' '${testRoot}/tmp' '${testRoot}/tmp/zapret2-manager' ${dirs}`);
});

after(() => shell(`rm -rf '${testRoot}' '${buildTempRoot}'`));

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

test('decoded NUL is rejected in every request identity without truncated echo', () => {
  const cases = [
    ['{"protocolVersion":1,"requestId":"safe\\u0000suffix","operation":"stat_regular","arguments":{"root":"runtime","path":"x"}}', null],
    ['{"protocolVersion":1,"requestId":"echo-safe","operation":"stat_regular\\u0000suffix","arguments":{"root":"runtime","path":"x"}}', 'echo-safe'],
    ['{"protocolVersion":1,"requestId":"echo-root","operation":"stat_regular","arguments":{"root":"runtime\\u0000suffix","path":"x"}}', 'echo-root'],
    ['{"protocolVersion":1,"requestId":"echo-path","operation":"stat_regular","arguments":{"root":"runtime","path":"x\\u0000suffix"}}', 'echo-path']
  ];
  for (const [wire, id] of cases) {
    const run = invoke(wire);
    expectFailure(run, id === 'echo-path' ? 3 : 2, id === 'echo-path' ? 'EPATH' : 'ESCHEMA', id);
    if (id !== null) assert.equal(run.response.requestId, id);
  }
});

test('duplicate scanner rejects excessive nesting and key work with a complete response', () => {
  const deep = `${'{"a":'.repeat(80)}0${'}'.repeat(80)}`;
  expectFailure(invoke(deep), 2, 'ESCHEMA', null);
  const keys = Array.from({ length: 5000 }, (_, i) => `"k${i}":0`).join(',');
  expectFailure(invoke(`{${keys}}`), 2, 'ESCHEMA', null);
});

test('duplicate scanner has bounded hash probes for adversarial common-prefix keys and catches a final duplicate', () => {
  const prefix = 'p'.repeat(3000);
  const fields = Array.from({ length: 1024 }, (_, i) => `"${prefix}${i.toString().padStart(4, '0')}":0`);
  const unique = invoke(`{${fields.join(',')}}`, { env: { Z2M_TEST_SCAN_STATS: '1' } });
  expectFailure(unique, 2, 'ESCHEMA', null);
  const probes = Number(unique.stderr.match(/scan-probes=(\d+)/)?.[1]);
  assert.ok(Number.isInteger(probes) && probes <= 4096, unique.stderr);

  fields[1023] = fields[0];
  const duplicate = invoke(`{${fields.join(',')}}`, { env: { Z2M_TEST_SCAN_STATS: '1' } });
  expectFailure(duplicate, 2, 'EMALFORMED', null);
  const duplicateProbes = Number(duplicate.stderr.match(/scan-probes=(\d+)/)?.[1]);
  assert.ok(Number.isInteger(duplicateProbes) && duplicateProbes <= 4096, duplicate.stderr);
});

test('scanner bounds empty-container work before bucket allocation amplification', () => {
  const wire = `[${Array(1100).fill('{}').join(',')}]`;
  const run = invoke(wire, { env: { Z2M_TEST_SCAN_STATS: '1' } });
  expectFailure(run, 2, 'ESCHEMA', null);
  const match = run.stderr.match(/scan-containers=(\d+) scan-bucket-allocs=(\d+)/);
  assert.ok(match, run.stderr);
  assert.ok(Number(match[1]) <= 1024, run.stderr);
  assert.equal(Number(match[2]), 0, run.stderr);
});

test('scanner rejects escaped NUL object keys at top-level and nested levels', () => {
  const wires = [
    '{"a\\u0000x":1,"a\\u0000y":2}',
    '{"a\\u0000x":1,"a\\u0000x":2}',
    '{"outer":{"a\\u0000x":1}}',
    '{"outer":{"deeper":{"a\\u0000x":1}}}'
  ];
  for (const wire of wires) expectFailure(invoke(wire), 2, 'ESCHEMA', null);
});

test('all eight exact root aliases are recognized and policy authorization remains closed', () => {
  for (const root of Object.keys(roots)) {
    const run = invoke(request('stat_regular', { root, path: 'missing' }, `root-${root}`));
    if (root === 'locks') expectFailure(run, 3, 'EDENIED', `root-${root}`);
    else expectFailure(run, 4, 'ENOENT', `root-${root}`);
  }
});

test('canonical relative path rejects every forbidden form and enforces byte/component/depth limits', () => {
  const bad = ['', '/x', '.', '..', 'a/./b', 'a/../b', 'a//b', 'a/', `a\0b`, 'a b', 'a"b',
    'a\\b', 'a:b', 'a\tb',
    'a'.repeat(256), `${'a/'.repeat(16)}a`, 'a'.repeat(4097)];
  for (const pathValue of bad)
    expectFailure(invoke(request('stat_regular', { root: 'runtime', path: pathValue })), 3, 'EPATH', 'req-1', JSON.stringify(pathValue));
  expectFailure(invoke(request('stat_regular', { root: 'runtime', path: 'aéb' })), 2, 'EMALFORMED', null, 'non-ASCII path');
  const depth12 = Array(12).fill('a').join('/');
  const allowed = invoke(request('stat_regular', { root: 'runtime', path: depth12 }));
  expectFailure(allowed, 4, 'ENOENT');
  const maximum = [...Array(15).fill('a'.repeat(255)), 'a'.repeat(254), 'a'].join('/');
  assert.equal(Buffer.byteLength(maximum), 4096);
  expectFailure(invoke(request('atomic_write_json', {
    root: 'persistent_state', path: maximum, value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true
  })), 3, 'EUNSUPPORTED');
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

test('object errors match the protocol manifest exit category and stage', () => {
  const base = `${testRoot}/${roots.runtime}`;
  shell(`mkdir -m 0700 '${base}/real'; printf x > '${base}/real/file'; chmod 0600 '${base}/real/file'; ln -s real/file '${base}/final-link'; ln -s real '${base}/parent-link'; mkdir -m 0700 '${base}/dir'; mkfifo '${base}/fifo'; python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('${base}/socket')"; mknod '${base}/device' c 1 3`);
  const cases = [
    ['final-link', 'ESYMLINK'], ['parent-link/file', 'ESYMLINK'],
    ['dir', 'ENOTREG'], ['fifo', 'ENOTREG'], ['socket', 'ENOTREG'],
    ['device', 'EDENIED', 3]
  ];
  for (const [name, code, status = 4] of cases) {
    const run = invoke(request('stat_regular', { root: 'runtime', path: name }), {
      timeout: 1000, env: { Z2M_TEST_FAIL_FALLBACK: '1' }
    });
    expectFailure(run, status, code, 'req-1', name);
    const policy = protocolManifest.errors[code];
    const exitCategory = Object.entries(protocolManifest.exitCategories)
      .find(([, exit]) => exit === run.status)?.[0];
    assert.ok(policy.allowedExitCategories.includes(exitCategory), `${name}: ${exitCategory}`);
    assert.ok(policy.allowedStages.includes(run.response.error.stage),
      `${name}: ${code} does not permit ${run.response.error.stage}`);
  }
});

test('descendant directories and final files must match private owner and mode policy', () => {
  const base = `${testRoot}/${roots.jobs}`;
  shell(`mkdir -m 0755 '${base}/wide'; printf secret > '${base}/wide/file'; chmod 0600 '${base}/wide/file'; printf secret > '${base}/wide-file'; chmod 0644 '${base}/wide-file'; printf secret > '${base}/foreign'; chmod 0600 '${base}/foreign'; chown 65534:65534 '${base}/foreign'`);
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'wide/file', maxBytes: 32 })), 3, 'EDENIED');
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'wide-file', maxBytes: 32 })), 3, 'EDENIED');
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'foreign', maxBytes: 32 })), 3, 'EDENIED');
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

test('transport retries stdin and stdout EINTR and short writes without corrupting response', () => {
  write('jobs', 'transport.bin', 'transport');
  const run = invoke(request('read_regular', { root: 'jobs', path: 'transport.bin', maxBytes: 32 }), {
    env: { Z2M_TEST_STDIN_SHIM: '1', Z2M_TEST_STDOUT_SHIM: '1' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.split('\n').length, 2);
  assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'transport');
});

test('unrecoverable partial stdout exits response-incomplete category', () => {
  const run = invoke(request('stat_regular', { root: 'jobs', path: 'missing' }), {
    env: { Z2M_TEST_STDOUT_FAIL_AFTER: '8' }
  });
  assert.equal(run.status, 74);
  assert.equal(run.response, null);
  assert.ok(run.stdout.length > 0 && run.stdout.length <= 8);
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

test('every path-bearing reserved schema applies the canonical path contract before EUNSUPPORTED', () => {
  const token = 'a'.repeat(64);
  const operations = {
    atomic_write: { root: 'runtime', path: 'x', content: '', mode: '0600', uid: 0, gid: 0, allowCreate: true },
    atomic_write_json: { root: 'runtime', path: 'x', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true },
    mkdir_private: { root: 'runtime', path: 'x', mode: '0700', uid: 0, gid: 0, existOk: false },
    sha256_regular: { root: 'runtime', path: 'x', maxBytes: 1 },
    rename_owned: { root: 'runtime', fromPath: 'x', toPath: 'y', ownershipToken: token, replace: false },
    unlink_owned: { root: 'runtime', path: 'x', ownershipToken: token, missingOk: false }
  };
  const invalidPaths = ['/absolute', 'a/../b', 'bad\tpath', 'nonascii-é'];
  for (const [operation, base] of Object.entries(operations)) {
    const fields = operation === 'rename_owned' ? ['fromPath', 'toPath'] : ['path'];
    for (const field of fields) {
      for (const invalidPath of invalidPaths) {
        const value = request(operation, { ...base, [field]: invalidPath });
        const wire = invalidPath === 'nonascii-é'
          ? JSON.stringify(value).replace('nonascii-é', 'nonascii-\\u00e9')
          : value;
        const run = invoke(wire);
        expectFailure(run, 2, 'ESCHEMA', 'req-1', `${operation}.${field}=${JSON.stringify(invalidPath)}`);
      }
    }
  }
});

test('atomic_write reserved schema accepts only canonical bounded base64', () => {
  const base = { root: 'runtime', path: 'x', mode: '0600', uid: 0, gid: 0, allowCreate: true };
  for (const content of ['YQ', 'YQ===', 'Y Q==', 'YQ=/', '****', 'YR=='])
    expectFailure(invoke(request('atomic_write', { ...base, content })), 2, 'ESCHEMA');
  expectFailure(invoke(request('atomic_write', { ...base, content: 'A'.repeat(4 * 1024 * 1024 + 4) })), 2, 'EREQUESTTOOBIG', null);
  for (const content of ['', 'YQ==', 'YWJj'])
    expectFailure(invoke(request('atomic_write', { ...base, content })), 3, 'EUNSUPPORTED');
  expectFailure(invoke(request('atomic_write', { ...base, path: 'bad path', content: '' })), 2, 'ESCHEMA');
});

test('allocation failures and unknown internal codes fail closed with stable exits', () => {
  for (let failAfter = 1; failAfter <= 16; failAfter++) {
    const allocation = invoke(request('stat_regular', { root: 'jobs', path: 'missing' }), {
      env: { Z2M_TEST_ALLOC_FAIL_AFTER: String(failAfter) }
    });
    assert.ok([4, 70, 74].includes(allocation.status), `allocation ${failAfter}: ${allocation.stderr || allocation.stdout}`);
    if (allocation.stdout.length > 0) assert.doesNotThrow(() => JSON.parse(allocation.stdout));
  }
  const unknown = invoke(request('stat_regular', { root: 'jobs', path: 'missing' }), {
    env: { Z2M_TEST_UNKNOWN_ERROR: '1' }
  });
  assert.equal(unknown.status, 70);
  assert.equal(unknown.response?.error?.code, 'EINTERNAL');
  assert.equal(unknown.response?.error?.stage, 'response_encode');
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

test('descriptor fallback refuses same-device bind mounts when mounting is available', (t) => {
  const source = `${testRoot}/bind-source`;
  const mountpoint = `${testRoot}/${roots.runtime}/bind-mounted`;
  shell(`mkdir -m 0700 '${source}' '${mountpoint}'; printf escape > '${source}/file'; chmod 0600 '${source}/file'`);
  const mounted = wsl(['mount', '--bind', source, mountpoint]);
  if (mounted.status !== 0) {
    t.skip(`bind mount unavailable: ${mounted.stderr.trim()}`);
    return;
  }
  try {
    expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'bind-mounted/file', maxBytes: 32 }), {
      env: { Z2M_TEST_FORCE_FALLBACK: '1' }
    }), 4, 'EXDEV');
  } finally {
    shell(`umount '${mountpoint}'`);
  }
});

test('descriptor fallback rejects changed mount identity and fails when mount identity is unavailable', () => {
  write('runtime', 'mount-id/file', 'inside');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'mount-id/file', maxBytes: 32 }), {
    env: { Z2M_TEST_FORCE_FALLBACK: '1', Z2M_TEST_MNT_ID_CHANGE: '1' }
  }), 4, 'EXDEV');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'mount-id/file', maxBytes: 32 }), {
    env: { Z2M_TEST_FORCE_FALLBACK: '1', Z2M_TEST_MNT_ID_UNAVAILABLE: '1' }
  }), 3, 'ECAPABILITY');
});

test('successful openat2 remains usable when fallback mount identity is unavailable', () => {
  write('runtime', 'openat2/file', 'primary-path');
  const run = invoke(request('read_regular', { root: 'runtime', path: 'openat2/file', maxBytes: 32 }), {
    env: { Z2M_TEST_MNT_ID_UNAVAILABLE: '1', Z2M_TEST_FAIL_FALLBACK: '1' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'primary-path');
});

test('build without statx constants compiles and fails fallback with ECAPABILITY', () => {
  write('runtime', 'no-statx/file', 'inside');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'no-statx/file', maxBytes: 32 }), {
    binary: noStatxBin,
    env: { Z2M_TEST_FORCE_FALLBACK: '1' }
  }), 3, 'ECAPABILITY');
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
